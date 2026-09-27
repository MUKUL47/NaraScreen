import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './index.css'
import App from './App.tsx'
import { preloadUiState } from './ui/persist'

// Section open/closed states load once, early, so collapsible panels don't jump after mount.
void preloadUiState()

// Dev-only component gallery at `?gallery`. In production builds `import.meta.env.DEV` is false,
// so the dynamic import is dropped and the gallery never ships.
const showGallery = import.meta.env.DEV && new URLSearchParams(window.location.search).has('gallery')
const UiGallery = import.meta.env.DEV ? lazy(() => import('./dev/UiGallery.tsx')) : null

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {showGallery && UiGallery ? (
      <Suspense fallback={null}>
        <UiGallery />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
