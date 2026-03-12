import React, { useCallback, useRef } from 'react'
import type { Transcript, TranscriptSegment } from '@shared/types'
import { SpeakerLabel, SPEAKER_COLORS, speakerColorIndex } from './SpeakerLabel'

interface TranscriptViewerProps {
  transcript: Transcript
  onSegmentClick?: (segment: TranscriptSegment) => void
  activeSegmentStart?: number
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m}:${s.toString().padStart(2, '0')}`
}

interface SegmentRowProps {
  segment: TranscriptSegment
  isActive: boolean
  onClick: (segment: TranscriptSegment) => void
}

function SegmentRow({ segment, isActive, onClick }: SegmentRowProps): React.JSX.Element {
  const speaker = segment.speaker ?? 'Unknown'
  const colorIdx = speakerColorIndex(speaker)
  const color = SPEAKER_COLORS[colorIdx]

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(segment)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick(segment)
      }}
      className={[
        'group flex gap-4 rounded-lg px-4 py-3 cursor-pointer transition-colors duration-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
        isActive ? 'bg-zinc-800 ring-1 ring-zinc-700' : 'hover:bg-zinc-900',
      ].join(' ')}
    >
      {/* Left: speaker + timestamp */}
      <div className="flex w-28 flex-shrink-0 flex-col items-start gap-1 pt-0.5">
        {segment.speaker ? (
          <SpeakerLabel speaker={speaker} />
        ) : (
          <span className="text-[10px] font-medium text-zinc-600">Unknown</span>
        )}
        <button
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation()
            onClick(segment)
          }}
          className={[
            'font-mono text-[10px] tabular-nums',
            color.text,
            'opacity-60 group-hover:opacity-100 transition-opacity',
          ].join(' ')}
        >
          {formatTimestamp(segment.start)}
        </button>
      </div>

      {/* Right: text */}
      <p
        className={[
          'flex-1 text-sm leading-relaxed',
          isActive ? 'text-zinc-100' : 'text-zinc-300',
        ].join(' ')}
      >
        {segment.text}
      </p>
    </div>
  )
}

export function TranscriptViewer({
  transcript,
  onSegmentClick,
  activeSegmentStart,
}: TranscriptViewerProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)

  const handleSegmentClick = useCallback(
    (segment: TranscriptSegment) => {
      onSegmentClick?.(segment)
    },
    [onSegmentClick],
  )

  if (!transcript.segments || transcript.segments.length === 0) {
    // Fallback: render raw content
    return (
      <div className="h-full overflow-y-auto px-4 py-5">
        <div className="mx-auto max-w-3xl">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
            {transcript.content}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-2 py-4">
        {/* Stats bar */}
        <div className="mb-4 flex items-center gap-3 px-4">
          <span className="text-xs text-zinc-600">{transcript.segments.length} segments</span>
          <span className="text-xs text-zinc-800">·</span>
          <span className="text-xs text-zinc-600">
            {transcript.content.split(/\s+/).length} words
          </span>
        </div>

        {/* Segments */}
        <div className="flex flex-col gap-0.5">
          {transcript.segments.map((segment, index) => (
            <SegmentRow
              key={`${segment.start}-${index}`}
              segment={segment}
              isActive={activeSegmentStart === segment.start}
              onClick={handleSegmentClick}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
