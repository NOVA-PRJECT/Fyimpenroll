const { defineConfig } = require('@playwright/test')
module.exports = defineConfig({
  testDir: './tests/browser', testMatch: '*.spec.cjs', workers: 1, timeout: 30000,
  outputDir: './scratch/browser-results', reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:4178', headless: true, channel: process.platform === 'win32' ? 'msedge' : undefined },
  webServer: { command: 'node tests/browser/server.cjs', url: 'http://127.0.0.1:4178/login', timeout: 60000, reuseExistingServer: false },
})
