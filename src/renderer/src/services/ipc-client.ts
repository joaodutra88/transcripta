import type {
  Meeting,
  CreateMeetingDto,
  UpdateMeetingDto,
  TranscriptionOptions,
  TranscriptionEvent,
  SummarizeOptions,
} from '@shared/types'

/**
 * Typed wrapper around window.api for convenient usage in components.
 * Throws on IPC errors so callers can use try/catch.
 */
export const ipcClient = {
  meetings: {
    async list(): Promise<Meeting[]> {
      const res = await window.api.meetings.list()
      if (!res.success) throw new Error(res.error)
      return res.data
    },

    async get(id: string): Promise<Meeting> {
      const res = await window.api.meetings.get(id)
      if (!res.success) throw new Error(res.error)
      return res.data
    },

    async create(dto: CreateMeetingDto): Promise<Meeting> {
      const res = await window.api.meetings.create(dto)
      if (!res.success) throw new Error(res.error)
      return res.data
    },

    async update(id: string, dto: UpdateMeetingDto): Promise<Meeting> {
      const res = await window.api.meetings.update(id, dto)
      if (!res.success) throw new Error(res.error)
      return res.data
    },

    async delete(id: string): Promise<void> {
      const res = await window.api.meetings.delete(id)
      if (!res.success) throw new Error(res.error)
    },
  },

  transcription: {
    async start(meetingId: string, options?: TranscriptionOptions): Promise<void> {
      const res = await window.api.transcription.start(meetingId, options)
      if (!res.success) throw new Error(res.error)
    },

    async status(meetingId: string): Promise<TranscriptionEvent> {
      const res = await window.api.transcription.status(meetingId)
      if (!res.success) throw new Error(res.error)
      return res.data as TranscriptionEvent
    },

    async cancel(meetingId: string): Promise<void> {
      const res = await window.api.transcription.cancel(meetingId)
      if (!res.success) throw new Error(res.error)
    },

    async check(): Promise<{ available: boolean; version?: string }> {
      const res = await window.api.transcription.check()
      if (!res.success) throw new Error(res.error)
      return res.data
    },
  },

  summarization: {
    async start(meetingId: string, options?: SummarizeOptions): Promise<void> {
      const res = await window.api.summarization.start(meetingId, options)
      if (!res.success) throw new Error(res.error)
    },

    async status(meetingId: string): Promise<{ status: string; progress?: number }> {
      const res = await window.api.summarization.status(meetingId)
      if (!res.success) throw new Error(res.error)
      return res.data
    },
  },

  files: {
    async selectAudio(): Promise<string | null> {
      const res = await window.api.files.selectAudio()
      if (!res.success) throw new Error(res.error)
      return res.data
    },
  },

  app: {
    async getVersion(): Promise<string> {
      const res = await window.api.app.getVersion()
      if (!res.success) throw new Error(res.error)
      return res.data
    },
  },
}
