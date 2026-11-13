import env from '@jahia/cypress/dist/plugins/env';

/**
 * Node-side setup: reads JAHIA_URL and SUPER_USER_PASSWORD from the process environment and sets baseUrl and
 * Cypress.env() from them (the CYPRESS_ prefixed forms of those two are ignored by @jahia/cypress).
 */
export function setupNodeEvents(on: Cypress.PluginEvents, config: Cypress.PluginConfigOptions): Cypress.PluginConfigOptions {
    // Accessibility violations, printed in the run's output (cypress-axe only lists them in the browser console)
    on('task', {
        log(message: string) {
            console.log(message);
            return null;
        }
    });
    return env(on, config);
}
