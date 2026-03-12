import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import log from 'electron-log'

export interface AppPaths {
  /** %APPDATA%/transcripta  (or platform equivalent) */
  userData: string
  /** SQLite database file */
  database: string
  /** electron-log output */
  logs: string
  /** Bundled Python scripts (inside app resources) */
  pythonScripts: string
  /** User-writable temp dir for in-progress transcriptions */
  temp: string
}

export interface AppConfig {
  paths: AppPaths
  python: {
    /** Executable used to invoke transcribe.py */
    executable: string
    /** faster-whisper model to use */
    whisperModel: string
    /** CUDA / cpu */
    device: string
    /** float16 / int8 / float32 */
    computeType: string
    /** Optional HuggingFace token for pyannote diarization */
    hfToken: string | undefined
  }
  anthropic: {
    apiKey: string | undefined
    model: string
  }
  app: {
    version: string
    isDev: boolean
  }
}

// ─── Path helpers ────────────────────────────────────────────────────────────

/**
 * Returns all resolved paths used by the main process.
 * Call once after `app.whenReady()`.
 */
export function getAppPaths(): AppPaths {
  const userData = app.getPath('userData')

  const paths: AppPaths = {
    userData,
    database: join(userData, 'transcripta.db'),
    logs: join(userData, 'logs'),
    // In production: resources live next to the app binary.
    // In dev: use the project-level python/ directory.
    pythonScripts: app.isPackaged
      ? join(process.resourcesPath, 'python')
      : join(app.getAppPath(), 'python'),
    temp: join(userData, 'temp'),
  }

  return paths
}

// ─── Full config ─────────────────────────────────────────────────────────────

let _config: AppConfig | null = null

/**
 * Returns the validated application configuration.
 * Reads environment variables set in .env (loaded by electron-vite dev) or
 * from the OS environment at runtime.
 *
 * Logs a warning for every optional value that is missing.
 */
export function getConfig(): AppConfig {
  if (_config) return _config

  const paths = getAppPaths()

  const pythonExecutable = process.env['PYTHON_PATH'] ?? 'python'
  const whisperModel = process.env['WHISPER_MODEL'] ?? 'large-v3'
  const device = process.env['WHISPER_DEVICE'] ?? 'cuda'
  const computeType = process.env['WHISPER_COMPUTE'] ?? 'float16'
  const hfToken = process.env['HF_TOKEN']
  const anthropicApiKey = process.env['ANTHROPIC_API_KEY']
  const anthropicModel = process.env['ANTHROPIC_MODEL'] ?? 'claude-sonnet-4-5-20250514'

  // ── Basic validation ──────────────────────────────────────────────────────

  if (!anthropicApiKey) {
    log.warn('ANTHROPIC_API_KEY is not set — summarization will be unavailable')
  }

  if (!hfToken) {
    log.warn('HF_TOKEN is not set — speaker diarization (pyannote) may be unavailable')
  }

  // Verify Python scripts directory exists (non-fatal in dev before first build)
  if (!existsSync(paths.pythonScripts)) {
    log.warn('Python scripts directory not found', { path: paths.pythonScripts })
  }

  _config = {
    paths,
    python: {
      executable: pythonExecutable,
      whisperModel,
      device,
      computeType,
      hfToken,
    },
    anthropic: {
      apiKey: anthropicApiKey,
      model: anthropicModel,
    },
    app: {
      version: app.getVersion(),
      isDev: !app.isPackaged,
    },
  }

  log.debug('Config loaded', {
    userData: paths.userData,
    pythonExecutable,
    whisperModel,
    device,
    hasApiKey: !!anthropicApiKey,
    hasDiarization: !!hfToken,
  })

  return _config
}

/** Resets the cached config (useful in tests). */
export function resetConfig(): void {
  _config = null
}
