import React from 'react'

interface ProgressBarProps {
  percent: number
  label?: string
  showLabel?: boolean
  className?: string
  color?: 'blue' | 'purple' | 'green'
}

const colorClasses = {
  blue: 'bg-blue-500',
  purple: 'bg-purple-500',
  green: 'bg-green-500',
}

export function ProgressBar({
  percent,
  label,
  showLabel = true,
  className = '',
  color = 'blue',
}: ProgressBarProps): React.JSX.Element {
  const clamped = Math.min(100, Math.max(0, percent))

  return (
    <div className={['flex flex-col gap-1.5', className].filter(Boolean).join(' ')}>
      {(showLabel || label) && (
        <div className="flex items-center justify-between">
          {label && <span className="text-xs text-zinc-400">{label}</span>}
          {showLabel && (
            <span className="text-xs tabular-nums text-zinc-400 ml-auto">
              {clamped.toFixed(0)}%
            </span>
          )}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800"
      >
        <div
          className={[
            'h-full rounded-full transition-all duration-300 ease-out',
            colorClasses[color],
            clamped < 100 && 'animate-pulse',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  )
}
