import { autoUpdater, UpdateCheckResult } from 'electron-updater'
import { BrowserWindow } from 'electron'
import log from 'electron-log'

/**
 * Configures and starts the auto-updater.
 *
 * Uses GitHub Releases as the update source (configured in electron-builder.yml).
 * In dev mode, auto-update is disabled to avoid noise.
 */
export function initAutoUpdater(mainWindow: BrowserWindow): void {
  autoUpdater.logger = log
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    log.info('Update available', { version: info.version })
    mainWindow.webContents.send('updater:update-available', {
      version: info.version,
      releaseNotes: info.releaseNotes,
    })
  })

  autoUpdater.on('update-not-available', () => {
    log.debug('No update available')
  })

  autoUpdater.on('download-progress', (progress) => {
    mainWindow.webContents.send('updater:download-progress', {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded', { version: info.version })
    mainWindow.webContents.send('updater:update-downloaded', {
      version: info.version,
    })
  })

  autoUpdater.on('error', (error) => {
    log.error('Auto-updater error', error)
  })
}

/**
 * Checks for updates. Returns the result or null if no update is available.
 */
export async function checkForUpdates(): Promise<UpdateCheckResult | null> {
  try {
    return await autoUpdater.checkForUpdates()
  } catch (error) {
    log.error('Failed to check for updates', error)
    return null
  }
}

/**
 * Downloads the available update.
 */
export async function downloadUpdate(): Promise<void> {
  await autoUpdater.downloadUpdate()
}

/**
 * Quits the app and installs the downloaded update.
 */
export function quitAndInstall(): void {
  autoUpdater.quitAndInstall()
}
