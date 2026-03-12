import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'path'

const ROOT = join(__dirname, '..', '..')

/**
 * Launches the Electron app for E2E testing.
 *
 * Expects the app to be built first (`npm run build`).
 * In CI, the app is built before running E2E tests.
 */
export async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(ROOT, 'out', 'main', 'index.js')],
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      // Skip first-run wizard in E2E tests
      TRANSCRIPTA_SKIP_SETUP: '1',
    },
  })

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  return { app, page }
}
