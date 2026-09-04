#!/usr/bin/env node
/**
 * Gera PDF de um HTML local com o Chrome headless, por CDP.
 *
 * Mesma abordagem dos scripts de captura: nenhuma dependencia nova, nenhum
 * download de navegador, e o Chrome ja esta instalado aqui.
 *
 * Uso: node scripts/to-pdf.mjs <entrada.html> <saida.pdf>
 */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9444

const entrada = process.argv[2]
const saida = process.argv[3]
if (!entrada || !saida) {
  console.error('uso: node scripts/to-pdf.mjs <entrada.html> <saida.pdf>')
  process.exit(1)
}

const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    // O documento tem tema claro e escuro. O PDF sai no claro.
    '--force-color-profile=srgb',
    `--user-data-dir=${join(process.env.TEMP ?? '.', 'sync-pdf-profile')}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function aguardar() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/json/version`)
      if (r.ok) return
    } catch {}
    await sleep(250)
  }
  throw new Error('Chrome nao abriu a porta de debug')
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pendentes = new Map()
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data)
      const p = this.pendentes.get(msg.id)
      if (!p) return
      this.pendentes.delete(msg.id)
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
    })
  }

  send(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((res, rej) => this.pendentes.set(id, { resolve: res, reject: rej }))
  }
}

async function main() {
  await aguardar()

  const url = pathToFileURL(resolve(entrada)).href
  const alvo = await (
    await fetch(`http://localhost:${PORT}/json/new?${url}`, { method: 'PUT' })
  ).json()

  const ws = new WebSocket(alvo.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))

  const cdp = new Cdp(ws)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setEmulatedMedia', {
    media: 'print',
    features: [{ name: 'prefers-color-scheme', value: 'light' }],
  })

  await cdp.send('Page.navigate', { url })
  await sleep(2500)

  // As fontes vem do Google Fonts. Sem esperar, o PDF sai na fonte de fallback.
  await cdp.send('Runtime.evaluate', { expression: 'document.fonts.ready', awaitPromise: true })
  await sleep(800)

  const { data } = await cdp.send('Page.printToPDF', {
    printBackground: true,
    paperWidth: 8.27, // A4
    paperHeight: 11.69,
    marginTop: 0.6,
    marginBottom: 0.6,
    marginLeft: 0.6,
    marginRight: 0.6,
    preferCSSPageSize: false,
  })

  writeFileSync(saida, Buffer.from(data, 'base64'))
  console.log(`  ${saida}`)
  ws.close()
}

main()
  .then(() => {
    chrome.kill()
    process.exit(0)
  })
  .catch((e) => {
    console.error('falhou:', e.message)
    chrome.kill()
    process.exit(1)
  })
