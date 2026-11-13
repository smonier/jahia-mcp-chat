import {deleteUser} from '@jahia/cypress';
import {TestUser, createTestSite, createTestUser, deleteTestSite, genaiStatus, sse} from '../support/mc';

const BUTTON = 'MCP Chat';
const DRAWER = 'dialog[aria-labelledby="jahia-mcp-chat-drawer-title"]';
const INPUT = `${DRAWER} textarea[aria-label="Message input"]`;
const ANSWER = `${DRAWER} [class*="answer"]`;

/**
 * The chat drawer in jContent, as an editor. genai-connector is stubbed (its status and its agent stream), so the
 * conversation tests need no model and give the same answer every run; the module's own servlets are real.
 */
describe('jahia-mcp-chat - drawer', () => {
    const siteKey = 'mc-drawer';
    const editor: TestUser = {username: 'mc-drawer-editor', password: 'mcEditor1234'};
    const pageUrl = `/jahia/jcontent/${siteKey}/en/pages/home`;

    const open = () => {
        cy.login(editor.username, editor.password);
        cy.visit(pageUrl);
        cy.window().then(win => {
            win.localStorage.removeItem('jahia-mcp-chat:history');
            win.localStorage.removeItem('jahia-mcp-chat:panelWidth');
        });
        cy.contains('button', BUTTON, {timeout: 30000}).click();
        cy.get(DRAWER).should('be.visible');
    };

    const stubConnector = (frames?: Array<[string, Record<string, unknown>]>) => {
        cy.intercept('GET', '**/modules/genai/status', {statusCode: 200, body: genaiStatus()}).as('status');
        if (frames) {
            cy.intercept('POST', '**/modules/genai/agent/stream', {
                statusCode: 200, headers: {'content-type': 'text/event-stream'}, body: sse(frames)
            }).as('stream');
        }
    };

    const send = (text: string) => {
        cy.get(INPUT).type(text);
        cy.get(INPUT).type('{enter}');
    };

    before(() => {
        createTestSite(siteKey);
        createTestUser(editor, `/sites/${siteKey}`, ['editor']);
    });

    beforeEach(() => {
        // jContent's own ResizeObserver can read an unmounted node when the page goes away at sign-out: only that
        // error is ignored, any error of the module still fails the test.
        cy.on('uncaught:exception', error => !(error.message.includes('offsetWidth')
            && String(error.stack).includes('/modules/jcontent/')));
    });

    afterEach(() => {
        cy.logout();
    });

    after(() => {
        deleteUser(editor.username);
        deleteTestSite(siteKey);
    });

    it('docks beside the page under edit and gives the page its width back on Escape', () => {
        stubConnector();
        open();
        cy.get('#page-builder-frame-1').parent().should($wrapper => {
            const frame = $wrapper[0].getBoundingClientRect();
            const drawer = Cypress.$(DRAWER)[0].getBoundingClientRect();
            expect(frame.right, 'the page ends where the drawer starts').to.be.lessThan(drawer.left);
            expect(Math.abs(frame.top - drawer.top), 'under the header, with the page').to.be.lessThan(2);
        });
        cy.get(DRAWER).should('contain.text', 'Balanced').and('contain.text', 'model-balanced');
        cy.focused().type('{esc}');
        cy.get(DRAWER).should('not.exist');
        cy.get('#page-builder-frame-1').parent()
            .should($wrapper => expect($wrapper[0].style.marginRight, 'the page gets its width back').to.eq('0px'));
    });

    it('says what is missing when genai-connector is not installed', () => {
        cy.intercept('GET', '**/modules/genai/status', {statusCode: 404, body: 'Not found'});
        open();
        cy.get(DRAWER).should('contain.text', 'The assistant is not available')
            .and('contain.text', 'genai-connector');
        cy.get(`${DRAWER} button`).contains('Send').closest('button').should('be.disabled');
    });

    it('shows the model tiers and the MCP servers in Settings', () => {
        stubConnector();
        open();
        cy.get('#jahia-mcp-chat-tab-settings').click();
        cy.get('#jahia-mcp-chat-tab-settings').should('have.attr', 'aria-selected', 'true');
        cy.get('#jahia-mcp-chat-panel-settings').within(() => {
            cy.contains('Model tier').should('be.visible');
            cy.contains('Balanced - test-provider / model-balanced').should('be.visible');
            cy.contains('MCP servers').should('be.visible');
            // The Jahia server counts the connector's tools that belong to no remote server
            cy.contains('Connected').should('be.visible');
            cy.contains('3 tools').should('be.visible');
        });
    });

    it('renders an answer as Markdown, also when the model wraps it in a fence', () => {
        stubConnector([
            ['start', {streamId: 's1'}],
            ['partial', {text: '```markdown\n## Content types\n\n| Name | Type |\n|---|---|\n| **Card** | `dsfr:card` |\n| Tile | `dsfr:tile` |\n```'}],
            ['complete', {text: '', stop: 'END_TURN', usage: {inputTokens: 1200, outputTokens: 80}}]
        ]);
        open();
        send('Which content types can I use?');
        cy.wait('@stream').its('request.body').should(body => {
            expect(body.tier).to.eq('balanced');
            expect(body.input).to.eq('Which content types can I use?');
            expect(body.instructions).to.contain(siteKey);
        });
        cy.get(`${ANSWER} table`).should('be.visible').within(() => {
            cy.get('th').first().should('have.text', 'Name');
            cy.get('tbody tr').should('have.length', 2);
            cy.get('strong').should('have.text', 'Card');
            cy.get('code').first().should('have.text', 'dsfr:card');
        });
        cy.get(`${ANSWER} h2`).should('have.text', 'Content types');
        cy.get(DRAWER).should('not.contain.text', '```').and('not.contain.text', '|---');
        cy.get(DRAWER).should('contain.text', '1.2k in, 80 out, 1.3k tokens');
    });

    // A run that waits for an approval keeps its stream open: the stream is played inside the page, and stays open
    // until the chat answers the approval (a canned response would end at once, and the chat clears an approval
    // when its run ends).
    it('shows each tool call, and sends the editor\'s answer to an approval', () => {
        stubConnector();
        open();
        const confirmations: Array<Record<string, unknown>> = [];
        cy.window().then(win => {
            const original = win.fetch.bind(win);
            const encoder = new TextEncoder();
            win.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
                const url = String(input);
                if (url.includes('/modules/genai/agent/confirm')) {
                    confirmations.push(JSON.parse(String(init?.body)));
                    return Promise.resolve(new win.Response('{"status":"decided"}', {status: 200}));
                }
                if (!url.includes('/modules/genai/agent/stream')) {
                    return original(input, init);
                }
                const body = new win.ReadableStream({
                    start(controller) {
                        controller.enqueue(encoder.encode(sse([
                            ['start', {streamId: 's2'}],
                            ['tool_call', {callId: 'c1', tool: 'page.list', safety: 'READ_ONLY', requiresApproval: false, argumentsJson: '{"siteKey":"mc-drawer"}'}],
                            ['tool_result', {callId: 'c1', tool: 'page.list', safety: 'READ_ONLY', ok: true, durationMs: 9, resultPreview: '{"count":1}'}],
                            ['tool_call', {callId: 'c2', tool: 'content.update', safety: 'MUTATING', requiresApproval: true, argumentsJson: '{"path":"/sites/mc-drawer/home"}'}],
                            ['approval_required', {streamId: 's2', callId: 'c2', tool: 'content.update', safety: 'MUTATING', argumentsJson: '{"path":"/sites/mc-drawer/home"}'}]
                        ])));
                        const wait = win.setInterval(() => {
                            if (confirmations.length > 0) {
                                win.clearInterval(wait);
                                controller.enqueue(encoder.encode(sse([
                                    ['tool_result', {callId: 'c2', tool: 'content.update', safety: 'MUTATING', ok: false, durationMs: 1, resultPreview: '{"error":"declined"}'}],
                                    ['partial', {text: 'The change was declined.'}],
                                    ['complete', {text: '', stop: 'END_TURN', usage: {inputTokens: 40, outputTokens: 6}}]
                                ])));
                                controller.close();
                            }
                        }, 100);
                    }
                });
                return Promise.resolve(new win.Response(body, {status: 200, headers: {'Content-Type': 'text/event-stream'}}));
            };
        });
        send('Rename the home page');
        cy.get(DRAWER).contains('page.list').should('be.visible');
        cy.get(DRAWER).contains('Done').should('be.visible');
        cy.get(`${DRAWER} [role="alertdialog"]`).should('be.visible')
            .and('contain.text', 'content.update')
            .and('contain.text', '/sites/mc-drawer/home');
        cy.get(`${DRAWER} [role="alertdialog"]`).contains('button', 'Deny').click();
        cy.wrap(confirmations).should('deep.eq', [{streamId: 's2', callId: 'c2', approve: false}]);
        cy.get(`${DRAWER} [role="alertdialog"]`).should('not.exist');
        cy.get(DRAWER).contains('Failed').should('be.visible');
        cy.get(ANSWER).should('contain.text', 'The change was declined.');
    });

    // The connector ends a run at its tool-round limit without finishing the task: the chat goes on by itself
    it('continues by itself when a run hits the tool-round limit, and remembers what the tools did', () => {
        stubConnector();
        const bodies: Array<Record<string, any>> = [];
        cy.intercept('POST', '**/modules/genai/agent/stream', req => {
            bodies.push(req.body);
            const first = bodies.length === 1;
            req.reply({
                statusCode: 200,
                headers: {'content-type': 'text/event-stream'},
                body: sse(first ? [
                    ['start', {streamId: 'r1'}],
                    ['tool_call', {callId: 'k1', tool: 'page.list', safety: 'READ_ONLY', requiresApproval: false, argumentsJson: '{"siteKey":"mc-drawer"}'}],
                    ['tool_result', {callId: 'k1', tool: 'page.list', safety: 'READ_ONLY', ok: true, durationMs: 5, resultPreview: '{"count":7}'}],
                    ['complete', {text: '', stop: 'MAX_ITERATIONS', usage: {inputTokens: 100, outputTokens: 10}}]
                ] : [
                    ['start', {streamId: 'r2'}],
                    ['partial', {text: 'All seven pages are checked.'}],
                    ['complete', {text: '', stop: 'COMPLETED', usage: {inputTokens: 50, outputTokens: 8}}]
                ])
            });
        }).as('run');
        open();
        send('Check every page');
        cy.get(ANSWER).should('contain.text', 'All seven pages are checked.');
        cy.wrap(bodies).should(sent => {
            expect(sent, 'two runs, the second started by the chat').to.have.length(2);
            expect(sent[0].maxToolIterations, 'more tool rounds than the connector\'s 8').to.be.greaterThan(8);
            expect(sent[0].maxOutputTokens, 'room for a long answer').to.be.greaterThan(1024);
            expect(sent[1].input).to.match(/^Continue the task/);
            const history = JSON.stringify(sent[1].history);
            expect(history, 'the request is kept').to.contain('Check every page');
            expect(history, 'and what the tools returned').to.contain('page.list').and.to.contain('count');
        });
        cy.get(`${DRAWER} [role="status"]`).should('not.exist');
        cy.get(DRAWER).should('contain.text', '150 in, 18 out');
    });

    // A token budget is the operator's limit: the chat does not go past it by itself, it says so and offers to go on
    it('says why a run stopped at the token budget and continues on request', () => {
        stubConnector();
        let runs = 0;
        cy.intercept('POST', '**/modules/genai/agent/stream', req => {
            runs += 1;
            req.reply({
                statusCode: 200,
                headers: {'content-type': 'text/event-stream'},
                body: sse(runs === 1 ? [
                    ['start', {streamId: 'b1'}],
                    ['partial', {text: 'Half of the pages are done.'}],
                    ['complete', {text: '', stop: 'TOKEN_BUDGET', usage: {inputTokens: 900, outputTokens: 90}}]
                ] : [
                    ['start', {streamId: 'b2'}],
                    ['partial', {text: 'The other half is done too.'}],
                    ['complete', {text: '', stop: 'COMPLETED', usage: {inputTokens: 40, outputTokens: 9}}]
                ])
            });
        });
        open();
        send('Update every page');
        cy.get(`${DRAWER} [role="status"]`).should('be.visible').and('contain.text', 'token budget');
        cy.wrap(null).should(() => expect(runs, 'no run started by the chat past the budget').to.eq(1));
        cy.get(`${DRAWER} [role="status"]`).contains('button', 'Continue').click();
        cy.get(ANSWER).last().should('contain.text', 'The other half is done too.');
        cy.get(`${DRAWER} [role="status"]`).should('not.exist');
    });

    it('meets WCAG 2.1 AA in the chat and in Settings', () => {
        stubConnector([
            ['start', {streamId: 's3'}],
            ['partial', {text: 'Here are **two** pages:\n\n- Home\n- About'}],
            ['complete', {text: '', stop: 'END_TURN', usage: {inputTokens: 10, outputTokens: 5}}]
        ]);
        open();
        send('List the pages');
        cy.get(`${ANSWER} li`).should('have.length', 2);
        cy.injectAxe();
        // Moonstone's filled accent and danger buttons are Jahia's own colours (white on #00a0e3 is 2.9:1): they are
        // left out of the contrast check, as in the other Jahia modules, and nothing else is.
        const context = {include: [[DRAWER]], exclude: [['.moonstone-button_accent'], ['.moonstone-button_danger']]};
        const options = {runOnly: {type: 'tag' as const, values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']}};
        const report = (violations: Array<{id: string; impact?: string | null; help: string; nodes: Array<{target: unknown}>}>) => {
            cy.task('log', violations.map(v => `${v.impact} ${v.id}: ${v.help} -> ${v.nodes.map(n => JSON.stringify(n.target)).join(' ')}`).join('\n'));
        };
        cy.checkA11y(context, options, report);
        cy.get('#jahia-mcp-chat-tab-settings').click();
        cy.get('#jahia-mcp-chat-panel-settings').should('be.visible');
        cy.checkA11y(context, options, report);
    });
});
