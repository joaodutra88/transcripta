import { useState, useEffect, useCallback } from 'react'
import type { Meeting } from '@shared/types'
import { ipcClient } from '../services/ipc-client'

interface UseMeetingReturn {
  meeting: Meeting | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function useMeeting(id: string | null): UseMeetingReturn {
  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!id) {
      setMeeting(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const data = await ipcClient.meetings.get(id)
      setMeeting(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load meeting.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { meeting, loading, error, refresh }
}
