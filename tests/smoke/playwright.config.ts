import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.smoke.ts',
  timeout: 120_000,
  retries: 0,
  reporter: [['list']],
})
