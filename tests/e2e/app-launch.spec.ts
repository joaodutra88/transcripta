import { test, expect } from '@playwright/test'
import { launchApp } from './electron.setup'
import type { ElectronApplication } from '@playwright/test'

let app: ElectronApplication

test.afterEach(async () => {
  if (app) await app.close()
})

test('app launches and shows main window', async () => {
  const result = await launchApp()
  app = result.app
  const page = result.page

  // Window should be visible
  const title = await page.title()
  expect(title).toBeDefined()

  // Main content should render
  await expect(page.locator('body')).toBeVisible()
})

test('app window has correct minimum dimensions', async () => {
  const result = await launchApp()
  app = result.app
  const page = result.page

  const size = page.viewportSize()
  expect(size).toBeDefined()
  if (size) {
    expect(size.width).toBeGreaterThanOrEqual(900)
    expect(size.height).toBeGreaterThanOrEqual(600)
  }
})

test('app shows empty state or setup wizard', async () => {
  const result = await launchApp()
  app = result.app
  const page = result.page

  // Should show either the setup wizard or the main app empty state
  const hasContent = await page
    .locator('text=Transcripta')
    .or(page.locator('text=Select a meeting'))
    .first()
    .isVisible({ timeout: 10_000 })
  expect(hasContent).toBe(true)
})
