// ─── Event types emitted by the Python bridge ────────────────────────────────

export interface TranscriptionProgressEvent {
  type: 'progress'
  /** 0–100 */
  percent: number
  /** Human-readable step label, e.g. "loading model", "transcribing", "aligning" */
  step: string
}

export interface TranscriptionSegmentEvent {
  type: 'segment'
  speaker: string
  /** Seconds from audio start */
  start: number
  /** Seconds from audio start */
  end: number
  text: string
}

export interface TranscriptionCompleteEvent {
  type: 'complete'
  segmentsCount: number
  /** Wall-clock duration of the transcription job, in seconds */
  elapsedSeconds: number
}

export interface TranscriptionErrorEvent {
  type: 'error'
  message: string
  /** Structured error code for programmatic handling */
  code: TranscriptionErrorCode
}

export type TranscriptionErrorCode =
  | 'PYTHON_NOT_FOUND'
  | 'FASTER_WHISPER_NOT_INSTALLED'
  | 'CUDA_NOT_AVAILABLE'
  | 'FILE_TOO_LARGE'
  | 'FILE_NOT_FOUND'
  | 'PROCESS_CRASHED'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'UNKNOWN'

export type TranscriptionEvent =
  | TranscriptionProgressEvent
  | TranscriptionSegmentEvent
  | TranscriptionCompleteEvent
  | TranscriptionErrorEvent

// ─── Options ──────────────────────────────────────────────────────────────────

export interface TranscriptionOptions {
  /** faster-whisper model size. Defaults to value in AppConfig. */
  model?: string
  /** "cuda" | "cpu". Defaults to value in AppConfig. */
  device?: string
  /** "float16" | "int8" | "float32". Defaults to value in AppConfig. */
  computeType?: string
  /** HuggingFace token for pyannote diarization. Omit to skip diarization. */
  hfToken?: string
  /** Max wall-clock seconds before the job is killed. Default: 1800 (30 min). */
  timeoutSeconds?: number
}

// ─── Availability probe ───────────────────────────────────────────────────────

export interface TranscriptionAvailability {
  available: boolean
  gpuDetected: boolean
  /** Set when `available` is false, explaining why. */
  error?: string
}

// ─── Port interface ───────────────────────────────────────────────────────────

/**
 * Port (interface) for the transcription engine.
 *
 * The concrete adapter (`services/adapters/whisper-transcription.service.ts`)
 * spawns a Python child process and pipes JSON-line events back as an
 * `AsyncGenerator`. Consumers iterate with `for await … of` and forward
 * progress events to the renderer via IPC.
 *
 * Design notes:
 *  - `AsyncGenerator` lets the caller cancel mid-stream by calling `.return()`,
 *    which the adapter maps to a SIGTERM on the child process.
 *  - One `TranscriptionErrorEvent` signals a non-recoverable failure; the
 *    generator terminates after yielding it.
 *  - `TranscriptionCompleteEvent` is always the last value when the job succeeds.
 */
export interface TranscriptionService {
  /**
   * Starts a transcription job and streams events as they arrive.
   *
   * @param audioPath - Absolute path to the audio/video file.
   * @param options   - Runtime overrides for model, device, etc.
   * @yields {@link TranscriptionEvent} until complete or errored.
   */
  transcribe(
    audioPath: string,
    options?: TranscriptionOptions,
  ): AsyncGenerator<TranscriptionEvent, void, undefined>

  /**
   * Probes whether Python and faster-whisper are available.
   * Should complete in < 5 seconds; does not start a real transcription.
   */
  isAvailable(): Promise<TranscriptionAvailability>

  /**
   * Cancels an in-progress transcription for the given meeting.
   * No-op if no job is active for `meetingId`.
   */
  cancel(meetingId: string): Promise<void>
}
