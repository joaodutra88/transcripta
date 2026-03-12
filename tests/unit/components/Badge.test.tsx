import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Badge } from '../../../src/renderer/src/components/ui/Badge'
import { MeetingStatus } from '../../../src/shared/types'

describe('Badge', () => {
  it.each([
    [MeetingStatus.PENDING, 'Pending', 'text-yellow-400'],
    [MeetingStatus.TRANSCRIBING, 'Transcribing', 'text-blue-400'],
    [MeetingStatus.SUMMARIZING, 'Summarizing', 'text-purple-400'],
    [MeetingStatus.COMPLETED, 'Completed', 'text-green-400'],
    [MeetingStatus.FAILED, 'Failed', 'text-red-400'],
  ])('renders %s status with label "%s" and correct color class', (status, label, colorClass) => {
    render(<Badge status={status} />)
    const badge = screen.getByText(label)
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveClass(colorClass)
  })

  it('accepts an additional className prop', () => {
    render(<Badge status={MeetingStatus.COMPLETED} className="extra-class" />)
    const badge = screen.getByText('Completed')
    expect(badge).toHaveClass('extra-class')
  })

  it('renders as an inline span', () => {
    render(<Badge status={MeetingStatus.PENDING} />)
    const badge = screen.getByText('Pending')
    expect(badge.tagName.toLowerCase()).toBe('span')
  })
})
