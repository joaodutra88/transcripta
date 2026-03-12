import { ipcMain } from 'electron'
import { spawn } from 'child_process'
import log from 'electron-log'
import { getConfig } from '../config/env'
import { isSetupComplete, setSetupComplete, setStoredApiKey } from '../services/app-store'
import type { IpcResponse } from './handlers'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SystemCheckResult {
  pythonInstalled: boolean
  pythonVersion: string | null
  fasterWhisperInstalled: boolean
  gpuAvailable: boolean
  gpuName: string | null
  anthropicKeySet: boolean
}

// ─── IPC channels ──────────────────────────────────────────────────────────

export const SETUP_CHANNELS = {
  CHECK_SYSTEM: 'setup:check-system',
  SAVE_API_KEY: 'setup:save-api-key',
  SET_FIRST_RUN_DONE: 'setup:set-first-run-done',
  IS_FIRST_RUN: 'setup:is-first-run',
} as const

// ─── Helpers ───────────────────────────────────────────────────────────────

function runPythonCheck(
  executable: string,
  code: string,
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const proc = spawn(executable, ['-c', code], {
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    proc.on('error', () => {
      resolve({ ok: false, output: stderr || 'spawn error' })
    })

    proc.on('close', (code) => {
      resolve({ ok: code === 0, output: stdout.trim() || stderr.trim() })
    })
  })
}

async function checkSystem(): Promise<SystemCheckResult> {
  const config = getConfig()
  const py = config.python.executable

  // 1. Check Python
  const pyCheck = await runPythonCheck(
    py,
    'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")',
  )

  if (!pyCheck.ok) {
    return {
      pythonInstalled: false,
      pythonVersion: null,
      fasterWhisperInstalled: false,
      gpuAvailable: false,
      gpuName: null,
      anthropicKeySet: !!config.anthropic.apiKey,
    }
  }

  // 2. Check faster-whisper
  const fwCheck = await runPythonCheck(py, 'import faster_whisper; print("ok")')

  // 3. Check GPU
  const gpuCheck = await runPythonCheck(
    py,
    'import ctranslate2; count = ctranslate2.get_cuda_device_count(); import torch; name = torch.cuda.get_device_name(0) if count > 0 else None; print(f"{count}|{name}")',
  )

  let gpuAvailable = false
  let gpuName: string | null = null
  if (gpuCheck.ok) {
    const parts = gpuCheck.output.split('|')
    gpuAvailable = parseInt(parts[0], 10) > 0
    gpuName = parts[1] !== 'None' ? parts[1] : null
  }

  return {
    pythonInstalled: true,
    pythonVersion: pyCheck.output,
    fasterWhisperInstalled: fwCheck.ok,
    gpuAvailable,
    gpuName,
    anthropicKeySet: !!config.anthropic.apiKey,
  }
}

// ─── Registration ──────────────────────────────────────────────────────────

export function registerSetupHandlers(): void {
  log.info('Registering setup IPC handlers')

  ipcMain.handle(SETUP_CHANNELS.CHECK_SYSTEM, async (): Promise<IpcResponse<SystemCheckResult>> => {
    log.debug('IPC setup:check-system')
    try {
      const result = await checkSystem()
      return { ok: true, data: result }
    } catch (error) {
      log.error('setup:check-system failed', error)
      return { ok: false, error: 'Failed to check system', code: 'SETUP_CHECK_ERROR' }
    }
  })

  ipcMain.handle(
    SETUP_CHANNELS.SAVE_API_KEY,
    async (_event, key: string): Promise<IpcResponse<void>> => {
      log.debug('IPC setup:save-api-key')
      try {
        process.env['ANTHROPIC_API_KEY'] = key
        setStoredApiKey(key)
        return { ok: true, data: undefined }
      } catch (error) {
        log.error('setup:save-api-key failed', error)
        return { ok: false, error: 'Failed to save API key', code: 'SETUP_SAVE_KEY_ERROR' }
      }
    },
  )

  ipcMain.handle(SETUP_CHANNELS.SET_FIRST_RUN_DONE, (): IpcResponse<void> => {
    setSetupComplete()
    return { ok: true, data: undefined }
  })

  ipcMain.handle(SETUP_CHANNELS.IS_FIRST_RUN, (): IpcResponse<boolean> => {
    return { ok: true, data: !isSetupComplete() }
  })
}

export function unregisterSetupHandlers(): void {
  Object.values(SETUP_CHANNELS).forEach((channel) => {
    ipcMain.removeAllListeners(channel)
  })
}
