const path = require('path');

const artifact = process.env.ARTIFACT_DIR;
if (!artifact) {
  throw new Error('ARTIFACT_DIR is not set');
}

module.exports = {
  testDir: './tests',
  retries: 0,
  workers: 1,
  fullyParallel: false,
  timeout: 120000,
  expect: { timeout: 20000 },
  outputDir: path.join(artifact, 'test-results'),
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(artifact, 'playwright-html'), open: 'never' }],
    ['json', { outputFile: path.join(artifact, 'playwright-results.json') }],
  ],
  use: {
    baseURL: process.env.BASE_URL,
    actionTimeout: 15000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1600, height: 1000 },
  },
};
