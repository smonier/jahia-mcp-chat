import {deleteUser, grantRoles} from '@jahia/cypress';
import {
    TestUser, assertGuardRefused, assertSignInRequired, createTestSite, createTestUser, csrfHeaders, deleteTestSite, moduleRequest,
    provisionServer
} from '../support/mc';

const SECRET = 'Bearer cy-secret-value-never-in-config';
const REMOTE_URL = 'https://mcp.cypress.invalid/mcp';

/**
 * The module's servlets: who may call them, their CSRF decision, and that the configuration the browser reads never
 * carries a server's URL or credential. A remote server is provisioned as a factory instance, allowed on one site.
 */
describe('jahia-mcp-chat - servlets', () => {
    const allowedSite = 'mc-api-allowed';
    const otherSite = 'mc-api-other';
    const editor: TestUser = {username: 'mc-api-editor', password: 'mcEditor1234'};
    const outsider: TestUser = {username: 'mc-api-outsider', password: 'mcOutsider1234'};

    const config = (siteKey: string) => {
        const path = '/modules/jahia-mcp-chat/config';
        return csrfHeaders(path).then(headers => moduleRequest('GET', `/config?site=${siteKey}`, {headers}));
    };

    before(() => {
        createTestSite(allowedSite);
        createTestSite(otherSite);
        createTestUser(editor, `/sites/${allowedSite}`, ['editor']);
        grantRoles(`/sites/${otherSite}`, ['editor'], editor.username, 'USER');
        createTestUser(outsider, `/sites/${allowedSite}`, []);
        provisionServer('cyremote', {label: 'Cypress remote', url: REMOTE_URL, authValue: SECRET, sites: allowedSite, enabled: 'true'});
        // The registry follows the configuration through OSGi: give it a moment
        cy.wait(3000);
    });

    after(() => {
        provisionServer('cyremote', {label: 'Cypress remote', url: REMOTE_URL, authValue: '', sites: allowedSite, enabled: 'false'});
        deleteUser(editor.username);
        deleteUser(outsider.username);
        deleteTestSite(allowedSite);
        deleteTestSite(otherSite);
    });

    it('refuses a visitor who is not signed in', () => {
        ['/config', '/settings'].forEach(path => {
            moduleRequest('GET', path).then(assertSignInRequired);
        });
        moduleRequest('POST', '/attachments?name=a.txt', {body: 'x'}).then(assertSignInRequired);
    });

    it('refuses a signed-in call without the CSRF token', () => {
        cy.login(editor.username, editor.password);
        moduleRequest('GET', `/config?site=${allowedSite}`).then(assertGuardRefused);
        moduleRequest('POST', '/attachments?name=a.txt', {body: 'x', headers: {'Content-Type': 'text/plain'}}).then(assertGuardRefused);
        moduleRequest('POST', '/oauth/signout?server=cyremote').then(assertGuardRefused);
    });

    it('lists the servers of the site, without a remote URL or a credential', () => {
        cy.login(editor.username, editor.password);
        config(allowedSite).then(response => {
            expect(response.status).to.eq(200);
            expect(response.headers['cache-control']).to.contain('no-store');
            const raw = JSON.stringify(response.body);
            expect(raw, 'no credential').not.to.contain('cy-secret-value');
            expect(raw, 'no remote URL').not.to.contain('cypress.invalid');
            expect(raw, 'no field of the old builds').not.to.match(/mcpToken|availableProviders|ApiKey/i);
            expect(response.body.defaultTier).to.be.oneOf(['advanced', 'balanced', 'lite']);
            const servers = response.body.mcpServers as Array<Record<string, unknown>>;
            const remote = servers.find(s => s.name === 'cyremote');
            expect(remote, 'the remote server is offered on its site').to.deep.include({label: 'Cypress remote', local: false});
            expect(remote).not.to.have.property('url');
            const jahia = servers.find(s => s.local);
            expect(jahia, 'the Jahia server').to.exist;
        });
    });

    it('leaves a server out of a site it is not allowed on', () => {
        cy.login(editor.username, editor.password);
        config(otherSite).then(response => {
            expect(response.status).to.eq(200);
            const names = (response.body.mcpServers as Array<{name: string}>).map(s => s.name);
            expect(names).not.to.include('cyremote');
        });
    });

    it('offers no server on a site the user has no jContent access to', () => {
        cy.login(outsider.username, outsider.password);
        config(allowedSite).then(response => {
            expect(response.status).to.eq(200);
            expect(response.body.mcpServers).to.deep.eq([]);
        });
    });

    it('keeps an attachment for its sender, with the token', () => {
        const path = '/modules/jahia-mcp-chat/attachments';
        cy.login(editor.username, editor.password);
        csrfHeaders(path).then(headers => {
            moduleRequest('POST', '/attachments?name=notes.txt', {headers: {...headers, 'Content-Type': 'text/plain'}, body: 'hello'})
                .then(response => {
                    expect(response.status).to.eq(200);
                    expect(response.body.id).to.match(/^[A-Za-z0-9_-]{20,}$/);
                });
        });
        csrfHeaders(path).then(headers => {
            moduleRequest('POST', '/attachments', {headers: {...headers, 'Content-Type': 'text/plain'}, body: 'hello'})
                .its('status').should('eq', 400);
        });
    });

    it('does not start a sign-in to an unknown server or for a site the user cannot reach', () => {
        moduleRequest('GET', `/oauth/start?server=cyremote&site=${allowedSite}`).then(assertSignInRequired);
        cy.login(outsider.username, outsider.password);
        moduleRequest('GET', `/oauth/start?server=cyremote&site=${allowedSite}`).then(response => {
            expect(response.status, 'a page for the popup, not a redirect').to.eq(200);
            expect(String(response.body)).to.contain('not available');
        });
    });
});
