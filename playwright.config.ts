import { defineConfig, devices } from '@playwright/test';

// Optional: point at an already-installed Chromium (e.g. PLAYWRIGHT_CHROMIUM_PATH=…/chrome.exe) instead of `npx playwright install`.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

const PORT = 5199;
// A throwaway in-memory database and a test-only bootstrap token, so each run starts from a clean install.
// (The token only works against this local, in-memory server while no administrator exists.)
const BOOTSTRAP = 'e2e-only-local-bootstrap-token-0123456789';
process.env.E2E_BOOTSTRAP_TOKEN = BOOTSTRAP;

export default defineConfig({
    testDir: 'e2e',
    fullyParallel: false,
    workers: 1,
    timeout: 60_000,
    reporter: [['list']],
    use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure', launchOptions: { executablePath } },
    webServer: {
        command: 'npx tsx scripts/dev-server.ts',
        url: `http://localhost:${PORT}/api/health`,
        reuseExistingServer: false,
        timeout: 120_000,
        env: { PORT: String(PORT), DATABASE_URL: 'pglite:memory', APP_ENV: 'development', ADMIN_BOOTSTRAP_TOKEN: BOOTSTRAP, SITE_ORIGIN: `http://localhost:${PORT}` },
    },
    projects: [
        { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } }, testIgnore: /mobile\.spec\.ts/ },
        { name: 'mobile', use: { ...devices['Pixel 7'], launchOptions: { executablePath } }, testMatch: /mobile\.spec\.ts/, dependencies: ['desktop'] },
    ],
});
