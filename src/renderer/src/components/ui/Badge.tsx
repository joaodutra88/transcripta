import React from 'react'
import { MeetingStatus } from '@shared/types'

interface BadgeProps {
  status: MeetingStatus
  className?: string
}

const statusConfig: Record<MeetingStatus, { label: string; className: string }> = {
  [MeetingStatus.PENDING]: {
    label: 'Pending',
    className: 'bg-yellow-500/15 text-yellow-400 ring-yellow-500/30',
  },
  [MeetingStatus.TRANSCRIBING]: {
    label: 'Transcribing',
    className: 'bg-blue-500/15 text-blue-400 ring-blue-500/30',
  },
  [MeetingStatus.SUMMARIZING]: {
    label: 'Summarizing',
    className: 'bg-purple-500/15 text-purple-400 ring-purple-500/30',
  },
  [MeetingStatus.COMPLETED]: {
    label: 'Completed',
    className: 'bg-green-500/15 text-green-400 ring-green-500/30',
  },
  [MeetingStatus.FAILED]: {
    label: 'Failed',
    className: 'bg-red-500/15 text-red-400 ring-red-500/30',
  },
}

export function Badge({ status, className = '' }: BadgeProps): React.JSX.Element {
  const config = statusConfig[status]

  return (
    <span
      className={[
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        config.className,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {config.label}
    </span>
  )
}

export { statusConfig }
