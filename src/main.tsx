import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

if (import.meta.env.DEV) {
  window.addEventListener('error', (e) => {
    document.title = `BR-ERR: ${e.message}`.slice(0, 120)
  })
  window.addEventListener('unhandledrejection', (e) => {
    document.title = `BR-REJ: ${String(e.reason)}`.slice(0, 120)
  })
}

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root not found')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
