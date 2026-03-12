import { ipcMain, dialog, app, BrowserWindow } from 'electron'
import log from 'electron-log'
import type { Meeting, CreateMeetingDto } from '../../shared/types/meeting'
import { getPrismaClient } from '../services/adapters/prisma-client'
import { PrismaMeetingRepository } from '../services/adapters/prisma-meeting.repository'
import {
  registerTranscriptionHandlers,
  unregisterTranscriptionHandlers,
} from './transcription-handlers'
import {
  registerSummarizationHandlers,
  unregisterSummarizationHandlers,
} from './summarization-handlers'

// ─── IPC channel constants ────────────────────────────────────────────────────
// Keep in sync with preload/index.ts and renderer service wrappers.

export const IPC_CHANNELS = {
  // Meetings CRUD
  MEETINGS_LIST: 'meetings:list',
  MEETINGS_CREATE: 'meetings:create',
  MEETINGS_GET: 'meetings:get',
  MEETINGS_DELETE: 'meetings:delete',

  // Transcription lifecycle
  TRANSCRIPTION_START: 'transcription:start',
  TRANSCRIPTION_STATUS: 'transcription:status',
  TRANSCRIPTION_CANCEL: 'transcription:cancel',
  TRANSCRIPTION_CHECK: 'transcription:check',

  // Summarization
  SUMMARIZATION_START: 'summarization:start',
  SUMMARIZATION_STATUS: 'summarization:status',

  // File system
  FILES_SELECT_AUDIO: 'files:select-audio',

  // App meta
  APP_GET_VERSION: 'app:get-version',
} as const

// ─── Response envelope ────────────────────────────────────────────────────────

export interface IpcSuccess<T> {
  ok: true
  data: T
}

export interface IpcError {
  ok: false
  error: string
  code?: string
}

export type IpcResponse<T> = IpcSuccess<T> | IpcError

function ok<T>(data: T): IpcSuccess<T> {
  return { ok: true, data }
}

function err(message: string, code?: string): IpcError {
  return { ok: false, error: message, code }
}

// ─── Audio file filter ────────────────────────────────────────────────────────

const AUDIO_VIDEO_FILTERS: Electron.FileFilter[] = [
  {
    name: 'Audio / Video',
    extensions: ['mp4', 'mp3', 'wav', 'm4a', 'webm', 'ogg', 'flac', 'aac', 'mkv'],
  },
  { name: 'All Files', extensions: ['*'] },
]

// ─── Handler registration ─────────────────────────────────────────────────────

/**
 * Registers all IPC handlers for the main process.
 * Must be called once after the main window is created.
 *
 * Each handler returns an {@link IpcResponse} envelope so the renderer can
 * always distinguish success from error without try/catch on every call.
 *
 * @param mainWindow - The application's main BrowserWindow instance.
 */
export function registerHandlers(mainWindow: BrowserWindow): void {
  log.info('Registering IPC handlers')

  const meetingRepo = new PrismaMeetingRepository(getPrismaClient())

  // ── Transcription (delegated to transcription-handlers.ts) ────────────────
  registerTranscriptionHandlers(mainWindow)

  // ── Summarization (delegated to summarization-handlers.ts) ────────────────
  registerSummarizationHandlers(mainWindow)

  // ── Meetings ──────────────────────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.MEETINGS_LIST, async (): Promise<IpcResponse<Meeting[]>> => {
    log.debug('IPC meetings:list')
    try {
      const meetings = await meetingRepo.findAll()
      return ok(meetings)
    } catch (error) {
      log.error('meetings:list failed', error)
      return err('Failed to list meetings', 'MEETINGS_LIST_ERROR')
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.MEETINGS_CREATE,
    async (_event, dto: CreateMeetingDto): Promise<IpcResponse<Meeting>> => {
      log.debug('IPC meetings:create', { title: dto.title })
      try {
        const meeting = await meetingRepo.create(dto)
        return ok(meeting)
      } catch (error) {
        log.error('meetings:create failed', error)
        return err('Failed to create meeting', 'MEETINGS_CREATE_ERROR')
      }
    },
  )

  ipcMain.handle(
    IPC_CHANNELS.MEETINGS_GET,
    async (_event, id: string): Promise<IpcResponse<Meeting | null>> => {
      log.debug('IPC meetings:get', { id })
      try {
        const meeting = await meetingRepo.findById(id)
        return ok(meeting)
      } catch (error) {
        log.error('meetings:get failed', error)
        return err('Failed to get meeting', 'MEETINGS_GET_ERROR')
      }
    },
  )

  ipcMain.handle(
    IPC_CHANNELS.MEETINGS_DELETE,
    async (_event, id: string): Promise<IpcResponse<void>> => {
      log.debug('IPC meetings:delete', { id })
      try {
        await meetingRepo.delete(id)
        return ok(undefined)
      } catch (error) {
        log.error('meetings:delete failed', error)
        return err('Failed to delete meeting', 'MEETINGS_DELETE_ERROR')
      }
    },
  )

  // ── Transcription ─────────────────────────────────────────────────────────
  // Handlers for transcription:start / status / cancel / check are registered
  // by registerTranscriptionHandlers() above (see transcription-handlers.ts).

  // ── Summarization ─────────────────────────────────────────────────────────
  // Handlers for summarization:start / status are registered by
  // registerSummarizationHandlers() above (see summarization-handlers.ts).

  // ── Files ─────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.FILES_SELECT_AUDIO, async (): Promise<IpcResponse<string | null>> => {
    log.debug('IPC files:select-audio — opening dialog')
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Select audio or video file',
        properties: ['openFile'],
        filters: AUDIO_VIDEO_FILTERS,
      })

      if (canceled || filePaths.length === 0) {
        log.debug('files:select-audio — dialog cancelled')
        return ok(null)
      }

      const selectedPath = filePaths[0]
      log.debug('files:select-audio — selected', { path: selectedPath })
      return ok(selectedPath)
    } catch (error) {
      log.error('files:select-audio failed', error)
      return err('Failed to open file dialog', 'FILES_SELECT_AUDIO_ERROR')
    }
  })

  // ── App meta ──────────────────────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, (): IpcResponse<{ version: string }> => {
    const version = app.getVersion()
    log.debug('IPC app:get-version', { version })
    return ok({ version })
  })

  log.info('IPC handlers registered', { count: Object.keys(IPC_CHANNELS).length })
}

/**
 * Removes all registered handlers. Useful in tests to avoid duplicate listener
 * warnings when `registerHandlers` is called multiple times.
 */
export function unregisterHandlers(): void {
  Object.values(IPC_CHANNELS).forEach((channel) => {
    ipcMain.removeAllListeners(channel)
  })
  unregisterTranscriptionHandlers()
  unregisterSummarizationHandlers()
  log.debug('IPC handlers unregistered')
}
