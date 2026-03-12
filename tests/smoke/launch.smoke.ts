import { test, expect } from '@playwright/test'
import { _electron as electron } from '@playwright/test'
import { join } from 'path'
import { existsSync } from 'fs'

const ROOT = join(__dirname, '..', '..')
const BUILT_MAIN = join(ROOT, 'out', 'main', 'index.js')

test.beforeAll(() => {
  // Ensure app has been built
  if (!existsSync(BUILT_MAIN)) {
    test.skip(true, 'App not built — run `npm run build` first')
  }
})

test('packaged app launches without crash', async () => {
  const app = await electron.launch({
    args: [BUILT_MAIN],
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'test', TRANSCRIPTA_SKIP_SETUP: '1' },
  })

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  // App should render something
  const body = page.locator('body')
  await expect(body).toBeVisible({ timeout: 15_000 })

  // No crash — window is alive
  expect(await page.title()).toBeDefined()

  await app.close()
})

test('app reports correct version', async () => {
  const app = await electron.launch({
    args: [BUILT_MAIN],
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'test', TRANSCRIPTA_SKIP_SETUP: '1' },
  })

  const version = await app.evaluate(async ({ app: electronApp }) => {
    return electronApp.getVersion()
  })

  expect(version).toMatch(/^\d+\.\d+\.\d+/)

  await app.close()
})
