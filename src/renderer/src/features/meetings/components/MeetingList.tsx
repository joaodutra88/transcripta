import React from 'react'
import type { Meeting } from '@shared/types'
import { MeetingCard } from './MeetingCard'
import { EmptyState } from '../../../components/ui/EmptyState'
import { Spinner } from '../../../components/ui/Spinner'

interface MeetingListProps {
  meetings: Meeting[]
  selectedMeetingId: string | null
  onSelectMeeting: (id: string) => void
  onNewMeeting: () => void
  loading?: boolean
  error?: string | null
}

const MicrophoneIcon = (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
)

export function MeetingList({
  meetings,
  selectedMeetingId,
  onSelectMeeting,
  onNewMeeting,
  loading = false,
  error = null,
}: MeetingListProps): React.JSX.Element {
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-8">
        <Spinner size="md" label="Loading meetings…" />
      </div>
    )
  }

  if (error) {
    return (
      <EmptyState
        title="Failed to load meetings"
        description={error}
        action={{ label: 'Retry', onClick: onNewMeeting }}
      />
    )
  }

  if (meetings.length === 0) {
    return (
      <EmptyState
        icon={MicrophoneIcon}
        title="No meetings yet"
        description="Create your first meeting to get started with transcription."
        action={{ label: 'New Meeting', onClick: onNewMeeting }}
      />
    )
  }

  return (
    <>
      {meetings.map((meeting) => (
        <MeetingCard
          key={meeting.id}
          meeting={meeting}
          selected={selectedMeetingId === meeting.id}
          onClick={onSelectMeeting}
        />
      ))}
    </>
  )
}
