import Store from 'electron-store'

interface AppStoreSchema {
  setupComplete: boolean
  anthropicApiKey?: string
}

const store = new Store<AppStoreSchema>({
  defaults: {
    setupComplete: false,
  },
})

export function isSetupComplete(): boolean {
  return store.get('setupComplete')
}

export function setSetupComplete(): void {
  store.set('setupComplete', true)
}

export function getStoredApiKey(): string | undefined {
  return store.get('anthropicApiKey')
}

export function setStoredApiKey(key: string): void {
  store.set('anthropicApiKey', key)
}
