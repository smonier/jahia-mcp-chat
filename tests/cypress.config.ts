import {defineConfig} from 'cypress';
import {setupNodeEvents} from './cypress/plugins';

export default defineConfig({
    video: false,
    screenshotOnRunFailure: true,
    screenshotsFolder: './results/screenshots',
    videosFolder: './results/videos',
    // The chat button is a jContent header action: below about 1000 px jContent folds it into its Actions menu
    viewportWidth: 1440,
    viewportHeight: 900,
    defaultCommandTimeout: 10000,
    requestTimeout: 30000,
    responseTimeout: 120000,
    reporter: 'cypress-multi-reporters',
    reporterOptions: {
        configFile: 'reporter-config.json'
    },
    e2e: {
        supportFile: 'cypress/support/e2e.ts',
        specPattern: 'cypress/e2e/**/*.spec.ts',
        setupNodeEvents
    }
});
