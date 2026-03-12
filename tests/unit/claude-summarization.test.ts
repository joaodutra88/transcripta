// @vitest-environment node
/**
 * Unit tests for ClaudeSummarizationService.
 *
 * The Anthropic SDK is mocked via vi.mock so no real API calls are made.
 * Tests cover:
 *  - Successful single-pass summarization
 *  - API key validation (validateConnection)
 *  - Error handling: invalid key, rate limit, network error, empty transcript
 *  - Chunking strategy for long transcripts (> 80 K chars)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Hoist mock functions so they are available inside vi.mock factories ───────
// vi.mock factories are hoisted to the top of the file by Vitest, but regular
// `const` declarations are not. vi.hoisted() runs before any imports and
// guarantees the returned references are in scope inside the factory closures.

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }))

// ─── Mock @anthropic-ai/sdk BEFORE importing the module under test ─────────────

vi.mock('@anthropic-ai/sdk', () => {
  // Mimic the shape of the real Anthropic class and its exported error types.
  class MockAnthropicAPIError extends Error {
    status: number
    constructor(message: string, status: number) {
      super(message)
      this.name = 'APIError'
      this.status = status
    }
  }

  class MockAnthropic {
    messages = {
      create: mockCreate,
    }
  }

  // Make the default export callable as `new Anthropic(...)` and expose APIError
  const MockAnthropicWithStatics = Object.assign(MockAnthropic, {
    APIError: MockAnthropicAPIError,
  })

  return {
    default: MockAnthropicWithStatics,
    APIError: MockAnthropicAPIError,
  }
})

// ─── Mock electron-log ────────────────────────────────────────────────────────

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
    anthropic: {
      apiKey: 'sk-ant-test-key',
      model: 'claude-sonnet-4-5-20250514',
    },
    paths: {},
    python: {},
    app: { isDev: true, version: '0.0.0' },
  })),
}))

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk'
import {
  ClaudeSummarizationService,
  getClaudeSummarizationService,
} from '../../src/main/services/adapters/claude-summarization.service'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds a mock Anthropic Messages API response that calls the produce_summary
 * tool with the given payload.
 */
function mockToolResponse(payload: {
  summary?: string
  actionItems?: Array<{ text: string; assignee?: string }>
  keyTopics?: string[]
  decisions?: string[]
}): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-5-20250514',
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 200 },
    content: [
      {
        type: 'tool_use',
        id: 'toolu_01',
        name: 'produce_summary',
        input: {
          summary: payload.summary ?? '## Meeting Summary\n\nThis was a productive meeting.',
          actionItems: payload.actionItems ?? [],
          keyTopics: payload.keyTopics ?? [],
          decisions: payload.decisions ?? [],
        },
      },
    ],
  } as unknown as Anthropic.Message
}

const SAMPLE_TRANSCRIPT = `
Speaker 1: Good morning everyone. Let's start the sprint planning meeting.
Speaker 2: Sounds good. We need to discuss the roadmap and Q3 priorities.
Speaker 1: Agreed. John, can you take ownership of the auth module refactoring?
Speaker 2: Sure. I'll have it done by Friday.
Speaker 1: Great. We've decided to delay the launch to Q4 due to testing feedback.
Speaker 2: That makes sense. Key topics today: roadmap, auth refactoring, launch timeline.
`.trim()

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ClaudeSummarizationService', () => {
  let service: ClaudeSummarizationService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new ClaudeSummarizationService()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── Successful summarization ─────────────────────────────────────────────

  describe('summarize() — success paths', () => {
    it('returns a SummaryResult with all fields on success', async () => {
      mockCreate.mockResolvedValueOnce(
        mockToolResponse({
          summary: '## Sprint Planning\n\nTeam discussed Q3 roadmap and auth refactoring.',
          actionItems: [{ text: 'Refactor auth module', assignee: 'John' }],
          keyTopics: ['roadmap', 'auth refactoring', 'launch timeline'],
          decisions: ['Launch delayed to Q4 due to testing feedback.'],
        }),
      )

      const result = await service.summarize(SAMPLE_TRANSCRIPT)

      expect(result.summary).toContain('Sprint Planning')
      expect(result.actionItems).toHaveLength(1)
      expect(result.actionItems[0]).toMatchObject({
        text: 'Refactor auth module',
        assignee: 'John',
      })
      expect(result.keyTopics).toContain('roadmap')
      expect(result.decisions).toHaveLength(1)
      expect(result.decisions[0]).toMatch(/Q4/)
    })

    it('passes meetingTitle and language to the API messages', async () => {
      mockCreate.mockResolvedValueOnce(mockToolResponse({}))

      await service.summarize(SAMPLE_TRANSCRIPT, {
        meetingTitle: 'Sprint Planning Q3',
        language: 'pt-BR',
      })

      expect(mockCreate).toHaveBeenCalledOnce()
      const callArgs = mockCreate.mock.calls[0][0] as Anthropic.MessageCreateParamsNonStreaming

      // System prompt should reference the language
      expect(callArgs.system).toContain('pt-BR')

      // User message should contain the meeting title
      const userMsg = callArgs.messages[0].content as string
      expect(userMsg).toContain('Sprint Planning Q3')
    })

    it('uses model override from options when provided', async () => {
      mockCreate.mockResolvedValueOnce(mockToolResponse({}))

      await service.summarize(SAMPLE_TRANSCRIPT, { model: 'claude-opus-4-5-20251101' })

      const callArgs = mockCreate.mock.calls[0][0] as Anthropic.MessageCreateParamsNonStreaming
      expect(callArgs.model).toBe('claude-opus-4-5-20251101')
    })

    it('uses default model from config when no override is given', async () => {
      mockCreate.mockResolvedValueOnce(mockToolResponse({}))

      await service.summarize(SAMPLE_TRANSCRIPT)

      const callArgs = mockCreate.mock.calls[0][0] as Anthropic.MessageCreateParamsNonStreaming
      expect(callArgs.model).toBe('claude-sonnet-4-5-20250514')
    })

    it('returns empty arrays for optional fields when model returns empty lists', async () => {
      mockCreate.mockResolvedValueOnce(
        mockToolResponse({
          summary: 'Short meeting.',
          actionItems: [],
          keyTopics: [],
          decisions: [],
        }),
      )

      const result = await service.summarize(SAMPLE_TRANSCRIPT)

      expect(result.actionItems).toEqual([])
      expect(result.keyTopics).toEqual([])
      expect(result.decisions).toEqual([])
    })

    it('returns action items without assignee when assignee is omitted', async () => {
      mockCreate.mockResolvedValueOnce(
        mockToolResponse({
          actionItems: [{ text: 'Write tests' }],
        }),
      )

      const result = await service.summarize(SAMPLE_TRANSCRIPT)

      expect(result.actionItems[0]).toMatchObject({ text: 'Write tests' })
      expect(result.actionItems[0].assignee).toBeUndefined()
    })
  })

  // ── Error handling ───────────────────────────────────────────────────────

  describe('summarize() — error handling', () => {
    it('throws a descriptive error when the transcript is empty', async () => {
      await expect(service.summarize('')).rejects.toThrow(/empty/)
      await expect(service.summarize('   ')).rejects.toThrow(/empty/)
    })

    it('throws with "Invalid or missing" message on 401 from the API', async () => {
      const apiError = new (Anthropic.APIError as unknown as new (
        msg: string,
        status: number,
      ) => Error)('Unauthorized', 401)
      mockCreate.mockRejectedValueOnce(apiError)

      await expect(service.summarize(SAMPLE_TRANSCRIPT)).rejects.toThrow(/Invalid or missing/)
    })

    it('throws with "rate limit" message on 429 from the API', async () => {
      const apiError = new (Anthropic.APIError as unknown as new (
        msg: string,
        status: number,
      ) => Error)('Too Many Requests', 429)
      mockCreate.mockRejectedValueOnce(apiError)

      await expect(service.summarize(SAMPLE_TRANSCRIPT)).rejects.toThrow(/rate limit/i)
    })

    it('throws with "Network error" message on ENOTFOUND', async () => {
      const networkError = new Error('getaddrinfo ENOTFOUND api.anthropic.com')
      mockCreate.mockRejectedValueOnce(networkError)

      await expect(service.summarize(SAMPLE_TRANSCRIPT)).rejects.toThrow(/Network error/)
    })

    it('throws when the model does not call the produce_summary tool', async () => {
      // Model returns a text block instead of a tool call
      const badResponse: Partial<Anthropic.Message> = {
        id: 'msg_test',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'I cannot summarize this.' } as Anthropic.TextBlock],
      }
      mockCreate.mockResolvedValueOnce(badResponse)

      await expect(service.summarize(SAMPLE_TRANSCRIPT)).rejects.toThrow(
        /did not return a structured summary/,
      )
    })
  })

  // ── validateConnection ───────────────────────────────────────────────────

  describe('validateConnection()', () => {
    it('returns { valid: true } when the API probe succeeds', async () => {
      // The probe just needs to resolve without error
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
      })

      const result = await service.validateConnection()

      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('returns { valid: false } with an error message on 401', async () => {
      const apiError = new (Anthropic.APIError as unknown as new (
        msg: string,
        status: number,
      ) => Error)('Unauthorized', 401)
      mockCreate.mockRejectedValueOnce(apiError)

      const result = await service.validateConnection()

      expect(result.valid).toBe(false)
      expect(result.error).toMatch(/Invalid or missing/)
    })

    it('returns { valid: false } when ANTHROPIC_API_KEY is not set', async () => {
      const { getConfig } = await import('../../src/main/config/env')
      vi.mocked(getConfig).mockReturnValueOnce({
        anthropic: { apiKey: undefined, model: 'claude-sonnet-4-5-20250514' },
        paths: {} as never,
        python: {} as never,
        app: { isDev: true, version: '0.0.0' },
      })

      const result = await service.validateConnection()

      expect(result.valid).toBe(false)
      expect(result.error).toMatch(/not configured/)
      // No API call should have been made
      expect(mockCreate).not.toHaveBeenCalled()
    })
  })

  // ── getClaudeSummarizationService singleton ──────────────────────────────

  describe('getClaudeSummarizationService()', () => {
    it('returns an instance of ClaudeSummarizationService', () => {
      const instance = getClaudeSummarizationService()
      expect(instance).toBeInstanceOf(ClaudeSummarizationService)
    })

    it('returns the same instance on repeated calls', () => {
      const a = getClaudeSummarizationService()
      const b = getClaudeSummarizationService()
      expect(a).toBe(b)
    })
  })

  // ── Additional error branches ──────────────────────────────────────────

  describe('summarize() — additional error branches', () => {
    it('throws with "overloaded" message on 529 from the API', async () => {
      const apiError = new (Anthropic.APIError as unknown as new (
        msg: string,
        status: number,
      ) => Error)('Overloaded', 529)
      mockCreate.mockRejectedValueOnce(apiError)

      await expect(service.summarize(SAMPLE_TRANSCRIPT)).rejects.toThrow(/overloaded/i)
    })

    it('throws with generic API error message on unknown status code', async () => {
      const apiError = new (Anthropic.APIError as unknown as new (
        msg: string,
        status: number,
      ) => Error)('Internal Server Error', 500)
      mockCreate.mockRejectedValueOnce(apiError)

      await expect(service.summarize(SAMPLE_TRANSCRIPT)).rejects.toThrow(/500/)
    })

    it('throws with ECONNREFUSED as network error', async () => {
      const networkError = new Error('connect ECONNREFUSED 127.0.0.1:443')
      mockCreate.mockRejectedValueOnce(networkError)

      await expect(service.summarize(SAMPLE_TRANSCRIPT)).rejects.toThrow(/Network error/)
    })

    it('stringifies non-Error objects thrown by the API', async () => {
      mockCreate.mockRejectedValueOnce('raw string error')

      await expect(service.summarize(SAMPLE_TRANSCRIPT)).rejects.toThrow('raw string error')
    })

    it('throws when model returns tool with wrong name', async () => {
      const badResponse: Partial<Anthropic.Message> = {
        id: 'msg_test',
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_01',
            name: 'wrong_tool',
            input: {},
          } as Anthropic.ToolUseBlock,
        ],
      }
      mockCreate.mockResolvedValueOnce(badResponse)

      await expect(service.summarize(SAMPLE_TRANSCRIPT)).rejects.toThrow(/did not return/)
    })

    it('throws with text content when model returns text instead of tool', async () => {
      const badResponse: Partial<Anthropic.Message> = {
        id: 'msg_test',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '' } as Anthropic.TextBlock],
      }
      mockCreate.mockResolvedValueOnce(badResponse)

      await expect(service.summarize(SAMPLE_TRANSCRIPT)).rejects.toThrow(/did not return/)
    })
  })

  // ── Chunking for long transcripts ────────────────────────────────────────

  describe('chunking for long transcripts', () => {
    it('splits a transcript > 80K chars into chunks and meta-summarises', async () => {
      // Build a transcript that exceeds the 80K threshold
      const longTranscript = SAMPLE_TRANSCRIPT.repeat(800) // ~540K chars

      // All API calls return successful tool responses
      mockCreate.mockResolvedValue(
        mockToolResponse({
          summary: '## Partial Summary\n\nDiscussed various topics.',
          actionItems: [{ text: 'Write tests', assignee: 'Alice' }],
          keyTopics: ['planning', 'roadmap'],
          decisions: ['Delayed launch to Q4.'],
        }),
      )

      const result = await service.summarize(longTranscript)

      // Should have called the API more than once (chunks + meta pass)
      expect(mockCreate.mock.calls.length).toBeGreaterThan(1)

      // Final result should be a SummaryResult
      expect(result).toMatchObject({
        summary: expect.any(String),
        actionItems: expect.any(Array),
        keyTopics: expect.any(Array),
        decisions: expect.any(Array),
      })
    })

    it('deduplicates action items and topics across chunk summaries', async () => {
      const longTranscript = SAMPLE_TRANSCRIPT.repeat(800)

      // Every chunk returns the same action item and topic
      mockCreate.mockResolvedValue(
        mockToolResponse({
          summary: '## Summary',
          actionItems: [{ text: 'Write tests', assignee: 'Alice' }],
          keyTopics: ['planning'],
          decisions: ['Delayed launch.'],
        }),
      )

      const result = await service.summarize(longTranscript)

      // After deduplication, each item should appear only once
      const texts = result.actionItems.map((a) => a.text.toLowerCase().trim())
      const unique = new Set(texts)
      expect(texts.length).toBe(unique.size)

      const topicSet = new Set(result.keyTopics.map((t) => t.trim()))
      expect(result.keyTopics.length).toBe(topicSet.size)
    })

    it('does NOT chunk transcripts shorter than 80K chars', async () => {
      // Transcript is well under the threshold
      mockCreate.mockResolvedValueOnce(mockToolResponse({}))

      await service.summarize(SAMPLE_TRANSCRIPT)

      // Should call the API exactly once
      expect(mockCreate).toHaveBeenCalledOnce()
    })

    it('uses meetingTitle in chunk labels when meetingTitle option is provided', async () => {
      const longTranscript = SAMPLE_TRANSCRIPT.repeat(800)

      mockCreate.mockResolvedValue(
        mockToolResponse({
          summary: '## Summary',
          actionItems: [],
          keyTopics: [],
          decisions: [],
        }),
      )

      await service.summarize(longTranscript, { meetingTitle: 'Team Sync' })

      // Should have called the API multiple times (chunks + meta)
      expect(mockCreate.mock.calls.length).toBeGreaterThan(1)

      // The first chunk call should include "Team Sync (part 1 of N)" in the user message
      const firstCallArgs = mockCreate.mock.calls[0][0] as { messages: Array<{ content: string }> }
      expect(firstCallArgs.messages[0].content).toContain('Team Sync (part 1 of')
    })

    it('handles transcript chunk with no newline — uses hard character break', async () => {
      // Build a transcript with no newlines so the chunk has no preferred break point
      // This forces the `if (newline > offset)` branch to be false
      const noNewlineBlock = 'x'.repeat(40_000) // exactly CHUNK_CHAR_LIMIT, no newlines
      const longTranscript = noNewlineBlock.repeat(3) // 120K chars, well above threshold

      mockCreate.mockResolvedValue(
        mockToolResponse({
          summary: '## Summary',
          actionItems: [],
          keyTopics: [],
          decisions: [],
        }),
      )

      const result = await service.summarize(longTranscript)

      expect(mockCreate.mock.calls.length).toBeGreaterThan(1)
      expect(result.summary).toBeTruthy()
    })
  })

  // ── _extractToolResult null-field branches ────────────────────────────────

  describe('summarize() — null field branches in tool result', () => {
    it('handles null actionItems / keyTopics / decisions from the model', async () => {
      const rawResponse = {
        id: 'msg_test',
        type: 'message' as const,
        role: 'assistant' as const,
        model: 'claude-sonnet-4-5-20250514',
        stop_reason: 'tool_use' as const,
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 200 },
        content: [
          {
            type: 'tool_use' as const,
            id: 'toolu_01',
            name: 'produce_summary',
            input: {
              summary: 'Null fields test.',
              // actionItems, keyTopics, decisions intentionally omitted (undefined → ?? [])
            },
          },
        ],
      }
      mockCreate.mockResolvedValueOnce(rawResponse)

      const result = await service.summarize(SAMPLE_TRANSCRIPT)

      expect(result.actionItems).toEqual([])
      expect(result.keyTopics).toEqual([])
      expect(result.decisions).toEqual([])
    })

    it('handles action item with missing text and missing assignee', async () => {
      const rawResponse = {
        id: 'msg_test',
        type: 'message' as const,
        role: 'assistant' as const,
        model: 'claude-sonnet-4-5-20250514',
        stop_reason: 'tool_use' as const,
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 200 },
        content: [
          {
            type: 'tool_use' as const,
            id: 'toolu_01',
            name: 'produce_summary',
            input: {
              summary: 'Test.',
              actionItems: [{}], // missing text and assignee
              keyTopics: [],
              decisions: [],
            },
          },
        ],
      }
      mockCreate.mockResolvedValueOnce(rawResponse)

      const result = await service.summarize(SAMPLE_TRANSCRIPT)

      expect(result.actionItems[0].text).toBe('')
      expect(result.actionItems[0].assignee).toBeUndefined()
    })

    it('throws with empty textBlocks when model returns no-text content and wrong tool', async () => {
      // Covers the `textBlocks ? ... : ''` branch where textBlocks is empty
      const badResponse = {
        id: 'msg_test',
        stop_reason: 'tool_use' as const,
        content: [] as Anthropic.ContentBlock[],
      }
      mockCreate.mockResolvedValueOnce(badResponse)

      await expect(service.summarize(SAMPLE_TRANSCRIPT)).rejects.toThrow(/did not return/)
    })
  })
})
