import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/schibsted-grotesk'
import '@fontsource-variable/jetbrains-mono'
import '../index.css'
import { EmbedApp } from './EmbedApp'

/* The read-only diagram served at /embed. A separate entry, so pages that
   embed a diagram never download the editor. */

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EmbedApp />
  </StrictMode>,
)
