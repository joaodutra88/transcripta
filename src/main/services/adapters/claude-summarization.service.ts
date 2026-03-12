/**
 * claude-summarization.service.ts
 * ─────────────────────────────────
 * Concrete adapter that implements the SummarizationService port by calling
 * the Anthropic Messages API with tool_use to obtain a structured JSON summary.
 *
 * Design highlights
 * -----------------
 *  - Uses claude-sonnet-4-5-20250514 by default (good speed / quality balance).
 *  - Structured output via tool_use — the model is forced to call
 *    `produce_summary` which validates the shape of the response.
 *  - Long transcripts (> 80 K chars) are split into ~40 K-char chunks,
 *    each chunk is summarised individually, and the partial summaries are
 *    meta-summarised in a final pass.
 *  - Language: if the caller passes `options.language` the model produces the
 *    summary in that language; otherwise it detects the language from the
 *    transcript automatically.
 *  - validateConnection() sends a minimal probe message so the API key can be
 *    verified without sending real user data.
 */

import Anthropic from '@anthropic-ai/sdk'
import log from 'electron-log'
import { getConfig } from '../../config/env'
import type {
  SummarizationService,
  SummarizeOptions,
  SummaryResult,
  ActionItemDto,
} from '../ports/summarization.service'

// ─── Constants ────────────────────────────────────────────────────────────────

const CHUNK_CHAR_LIMIT = 40_000
const LONG_TRANSCRIPT_THRESHOLD = 80_000
const TOOL_NAME = 'produce_summary'

// ─── Tool definition ─────────────────────────────────────────────────────────

/**
 * Anthropic tool schema that forces the model to return a validated structure.
 * All fields are required so the response is always complete.
 */
const SUMMARY_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description:
    'Produces a structured meeting summary from a transcript. Call this tool exactly once with the complete summary.',
  input_schema: {
    type: 'object' as const,
    properties: {
      summary: {
        type: 'string',
        description: 'Full meeting summary written in Markdown format.',
      },
      actionItems: {
        type: 'array',
        description: 'List of action items extracted from the transcript.',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Description of the action item.' },
            assignee: { type: 'string', description: 'Person responsible, if mentioned.' },
          },
          required: ['text'],
        },
      },
      keyTopics: {
        type: 'array',
        description: 'Key topics discussed in the meeting (short tags or labels).',
        items: { type: 'string' },
      },
      decisions: {
        type: 'array',
        description: 'Explicit decisions made during the meeting.',
        items: { type: 'string' },
      },
    },
    required: ['summary', 'actionItems', 'keyTopics', 'decisions'],
  },
}

// ─── Error helpers ────────────────────────────────────────────────────────────

/**
 * Classifies an Anthropic SDK or network error into a human-readable message.
 */
function classifyError(error: unknown): string {
  if (error instanceof Anthropic.APIError) {
    if (error.status === 401) return 'Invalid or missing Anthropic API key (401 Unauthorized).'
    if (error.status === 429)
      return 'Anthropic rate limit exceeded (429 Too Many Requests). Please retry later.'
    if (error.status === 529)
      return 'Anthropic API is temporarily overloaded (529). Please retry later.'
    return `Anthropic API error ${error.status}: ${error.message}`
  }

  if (error instanceof Error) {
    if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
      return `Network error: unable to reach the Anthropic API. Check your internet connection.`
    }
    return error.message
  }

  return String(error)
}

// ─── Raw tool input type ──────────────────────────────────────────────────────

interface RawSummaryInput {
  summary: string
  actionItems: Array<{ text: string; assignee?: string }>
  keyTopics: string[]
  decisions: string[]
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export class ClaudeSummarizationService implements SummarizationService {
  private readonly client: Anthropic

  constructor() {
    const { anthropic } = getConfig()

    // The SDK reads ANTHROPIC_API_KEY from env automatically; passing it
    // explicitly here lets the config layer control the key source.
    this.client = new Anthropic({
      apiKey: anthropic.apiKey,
    })

    log.debug('ClaudeSummarizationService: initialised', {
      model: anthropic.model,
      hasApiKey: !!anthropic.apiKey,
    })
  }

  // ── summarize ──────────────────────────────────────────────────────────────

  async summarize(transcript: string, options?: SummarizeOptions): Promise<SummaryResult> {
    if (!transcript || transcript.trim().length === 0) {
      throw new Error('Transcript is empty — nothing to summarise.')
    }

    log.info('ClaudeSummarizationService: starting summarization', {
      transcriptLength: transcript.length,
      meetingTitle: options?.meetingTitle,
      language: options?.language,
    })

    // Route to chunked strategy for very long transcripts
    if (transcript.length > LONG_TRANSCRIPT_THRESHOLD) {
      return this._summarizeChunked(transcript, options)
    }

    return this._summarizeSingle(transcript, options)
  }

  // ── validateConnection ─────────────────────────────────────────────────────

  async validateConnection(): Promise<{ valid: boolean; error?: string }> {
    log.debug('ClaudeSummarizationService: validating connection')

    const { anthropic } = getConfig()

    if (!anthropic.apiKey) {
      return { valid: false, error: 'ANTHROPIC_API_KEY is not configured.' }
    }

    try {
      // Minimal probe — does not send user data, just checks reachability + auth
      await this.client.messages.create({
        model: anthropic.model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Reply with the word "ok".' }],
      })

      log.info('ClaudeSummarizationService: connection valid')
      return { valid: true }
    } catch (error) {
      const reason = classifyError(error)
      log.warn('ClaudeSummarizationService: connection invalid', { reason })
      return { valid: false, error: reason }
    }
  }

  // ── Private: single-pass summarization ────────────────────────────────────

  private async _summarizeSingle(
    transcript: string,
    options?: SummarizeOptions,
  ): Promise<SummaryResult> {
    const { anthropic } = getConfig()
    const model = options?.model ?? anthropic.model

    const userContent = this._buildUserMessage(transcript, options)

    log.debug('ClaudeSummarizationService: calling API (single pass)', { model })

    let response: Anthropic.Message
    try {
      response = await this.client.messages.create({
        model,
        max_tokens: 4096,
        system: this._buildSystemPrompt(options),
        tools: [SUMMARY_TOOL],
        tool_choice: { type: 'any' },
        messages: [{ role: 'user', content: userContent }],
      })
    } catch (error) {
      throw new Error(classifyError(error), { cause: error })
    }

    return this._extractToolResult(response)
  }

  // ── Private: chunked map-reduce summarization ──────────────────────────────

  private async _summarizeChunked(
    transcript: string,
    options?: SummarizeOptions,
  ): Promise<SummaryResult> {
    const chunks = this._chunkTranscript(transcript)
    log.info('ClaudeSummarizationService: long transcript — chunked strategy', {
      totalChars: transcript.length,
      chunks: chunks.length,
    })

    // Phase 1: summarise each chunk independently
    const partialSummaries: SummaryResult[] = []
    for (let i = 0; i < chunks.length; i++) {
      log.debug(`ClaudeSummarizationService: summarising chunk ${i + 1}/${chunks.length}`)
      const partial = await this._summarizeSingle(chunks[i], {
        ...options,
        meetingTitle: options?.meetingTitle
          ? `${options.meetingTitle} (part ${i + 1} of ${chunks.length})`
          : `Part ${i + 1} of ${chunks.length}`,
      })
      partialSummaries.push(partial)
    }

    // Phase 2: meta-summarise the partial summaries
    const combinedText = partialSummaries
      .map((s, i) => `## Part ${i + 1}\n\n${s.summary}`)
      .join('\n\n---\n\n')

    log.debug('ClaudeSummarizationService: meta-summarising partial results')

    const metaTranscript = [
      'The following are partial summaries of a long meeting transcript. ',
      'Consolidate them into a single comprehensive summary.\n\n',
      combinedText,
    ].join('')

    const metaResult = await this._summarizeSingle(metaTranscript, options)

    // Merge action items, topics, and decisions from all partials + meta
    const allActionItems = deduplicateActionItems([
      ...partialSummaries.flatMap((s) => s.actionItems),
      ...metaResult.actionItems,
    ])

    const allKeyTopics = deduplicate([
      ...partialSummaries.flatMap((s) => s.keyTopics),
      ...metaResult.keyTopics,
    ])

    const allDecisions = deduplicate([
      ...partialSummaries.flatMap((s) => s.decisions),
      ...metaResult.decisions,
    ])

    return {
      summary: metaResult.summary,
      actionItems: allActionItems,
      keyTopics: allKeyTopics,
      decisions: allDecisions,
    }
  }

  // ── Private: prompt builders ───────────────────────────────────────────────

  private _buildSystemPrompt(options?: SummarizeOptions): string {
    const languageInstruction = options?.language
      ? `Always respond and produce the summary in this language: ${options.language}.`
      : 'Detect the language of the transcript automatically and produce the summary in the same language.'

    return [
      'You are a professional meeting summarizer.',
      'Given a meeting transcript, you must call the produce_summary tool exactly once with a structured summary.',
      languageInstruction,
      'Be concise but comprehensive. Capture action items with assignees where mentioned.',
      'For key topics, use short noun phrases (e.g. "budget review", "roadmap Q3").',
      'For decisions, use past-tense declarative sentences (e.g. "Team agreed to delay launch to Q4").',
    ].join(' ')
  }

  private _buildUserMessage(transcript: string, options?: SummarizeOptions): string {
    const parts: string[] = []

    if (options?.meetingTitle) {
      parts.push(`Meeting title: ${options.meetingTitle}\n`)
    }

    parts.push('Transcript:\n')
    parts.push(transcript)

    return parts.join('')
  }

  // ── Private: extract tool_use result ──────────────────────────────────────

  private _extractToolResult(response: Anthropic.Message): SummaryResult {
    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === 'tool_use' && block.name === TOOL_NAME,
    )

    if (!toolUse) {
      const textBlocks = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')

      log.error('ClaudeSummarizationService: model did not call the produce_summary tool', {
        stopReason: response.stop_reason,
        textContent: textBlocks.slice(0, 200),
      })

      throw new Error(
        'The model did not return a structured summary. ' +
          `Stop reason: ${response.stop_reason}. ` +
          (textBlocks ? `Model said: "${textBlocks.slice(0, 100)}…"` : ''),
      )
    }

    const input = toolUse.input as RawSummaryInput

    const actionItems: ActionItemDto[] = (input.actionItems ?? []).map((item) => ({
      text: String(item.text ?? ''),
      ...(item.assignee ? { assignee: String(item.assignee) } : {}),
    }))

    return {
      summary: String(input.summary ?? ''),
      actionItems,
      keyTopics: (input.keyTopics ?? []).map(String),
      decisions: (input.decisions ?? []).map(String),
    }
  }

  // ── Private: chunking ──────────────────────────────────────────────────────

  /**
   * Splits the transcript into chunks of roughly `CHUNK_CHAR_LIMIT` characters,
   * preferring to break at newlines to avoid splitting mid-sentence.
   */
  private _chunkTranscript(transcript: string): string[] {
    const chunks: string[] = []
    let offset = 0

    while (offset < transcript.length) {
      const end = offset + CHUNK_CHAR_LIMIT

      if (end >= transcript.length) {
        chunks.push(transcript.slice(offset))
        break
      }

      // Walk back to the nearest newline to get a clean break
      let breakAt = end
      const newline = transcript.lastIndexOf('\n', end)
      if (newline > offset) {
        breakAt = newline + 1
      }

      chunks.push(transcript.slice(offset, breakAt))
      offset = breakAt
    }

    return chunks
  }
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

function deduplicate(items: string[]): string[] {
  return [...new Set(items.map((s) => s.trim()).filter(Boolean))]
}

function deduplicateActionItems(items: ActionItemDto[]): ActionItemDto[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = item.text.trim().toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ─── Singleton export (lazy) ──────────────────────────────────────────────────
// Instantiated on first use so that tests can mock dependencies (getConfig,
// Anthropic SDK) before the constructor executes.

let _instance: ClaudeSummarizationService | null = null

/**
 * Returns the shared ClaudeSummarizationService instance, creating it on the
 * first call. Lazy instantiation keeps this module safe to import in tests
 * without triggering `getConfig()` or Electron APIs at parse time.
 */
export function getClaudeSummarizationService(): ClaudeSummarizationService {
  if (!_instance) {
    _instance = new ClaudeSummarizationService()
  }
  return _instance
}
