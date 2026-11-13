// @jahia/cypress publishes and waits through cy.waitUntil, which registerSupport() does not load.
import 'cypress-wait-until';
import 'cypress-axe';
import {registerSupport} from '@jahia/cypress/dist/support/registerSupport';
import {signOut} from './mc';

registerSupport();

// Apollo (behind the @jahia/cypress helpers) calls fetch unbound.
if (typeof window !== 'undefined' && window.fetch) {
    globalThis.fetch = window.fetch.bind(window);
}

/**
 * Run-level guard: every spec asserts what the module answers. When the module is not deployed, a refusal would pass
 * for that reason, so the run checks once that the module's config servlet exists (a visitor is refused, not 404).
 */
before(() => {
    cy.request({url: '/modules/jahia-mcp-chat/config', failOnStatusCode: false, followRedirect: false})
        .its('status').should('not.eq', 404);
});

// The calls of a test share one server session, which holds a licence seat until it is signed out.
afterEach(() => {
    signOut();
});
