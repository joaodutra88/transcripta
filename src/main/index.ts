import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import log from 'electron-log'
import { registerHandlers } from './ipc/handlers'
import { registerSetupHandlers } from './ipc/setup-handlers'
import { registerUpdaterHandlers } from './ipc/updater-handlers'
import { initAutoUpdater } from './services/auto-updater'
import { getStoredApiKey } from './services/app-store'

// Configure electron-log
log.transports.file.level = 'info'
log.transports.console.level = is.dev ? 'debug' : 'info'
log.transports.file.resolvePathFn = () => join(app.getPath('userData'), 'logs', 'main.log')

log.info('Transcripta starting', { version: app.getVersion() })

let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    // Frameless window — custom title bar rendered in renderer
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0f0f0f',
    autoHideMenuBar: true,
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.on('ready-to-show', () => {
    win.show()
    if (is.dev) {
      win.webContents.openDevTools({ mode: 'detach' })
    }
    log.info('Main window ready to show')
  })

  // Open external links in the OS browser, not inside Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Load the renderer
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

// Quit when all windows are closed on platforms other than macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    log.info('All windows closed — quitting')
    app.quit()
  }
})

app.whenReady().then(() => {
  // Restore persisted API key from electron-store
  const storedKey = getStoredApiKey()
  if (storedKey) {
    process.env['ANTHROPIC_API_KEY'] = storedKey
    log.info('Restored Anthropic API key from store')
  }

  // Set app user model ID for Windows taskbar / notifications
  electronApp.setAppUserModelId('com.transcripta.app')

  // Default open/close DevTools shortcut (F12) and reload (Ctrl+R)
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  mainWindow = createWindow()
  registerHandlers(mainWindow)
  registerSetupHandlers()
  registerUpdaterHandlers()

  // Auto-updater (only in production)
  if (!is.dev) {
    initAutoUpdater(mainWindow)
  }

  app.on('activate', () => {
    // macOS: re-create window when dock icon is clicked and no windows are open
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
      registerHandlers(mainWindow!)
    }
  })

  log.info('App ready, window created and IPC handlers registered')
})

app.on('before-quit', () => {
  log.info('App before-quit')
})
