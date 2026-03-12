import React, { useState, useCallback, useRef, useEffect } from 'react'
import { Button } from '../../../components/ui/Button'
import type { Meeting } from '@shared/types'

interface CreateMeetingDialogProps {
  open: boolean
  onClose: () => void
  onCreate: (meeting: Meeting) => void
}

export function CreateMeetingDialog({
  open,
  onClose,
  onCreate,
}: CreateMeetingDialogProps): React.JSX.Element | null {
  const [title, setTitle] = useState('')
  const [audioPath, setAudioPath] = useState<string | null>(null)
  const [audioFileName, setAudioFileName] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setTitle('')
      setAudioPath(null)
      setAudioFileName(null)
      setError(null)
      setTimeout(() => titleRef.current?.focus(), 50)
    }
  }, [open])

  const handleSelectAudio = useCallback(async () => {
    const res = await window.api.files.selectAudio()
    if (!res.success) {
      setError(res.error)
      return
    }
    if (res.data) {
      setAudioPath(res.data)
      // Extract filename from path
      const parts = res.data.replace(/\\/g, '/').split('/')
      setAudioFileName(parts[parts.length - 1] ?? res.data)
    }
  }, [])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!title.trim()) {
        setError('Please enter a meeting title.')
        return
      }
      if (!audioPath) {
        setError('Please select an audio file.')
        return
      }

      setSubmitting(true)
      setError(null)

      try {
        const res = await window.api.meetings.create({
          title: title.trim(),
          audioPath,
        })

        if (!res.success) {
          setError(res.error)
          return
        }

        onCreate(res.data)
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unexpected error occurred.')
      } finally {
        setSubmitting(false)
      }
    },
    [title, audioPath, onCreate, onClose],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    },
    [onClose],
  )

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Create New Meeting"
      className="fixed inset-0 z-50 flex items-center justify-center"
      onKeyDown={handleKeyDown}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-100">New Meeting</h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
            aria-label="Close"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="1" y1="1" x2="13" y2="13" />
              <line x1="13" y1="1" x2="1" y2="13" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Title field */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="meeting-title" className="text-xs font-medium text-zinc-400">
              Meeting Title
            </label>
            <input
              id="meeting-title"
              ref={titleRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Q1 Planning Session"
              className="h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-100 placeholder-zinc-600 transition-colors focus:border-blue-500 focus:outline-none"
              autoComplete="off"
            />
          </div>

          {/* Audio file field */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-zinc-400">Audio File</span>
            <div
              className={[
                'flex items-center gap-3 rounded-md border px-3 py-2.5 transition-colors',
                audioPath ? 'border-zinc-700 bg-zinc-800' : 'border-zinc-700 bg-zinc-800/50',
              ].join(' ')}
            >
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-zinc-700 text-zinc-400">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
              </div>

              <span
                className={[
                  'flex-1 truncate text-xs',
                  audioFileName ? 'text-zinc-300' : 'text-zinc-600',
                ].join(' ')}
              >
                {audioFileName ?? 'No file selected'}
              </span>

              <Button type="button" variant="secondary" size="sm" onClick={handleSelectAudio}>
                {audioPath ? 'Change' : 'Browse'}
              </Button>
            </div>
            <p className="text-[11px] text-zinc-600">
              Supports MP3, WAV, M4A, FLAC, OGG, and other common formats.
            </p>
          </div>

          {/* Error */}
          {error && (
            <p className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400 ring-1 ring-red-500/20">
              {error}
            </p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={submitting}>
              Create Meeting
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
