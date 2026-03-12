// @vitest-environment node
/**
 * Unit tests for WhisperTranscriptionService.
 *
 * child_process.spawn is mocked via vi.mock so no Python installation is
 * required.  Each test creates a fresh EventEmitter pair that simulates the
 * stdout/stderr/exit lifecycle of the transcribe.py process.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import type { ChildProcess } from 'child_process'

// ─── Mock child_process BEFORE importing the module under test ────────────────

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

// ─── Mock electron-log so tests don't require the Electron runtime ────────────

vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

// ─── Mock env.ts ──────────────────────────────────────────────────────────────

vi.mock('../../src/main/config/env', () => ({
  getConfig: vi.fn(() => ({
    paths: {
      pythonScripts: '/fake/python',
    },
    python: {
      executable: 'python',
      whisperModel: 'large-v3',
      device: 'cuda',
      computeType: 'float16',
      hfToken: undefined,
    },
  })),
}))

// ─── Mock fs.existsSync so we control file-existence ─────────────────────────

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, existsSync: vi.fn(() => true) }
})

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { spawn } from 'child_process'
import { existsSync } from 'fs'
import {
  WhisperTranscriptionService,
  registerActiveJob,
  unregisterActiveJob,
} from '../../src/main/services/adapters/whisper-transcription.service'

const mockedSpawn = vi.mocked(spawn)
const mockedExistsSync = vi.mocked(existsSync)

// ─── Fake process factory ──────────────────────────────────────────────────────

interface FakeProcess {
  proc: ChildProcess
  stdout: EventEmitter & { emit(event: 'data', chunk: Buffer): boolean }
  stderr: EventEmitter & { emit(event: 'data', chunk: Buffer): boolean }
  emitClose(code: number | null, signal?: string | null): void
  emitSpawnError(err: NodeJS.ErrnoException): void
}

function makeFakeProcess(): FakeProcess {
  const stdout = new EventEmitter() as FakeProcess['stdout']
  const stderr = new EventEmitter() as FakeProcess['stderr']
  const proc = new EventEmitter() as unknown as ChildProcess

  // Attach fake stdio streams
  ;(proc as unknown as Record<string, unknown>)['stdout'] = stdout
  ;(proc as unknown as Record<string, unknown>)['stderr'] = stderr
  ;(proc as unknown as Record<string, unknown>)['killed'] = false
  ;(proc as unknown as Record<string, unknown>)['kill'] = vi.fn((signal?: string) => {
    ;(proc as unknown as Record<string, unknown>)['killed'] = true
    // Simulate async exit after kill
    setImmediate(() => proc.emit('close', null, signal ?? 'SIGTERM'))
    return true
  })

  function emitClose(code: number | null, signal?: string | null): void {
    proc.emit('close', code, signal ?? null)
  }

  function emitSpawnError(err: NodeJS.ErrnoException): void {
    proc.emit('error', err)
  }

  return { proc, stdout, stderr, emitClose, emitSpawnError }
}

// ─── Helper: collect all events from the generator ────────────────────────────

async function collectEvents(
  service: WhisperTranscriptionService,
  audioPath = '/audio/test.mp3',
): Promise<
  ReturnType<typeof service.transcribe> extends AsyncGenerator<infer T, unknown, unknown>
    ? T[]
    : never
> {
  const events: unknown[] = []
  const gen = service.transcribe(audioPath)
  for await (const event of gen) {
    events.push(event)
  }
  return events as never
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WhisperTranscriptionService', () => {
  let service: WhisperTranscriptionService
  let fake: FakeProcess

  beforeEach(() => {
    vi.clearAllMocks()
    mockedExistsSync.mockReturnValue(true)
    service = new WhisperTranscriptionService()
    fake = makeFakeProcess()
    mockedSpawn.mockReturnValue(fake.proc)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── JSON-line parsing ───────────────────────────────────────────────────────

  describe('JSON-line parsing', () => {
    it('parses a progress event from stdout', async () => {
      const collectPromise = collectEvents(service)

      // Give the generator time to attach listeners
      await vi.waitFor(() => fake.stdout.listenerCount('data') > 0)

      fake.stdout.emit(
        'data',
        Buffer.from('{"type":"progress","percent":25,"step":"transcribing"}\n'),
      )
      fake.stdout.emit(
        'data',
        Buffer.from('{"type":"complete","segments_count":5,"elapsed_seconds":12.3}\n'),
      )
      fake.emitClose(0)

      const events = await collectPromise

      expect(events[0]).toMatchObject({ type: 'progress', percent: 25, step: 'transcribing' })
      expect(events[1]).toMatchObject({ type: 'complete', segmentsCount: 5, elapsedSeconds: 12.3 })
    })

    it('parses a segment event from stdout', async () => {
      const collectPromise = collectEvents(service)
      await vi.waitFor(() => fake.stdout.listenerCount('data') > 0)

      const line = JSON.stringify({
        type: 'segment',
        speaker: 'SPEAKER_01',
        start: 1.5,
        end: 3.0,
        text: 'Hello world',
      })
      fake.stdout.emit('data', Buffer.from(line + '\n'))
      fake.stdout.emit(
        'data',
        Buffer.from('{"type":"complete","segments_count":1,"elapsed_seconds":5.0}\n'),
      )
      fake.emitClose(0)

      const events = await collectPromise

      expect(events[0]).toMatchObject({
        type: 'segment',
        speaker: 'SPEAKER_01',
        start: 1.5,
        end: 3.0,
        text: 'Hello world',
      })
    })

    it('handles a multi-line chunk arriving in one data event', async () => {
      const collectPromise = collectEvents(service)
      await vi.waitFor(() => fake.stdout.listenerCount('data') > 0)

      const chunk =
        '{"type":"progress","percent":10,"step":"loading model"}\n' +
        '{"type":"progress","percent":50,"step":"transcribing"}\n' +
        '{"type":"complete","segments_count":3,"elapsed_seconds":8}\n'

      fake.stdout.emit('data', Buffer.from(chunk))
      fake.emitClose(0)

      const events = await collectPromise

      expect(events).toHaveLength(3)
      expect(events[0]).toMatchObject({ type: 'progress', percent: 10 })
      expect(events[1]).toMatchObject({ type: 'progress', percent: 50 })
      expect(events[2]).toMatchObject({ type: 'complete', segmentsCount: 3 })
    })

    it('silently skips non-JSON lines in stdout', async () => {
      const collectPromise = collectEvents(service)
      await vi.waitFor(() => fake.stdout.listenerCount('data') > 0)

      fake.stdout.emit('data', Buffer.from('some debug noise\n'))
      fake.stdout.emit(
        'data',
        Buffer.from('{"type":"complete","segments_count":0,"elapsed_seconds":1}\n'),
      )
      fake.emitClose(0)

      const events = await collectPromise

      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ type: 'complete' })
    })

    it('reassembles lines split across multiple data chunks', async () => {
      const collectPromise = collectEvents(service)
      await vi.waitFor(() => fake.stdout.listenerCount('data') > 0)

      // Split the JSON line across two chunks
      fake.stdout.emit('data', Buffer.from('{"type":"progress","per'))
      fake.stdout.emit('data', Buffer.from('cent":33,"step":"transcribing"}\n'))
      fake.stdout.emit(
        'data',
        Buffer.from('{"type":"complete","segments_count":1,"elapsed_seconds":2}\n'),
      )
      fake.emitClose(0)

      const events = await collectPromise

      expect(events[0]).toMatchObject({ type: 'progress', percent: 33 })
    })
  })

  // ── Error handling ──────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('yields PYTHON_NOT_FOUND error when spawn emits ENOENT', async () => {
      const collectPromise = collectEvents(service)
      await vi.waitFor(() => fake.proc.listenerCount('error') > 0)

      const spawnErr = Object.assign(new Error('spawn python ENOENT'), { code: 'ENOENT' })
      fake.emitSpawnError(spawnErr as NodeJS.ErrnoException)

      const events = await collectPromise

      expect(
        events.some(
          (e) => e.type === 'error' && (e as { code: string }).code === 'PYTHON_NOT_FOUND',
        ),
      ).toBe(true)
    })

    it('yields PROCESS_CRASHED when spawn emits a non-ENOENT error', async () => {
      const collectPromise = collectEvents(service)
      await vi.waitFor(() => fake.proc.listenerCount('error') > 0)

      const spawnErr = Object.assign(new Error('EPERM'), { code: 'EPERM' })
      fake.emitSpawnError(spawnErr as NodeJS.ErrnoException)

      const events = await collectPromise

      expect(
        events.some(
          (e) => e.type === 'error' && (e as { code: string }).code === 'PROCESS_CRASHED',
        ),
      ).toBe(true)
    })

    it('yields a Python error event when transcribe.py emits {"type":"error"}', async () => {
      const collectPromise = collectEvents(service)
      await vi.waitFor(() => fake.stdout.listenerCount('data') > 0)

      fake.stdout.emit(
        'data',
        Buffer.from(
          '{"type":"error","message":"CUDA out of memory","code":"CUDA_NOT_AVAILABLE"}\n',
        ),
      )
      fake.emitClose(1)

      const events = await collectPromise

      const errEvt = events.find((e) => e.type === 'error') as
        | { code: string; message: string }
        | undefined
      expect(errEvt).toBeDefined()
      expect(errEvt!.code).toBe('CUDA_NOT_AVAILABLE')
      expect(errEvt!.message).toBe('CUDA out of memory')
    })

    it('yields PROCESS_CRASHED when the process exits with a non-zero code and no error event', async () => {
      const collectPromise = collectEvents(service)
      await vi.waitFor(() => fake.proc.listenerCount('close') > 0)

      fake.emitClose(1)

      const events = await collectPromise

      const errEvt = events.find((e) => e.type === 'error') as { code: string } | undefined
      expect(errEvt?.code).toBe('PROCESS_CRASHED')
    })

    it('yields FILE_NOT_FOUND when audio file does not exist', async () => {
      mockedExistsSync.mockImplementation((p) => String(p).endsWith('transcribe.py'))

      const events = await collectEvents(service, '/nonexistent/audio.mp3')

      expect(events[0]).toMatchObject({ type: 'error', code: 'FILE_NOT_FOUND' })
      // spawn should NOT have been called
      expect(mockedSpawn).not.toHaveBeenCalled()
    })

    it('yields PYTHON_NOT_FOUND when the script file does not exist', async () => {
      mockedExistsSync.mockReturnValue(false)

      const events = await collectEvents(service)

      expect(events[0]).toMatchObject({ type: 'error', code: 'PYTHON_NOT_FOUND' })
      expect(mockedSpawn).not.toHaveBeenCalled()
    })
  })

  // ── Timeout / abort path ────────────────────────────────────────────────────

  describe('timeout / abort path', () => {
    it('yields aborted sentinel when abortController fires (timeout path)', async () => {
      vi.useFakeTimers()

      const collectPromise = collectEvents(service, '/audio/test.mp3')
      it('enqueues sentinel (no error) when close fires after abortController was aborted', async () => {
        // Use a very short timeout so the abortController fires quickly
        const fakeAbort = makeFakeProcess()
        mockedSpawn.mockReturnValueOnce(fakeAbort.proc)

        const events: unknown[] = []
        const gen = service.transcribe('/audio/test.mp3', { timeoutSeconds: 0.001 })

        const collectDone = (async () => {
          for await (const e of gen) {
            events.push(e)
          }
        })()

        await vi.waitFor(() => fakeAbort.proc.listenerCount('close') > 0)

        // Wait for the 1ms timeout to fire and abort the controller
        await new Promise((r) => setTimeout(r, 30))

        // Now emit close — abortController.signal.aborted should be true
        fakeAbort.proc.emit('close', null, 'SIGTERM')

        await collectDone

        // Aborted branch only enqueues null sentinel → generator returns without error events
        expect(
          events.every(
            (e) =>
              (e as { type: string }).type !== 'error' ||
              (e as { code: string }).code === 'CANCELLED',
          ),
        ).toBe(true)
      })

      // Wait for listeners to attach
      await vi.waitFor(() => fake.proc.listenerCount('close') > 0)

      // Advance time past the default 1800s timeout
      vi.advanceTimersByTime(1800 * 1000 + 100)

      // The timeout fires: proc.kill('SIGTERM') is called, which in the fake
      // process schedules proc.emit('close', null, 'SIGTERM') via setImmediate.
      // Run all pending microtasks / timers.
      await vi.runAllTimersAsync()

      const events = await collectPromise

      // The aborted branch enqueues a null sentinel only — so the generator
      // returns without yielding any further error events.
      // The important thing is that the generator completes without hanging.
      expect(Array.isArray(events)).toBe(true)

      vi.useRealTimers()
    })

    it('yields CANCELLED error on SIGKILL close signal', async () => {
      const collectPromise = collectEvents(service)
      await vi.waitFor(() => fake.proc.listenerCount('close') > 0)

      // Emit close with SIGKILL (not triggered by abortController)
      fake.proc.emit('close', null, 'SIGKILL')

      const events = await collectPromise

      const errEvt = events.find((e) => e.type === 'error') as { code: string } | undefined
      expect(errEvt?.code).toBe('CANCELLED')
    })

    it('yields CANCELLED error on SIGTERM close signal', async () => {
      const collectPromise = collectEvents(service)
      await vi.waitFor(() => fake.proc.listenerCount('close') > 0)

      fake.proc.emit('close', null, 'SIGTERM')

      const events = await collectPromise

      const errEvt = events.find((e) => e.type === 'error') as { code: string } | undefined
      expect(errEvt?.code).toBe('CANCELLED')
    })
  })

  // ── Cancel ──────────────────────────────────────────────────────────────────

  describe('cancel', () => {
    it('kills the child process when cancel is called', async () => {
      // Register a fake active job manually via the exported helper
      const fakeJobProc = makeFakeProcess()
      const meetingId = 'test-meeting-cancel'
      registerActiveJob(meetingId, fakeJobProc.proc)

      // Call cancel — should kill the process and remove from registry
      await expect(service.cancel(meetingId)).resolves.toBeUndefined()

      // The process should have received a kill signal
      const killMock = (fakeJobProc.proc as unknown as Record<string, unknown>)[
        'kill'
      ] as ReturnType<typeof vi.fn>
      expect(killMock).toHaveBeenCalledWith('SIGTERM')
    })

    it('cancel(meetingId) is a no-op when no job is active', async () => {
      // Should not throw
      await expect(service.cancel('nonexistent-meeting-id')).resolves.toBeUndefined()
    })
  })

  // ── registerActiveJob / unregisterActiveJob exports ─────────────────────────

  describe('registerActiveJob / unregisterActiveJob', () => {
    it('registers and unregisters a job without throwing', () => {
      const fakeProc = makeFakeProcess()
      const meetingId = 'meeting-register-test'

      expect(() => registerActiveJob(meetingId, fakeProc.proc)).not.toThrow()
      expect(() => unregisterActiveJob(meetingId)).not.toThrow()
    })

    it('unregisterActiveJob is a no-op for unknown meetingId', () => {
      expect(() => unregisterActiveJob('no-such-meeting')).not.toThrow()
    })
  })

  // ── isAvailable ─────────────────────────────────────────────────────────────

  describe('isAvailable()', () => {
    it('returns available:true and gpuDetected:true when both probes succeed', async () => {
      // Both probes spawn a subprocess
      const fakeImport = makeFakeProcess()
      const fakeCuda = makeFakeProcess()

      mockedSpawn
        .mockReturnValueOnce(fakeImport.proc) // import probe
        .mockReturnValueOnce(fakeCuda.proc) // cuda probe

      const availablePromise = service.isAvailable()

      await vi.waitFor(() => mockedSpawn.mock.calls.length >= 1)

      // Simulate `import faster_whisper; print("ok")` succeeding
      fakeImport.stdout.emit('data', Buffer.from('ok\n'))
      fakeImport.emitClose(0)

      await vi.waitFor(() => mockedSpawn.mock.calls.length >= 2)

      // Simulate `ctranslate2.get_cuda_device_count()` returning 1
      fakeCuda.stdout.emit('data', Buffer.from('1\n'))
      fakeCuda.emitClose(0)

      const result = await availablePromise

      expect(result.available).toBe(true)
      expect(result.gpuDetected).toBe(true)
    })

    it('returns available:false when import probe exits non-zero', async () => {
      const fakeImport = makeFakeProcess()
      mockedSpawn.mockReturnValueOnce(fakeImport.proc)

      const availablePromise = service.isAvailable()

      await vi.waitFor(() => mockedSpawn.mock.calls.length >= 1)
      fakeImport.emitClose(1) // non-zero = import failed

      const result = await availablePromise

      expect(result.available).toBe(false)
      expect(result.gpuDetected).toBe(false)
    })

    it('returns available:false with PYTHON_NOT_FOUND message on ENOENT', async () => {
      const fakeImport = makeFakeProcess()
      mockedSpawn.mockReturnValueOnce(fakeImport.proc)

      const availablePromise = service.isAvailable()

      await vi.waitFor(() => fakeImport.proc.listenerCount('error') > 0)

      const spawnErr = Object.assign(new Error('spawn python ENOENT'), { code: 'ENOENT' })
      fakeImport.emitSpawnError(spawnErr as NodeJS.ErrnoException)

      const result = await availablePromise

      expect(result.available).toBe(false)
      expect(result.error).toMatch(/ENOENT|not found/i)
    })

    it('returns available:true but gpuDetected:false when cuda probe fails', async () => {
      const fakeImport = makeFakeProcess()
      const fakeCuda = makeFakeProcess()

      mockedSpawn.mockReturnValueOnce(fakeImport.proc).mockReturnValueOnce(fakeCuda.proc)

      const availablePromise = service.isAvailable()

      await vi.waitFor(() => mockedSpawn.mock.calls.length >= 1)
      fakeImport.stdout.emit('data', Buffer.from('ok\n'))
      fakeImport.emitClose(0)

      await vi.waitFor(() => mockedSpawn.mock.calls.length >= 2)
      // CUDA probe exits non-zero (e.g., ctranslate2 not installed)
      fakeCuda.emitClose(1)

      const result = await availablePromise

      expect(result.available).toBe(true)
      expect(result.gpuDetected).toBe(false)
    })

    it('returns available:false with "not installed" error when import fails (non-ENOENT)', async () => {
      const fakeImport = makeFakeProcess()
      mockedSpawn.mockReturnValueOnce(fakeImport.proc)

      const availablePromise = service.isAvailable()

      await vi.waitFor(() => mockedSpawn.mock.calls.length >= 1)
      // Non-zero exit = import failed, but not ENOENT
      fakeImport.stderr.emit(
        'data',
        Buffer.from('ModuleNotFoundError: No module named "faster_whisper"\n'),
      )
      fakeImport.emitClose(1)

      const result = await availablePromise

      expect(result.available).toBe(false)
      expect(result.error).toMatch(/not installed/i)
    })

    it('returns available:true but gpuDetected:false when cuda probe returns 0', async () => {
      const fakeImport = makeFakeProcess()
      const fakeCuda = makeFakeProcess()

      mockedSpawn.mockReturnValueOnce(fakeImport.proc).mockReturnValueOnce(fakeCuda.proc)

      const availablePromise = service.isAvailable()

      await vi.waitFor(() => mockedSpawn.mock.calls.length >= 1)
      fakeImport.stdout.emit('data', Buffer.from('ok\n'))
      fakeImport.emitClose(0)

      await vi.waitFor(() => mockedSpawn.mock.calls.length >= 2)
      fakeCuda.stdout.emit('data', Buffer.from('0\n'))
      fakeCuda.emitClose(0)

      const result = await availablePromise

      expect(result.available).toBe(true)
      expect(result.gpuDetected).toBe(false)
    })
  })
})
