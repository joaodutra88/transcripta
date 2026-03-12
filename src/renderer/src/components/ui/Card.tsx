import React from 'react'

interface CardProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
  hoverable?: boolean
}

export function Card({
  children,
  className = '',
  onClick,
  hoverable = false,
}: CardProps): React.JSX.Element {
  return (
    <div
      onClick={onClick}
      className={[
        'rounded-lg border border-zinc-800 bg-zinc-900 p-4',
        hoverable &&
          'cursor-pointer transition-colors duration-150 hover:bg-zinc-800/80 hover:border-zinc-700',
        onClick && !hoverable && 'cursor-pointer',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  )
}

interface CardHeaderProps {
  children: React.ReactNode
  className?: string
}

export function CardHeader({ children, className = '' }: CardHeaderProps): React.JSX.Element {
  return <div className={['mb-3', className].filter(Boolean).join(' ')}>{children}</div>
}

interface CardBodyProps {
  children: React.ReactNode
  className?: string
}

export function CardBody({ children, className = '' }: CardBodyProps): React.JSX.Element {
  return <div className={className}>{children}</div>
}
