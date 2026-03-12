import React from 'react'

// Deterministic color from speaker name
const SPEAKER_COLORS = [
  { bg: 'bg-blue-500/20', text: 'text-blue-400', ring: 'ring-blue-500/30' },
  { bg: 'bg-emerald-500/20', text: 'text-emerald-400', ring: 'ring-emerald-500/30' },
  { bg: 'bg-violet-500/20', text: 'text-violet-400', ring: 'ring-violet-500/30' },
  { bg: 'bg-amber-500/20', text: 'text-amber-400', ring: 'ring-amber-500/30' },
  { bg: 'bg-rose-500/20', text: 'text-rose-400', ring: 'ring-rose-500/30' },
  { bg: 'bg-cyan-500/20', text: 'text-cyan-400', ring: 'ring-cyan-500/30' },
  { bg: 'bg-fuchsia-500/20', text: 'text-fuchsia-400', ring: 'ring-fuchsia-500/30' },
  { bg: 'bg-orange-500/20', text: 'text-orange-400', ring: 'ring-orange-500/30' },
]

function speakerColorIndex(speaker: string): number {
  let hash = 0
  for (let i = 0; i < speaker.length; i++) {
    hash = (hash * 31 + speaker.charCodeAt(i)) & 0xffff
  }
  return hash % SPEAKER_COLORS.length
}

interface SpeakerLabelProps {
  speaker: string
  className?: string
}

export function SpeakerLabel({ speaker, className = '' }: SpeakerLabelProps): React.JSX.Element {
  const colorIdx = speakerColorIndex(speaker)
  const color = SPEAKER_COLORS[colorIdx]

  return (
    <span
      className={[
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset',
        color.bg,
        color.text,
        color.ring,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {speaker}
    </span>
  )
}

export { SPEAKER_COLORS, speakerColorIndex }
