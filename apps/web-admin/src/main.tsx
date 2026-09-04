import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import '@sync/chat-ui/src/app-switcher.css'
import './console.css'

const raiz = document.getElementById('root')
if (!raiz) throw new Error('elemento #root não encontrado')

createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
