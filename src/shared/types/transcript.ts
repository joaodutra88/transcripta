export interface TranscriptSegment {
  speaker: string | null
  start: number
  end: number
  text: string
}

export interface Transcript {
  id: string
  meetingId: string
  content: string
  segments: TranscriptSegment[]
}

export type TranscriptionEvent =
  | {
      type: 'progress'
      meetingId: string
      percent: number
    }
  | {
      type: 'segment'
      meetingId: string
      segment: TranscriptSegment
    }
  | {
      type: 'complete'
      meetingId: string
      transcript: Transcript
    }
  | {
      type: 'error'
      meetingId: string
      message: string
    }

export interface TranscriptionOptions {
  language?: string
  modelSize?: 'tiny' | 'base' | 'small' | 'medium' | 'large-v2' | 'large-v3'
  diarize?: boolean
  minSpeakers?: number
  maxSpeakers?: number
}
