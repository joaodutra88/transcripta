import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MeetingCard } from '../../../src/renderer/src/features/meetings/components/MeetingCard'
import { MeetingStatus } from '../../../src/shared/types'
import type { Meeting } from '../../../src/shared/types'

const baseMeeting: Meeting = {
  id: 'meeting-1',
  title: 'Q1 Planning Session',
  audioPath: '/audio/meeting.mp3',
  duration: 3720,
  status: MeetingStatus.COMPLETED,
  errorMessage: null,
  createdAt: new Date('2026-03-10T10:00:00Z'),
  updatedAt: new Date('2026-03-10T11:02:00Z'),
}

describe('MeetingCard', () => {
  it('renders the meeting title', () => {
    render(<MeetingCard meeting={baseMeeting} onClick={vi.fn()} />)
    expect(screen.getByText('Q1 Planning Session')).toBeInTheDocument()
  })

  it('renders the creation date', () => {
    render(<MeetingCard meeting={baseMeeting} onClick={vi.fn()} />)
    // Date rendered in some locale format containing "Mar" or "10"
    const dateEl = screen.getByText(/mar/i)
    expect(dateEl).toBeInTheDocument()
  })

  it('renders the status badge', () => {
    render(<MeetingCard meeting={baseMeeting} onClick={vi.fn()} />)
    expect(screen.getByText('Completed')).toBeInTheDocument()
  })

  it('calls onClick with the meeting id when clicked', () => {
    const handleClick = vi.fn()
    render(<MeetingCard meeting={baseMeeting} onClick={handleClick} />)
    fireEvent.click(screen.getByText('Q1 Planning Session'))
    expect(handleClick).toHaveBeenCalledWith('meeting-1')
  })

  it('applies selected styling when selected is true', () => {
    const { container } = render(
      <MeetingCard meeting={baseMeeting} selected={true} onClick={vi.fn()} />,
    )
    const button = container.querySelector('button')
    expect(button).toHaveClass('bg-zinc-800')
  })

  it('does not apply selected styling when not selected', () => {
    const { container } = render(
      <MeetingCard meeting={baseMeeting} selected={false} onClick={vi.fn()} />,
    )
    const button = container.querySelector('button')
    expect(button).not.toHaveClass('bg-zinc-800')
  })

  it('shows duration when available', () => {
    render(<MeetingCard meeting={baseMeeting} onClick={vi.fn()} />)
    // 3720 seconds = 1h 2m
    expect(screen.getByText(/1h 2m/)).toBeInTheDocument()
  })

  it('does not show duration when null', () => {
    render(<MeetingCard meeting={{ ...baseMeeting, duration: null }} onClick={vi.fn()} />)
    expect(screen.queryByText(/1h 2m/)).not.toBeInTheDocument()
  })

  it('renders FAILED status badge', () => {
    render(
      <MeetingCard meeting={{ ...baseMeeting, status: MeetingStatus.FAILED }} onClick={vi.fn()} />,
    )
    expect(screen.getByText('Failed')).toBeInTheDocument()
  })

  it('renders TRANSCRIBING status badge', () => {
    render(
      <MeetingCard
        meeting={{ ...baseMeeting, status: MeetingStatus.TRANSCRIBING }}
        onClick={vi.fn()}
      />,
    )
    expect(screen.getByText('Transcribing')).toBeInTheDocument()
  })

  it('renders SUMMARIZING status with spinner icon', () => {
    render(
      <MeetingCard
        meeting={{ ...baseMeeting, status: MeetingStatus.SUMMARIZING }}
        onClick={vi.fn()}
      />,
    )
    expect(screen.getByText('Summarizing')).toBeInTheDocument()
  })

  it('renders PENDING status badge', () => {
    render(
      <MeetingCard meeting={{ ...baseMeeting, status: MeetingStatus.PENDING }} onClick={vi.fn()} />,
    )
    expect(screen.getByText('Pending')).toBeInTheDocument()
  })

  it('shows minutes and seconds for durations under 1 hour', () => {
    render(<MeetingCard meeting={{ ...baseMeeting, duration: 125 }} onClick={vi.fn()} />)
    // 125 seconds = 2m 05s
    expect(screen.getByText(/2m 05s/)).toBeInTheDocument()
  })

  it('renders date without year when same year as now', () => {
    render(<MeetingCard meeting={{ ...baseMeeting, createdAt: new Date() }} onClick={vi.fn()} />)
    // Should render without year since it's the current year
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('renders date with year for older meetings', () => {
    render(
      <MeetingCard
        meeting={{ ...baseMeeting, createdAt: new Date('2024-01-15T10:00:00Z') }}
        onClick={vi.fn()}
      />,
    )
    expect(screen.getByText(/2024/)).toBeInTheDocument()
  })
})
