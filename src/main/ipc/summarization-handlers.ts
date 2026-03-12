/**
 * summarization-handlers.ts
 * ──────────────────────────
 * IPC handlers for the summarization lifecycle. Imported by handlers.ts and
 * wired up via `registerSummarizationHandlers(mainWindow)`.
 *
 * Channels handled
 * ----------------
 *  summarization:start   — fetch transcript from DB, run summarization via
 *                          ClaudeSummarizationService, persist the result in DB,
 *                          and push progress events to the renderer.
 *  summarization:status  — return the current job status from the in-memory map.
 *
 * All handlers return an IpcResponse<T> envelope.
 */

import { ipcMain, BrowserWindow } from 'electron'
import log from 'electron-log'
import { getPrismaClient } from '../services/adapters/prisma-client'
import { getClaudeSummarizationService } from '../services/adapters/claude-summarization.service'
import type { SummarizeOptions } from '../services/ports/summarization.service'

// ─── IPC channel constants (subset owned by this module) ─────────────────────

const SUMMARIZATION_START = 'summarization:start'
const SUMMARIZATION_STATUS = 'summarization:status'

// ─── Renderer-push channels (one-way, main → renderer) ───────────────────────

const SUMMARIZATION_PROGRESS = 'summarization:progress'
const SUMMARIZATION_COMPLETE = 'summarization:complete'
const SUMMARIZATION_ERROR = 'summarization:error'

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

type SummarizationStatus = 'IDLE' | 'RUNNING' | 'COMPLETE' | 'FAILED'

interface SummarizationJobState {
  status: SummarizationStatus
  /** Set when status is FAILED */
  errorMessage?: string
}

const _jobs = new Map<string, SummarizationJobState>()

// ─── Handler registration ─────────────────────────────────────────────────────

/**
 * Registers the two summarization IPC handlers.
 * Must be called once inside `registerHandlers(mainWindow)`.
 */
export function registerSummarizationHandlers(mainWindow: BrowserWindow): void {
  log.info('Registering summarization IPC handlers')

  // ── summarization:start ────────────────────────────────────────────────────

  ipcMain.handle(
    SUMMARIZATION_START,
    async (
      _event,
      meetingId: string,
      summarizeOptions?: SummarizeOptions,
    ): Promise<IpcResponse<{ queued: boolean }>> => {
      log.debug('IPC summarization:start', { meetingId })

      // Reject if a job is already running for this meeting
      const existing = _jobs.get(meetingId)
      if (existing?.status === 'RUNNING') {
        log.warn('summarization:start — job already running', { meetingId })
        return err('A summarization job is already running for this meeting', 'ALREADY_RUNNING')
      }

      const jobState: SummarizationJobState = { status: 'RUNNING' }
      _jobs.set(meetingId, jobState)

      // Run in a detached async task so the IPC handler returns immediately.
      // Progress is pushed to the renderer via mainWindow.webContents.send().
      void (async () => {
        const prisma = getPrismaClient()

        try {
          // ── 1. Fetch transcript from the database ────────────────────────
          log.debug('summarization: fetching transcript', { meetingId })

          mainWindow.webContents.send(SUMMARIZATION_PROGRESS, {
            meetingId,
            step: 'fetching_transcript',
            message: 'Fetching transcript from database…',
          })

          const transcript = await prisma.transcript.findUnique({
            where: { meetingId },
          })

          if (!transcript) {
            throw Object.assign(
              new Error(`No transcript found for meeting ${meetingId}. Run transcription first.`),
              { code: 'TRANSCRIPT_NOT_FOUND' },
            )
          }

          // ── 2. Fetch meeting metadata for context ────────────────────────
          const meeting = await prisma.meeting.findUnique({
            where: { id: meetingId },
          })

          // ── 3. Run summarization ─────────────────────────────────────────
          log.info('summarization: calling Claude API', {
            meetingId,
            transcriptLength: transcript.content.length,
          })

          mainWindow.webContents.send(SUMMARIZATION_PROGRESS, {
            meetingId,
            step: 'summarizing',
            message: 'Generating summary with Claude AI…',
          })

          const options: SummarizeOptions = {
            meetingTitle: meeting?.title,
            ...summarizeOptions,
          }

          const result = await getClaudeSummarizationService().summarize(
            transcript.content,
            options,
          )

          // ── 4. Persist result in the database ────────────────────────────
          log.debug('summarization: persisting result to DB', { meetingId })

          mainWindow.webContents.send(SUMMARIZATION_PROGRESS, {
            meetingId,
            step: 'saving',
            message: 'Saving summary to database…',
          })

          // Upsert: replace an existing summary if one already exists
          await prisma.summary.upsert({
            where: { meetingId },
            create: {
              meetingId,
              content: result.summary,
              keyTopics: JSON.stringify(result.keyTopics),
              decisions: JSON.stringify(result.decisions),
              actionItems: {
                create: result.actionItems.map((item) => ({
                  text: item.text,
                  assignee: item.assignee ?? null,
                })),
              },
            },
            update: {
              content: result.summary,
              keyTopics: JSON.stringify(result.keyTopics),
              decisions: JSON.stringify(result.decisions),
              // Delete existing action items and recreate them
              actionItems: {
                deleteMany: {},
                create: result.actionItems.map((item) => ({
                  text: item.text,
                  assignee: item.assignee ?? null,
                })),
              },
            },
          })

          // ── 5. Notify renderer of completion ─────────────────────────────
          jobState.status = 'COMPLETE'

          mainWindow.webContents.send(SUMMARIZATION_COMPLETE, {
            meetingId,
            summary: result.summary,
            actionItemsCount: result.actionItems.length,
            keyTopicsCount: result.keyTopics.length,
            decisionsCount: result.decisions.length,
          })

          log.info('summarization: complete', {
            meetingId,
            actionItems: result.actionItems.length,
            keyTopics: result.keyTopics.length,
            decisions: result.decisions.length,
          })
        } catch (runError) {
          const errorObj = runError as Error & { code?: string }
          const msg = errorObj.message ?? String(runError)
          const code = errorObj.code ?? 'SUMMARIZATION_ERROR'

          log.error('summarization: job failed', { meetingId, error: msg, code })

          jobState.status = 'FAILED'
          jobState.errorMessage = msg

          mainWindow.webContents.send(SUMMARIZATION_ERROR, {
            meetingId,
            message: msg,
            code,
          })
        }
      })()

      return ok({ queued: true })
    },
  )

  // ── summarization:status ───────────────────────────────────────────────────

  ipcMain.handle(
    SUMMARIZATION_STATUS,
    async (
      _event,
      meetingId: string,
    ): Promise<IpcResponse<{ status: SummarizationStatus; errorMessage?: string }>> => {
      log.debug('IPC summarization:status', { meetingId })
      try {
        const job = _jobs.get(meetingId)
        if (!job) {
          return ok({ status: 'IDLE' })
        }
        return ok({ status: job.status, errorMessage: job.errorMessage })
      } catch (error) {
        log.error('summarization:status failed', error)
        return err('Failed to get summarization status', 'SUMMARIZATION_STATUS_ERROR')
      }
    },
  )

  log.info('Summarization IPC handlers registered')
}

/**
 * Removes the summarization IPC handlers (useful in tests to avoid duplicate
 * listener warnings).
 */
export function unregisterSummarizationHandlers(): void {
  ipcMain.removeAllListeners(SUMMARIZATION_START)
  ipcMain.removeAllListeners(SUMMARIZATION_STATUS)
}
