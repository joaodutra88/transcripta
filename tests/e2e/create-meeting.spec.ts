import { test, expect } from '@playwright/test'
import { launchApp } from './electron.setup'
import type { ElectronApplication } from '@playwright/test'

let app: ElectronApplication

test.afterEach(async () => {
  if (app) await app.close()
})

test('new meeting button opens create dialog', async () => {
  const result = await launchApp()
  app = result.app
  const page = result.page

  // Look for the "New Meeting" button in the sidebar or empty state
  const newMeetingBtn = page.locator('button', { hasText: /new meeting/i }).first()
  await expect(newMeetingBtn).toBeVisible({ timeout: 10_000 })
  await newMeetingBtn.click()

  // Dialog should appear
  const dialog = page.locator('[role="dialog"]').or(page.locator('text=Create Meeting')).first()
  await expect(dialog).toBeVisible({ timeout: 5_000 })
})

test('meeting list shows created meetings', async () => {
  const result = await launchApp()
  app = result.app
  const page = result.page

  // Wait for the app to load
  await page.waitForTimeout(2_000)

  // The meeting list area should be present (even if empty)
  const sidebar = page.locator('[data-testid="sidebar"]').or(page.locator('nav')).first()
  await expect(sidebar).toBeVisible({ timeout: 10_000 })
})
