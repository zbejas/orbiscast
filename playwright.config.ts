import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './test/e2e',
    fullyParallel: false,
    workers: 1,
    timeout: 60_000,
    expect: { timeout: 10_000 },
    reporter: [['list'], ['html', { open: 'never' }]],
    use: {
        baseURL: 'http://127.0.0.1:3100',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    webServer: {
        command: 'rm -rf .tmp/e2e && node dist/index.js --test-mode --port 3100 --data-dir .tmp/e2e',
        url: 'http://127.0.0.1:3100/api/health',
        reuseExistingServer: false,
        timeout: 120_000,
    },
});
