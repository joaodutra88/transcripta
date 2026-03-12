// ─── Domain types ─────────────────────────────────────────────────────────────

export interface ActionItemDto {
  text: string
  /** Person responsible, if extractable from the transcript. */
  assignee?: string
}

/**
 * Structured output returned by a completed summarization job.
 * All string fields contain UTF-8 text; `summary` is Markdown.
 */
export interface SummaryResult {
  /** Full meeting summary in Markdown. */
  summary: string
  /** Zero or more extracted action items. */
  actionItems: ActionItemDto[]
  /** Key topics discussed (tags/labels). */
  keyTopics: string[]
  /** Explicit decisions made during the meeting. */
  decisions: string[]
}

// ─── Options ──────────────────────────────────────────────────────────────────

export interface SummarizeOptions {
  /**
   * Optional meeting title added to the prompt for context.
   * Helps the model produce a more relevant summary.
   */
  meetingTitle?: string
  /**
   * Language hint passed to the model (e.g. "pt-BR", "en-US").
   * The model will produce the summary in this language when provided.
   */
  language?: string
  /**
   * Override the Claude model used for this call.
   * Defaults to the value in AppConfig (`claude-sonnet-4-5-20250514`).
   */
  model?: string
}

// ─── Port interface ───────────────────────────────────────────────────────────

/**
 * Port (interface) for AI-powered meeting summarization.
 *
 * The concrete adapter (`services/adapters/claude-summarization.service.ts`)
 * calls the Anthropic API. Depending on this abstraction (DIP) keeps the main
 * process decoupled from the SDK and makes the provider swappable (e.g. a local
 * LLM in the future).
 *
 * Long transcripts (> 100 K tokens) should be handled by the adapter via a
 * map-reduce strategy: chunk → summarize each chunk → meta-summarize.
 */
export interface SummarizationService {
  /**
   * Generates a structured summary of the given transcript text.
   *
   * @param transcript - Full plain-text transcript (may include speaker labels).
   * @param options    - Optional prompt hints (title, language, model override).
   * @returns A {@link SummaryResult} with markdown summary, action items,
   *          key topics, and decisions.
   * @throws When the API key is missing, invalid, or a network/rate-limit error occurs.
   */
  summarize(transcript: string, options?: SummarizeOptions): Promise<SummaryResult>

  /**
   * Validates that the service is configured and reachable.
   * Performs a minimal probe call (e.g. a short completion) without sending
   * real user data.
   *
   * @returns `{ valid: true }` on success, or `{ valid: false, error }` with a
   *          human-readable reason.
   */
  validateConnection(): Promise<{ valid: boolean; error?: string }>
}
