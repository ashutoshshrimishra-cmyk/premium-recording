import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import OverlayApp from './overlay/OverlayApp'

const isOverlayView = new URLSearchParams(location.search).get('view') === 'overlay'
document.documentElement.classList.toggle('overlay-view', isOverlayView)

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isOverlayView ? <OverlayApp /> : <App />}</StrictMode>
)
