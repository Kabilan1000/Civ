import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './ui/App.tsx'
import './ui/styles.css'

// The lazily loaded renderer chunk lists the app stylesheet as a preload
// dependency. That stylesheet is already on the page (or inlined by a host
// that serves only scripts), so a failure to re-fetch it must not stop the
// map from loading. Any other preload failure still surfaces normally.
window.addEventListener('vite:preloadError', (event) => {
  const message = String((event as Event & { payload?: unknown }).payload ?? '')
  if (message.includes('Unable to preload CSS')) event.preventDefault()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
