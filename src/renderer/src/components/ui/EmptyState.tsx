import React from 'react'
import { Button } from './Button'

interface EmptyStateAction {
  label: string
  onClick: () => void
}

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: EmptyStateAction
  className?: string
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className = '',
}: EmptyStateProps): React.JSX.Element {
  return (
    <div
      className={[
        'flex flex-col items-center justify-center gap-4 py-16 px-8 text-center',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {icon && (
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800 text-zinc-500">
          {icon}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-zinc-200">{title}</p>
        {description && <p className="text-xs text-zinc-500 max-w-xs">{description}</p>}
      </div>
      {action && (
        <Button variant="secondary" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  )
}
