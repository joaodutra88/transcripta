import { contextBridge, ipcRenderer } from 'electron'
import type { IpcResponse } from '../shared/types'
import type { Meeting, CreateMeetingDto, UpdateMeetingDto } from '../shared/types'
import type { TranscriptionOptions, TranscriptionEvent } from '../shared/types'
import type { SummarizeOptions } from '../shared/types'

export const api = {
  meetings: {
    list: (): Promise<IpcResponse<Meeting[]>> => ipcRenderer.invoke('meetings:list'),

    create: (dto: CreateMeetingDto): Promise<IpcResponse<Meeting>> =>
      ipcRenderer.invoke('meetings:create', dto),

    get: (id: string): Promise<IpcResponse<Meeting>> => ipcRenderer.invoke('meetings:get', id),

    delete: (id: string): Promise<IpcResponse<void>> => ipcRenderer.invoke('meetings:delete', id),

    update: (id: string, dto: UpdateMeetingDto): Promise<IpcResponse<Meeting>> =>
      ipcRenderer.invoke('meetings:update', id, dto),
  },

  transcription: {
    start: (meetingId: string, options?: TranscriptionOptions): Promise<IpcResponse<void>> =>
      ipcRenderer.invoke('transcription:start', meetingId, options),

    status: (meetingId: string): Promise<IpcResponse<TranscriptionEvent>> =>
      ipcRenderer.invoke('transcription:status', meetingId),

    cancel: (meetingId: string): Promise<IpcResponse<void>> =>
      ipcRenderer.invoke('transcription:cancel', meetingId),

    check: (): Promise<IpcResponse<{ available: boolean; version?: string }>> =>
      ipcRenderer.invoke('transcription:check'),
  },

  summarization: {
    start: (meetingId: string, options?: SummarizeOptions): Promise<IpcResponse<void>> =>
      ipcRenderer.invoke('summarization:start', meetingId, options),

    status: (meetingId: string): Promise<IpcResponse<{ status: string; progress?: number }>> =>
      ipcRenderer.invoke('summarization:status', meetingId),
  },

  files: {
    selectAudio: (): Promise<IpcResponse<string | null>> => ipcRenderer.invoke('files:selectAudio'),
  },

  setup: {
    checkSystem: (): Promise<
      IpcResponse<{
        pythonInstalled: boolean
        pythonVersion: string | null
        fasterWhisperInstalled: boolean
        gpuAvailable: boolean
        gpuName: string | null
        anthropicKeySet: boolean
      }>
    > => ipcRenderer.invoke('setup:check-system'),

    saveApiKey: (key: string): Promise<IpcResponse<void>> =>
      ipcRenderer.invoke('setup:save-api-key', key),

    setFirstRunDone: (): Promise<IpcResponse<void>> =>
      ipcRenderer.invoke('setup:set-first-run-done'),

    isFirstRun: (): Promise<IpcResponse<boolean>> => ipcRenderer.invoke('setup:is-first-run'),
  },

  updater: {
    check: (): Promise<IpcResponse<{ available: boolean; version?: string }>> =>
      ipcRenderer.invoke('updater:check'),

    download: (): Promise<IpcResponse<void>> => ipcRenderer.invoke('updater:download'),

    install: (): Promise<IpcResponse<void>> => ipcRenderer.invoke('updater:install'),

    onUpdateAvailable: (callback: (info: { version: string }) => void) => {
      ipcRenderer.on('updater:update-available', (_event, info) => callback(info))
      return () => {
        ipcRenderer.removeAllListeners('updater:update-available')
      }
    },

    onDownloadProgress: (callback: (progress: { percent: number }) => void) => {
      ipcRenderer.on('updater:download-progress', (_event, progress) => callback(progress))
      return () => {
        ipcRenderer.removeAllListeners('updater:download-progress')
      }
    },

    onUpdateDownloaded: (callback: (info: { version: string }) => void) => {
      ipcRenderer.on('updater:update-downloaded', (_event, info) => callback(info))
      return () => {
        ipcRenderer.removeAllListeners('updater:update-downloaded')
      }
    },
  },

  app: {
    getVersion: (): Promise<IpcResponse<string>> => ipcRenderer.invoke('app:getVersion'),
  },
} as const

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
