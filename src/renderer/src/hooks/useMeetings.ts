import { useState, useEffect, useCallback } from 'react'
import type { Meeting } from '@shared/types'
import { ipcClient } from '../services/ipc-client'

interface UseMeetingsReturn {
  meetings: Meeting[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  addMeeting: (meeting: Meeting) => void
  updateMeeting: (updated: Meeting) => void
  removeMeeting: (id: string) => void
}

export function useMeetings(): UseMeetingsReturn {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await ipcClient.meetings.list()
      // Sort newest first
      data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      setMeetings(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load meetings.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const addMeeting = useCallback((meeting: Meeting) => {
    setMeetings((prev) => [meeting, ...prev])
  }, [])

  const updateMeeting = useCallback((updated: Meeting) => {
    setMeetings((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
  }, [])

  const removeMeeting = useCallback((id: string) => {
    setMeetings((prev) => prev.filter((m) => m.id !== id))
  }, [])

  return { meetings, loading, error, refresh, addMeeting, updateMeeting, removeMeeting }
}
