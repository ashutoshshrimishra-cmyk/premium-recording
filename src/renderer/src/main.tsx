import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import OverlayApp from './overlay/OverlayApp'
import ToolbarApp from './toolbar/ToolbarApp'

const view = new URLSearchParams(location.search).get('view')
document.documentElement.classList.toggle('overlay-view', view === 'overlay')
document.documentElement.classList.toggle('toolbar-view', view === 'toolbar')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {view === 'overlay' ? <OverlayApp /> : view === 'toolbar' ? <ToolbarApp /> : <App />}
  </StrictMode>
)
