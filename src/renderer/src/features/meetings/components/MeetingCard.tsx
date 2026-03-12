import React from 'react'
import { Meeting, MeetingStatus } from '@shared/types'
import { Badge } from '../../../components/ui/Badge'

interface MeetingCardProps {
  meeting: Meeting
  selected?: boolean
  onClick: (id: string) => void
}

function formatDate(date: Date): string {
  const d = new Date(date)
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  })
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return ''
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m >= 60) {
    const h = Math.floor(m / 60)
    const rem = m % 60
    return `${h}h ${rem}m`
  }
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

const statusIcons: Partial<Record<MeetingStatus, React.ReactNode>> = {
  [MeetingStatus.TRANSCRIBING]: (
    <svg
      className="animate-spin text-blue-400"
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <path d="M21 12a9 9 0 11-6.219-8.56" />
    </svg>
  ),
  [MeetingStatus.SUMMARIZING]: (
    <svg
      className="animate-spin text-purple-400"
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <path d="M21 12a9 9 0 11-6.219-8.56" />
    </svg>
  ),
}

export function MeetingCard({
  meeting,
  selected = false,
  onClick,
}: MeetingCardProps): React.JSX.Element {
  return (
    <button
      onClick={() => onClick(meeting.id)}
      className={[
        'flex w-full flex-col gap-1 rounded-md px-3 py-2.5 text-left',
        'transition-colors duration-100 cursor-pointer',
        selected
          ? 'bg-zinc-800 text-zinc-100'
          : 'text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100',
      ].join(' ')}
    >
      {/* Title row */}
      <div className="flex items-start justify-between gap-2">
        <span className="flex-1 truncate text-xs font-medium leading-snug">{meeting.title}</span>
        {statusIcons[meeting.status] ?? null}
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-zinc-500">{formatDate(meeting.createdAt)}</span>
        {meeting.duration !== null && (
          <>
            <span className="text-[10px] text-zinc-700">·</span>
            <span className="text-[10px] text-zinc-500">{formatDuration(meeting.duration)}</span>
          </>
        )}
        <span className="ml-auto">
          <Badge status={meeting.status} />
        </span>
      </div>
    </button>
  )
}
