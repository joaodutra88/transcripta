import React from 'react'

interface TitleBarProps {
  title?: string
}

export function TitleBar({ title = 'Transcripta' }: TitleBarProps): React.JSX.Element {
  return (
    <div
      className="flex h-9 flex-shrink-0 items-center justify-between bg-zinc-950 border-b border-zinc-800/50 select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Left: app title area */}
      <div className="flex items-center px-4 gap-2">
        <div className="h-2.5 w-2.5 rounded-full bg-blue-500/80" />
        <span className="text-xs font-medium text-zinc-500">{title}</span>
      </div>

      {/* Right: window controls (no-drag zone) */}
      <div
        className="flex items-center"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <TitleBarButton
          onClick={() => window.api.app.getVersion()}
          label="Minimize"
          hoverColor="hover:bg-zinc-700"
        >
          <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
            <rect width="10" height="1" />
          </svg>
        </TitleBarButton>

        <TitleBarButton label="Maximize" hoverColor="hover:bg-zinc-700">
          <svg
            width="9"
            height="9"
            viewBox="0 0 9 9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
          >
            <rect x="0.5" y="0.5" width="8" height="8" />
          </svg>
        </TitleBarButton>

        <TitleBarButton label="Close" hoverColor="hover:bg-red-600 hover:text-white">
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
          >
            <line x1="1" y1="1" x2="9" y2="9" />
            <line x1="9" y1="1" x2="1" y2="9" />
          </svg>
        </TitleBarButton>
      </div>
    </div>
  )
}

interface TitleBarButtonProps {
  onClick?: () => void
  label: string
  hoverColor: string
  children: React.ReactNode
}

function TitleBarButton({
  onClick,
  label,
  hoverColor,
  children,
}: TitleBarButtonProps): React.JSX.Element {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className={[
        'flex h-9 w-11 items-center justify-center text-zinc-500 transition-colors duration-100',
        hoverColor,
      ].join(' ')}
    >
      {children}
    </button>
  )
}
