import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@sync/chat-ui/src/chat-ui.css'
import { App } from './App.js'
import './styles.css'

const raiz = document.getElementById('root')
if (!raiz) throw new Error('elemento #root não encontrado')

createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
