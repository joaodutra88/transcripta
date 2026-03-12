/**
 * transcription-handlers.ts
 * ──────────────────────────
 * IPC handlers for the transcription lifecycle.  Imported by handlers.ts and
 * wired up via `registerTranscriptionHandlers(mainWindow)`.
 *
 * Channels handled
 * ----------------
 *  transcription:start   — spawn Python, stream progress events to renderer
 *  transcription:status  — return current job status from the in-memory job map
 *  transcription:cancel  — kill the active Python process for a meetingId
 *  transcription:check   — probe Python + faster-whisper availability
 *
 * All handlers return an IpcResponse<T> envelope so the renderer always
 * distinguishes success from error without try/catch on every call.
 */

import { ipcMain, BrowserWindow } from 'electron'
import log from 'electron-log'
import { whisperTranscriptionService } from '../services/adapters/whisper-transcription.service'
import type { TranscriptionOptions } from '../services/ports/transcription.service'

// ─── IPC channel constants (subset owned by this module) ─────────────────────

const TRANSCRIPTION_START = 'transcription:start'
const TRANSCRIPTION_STATUS = 'transcription:status'
const TRANSCRIPTION_CANCEL = 'transcription:cancel'
const TRANSCRIPTION_CHECK = 'transcription:check'

// ─── Renderer-push channels (one-way, main → renderer) ───────────────────────

const TRANSCRIPTION_PROGRESS = 'transcription:progress'
const TRANSCRIPTION_SEGMENT = 'transcription:segment'
const TRANSCRIPTION_COMPLETE = 'transcription:complete'
const TRANSCRIPTION_ERROR = 'transcription:error'

// ─── Response envelope helpers ────────────────────────────────────────────────

interface IpcSuccess<T> {
  ok: true
  data: T
}

interface IpcError {
  ok: false
  error: string
  code?: string
}

type IpcResponse<T> = IpcSuccess<T> | IpcError

function ok<T>(data: T): IpcSuccess<T> {
  return { ok: true, data }
}

function err(message: string, code?: string): IpcError {
  return { ok: false, error: message, code }
}

// ─── In-memory job-status registry ────────────────────────────────────────────

type JobStatus = 'IDLE' | 'RUNNING' | 'COMPLETE' | 'FAILED' | 'CANCELLED'

interface JobState {
  status: JobStatus
  progress: number
  /** Set when status is FAILED */
  errorMessage?: string
  /** AbortController that allows the generator loop to be torn down */
  abort: AbortController
}

const _jobs = new Map<string, JobState>()

// ─── Handler registration ─────────────────────────────────────────────────────

/**
 * Registers the four transcription IPC handlers.
 * Must be called once inside `registerHandlers(mainWindow)`.
 */
export function registerTranscriptionHandlers(mainWindow: BrowserWindow): void {
  log.info('Registering transcription IPC handlers')

  // ── transcription:start ────────────────────────────────────────────────────

  ipcMain.handle(
    TRANSCRIPTION_START,
    async (
      _event,
      meetingId: string,
      audioPath: string,
      options?: TranscriptionOptions,
    ): Promise<IpcResponse<{ queued: boolean }>> => {
      log.debug('IPC transcription:start', { meetingId, audioPath })

      // Reject if a job is already running for this meeting
      const existing = _jobs.get(meetingId)
      if (existing?.status === 'RUNNING') {
        log.warn('transcription:start — job already running', { meetingId })
        return err('A transcription job is already running for this meeting', 'ALREADY_RUNNING')
      }

      const abort = new AbortController()
      const jobState: JobState = { status: 'RUNNING', progress: 0, abort }
      _jobs.set(meetingId, jobState)

      // Run the generator in a detached async task so the IPC handler returns
      // immediately with { queued: true }.  Progress is pushed to the renderer
      // via mainWindow.webContents.send().
      void (async () => {
        try {
          const gen = whisperTranscriptionService.transcribe(audioPath, options ?? {})

          for await (const event of gen) {
            // Bail out if the job was cancelled between iterations
            if (abort.signal.aborted) {
              await gen.return(undefined)
              break
            }

            switch (event.type) {
              case 'progress':
                jobState.progress = event.percent
                mainWindow.webContents.send(TRANSCRIPTION_PROGRESS, {
                  meetingId,
                  percent: event.percent,
                  step: event.step,
                })
                break

              case 'segment':
                mainWindow.webContents.send(TRANSCRIPTION_SEGMENT, {
                  meetingId,
                  segment: {
                    speaker: event.speaker,
                    start: event.start,
                    end: event.end,
                    text: event.text,
                  },
                })
                break

              case 'complete':
                jobState.status = 'COMPLETE'
                jobState.progress = 100
                mainWindow.webContents.send(TRANSCRIPTION_COMPLETE, {
                  meetingId,
                  segmentsCount: event.segmentsCount,
                  elapsedSeconds: event.elapsedSeconds,
                })
                log.info('transcription:complete', {
                  meetingId,
                  segments: event.segmentsCount,
                  elapsed: event.elapsedSeconds,
                })
                break

              case 'error':
                jobState.status = 'FAILED'
                jobState.errorMessage = event.message
                mainWindow.webContents.send(TRANSCRIPTION_ERROR, {
                  meetingId,
                  message: event.message,
                  code: event.code,
                })
                log.error('transcription:error from Python', {
                  meetingId,
                  code: event.code,
                  message: event.message,
                })
                break
            }
          }
        } catch (runError) {
          const msg = runError instanceof Error ? runError.message : String(runError)
          log.error('transcription: unhandled generator error', { meetingId, error: msg })
          jobState.status = 'FAILED'
          jobState.errorMessage = msg
          mainWindow.webContents.send(TRANSCRIPTION_ERROR, {
            meetingId,
            message: msg,
            code: 'PROCESS_CRASHED',
          })
        } finally {
          // Leave the final status in the map for status queries; clean up RUNNING state.
          if (jobState.status === 'RUNNING') {
            jobState.status = abort.signal.aborted ? 'CANCELLED' : 'FAILED'
          }
        }
      })()

      return ok({ queued: true })
    },
  )

  // ── transcription:status ───────────────────────────────────────────────────

  ipcMain.handle(
    TRANSCRIPTION_STATUS,
    async (
      _event,
      meetingId: string,
    ): Promise<IpcResponse<{ status: JobStatus; progress: number; errorMessage?: string }>> => {
      log.debug('IPC transcription:status', { meetingId })
      try {
        const job = _jobs.get(meetingId)
        if (!job) {
          return ok({ status: 'IDLE', progress: 0 })
        }
        return ok({ status: job.status, progress: job.progress, errorMessage: job.errorMessage })
      } catch (error) {
        log.error('transcription:status failed', error)
        return err('Failed to get transcription status', 'TRANSCRIPTION_STATUS_ERROR')
      }
    },
  )

  // ── transcription:cancel ───────────────────────────────────────────────────

  ipcMain.handle(
    TRANSCRIPTION_CANCEL,
    async (_event, meetingId: string): Promise<IpcResponse<void>> => {
      log.debug('IPC transcription:cancel', { meetingId })
      try {
        const job = _jobs.get(meetingId)
        if (job) {
          job.abort.abort()
          job.status = 'CANCELLED'
        }
        await whisperTranscriptionService.cancel(meetingId)
        return ok(undefined)
      } catch (error) {
        log.error('transcription:cancel failed', error)
        return err('Failed to cancel transcription', 'TRANSCRIPTION_CANCEL_ERROR')
      }
    },
  )

  // ── transcription:check ────────────────────────────────────────────────────

  ipcMain.handle(
    TRANSCRIPTION_CHECK,
    async (): Promise<
      IpcResponse<{ available: boolean; gpuDetected: boolean; error?: string }>
    > => {
      log.debug('IPC transcription:check')
      try {
        const result = await whisperTranscriptionService.isAvailable()
        return ok(result)
      } catch (error) {
        log.error('transcription:check failed', error)
        return err('Failed to check transcription availability', 'TRANSCRIPTION_CHECK_ERROR')
      }
    },
  )

  log.info('Transcription IPC handlers registered')
}

/**
 * Removes the transcription IPC handlers (useful in tests to avoid duplicate
 * listener warnings).
 */
export function unregisterTranscriptionHandlers(): void {
  ipcMain.removeAllListeners(TRANSCRIPTION_START)
  ipcMain.removeAllListeners(TRANSCRIPTION_STATUS)
  ipcMain.removeAllListeners(TRANSCRIPTION_CANCEL)
  ipcMain.removeAllListeners(TRANSCRIPTION_CHECK)
}
