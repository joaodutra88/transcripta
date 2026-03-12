export enum MeetingStatus {
  PENDING = 'PENDING',
  TRANSCRIBING = 'TRANSCRIBING',
  SUMMARIZING = 'SUMMARIZING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export interface Meeting {
  id: string
  title: string
  audioPath: string
  duration: number | null
  status: MeetingStatus
  errorMessage: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateMeetingDto {
  title: string
  audioPath: string
}

export interface UpdateMeetingDto {
  title?: string
  audioPath?: string
  duration?: number | null
  status?: MeetingStatus
  errorMessage?: string | null
}
