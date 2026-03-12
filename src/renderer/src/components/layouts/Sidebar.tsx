import React from 'react'
import { Button } from '../ui/Button'
import type { Meeting } from '@shared/types'

interface SidebarProps {
  meetings: Meeting[]
  selectedMeetingId: string | null
  onSelectMeeting: (id: string) => void
  onNewMeeting: () => void
  loading?: boolean
  children?: React.ReactNode
}

export function Sidebar({ onNewMeeting, children }: SidebarProps): React.JSX.Element {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex flex-col gap-3 p-3 border-b border-zinc-800/60">
        <div className="flex items-center gap-2 px-1">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-600">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-zinc-100">Transcripta</span>
        </div>

        <Button
          variant="primary"
          size="sm"
          onClick={onNewMeeting}
          className="w-full justify-center"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Meeting
        </Button>
      </div>

      {/* Meeting list */}
      <div className="flex flex-col gap-0.5 flex-1 overflow-y-auto p-2">{children}</div>
    </div>
  )
}
