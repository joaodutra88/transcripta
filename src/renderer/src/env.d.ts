/// <reference types="vite/client" />

import type { Api } from '../../preload'

declare global {
  interface Window {
    api: Api
  }
}

interface ImportMetaEnv {
  readonly VITE_APP_TITLE: string
  readonly VITE_APP_VERSION: string
  // Add further env vars here as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
