import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '../../scenes', testMatch: 'markdown-parser.spec.ts', workers: 1,
  outputDir: '../../test-results/markdown-parser', reporter: 'list',
  use: { headless: true },
});
