import React, { useState, useEffect, useCallback } from 'react'
import './styles/globals.css'
import { SetupWizard } from './features/setup/SetupWizard'
import { AppLayout } from './components/layouts/AppLayout'
import { Sidebar } from './components/layouts/Sidebar'
import { MeetingList } from './features/meetings/components/MeetingList'
import { MeetingDetail } from './features/meetings/components/MeetingDetail'
import { CreateMeetingDialog } from './features/meetings/components/CreateMeetingDialog'
import { EmptyState } from './components/ui/EmptyState'
import { useMeetings } from './hooks/useMeetings'
import type { Meeting } from '@shared/types'

const InboxIcon = (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
    <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </svg>
)

export default function App(): React.JSX.Element {
  const { meetings, loading, error, addMeeting, updateMeeting } = useMeetings()
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [showSetup, setShowSetup] = useState<boolean | null>(null)

  useEffect(() => {
    window.api.setup.isFirstRun().then((res) => {
      setShowSetup(res.ok ? res.data : false)
    })
  }, [])

  const selectedMeeting = meetings.find((m) => m.id === selectedMeetingId) ?? null

  const handleSelectMeeting = useCallback((id: string) => {
    setSelectedMeetingId(id)
  }, [])

  const handleNewMeeting = useCallback(() => {
    setDialogOpen(true)
  }, [])

  const handleMeetingCreated = useCallback(
    (meeting: Meeting) => {
      addMeeting(meeting)
      setSelectedMeetingId(meeting.id)
    },
    [addMeeting],
  )

  const handleMeetingUpdated = useCallback(
    (meeting: Meeting) => {
      updateMeeting(meeting)
    },
    [updateMeeting],
  )

  // Show setup wizard on first run
  if (showSetup === null) return null // loading
  if (showSetup) return <SetupWizard onComplete={() => setShowSetup(false)} />

  return (
    <>
      <AppLayout
        sidebar={
          <Sidebar
            meetings={meetings}
            selectedMeetingId={selectedMeetingId}
            onSelectMeeting={handleSelectMeeting}
            onNewMeeting={handleNewMeeting}
          >
            <MeetingList
              meetings={meetings}
              selectedMeetingId={selectedMeetingId}
              onSelectMeeting={handleSelectMeeting}
              onNewMeeting={handleNewMeeting}
              loading={loading}
              error={error}
            />
          </Sidebar>
        }
      >
        {selectedMeeting ? (
          <MeetingDetail meeting={selectedMeeting} onMeetingUpdated={handleMeetingUpdated} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={InboxIcon}
              title="Select a meeting"
              description="Choose a meeting from the sidebar or create a new one to get started."
              action={{ label: 'New Meeting', onClick: handleNewMeeting }}
            />
          </div>
        )}
      </AppLayout>

      <CreateMeetingDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreate={handleMeetingCreated}
      />
    </>
  )
}
