// @vitest-environment node
/**
 * Unit tests for setup-handlers.ts
 *
 * Mocks child_process.spawn to simulate Python probe results.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import type { ChildProcess } from 'child_process'

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  app: {
    getPath: vi.fn(() => '/fake/userData'),
    getAppPath: vi.fn(() => '/fake/app'),
    getVersion: vi.fn(() => '0.1.0'),
    isPackaged: false,
  },
}))

vi.mock('../../src/main/config/env', () => ({
  getConfig: vi.fn(() => ({
    paths: {
      userData: '/fake/userData',
      database: '/fake/userData/transcripta.db',
      logs: '/fake/userData/logs',
      pythonScripts: '/fake/python',
      temp: '/fake/userData/temp',
    },
    python: {
      executable: 'python',
      whisperModel: 'large-v3',
      device: 'cuda',
      computeType: 'float16',
      hfToken: undefined,
    },
    anthropic: {
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-4-5-20250514',
    },
    app: {
      version: '0.1.0',
      isDev: true,
    },
  })),
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, existsSync: vi.fn(() => true) }
})

let _mockSetupComplete = false
vi.mock('../../src/main/services/app-store', () => ({
  isSetupComplete: vi.fn(() => _mockSetupComplete),
  setSetupComplete: vi.fn(() => {
    _mockSetupComplete = true
  }),
  setStoredApiKey: vi.fn(),
  getStoredApiKey: vi.fn(),
}))

import { spawn } from 'child_process'
import { ipcMain } from 'electron'
import { registerSetupHandlers, unregisterSetupHandlers } from '../../src/main/ipc/setup-handlers'

const mockedSpawn = vi.mocked(spawn)
const mockedIpcMain = vi.mocked(ipcMain)

// ─── Fake process ────────────────────────────────────────────────────────────

function makeFakeProcess() {
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  const proc = new EventEmitter() as unknown as ChildProcess
  ;(proc as unknown as Record<string, unknown>)['stdout'] = stdout
  ;(proc as unknown as Record<string, unknown>)['stderr'] = stderr
  ;(proc as unknown as Record<string, unknown>)['killed'] = false

  return {
    proc,
    stdout,
    stderr,
    emitClose(code: number | null) {
      proc.emit('close', code)
    },
    emitSpawnError(err: Error) {
      proc.emit('error', err)
    },
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('setup-handlers', () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>

  beforeEach(() => {
    vi.clearAllMocks()
    _mockSetupComplete = false
    handlers = new Map()

    // Capture handlers registered via ipcMain.handle
    mockedIpcMain.handle.mockImplementation(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
        return undefined as never
      },
    )

    registerSetupHandlers()
  })

  it('registers all setup IPC channels', () => {
    expect(handlers.has('setup:check-system')).toBe(true)
    expect(handlers.has('setup:save-api-key')).toBe(true)
    expect(handlers.has('setup:set-first-run-done')).toBe(true)
    expect(handlers.has('setup:is-first-run')).toBe(true)
  })

  describe('setup:check-system', () => {
    it('returns all checks passed when Python + faster-whisper + GPU are available', async () => {
      const pyProbe = makeFakeProcess()
      const fwProbe = makeFakeProcess()
      const gpuProbe = makeFakeProcess()

      mockedSpawn
        .mockReturnValueOnce(pyProbe.proc)
        .mockReturnValueOnce(fwProbe.proc)
        .mockReturnValueOnce(gpuProbe.proc)

      const handler = handlers.get('setup:check-system')!
      const promise = handler() as Promise<unknown>

      // Python version check
      await vi.waitFor(() => mockedSpawn.mock.calls.length >= 1)
      pyProbe.stdout.emit('data', Buffer.from('3.11.5\n'))
      pyProbe.emitClose(0)

      // faster-whisper check
      await vi.waitFor(() => mockedSpawn.mock.calls.length >= 2)
      fwProbe.stdout.emit('data', Buffer.from('ok\n'))
      fwProbe.emitClose(0)

      // GPU check
      await vi.waitFor(() => mockedSpawn.mock.calls.length >= 3)
      gpuProbe.stdout.emit('data', Buffer.from('1|NVIDIA RTX 4090\n'))
      gpuProbe.emitClose(0)

      const result = (await promise) as { ok: boolean; data: Record<string, unknown> }
      expect(result.ok).toBe(true)
      expect(result.data.pythonInstalled).toBe(true)
      expect(result.data.pythonVersion).toBe('3.11.5')
      expect(result.data.fasterWhisperInstalled).toBe(true)
      expect(result.data.gpuAvailable).toBe(true)
      expect(result.data.gpuName).toBe('NVIDIA RTX 4090')
      expect(result.data.anthropicKeySet).toBe(true)
    })

    it('returns pythonInstalled:false when Python is not found', async () => {
      const pyProbe = makeFakeProcess()
      mockedSpawn.mockReturnValueOnce(pyProbe.proc)

      const handler = handlers.get('setup:check-system')!
      const promise = handler() as Promise<unknown>

      await vi.waitFor(() => mockedSpawn.mock.calls.length >= 1)
      pyProbe.emitSpawnError(new Error('spawn python ENOENT'))

      const result = (await promise) as { ok: boolean; data: Record<string, unknown> }
      expect(result.ok).toBe(true)
      expect(result.data.pythonInstalled).toBe(false)
      expect(result.data.fasterWhisperInstalled).toBe(false)
    })

    it('detects failed GPU check when probe exits non-zero', async () => {
      const pyProbe = makeFakeProcess()
      const fwProbe = makeFakeProcess()
      const gpuProbe = makeFakeProcess()

      mockedSpawn
        .mockReturnValueOnce(pyProbe.proc)
        .mockReturnValueOnce(fwProbe.proc)
        .mockReturnValueOnce(gpuProbe.proc)

      const handler = handlers.get('setup:check-system')!
      const promise = handler() as Promise<unknown>

      await vi.waitFor(() => mockedSpawn.mock.calls.length >= 1)
      pyProbe.stdout.emit('data', Buffer.from('3.11.5\n'))
      pyProbe.emitClose(0)

      await vi.waitFor(() => mockedSpawn.mock.calls.length >= 2)
      fwProbe.stdout.emit('data', Buffer.from('ok\n'))
      fwProbe.emitClose(0)

      await vi.waitFor(() => mockedSpawn.mock.calls.length >= 3)
      // GPU probe exits with non-zero — gpuCheck.ok = false
      gpuProbe.emitClose(1)

      const result = (await promise) as { ok: boolean; data: Record<string, unknown> }
      expect(result.data.gpuAvailable).toBe(false)
      expect(result.data.gpuName).toBeNull()
    })

    it('detects faster-whisper not installed when fw probe fails', async () => {
      const pyProbe = makeFakeProcess()
      const fwProbe = makeFakeProcess()
      const gpuProbe = makeFakeProcess()

      mockedSpawn
        .mockReturnValueOnce(pyProbe.proc)
        .mockReturnValueOnce(fwProbe.proc)
        .mockReturnValueOnce(gpuProbe.proc)

      const handler = handlers.get('setup:check-system')!
      const promise = handler() as Promise<unknown>

      await vi.waitFor(() => mockedSpawn.mock.calls.length >= 1)
      pyProbe.stdout.emit('data', Buffer.from('3.11.5\n'))
      pyProbe.emitClose(0)

      await vi.waitFor(() => mockedSpawn.mock.calls.length >= 2)
      // faster-whisper import fails
      fwProbe.emitClose(1)

      await vi.waitFor(() => mockedSpawn.mock.calls.length >= 3)
      gpuProbe.stdout.emit('data', Buffer.from('1|RTX 3090\n'))
      gpuProbe.emitClose(0)

      const result = (await promise) as { ok: boolean; data: Record<string, unknown> }
      expect(result.data.pythonInstalled).toBe(true)
      expect(result.data.fasterWhisperInstalled).toBe(false)
      expect(result.data.gpuAvailable).toBe(true)
    })

    it('detects missing GPU when cuda count is 0', async () => {
      const pyProbe = makeFakeProcess()
      const fwProbe = makeFakeProcess()
      const gpuProbe = makeFakeProcess()

      mockedSpawn
        .mockReturnValueOnce(pyProbe.proc)
        .mockReturnValueOnce(fwProbe.proc)
        .mockReturnValueOnce(gpuProbe.proc)

      const handler = handlers.get('setup:check-system')!
      const promise = handler() as Promise<unknown>

      await vi.waitFor(() => mockedSpawn.mock.calls.length >= 1)
      pyProbe.stdout.emit('data', Buffer.from('3.11.5\n'))
      pyProbe.emitClose(0)

      await vi.waitFor(() => mockedSpawn.mock.calls.length >= 2)
      fwProbe.stdout.emit('data', Buffer.from('ok\n'))
      fwProbe.emitClose(0)

      await vi.waitFor(() => mockedSpawn.mock.calls.length >= 3)
      gpuProbe.stdout.emit('data', Buffer.from('0|None\n'))
      gpuProbe.emitClose(0)

      const result = (await promise) as { ok: boolean; data: Record<string, unknown> }
      expect(result.data.gpuAvailable).toBe(false)
      expect(result.data.gpuName).toBeNull()
    })

    it('returns ok:false when checkSystem throws an unexpected error', async () => {
      // Make spawn throw synchronously so the async handler catch block fires
      mockedSpawn.mockImplementationOnce(() => {
        throw new Error('unexpected spawn failure')
      })

      const handler = handlers.get('setup:check-system')!
      const result = (await handler()) as { ok: boolean; error: string; code: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBe('Failed to check system')
      expect(result.code).toBe('SETUP_CHECK_ERROR')
    })

    it('uses stderr as output when stdout is empty on process close', async () => {
      // Covers the `stdout.trim() || stderr.trim()` false branch where stdout is empty
      const pyProbe = makeFakeProcess()
      mockedSpawn.mockReturnValueOnce(pyProbe.proc)

      const handler = handlers.get('setup:check-system')!
      const promise = handler() as Promise<unknown>

      await vi.waitFor(() => mockedSpawn.mock.calls.length >= 1)
      // Only emit stderr, no stdout — close non-zero so python check fails
      pyProbe.stderr.emit('data', Buffer.from('command not found: python\n'))
      pyProbe.emitClose(1)

      const result = (await promise) as { ok: boolean; data: Record<string, unknown> }
      expect(result.data.pythonInstalled).toBe(false)
    })
  })

  describe('setup:is-first-run / set-first-run-done', () => {
    it('returns true initially then false after set-first-run-done', () => {
      const isFirstRun = handlers.get('setup:is-first-run')!
      const setDone = handlers.get('setup:set-first-run-done')!

      const r1 = isFirstRun() as { ok: boolean; data: boolean }
      expect(r1.data).toBe(true)

      setDone()

      const r2 = isFirstRun() as { ok: boolean; data: boolean }
      expect(r2.data).toBe(false)
    })
  })

  describe('setup:save-api-key', () => {
    it('saves the API key to process.env', async () => {
      const handler = handlers.get('setup:save-api-key')!
      const result = (await handler({}, 'sk-ant-new-key')) as { ok: boolean }
      expect(result.ok).toBe(true)
      expect(process.env['ANTHROPIC_API_KEY']).toBe('sk-ant-new-key')
    })

    it('returns ok:false when saving the key throws an error', async () => {
      const handler = handlers.get('setup:save-api-key')!
      const originalEnv = process.env

      // Make process.env setter throw to trigger the catch block
      const throwingProxy = new Proxy(originalEnv, {
        set: () => {
          throw new Error('env write error')
        },
        get: (t, p) => t[p as string],
      })
      Object.defineProperty(process, 'env', {
        get: () => throwingProxy,
        configurable: true,
        enumerable: true,
      })

      try {
        const result = (await handler({}, 'sk-ant-bad')) as {
          ok: boolean
          error: string
          code: string
        }
        expect(result.ok).toBe(false)
        expect(result.error).toBe('Failed to save API key')
        expect(result.code).toBe('SETUP_SAVE_KEY_ERROR')
      } finally {
        Object.defineProperty(process, 'env', {
          value: originalEnv,
          writable: true,
          configurable: true,
          enumerable: true,
        })
      }
    })
  })

  describe('unregisterSetupHandlers', () => {
    it('calls removeAllListeners for all setup channels', () => {
      unregisterSetupHandlers()
      expect(mockedIpcMain.removeAllListeners).toHaveBeenCalledWith('setup:check-system')
      expect(mockedIpcMain.removeAllListeners).toHaveBeenCalledWith('setup:save-api-key')
    })
  })
})
