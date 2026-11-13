/**
 * Helpers shared by the jahia-mcp-chat specs.
 *
 * GraphQL fixtures go through `gql(asRoot(), ...)` with basic auth and the Origin header Jahia requires. The module's
 * servlets sit under Jahia's CSRF guard, which answers browser sessions only: the specs sign in with `cy.login` and
 * send the guard's per-URI page token, as the chat does (`csrfHeaders`). Every test ends with `signOut`
 * (support/e2e.ts): an open session holds a licence seat.
 */
import {createSite, createUser, deleteSite, deleteUser, grantRoles} from '@jahia/cypress';

export type TestUser = {username: string; password: string};

export type GqlBody = {data?: Record<string, unknown> | null; errors?: Array<{message: string}>};

export const MODULE_PATH = '/modules/jahia-mcp-chat';

/** Any template set that creates a home page; override with CYPRESS_MC_TEMPLATE_SET. */
export const TEMPLATE_SET: string = Cypress.env('MC_TEMPLATE_SET') || 'dx-base-demo-templates';

export function asRoot(): TestUser {
    return {username: 'root', password: Cypress.env('SUPER_USER_PASSWORD') || 'root1234'};
}

export function jahiaOrigin(): string {
    const baseUrl = Cypress.config('baseUrl');
    if (!baseUrl) {
        throw new Error('baseUrl is not set: the @jahia/cypress env plugin did not run');
    }
    return new URL(baseUrl).origin;
}

export function gql(user: TestUser, query: string, variables: Record<string, unknown> = {}): Cypress.Chainable<GqlBody> {
    return cy.request({
        method: 'POST',
        url: '/modules/graphql',
        auth: {username: user.username, password: user.password},
        headers: {Origin: jahiaOrigin(), 'Content-Type': 'application/json'},
        body: {query, variables},
        failOnStatusCode: false
    }).then(response => {
        expect(response.status, 'GraphQL answered').to.eq(200);
        return response.body as GqlBody;
    });
}

/** Ends the server session of the current cookies, freeing its licence seat. */
export function signOut(): Cypress.Chainable<null> {
    cy.request({url: '/cms/logout', followRedirect: false, failOnStatusCode: false});
    return cy.clearCookies();
}

export function nodeExists(path: string): Cypress.Chainable<boolean> {
    return gql(asRoot(), 'query N($path: String!) { jcr { nodeByPath(path: $path) { path } } }', {path})
        .then(body => Boolean((body.data?.jcr as {nodeByPath?: unknown} | undefined)?.nodeByPath));
}

export function deleteTestSite(siteKey: string): void {
    nodeExists(`/sites/${siteKey}`).then(exists => {
        if (exists) {
            deleteSite(siteKey);
        }
    });
}

/** Creates a site after removing what a killed run may have left. */
export function createTestSite(siteKey: string): void {
    deleteTestSite(siteKey);
    createSite(siteKey, {templateSet: TEMPLATE_SET, serverName: 'localhost', locale: 'en', languages: 'en'});
    nodeExists(`/sites/${siteKey}/home`).should('eq', true);
}

/** Creates a user granted `roles` on `sitePath` (none: a user with no jContent access to the site). */
export function createTestUser(user: TestUser, sitePath: string, roles: string[]): void {
    deleteUser(user.username);
    createUser(user.username, user.password, []);
    if (roles.length > 0) {
        grantRoles(sitePath, roles, user.username, 'USER');
    }
}

/**
 * Writes one instance of the MCP server factory configuration through the provisioning API. The API cannot delete
 * an instance: specs reuse fixed names and switch them off with `enabled: 'false'` when done.
 */
export function provisionServer(name: string, properties: Record<string, string>): void {
    const lines = Object.entries({name, ...properties}).map(([k, v]) => `    ${k}: ${JSON.stringify(v)}`);
    cy.request({
        method: 'POST',
        url: '/modules/api/provisioning',
        auth: {username: asRoot().username, password: asRoot().password},
        headers: {'Content-Type': 'application/yaml'},
        body: [
            '- editConfiguration: "org.jahia.se.modules.mcpchat.server"',
            `  configIdentifier: ${JSON.stringify(name)}`,
            '  properties:',
            ...lines
        ].join('\n') + '\n'
    }).its('status').should('eq', 200);
}

const MASTER_TOKEN = /var\s+[\w$]+\s*=\s*'([A-Za-z][A-Za-z0-9_-]*)'\s*,\s*[\w$]+\s*=\s*'([A-Za-z0-9-]{8,})'/;

/**
 * The guard's headers for one URI of the signed-in session: master token from /modules/CsrfServlet, then the
 * per-URI page token it answers to a POST (jahia-csrf-guard 4.x refuses the master token soon after its first use).
 */
export function csrfHeaders(path: string): Cypress.Chainable<Record<string, string>> {
    return cy.request({url: '/modules/CsrfServlet', headers: {'Cache-Control': 'no-store'}}).then(response => {
        const match = MASTER_TOKEN.exec(String(response.body));
        expect(match, 'the CSRF guard serves a token to the session').to.not.be.null;
        const [, name, master] = match ?? [];
        return cy.request({
            method: 'POST',
            url: '/modules/CsrfServlet',
            headers: {'X-Requested-With': 'XMLHttpRequest', [name]: master}
        }).then(pages => {
            const token: string = (pages.body?.pageTokens || {})[path] || master;
            const headers: Record<string, string> = {'X-Requested-With': 'XMLHttpRequest'};
            headers[name] = token;
            return headers;
        });
    });
}

/** Calls one of the module's servlets with the current cookies, without following the guard's redirect. */
export function moduleRequest(method: string, path: string, options: Partial<Cypress.RequestOptions> = {}):
    Cypress.Chainable<Cypress.Response<any>> {
    return cy.request({
        method,
        url: `${MODULE_PATH}${path}`,
        followRedirect: false,
        failOnStatusCode: false,
        ...options,
        headers: {Origin: jahiaOrigin(), ...(options.headers || {})}
    });
}

/**
 * Asserts that a visitor who is not signed in was refused. Jahia answers the servlet's 401 with its sign-in page,
 * under 401, 400 or a 302 to it depending on the session the request carries: what matters is that nothing of the
 * module came back.
 */
export function assertSignInRequired(response: Cypress.Response<unknown>): void {
    expect(response.status, 'refused').to.be.oneOf([302, 400, 401]);
    const body = typeof response.body === 'string' ? response.body : JSON.stringify(response.body);
    expect(body, 'no module data').not.to.match(/mcpServers|defaultTier|"id"\s*:/);
}

/** Asserts that the CSRF guard refused a request: a redirect to its error page. */
export function assertGuardRefused(response: Cypress.Response<unknown>): void {
    expect(response.status, 'the CSRF guard redirects').to.eq(302);
    expect(String(response.headers.location), 'to its error page').to.contain('/error.html');
}

/** genai-connector's /modules/genai/status, as the chat reads it, with every tier able to run the agent. */
export function genaiStatus(tools: string[] = ['site.list', 'page.list', 'content.update']): Record<string, unknown> {
    const tier = (model: string) => ({available: true, agentAvailable: true, provider: 'test-provider', model});
    return {
        available: true,
        agentAvailable: true,
        tiers: {advanced: tier('model-advanced'), balanced: tier('model-balanced'), lite: tier('model-lite')},
        tools: tools.map(name => ({name, description: name, safety: name.endsWith('update') ? 'MUTATING' : 'READ_ONLY'}))
    };
}

/** An SSE body of genai-connector's agent stream, one frame per [event, data]. */
export function sse(frames: Array<[string, Record<string, unknown>]>): string {
    return frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
}
