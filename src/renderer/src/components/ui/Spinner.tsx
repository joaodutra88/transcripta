import React from 'react'

type SpinnerSize = 'sm' | 'md' | 'lg'

interface SpinnerProps {
  size?: SpinnerSize
  className?: string
  label?: string
}

const sizeClasses: Record<SpinnerSize, string> = {
  sm: 'h-4 w-4 border-2',
  md: 'h-6 w-6 border-2',
  lg: 'h-10 w-10 border-[3px]',
}

export function Spinner({ size = 'md', className = '', label }: SpinnerProps): React.JSX.Element {
  return (
    <div
      role="status"
      aria-label={label ?? 'Loading'}
      className={['inline-flex flex-col items-center gap-2', className].filter(Boolean).join(' ')}
    >
      <div
        className={[
          'animate-spin rounded-full border-zinc-700 border-t-blue-500',
          sizeClasses[size],
        ].join(' ')}
      />
      {label && <span className="text-xs text-zinc-500">{label}</span>}
    </div>
  )
}
