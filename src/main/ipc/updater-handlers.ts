import { ipcMain } from 'electron'
import log from 'electron-log'
import { checkForUpdates, downloadUpdate, quitAndInstall } from '../services/auto-updater'
import type { IpcResponse } from './handlers'

export const UPDATER_CHANNELS = {
  CHECK: 'updater:check',
  DOWNLOAD: 'updater:download',
  INSTALL: 'updater:install',
} as const

export function registerUpdaterHandlers(): void {
  log.info('Registering updater IPC handlers')

  ipcMain.handle(
    UPDATER_CHANNELS.CHECK,
    async (): Promise<IpcResponse<{ available: boolean; version?: string }>> => {
      try {
        const result = await checkForUpdates()
        if (result?.updateInfo) {
          return { ok: true, data: { available: true, version: result.updateInfo.version } }
        }
        return { ok: true, data: { available: false } }
      } catch (error) {
        log.error('updater:check failed', error)
        return { ok: false, error: 'Failed to check for updates' }
      }
    },
  )

  ipcMain.handle(UPDATER_CHANNELS.DOWNLOAD, async (): Promise<IpcResponse<void>> => {
    try {
      await downloadUpdate()
      return { ok: true, data: undefined }
    } catch (error) {
      log.error('updater:download failed', error)
      return { ok: false, error: 'Failed to download update' }
    }
  })

  ipcMain.handle(UPDATER_CHANNELS.INSTALL, (): IpcResponse<void> => {
    quitAndInstall()
    return { ok: true, data: undefined }
  })
}

export function unregisterUpdaterHandlers(): void {
  Object.values(UPDATER_CHANNELS).forEach((channel) => {
    ipcMain.removeAllListeners(channel)
  })
}
