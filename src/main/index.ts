import { app, shell, BrowserWindow, desktopCapturer, session } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpc } from './ipc'
import { getLogPath, log } from './logger'
import { BUILD_COMMIT, BUILD_TIME } from './buildInfo'
import { release } from 'node:os'
import { captureExclusionMode, describeCaptureMode } from './windows/platformCaps'
import { discardActiveRecording, getSelectedSourceId, setSelectedSourceId } from './recording'
import { closeAnnotationOverlay } from './windows/overlay'
import { setShortcutTarget, unregisterShortcuts } from './shortcuts/shortcutManager'

app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    minWidth: 760,
    minHeight: 560,
    title: 'Premium Recording',
    show: false,
    autoHideMenuBar: true,
    ...(process.platform !== 'darwin' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  })

  setShortcutTarget(mainWindow.webContents)
  mainWindow.on('ready-to-show', () => mainWindow.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const protocol = new URL(url).protocol
      if (protocol === 'https:' || protocol === 'http:') void shell.openExternal(url)
    } catch {
      // Invalid and non-web URLs stay blocked.
    }
    return { action: 'deny' }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  // Another instance owns the save folder and any active .part file.
  app.quit()
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return
  log(
    'info',
    `Startup v${app.getVersion()} (${BUILD_COMMIT}) built ${BUILD_TIME || 'n/a'} | electron ${process.versions.electron} chrome ${process.versions.chrome} | ${process.platform} ${process.getSystemVersion()} | log ${getLogPath()}`
  )
  log(
    'info',
    `Capture: ${describeCaptureMode(process.platform, release(), captureExclusionMode(process.platform, release()))}`
  )
  try {
    log('info', `GPU feature status: ${JSON.stringify(app.getGPUFeatureStatus())}`)
  } catch (error) {
    log('warn', 'Could not read GPU feature status', error)
  }
  registerIpc()
  const isOwnOrigin = (origin: string): boolean => {
    if (origin.startsWith('file://')) return true
    const rendererUrl = process.env.ELECTRON_RENDERER_URL
    if (!is.dev || !rendererUrl) return false
    try {
      return new URL(origin).origin === new URL(rendererUrl).origin
    } catch {
      return false
    }
  }
  const allowedPermissions = new Set<string>(['media', 'audioCapture', 'display-capture'])
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(allowedPermissions.has(permission) && isOwnOrigin(details.requestingUrl))
  })
  session.defaultSession.setPermissionCheckHandler(
    (_contents, permission, requestingOrigin) =>
      allowedPermissions.has(permission) && isOwnOrigin(requestingOrigin)
  )
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sourceId = getSelectedSourceId()
        if (!sourceId) {
          callback({})
          return
        }
        const sources = await desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 1, height: 1 },
          fetchWindowIcons: false
        })
        const source = sources.find((item) => item.id === sourceId)
        setSelectedSourceId('')
        if (!source) log('error', `Capture source ${sourceId} is no longer available`)
        callback(source ? { video: source } : {})
      } catch (error) {
        setSelectedSourceId('')
        log('error', 'Could not resolve the selected capture source', error)
        callback({})
      }
    },
    { useSystemPicker: false }
  )
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

let finishingQuit = false
app.on('before-quit', (event) => {
  if (finishingQuit) return
  event.preventDefault()
  unregisterShortcuts()
  closeAnnotationOverlay()
  void discardActiveRecording().finally(() => {
    finishingQuit = true
    app.quit()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
