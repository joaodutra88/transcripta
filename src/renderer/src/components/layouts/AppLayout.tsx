import React from 'react'
import { TitleBar } from './TitleBar'

interface AppLayoutProps {
  sidebar: React.ReactNode
  children: React.ReactNode
}

export function AppLayout({ sidebar, children }: AppLayoutProps): React.JSX.Element {
  return (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-100">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside
          className="flex w-[250px] flex-shrink-0 flex-col border-r border-zinc-800/60 bg-zinc-950"
          style={{ minWidth: 250 }}
        >
          {sidebar}
        </aside>

        {/* Main content */}
        <main className="flex flex-1 flex-col overflow-hidden bg-zinc-950">{children}</main>
      </div>
    </div>
  )
}
