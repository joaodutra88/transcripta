import React, { useState, useEffect, useCallback } from 'react'
import type { Meeting, Transcript, Summary, TranscriptionEvent } from '@shared/types'
import { MeetingStatus } from '@shared/types'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { ProgressBar } from '../../../components/ui/ProgressBar'
import { Spinner } from '../../../components/ui/Spinner'
import { EmptyState } from '../../../components/ui/EmptyState'
import { TranscriptViewer } from '../../transcripts/components/TranscriptViewer'

interface MeetingDetailProps {
  meeting: Meeting
  onMeetingUpdated?: (meeting: Meeting) => void
}

type Tab = 'transcript' | 'summary' | 'actions'

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return 'Unknown duration'
  const m = Math.floor(seconds / 60)
  if (m >= 60) {
    const h = Math.floor(m / 60)
    const rem = m % 60
    return `${h}h ${rem}m`
  }
  return `${m} min`
}

export function MeetingDetail({
  meeting,
  onMeetingUpdated,
}: MeetingDetailProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<Tab>('transcript')
  const [transcript, setTranscript] = useState<Transcript | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loadingTranscript, setLoadingTranscript] = useState(false)
  const [loadingSummary, setLoadingSummary] = useState(false)
  // setSummary and setLoadingSummary are used when summarization IPC is wired up
  void setSummary
  void setLoadingSummary
  const [transcriptionProgress, setTranscriptionProgress] = useState(0)
  const [startingTranscription, setStartingTranscription] = useState(false)

  // Poll for progress when transcribing/summarizing
  useEffect(() => {
    if (
      meeting.status !== MeetingStatus.TRANSCRIBING &&
      meeting.status !== MeetingStatus.SUMMARIZING
    ) {
      return
    }

    const interval = setInterval(async () => {
      if (meeting.status === MeetingStatus.TRANSCRIBING) {
        const res = await window.api.transcription.status(meeting.id)
        if (res.success) {
          const event = res.data as TranscriptionEvent
          if (event.type === 'progress') {
            setTranscriptionProgress(event.percent)
          } else if (event.type === 'complete') {
            setTranscriptionProgress(100)
            onMeetingUpdated?.({ ...meeting, status: MeetingStatus.COMPLETED })
          } else if (event.type === 'error') {
            onMeetingUpdated?.({
              ...meeting,
              status: MeetingStatus.FAILED,
              errorMessage: event.message,
            })
          }
        }
      }
    }, 1500)

    return () => clearInterval(interval)
  }, [meeting.id, meeting.status, onMeetingUpdated])

  // Load transcript when completed
  useEffect(() => {
    if (meeting.status !== MeetingStatus.COMPLETED) return

    setLoadingTranscript(true)
    window.api.transcription
      .status(meeting.id)
      .then((res) => {
        if (res.success) {
          const event = res.data as TranscriptionEvent
          if (event.type === 'complete') {
            setTranscript(event.transcript)
          }
        }
      })
      .finally(() => setLoadingTranscript(false))
  }, [meeting.id, meeting.status])

  const handleStartTranscription = useCallback(async () => {
    setStartingTranscription(true)
    try {
      const res = await window.api.transcription.start(meeting.id)
      if (res.success) {
        onMeetingUpdated?.({ ...meeting, status: MeetingStatus.TRANSCRIBING })
      }
    } finally {
      setStartingTranscription(false)
    }
  }, [meeting, onMeetingUpdated])

  const isProcessing =
    meeting.status === MeetingStatus.TRANSCRIBING || meeting.status === MeetingStatus.SUMMARIZING

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'transcript', label: 'Transcript' },
    { id: 'summary', label: 'Summary' },
    { id: 'actions', label: 'Action Items' },
  ]

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-zinc-800 px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1 min-w-0">
            <h1 className="truncate text-lg font-semibold text-zinc-100">{meeting.title}</h1>
            <div className="flex items-center gap-3 text-xs text-zinc-500">
              <span>{formatDate(meeting.createdAt)}</span>
              {meeting.duration !== null && (
                <>
                  <span className="text-zinc-700">·</span>
                  <span>{formatDuration(meeting.duration)}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <Badge status={meeting.status} />
            {meeting.status === MeetingStatus.PENDING && (
              <Button
                variant="primary"
                size="sm"
                onClick={handleStartTranscription}
                loading={startingTranscription}
              >
                Start Transcription
              </Button>
            )}
          </div>
        </div>

        {/* Progress bar for active processing */}
        {isProcessing && (
          <div className="mt-4">
            <ProgressBar
              percent={meeting.status === MeetingStatus.TRANSCRIBING ? transcriptionProgress : 50}
              label={
                meeting.status === MeetingStatus.TRANSCRIBING
                  ? 'Transcribing audio…'
                  : 'Generating summary…'
              }
              color={meeting.status === MeetingStatus.SUMMARIZING ? 'purple' : 'blue'}
            />
          </div>
        )}

        {/* Error message */}
        {meeting.status === MeetingStatus.FAILED && meeting.errorMessage && (
          <div className="mt-3 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400 ring-1 ring-red-500/20">
            {meeting.errorMessage}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex-shrink-0 border-b border-zinc-800 px-6">
        <nav className="flex gap-0" aria-label="Meeting detail tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={[
                'relative px-4 py-3 text-xs font-medium transition-colors duration-150',
                'border-b-2 -mb-px',
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300',
              ].join(' ')}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'transcript' && (
          <TranscriptContent
            meeting={meeting}
            transcript={transcript}
            loading={loadingTranscript}
          />
        )}
        {activeTab === 'summary' && (
          <SummaryContent meeting={meeting} summary={summary} loading={loadingSummary} />
        )}
        {activeTab === 'actions' && <ActionItemsContent meeting={meeting} summary={summary} />}
      </div>
    </div>
  )
}

// Sub-components for each tab

interface TranscriptContentProps {
  meeting: Meeting
  transcript: Transcript | null
  loading: boolean
}

function TranscriptContent({
  meeting,
  transcript,
  loading,
}: TranscriptContentProps): React.JSX.Element {
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Loading transcript…" />
      </div>
    )
  }

  if (meeting.status === MeetingStatus.TRANSCRIBING) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={<Spinner size="lg" />}
          title="Transcribing audio"
          description="This may take a few minutes depending on the audio length."
        />
      </div>
    )
  }

  if (meeting.status === MeetingStatus.PENDING) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          title="Transcript not available"
          description="Start transcription to generate a transcript for this meeting."
        />
      </div>
    )
  }

  if (meeting.status === MeetingStatus.FAILED) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          title="Transcription failed"
          description={meeting.errorMessage ?? 'An error occurred during transcription.'}
        />
      </div>
    )
  }

  if (!transcript) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          title="No transcript available"
          description="The transcript could not be loaded."
        />
      </div>
    )
  }

  return <TranscriptViewer transcript={transcript} />
}

interface SummaryContentProps {
  meeting: Meeting
  summary: Summary | null
  loading: boolean
}

function SummaryContent({ meeting, summary, loading }: SummaryContentProps): React.JSX.Element {
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Loading summary…" />
      </div>
    )
  }

  if (meeting.status !== MeetingStatus.COMPLETED) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          title="Summary not available"
          description="Complete the transcription to generate a summary."
        />
      </div>
    )
  }

  if (!summary) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          title="No summary yet"
          description="Generate a summary from the transcript."
          action={{
            label: 'Generate Summary',
            onClick: () => window.api.summarization.start(meeting.id),
          }}
        />
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <div className="mx-auto max-w-2xl space-y-6">
        {/* Summary content */}
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Summary
          </h3>
          <p className="text-sm leading-relaxed text-zinc-300">{summary.content}</p>
        </section>

        {/* Key topics */}
        {summary.keyTopics.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Key Topics
            </h3>
            <div className="flex flex-wrap gap-2">
              {summary.keyTopics.map((topic, i) => (
                <span
                  key={i}
                  className="rounded-full bg-zinc-800 px-3 py-1 text-xs text-zinc-300 ring-1 ring-zinc-700"
                >
                  {topic}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Decisions */}
        {summary.decisions.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Decisions Made
            </h3>
            <ul className="space-y-1.5">
              {summary.decisions.map((decision, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-zinc-300">
                  <span className="mt-0.5 text-green-500">✓</span>
                  {decision}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}

interface ActionItemsContentProps {
  meeting: Meeting
  summary: Summary | null
}

function ActionItemsContent({ meeting, summary }: ActionItemsContentProps): React.JSX.Element {
  if (meeting.status !== MeetingStatus.COMPLETED) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          title="Action items not available"
          description="Complete the transcription and generate a summary first."
        />
      </div>
    )
  }

  if (!summary || summary.actionItems.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          title="No action items"
          description="No action items were found in this meeting."
        />
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <div className="mx-auto max-w-2xl">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Action Items ({summary.actionItems.length})
        </h3>
        <ul className="space-y-2">
          {summary.actionItems.map((item) => (
            <li
              key={item.id}
              className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900 p-3"
            >
              <div
                className={[
                  'mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-sm border',
                  item.completed ? 'border-green-600 bg-green-600/20' : 'border-zinc-600',
                ].join(' ')}
              >
                {item.completed && (
                  <svg
                    width="9"
                    height="7"
                    viewBox="0 0 9 7"
                    fill="none"
                    stroke="#4ade80"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="1 3.5 3.5 6 8 1" />
                  </svg>
                )}
              </div>
              <div className="flex flex-col gap-0.5">
                <p
                  className={[
                    'text-sm',
                    item.completed ? 'line-through text-zinc-600' : 'text-zinc-200',
                  ].join(' ')}
                >
                  {item.text}
                </p>
                {item.assignee && (
                  <p className="text-xs text-zinc-500">Assigned to: {item.assignee}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
