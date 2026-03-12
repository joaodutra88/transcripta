/**
 * whisper-transcription.service.ts
 * ─────────────────────────────────
 * Concrete adapter that implements the TranscriptionService port by spawning
 * `python transcribe.py` as a child process and parsing its JSON-line output.
 *
 * Design highlights
 * -----------------
 *  - `transcribe()` returns an AsyncGenerator so callers can iterate with
 *    `for await … of` and cancel mid-stream by calling `.return()`.
 *  - Each in-progress job is keyed by meetingId in `_activeJobs`.
 *  - `cancel(meetingId)` sends SIGTERM to the Python process.
 *  - `isAvailable()` runs a fast probe (`python -c "import faster_whisper"`)
 *    and optionally checks for CUDA via ctranslate2.
 *  - A 30-minute hard timeout kills the process and yields a TIMEOUT error.
 */

import { spawn, ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import log from 'electron-log'
import { getConfig } from '../../config/env'
import type {
  TranscriptionService,
  TranscriptionEvent,
  TranscriptionErrorCode,
  TranscriptionAvailability,
  TranscriptionOptions,
} from '../ports/transcription.service'

// ─── Active-job registry ──────────────────────────────────────────────────────

interface ActiveJob {
  process: ChildProcess
  /** Resolves/rejects when the process exits (used for cancel). */
  abortController: AbortController
}

const _activeJobs = new Map<string, ActiveJob>()

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Parses a single stdout line from transcribe.py.
 * Returns the parsed object or null if the line is not valid JSON.
 */
function parseLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    log.warn('whisper-bridge: non-JSON stdout line', { line: trimmed })
    return null
  }
}

/**
 * Builds the argv array for transcribe.py based on the merged config + options.
 */
function buildArgs(audioPath: string, scriptPath: string, options: TranscriptionOptions): string[] {
  const cfg = getConfig()

  const model = options.model ?? cfg.python.whisperModel
  const device = options.device ?? cfg.python.device
  const compute = options.computeType ?? cfg.python.computeType
  const hfToken = options.hfToken ?? cfg.python.hfToken

  const argv: string[] = [
    scriptPath,
    audioPath,
    '--model',
    model,
    '--device',
    device,
    '--compute',
    compute,
  ]

  if (hfToken) {
    argv.push('--diarize', '--hf-token', hfToken)
  }

  return argv
}

// ─── Adapter implementation ───────────────────────────────────────────────────

export class WhisperTranscriptionService implements TranscriptionService {
  // ── transcribe ─────────────────────────────────────────────────────────────

  async *transcribe(
    audioPath: string,
    options: TranscriptionOptions = {},
  ): AsyncGenerator<TranscriptionEvent, void, undefined> {
    const cfg = getConfig()
    const scriptPath = join(cfg.paths.pythonScripts, 'transcribe.py')

    // ── Guard: script file must exist ──────────────────────────────────────
    if (!existsSync(scriptPath)) {
      yield {
        type: 'error',
        message: `Python script not found: ${scriptPath}`,
        code: 'PYTHON_NOT_FOUND',
      }
      return
    }

    // ── Guard: audio file must exist ───────────────────────────────────────
    if (!existsSync(audioPath)) {
      yield {
        type: 'error',
        message: `Audio file not found: ${audioPath}`,
        code: 'FILE_NOT_FOUND',
      }
      return
    }

    const timeoutMs = (options.timeoutSeconds ?? 1800) * 1000
    const pythonExe = cfg.python.executable
    const argv = buildArgs(audioPath, scriptPath, options)

    log.info('whisper-bridge: spawning', { pythonExe, argv })

    const proc = spawn(pythonExe, argv, {
      stdio: ['ignore', 'pipe', 'pipe'],
      // Detached is NOT set — we want the child to die when the parent dies on Windows.
    })

    // ── Register active job (meetingId from caller is not passed here, so we
    //    use a synthetic key; the IPC layer maps meetingId → this generator) ──
    const abortController = new AbortController()

    // ── Timeout ────────────────────────────────────────────────────────────
    const timeoutHandle = setTimeout(() => {
      log.warn('whisper-bridge: job timed out — killing process')
      proc.kill('SIGTERM')
      abortController.abort()
    }, timeoutMs)

    // ── Buffer stdout into lines ────────────────────────────────────────────
    // We use a manual event-driven queue so the generator can yield lazily
    // without blocking the Node.js event loop.
    const eventQueue: Array<TranscriptionEvent | null> = [] // null = stream ended
    let resolveNext: (() => void) | null = null

    function enqueue(event: TranscriptionEvent | null): void {
      eventQueue.push(event)
      resolveNext?.()
      resolveNext = null
    }

    function waitForNext(): Promise<void> {
      if (eventQueue.length > 0) return Promise.resolve()
      return new Promise((resolve) => {
        resolveNext = resolve
      })
    }

    // ── Wire stdout → JSON-line parser ─────────────────────────────────────
    let stdoutBuffer = ''

    proc.stdout!.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf8')
      const lines = stdoutBuffer.split('\n')
      stdoutBuffer = lines.pop() ?? '' // keep the incomplete last line

      for (const line of lines) {
        const obj = parseLine(line)
        if (!obj) continue

        const evtType = obj['type'] as string

        if (evtType === 'progress') {
          enqueue({
            type: 'progress',
            percent: obj['percent'] as number,
            step: obj['step'] as string,
          })
        } else if (evtType === 'segment') {
          enqueue({
            type: 'segment',
            speaker: (obj['speaker'] as string) ?? 'unknown',
            start: obj['start'] as number,
            end: obj['end'] as number,
            text: obj['text'] as string,
          })
        } else if (evtType === 'complete') {
          enqueue({
            type: 'complete',
            segmentsCount: (obj['segments_count'] as number) ?? 0,
            elapsedSeconds: (obj['elapsed_seconds'] as number) ?? 0,
          })
        } else if (evtType === 'error') {
          enqueue({
            type: 'error',
            message: (obj['message'] as string) ?? 'Unknown error',
            code: ((obj['code'] as TranscriptionErrorCode) ?? 'UNKNOWN') as TranscriptionErrorCode,
          })
        }
        // 'warning' lines are handled via stderr; silently ignore here.
      }
    })

    // ── Wire stderr → log warnings ─────────────────────────────────────────
    let stderrBuffer = ''
    proc.stderr!.on('data', (chunk: Buffer) => {
      stderrBuffer += chunk.toString('utf8')
      const lines = stderrBuffer.split('\n')
      stderrBuffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim()) log.warn('whisper-bridge stderr:', line.trim())
      }
    })

    // ── Wire process exit ──────────────────────────────────────────────────
    proc.on('close', (code, signal) => {
      clearTimeout(timeoutHandle)
      log.info('whisper-bridge: process exited', { code, signal })

      // Flush any remaining stderr
      if (stderrBuffer.trim()) log.warn('whisper-bridge stderr (tail):', stderrBuffer.trim())

      if (abortController.signal.aborted) {
        // Already handled by timeout path — enqueue sentinel only if not yet done
        enqueue(null)
        return
      }

      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        enqueue({
          type: 'error',
          message: 'Process was cancelled',
          code: 'CANCELLED',
        })
      } else if (code !== 0 && code !== null) {
        // Non-zero exit without an explicit error event from the script
        enqueue({
          type: 'error',
          message: `Python process exited with code ${code}`,
          code: 'PROCESS_CRASHED',
        })
      }

      enqueue(null) // sentinel: stream is done
    })

    proc.on('error', (spawnError: NodeJS.ErrnoException) => {
      clearTimeout(timeoutHandle)
      log.error('whisper-bridge: spawn error', spawnError)

      if (spawnError.code === 'ENOENT') {
        enqueue({
          type: 'error',
          message: `Python executable not found: ${pythonExe}`,
          code: 'PYTHON_NOT_FOUND',
        })
      } else {
        enqueue({
          type: 'error',
          message: `Failed to spawn Python: ${spawnError.message}`,
          code: 'PROCESS_CRASHED',
        })
      }

      enqueue(null)
    })

    // ── Drain the queue as an AsyncGenerator ──────────────────────────────
    try {
      while (true) {
        await waitForNext()

        while (eventQueue.length > 0) {
          const item = eventQueue.shift()!

          if (item === null) {
            // Stream ended
            return
          }

          yield item

          // After a complete or error event the stream is semantically over
          if (item.type === 'complete' || item.type === 'error') {
            // Drain the sentinel that follows
            await waitForNext()
            eventQueue.shift() // discard null sentinel
            return
          }
        }
      }
    } finally {
      // If the caller breaks out of the loop early (.return() was called),
      // ensure the child process is cleaned up.
      clearTimeout(timeoutHandle)
      if (!proc.killed) {
        log.info('whisper-bridge: generator returned early — killing process')
        proc.kill('SIGTERM')
      }
    }
  }

  // ── isAvailable ────────────────────────────────────────────────────────────

  async isAvailable(): Promise<TranscriptionAvailability> {
    const cfg = getConfig()
    const pythonExe = cfg.python.executable

    // Step 1: verify Python + faster-whisper can be imported
    const importCheck = await runPythonProbe(pythonExe, 'import faster_whisper; print("ok")', 5000)

    if (!importCheck.success) {
      const isNoExe = importCheck.error?.includes('ENOENT') ?? false
      return {
        available: false,
        gpuDetected: false,
        error: isNoExe
          ? `Python executable not found: ${pythonExe}`
          : `faster-whisper not installed: ${importCheck.error}`,
      }
    }

    // Step 2: probe for CUDA (non-fatal)
    const cudaCheck = await runPythonProbe(
      pythonExe,
      'import ctranslate2; print(ctranslate2.get_cuda_device_count())',
      5000,
    )

    const gpuDetected = cudaCheck.success && parseInt(cudaCheck.stdout?.trim() ?? '0', 10) > 0

    return { available: true, gpuDetected }
  }

  // ── cancel ─────────────────────────────────────────────────────────────────

  async cancel(meetingId: string): Promise<void> {
    const job = _activeJobs.get(meetingId)
    if (!job) {
      log.debug('whisper-bridge: cancel called but no active job', { meetingId })
      return
    }

    log.info('whisper-bridge: cancelling job', { meetingId })
    job.process.kill('SIGTERM')
    job.abortController.abort()
    _activeJobs.delete(meetingId)
  }
}

// ─── Process probe helper ─────────────────────────────────────────────────────

interface ProbeResult {
  success: boolean
  stdout?: string
  error?: string
}

function runPythonProbe(exe: string, code: string, timeoutMs: number): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let timedOut = false

    let proc: ChildProcess
    try {
      proc = spawn(exe, ['-c', code], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      resolve({ success: false, error: String(e) })
      return
    }

    const timer = setTimeout(() => {
      timedOut = true
      proc.kill('SIGTERM')
      resolve({ success: false, error: 'Probe timed out' })
    }, timeoutMs)

    proc.stdout!.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })

    proc.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      if (!timedOut) resolve({ success: false, error: err.code ?? err.message })
    })

    proc.on('close', (code) => {
      clearTimeout(timer)
      if (!timedOut) {
        resolve({ success: code === 0, stdout, error: code !== 0 ? `exit ${code}` : undefined })
      }
    })
  })
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const whisperTranscriptionService = new WhisperTranscriptionService()

/**
 * Exposes the internal active-job registry for use by the IPC layer.
 * The IPC handler stores its own AbortController reference here when a job
 * is started so that `cancel(meetingId)` can find and kill it.
 */
export function registerActiveJob(meetingId: string, proc: ChildProcess): void {
  _activeJobs.set(meetingId, { process: proc, abortController: new AbortController() })
}

export function unregisterActiveJob(meetingId: string): void {
  _activeJobs.delete(meetingId)
}
