#!/usr/bin/env node
/**
 * Drives the running site with Chrome DevTools Protocol and captures screenshots.
 *
 * Uses raw CDP over Node's built-in WebSocket instead of Playwright: no extra
 * dependency, no browser download, and Chrome is already installed here.
 *
 * On `cdp.eval`: this is CDP's `Runtime.evaluate`, the same primitive behind
 * Playwright's `page.evaluate`. It is not JavaScript `eval()`. Every expression
 * it runs is a literal written in this file and evaluated inside a throwaway
 * headless browser tab. No external or user-supplied input reaches it. This is a
 * local development tool and never ships to any server.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9333
const SITE = 'http://localhost:5173'
const OUT = process.argv[2] ?? 'screenshots'
const WIDTH = Number(process.env.SHOT_WIDTH ?? 1440)
const HEIGHT = Number(process.env.SHOT_HEIGHT ?? 900)

mkdirSync(OUT, { recursive: true })

const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=' + join(process.env.TEMP ?? '.', 'sync-shot-profile'),
    `--window-size=${WIDTH},${HEIGHT}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function aguardarDevtools() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/json/version`)
      if (r.ok) return
    } catch {}
    await sleep(250)
  }
  throw new Error('Chrome não abriu a porta de debug')
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
    return new Promise((resolve, reject) => this.pendentes.set(id, { resolve, reject }))
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (r.exceptionDetails) {
      const d = r.exceptionDetails
      throw new Error(d.exception?.description ?? d.exception?.value ?? d.text)
    }
    return r.result.value
  }

  async shot(nome) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' })
    const caminho = join(OUT, `${nome}.png`)
    writeFileSync(caminho, Buffer.from(data, 'base64'))
    console.log(`  ${caminho}`)
  }
}

/**
 * React ignora `input.value = x`: ele guarda o valor anterior no nó e compara.
 * Escrever pelo setter nativo do prototype e disparar o evento faz o React ver.
 */
const PREENCHER = (seletor, valor) => `
(() => {
  const el = document.querySelector(${JSON.stringify(seletor)})
  if (!el) throw new Error('não achei ${seletor}')
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement
  Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, ${JSON.stringify(valor)})
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`

const CLICAR_TEXTO = (texto) => `
(() => {
  const alvo = [...document.querySelectorAll('button')]
    .find((b) => b.textContent.trim().startsWith(${JSON.stringify(texto)}))
  if (!alvo) throw new Error('não achei o botão ${texto}')
  alvo.click()
  return true
})()`

async function main() {
  await aguardarDevtools()

  const alvo = await (await fetch(`http://localhost:${PORT}/json/new?${SITE}`, { method: 'PUT' })).json()
  const ws = new WebSocket(alvo.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))

  const cdp = new Cdp(ws)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 2,
    mobile: WIDTH < 700,
  })

  // O perfil do Chrome persiste entre execucoes, entao a sessao guardada no
  // localStorage sobreviveria e a tela de login nunca apareceria.
  await cdp.send('Page.navigate', { url: SITE })
  await sleep(1200)
  await cdp.eval('localStorage.clear(); true')
  await cdp.send('Page.reload')
  await sleep(2500)

  console.log('capturando:')
  await cdp.shot('1-login')

  await cdp.eval(PREENCHER('input[type=email]', 'maria.silva@exemplo.com'))
  await cdp.eval(PREENCHER('input[type=password]', 'MinhaSenha123'))
  await sleep(200)
  await cdp.shot('2-login-preenchido')

  await cdp.eval(CLICAR_TEXTO('Entrar'))
  await sleep(1800)
  await cdp.shot('3-chat-vazio')

  await cdp.eval(PREENCHER('textarea', 'minha internet está caindo toda hora'))
  await sleep(200)
  await cdp.eval(CLICAR_TEXTO('↑'))
  await sleep(2200)
  await cdp.shot('4-chat-com-contexto')

  await cdp.eval(PREENCHER('textarea', 'quero a segunda via da fatura'))
  await sleep(200)
  await cdp.eval(CLICAR_TEXTO('↑'))
  await sleep(2200)
  await cdp.shot('5-chat-fatura')

  await cdp.eval(PREENCHER('textarea', 'quero cancelar meu plano'))
  await sleep(200)
  await cdp.eval(CLICAR_TEXTO('↑'))
  await sleep(2200)
  await cdp.shot('6-chat-escalado')

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
