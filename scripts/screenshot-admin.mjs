#!/usr/bin/env node
/**
 * Captura o console da equipe. Mesma abordagem do screenshot.mjs: CDP cru sobre o
 * WebSocket nativo do Node, sem Playwright e sem download de navegador.
 *
 * Sobre `cdp.eval`: e o `Runtime.evaluate` do CDP, o mesmo primitivo por tras do
 * `page.evaluate` do Playwright. Nao e o `eval()` do JavaScript. Toda expressao
 * executada e um literal escrito neste arquivo e roda numa aba headless
 * descartavel. Nenhuma entrada externa chega ali. E ferramenta local de
 * desenvolvimento e nunca vai para servidor nenhum.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9334
const SITE = 'http://localhost:5174'
const OUT = process.argv[2] ?? 'screenshots/admin'
const WIDTH = Number(process.env.SHOT_WIDTH ?? 1600)
const HEIGHT = Number(process.env.SHOT_HEIGHT ?? 950)

mkdirSync(OUT, { recursive: true })

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${join(process.env.TEMP ?? '.', 'sync-admin-shot')}`,
  `--window-size=${WIDTH},${HEIGHT}`,
  'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function aguardar() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/json/version`)).ok) return
    } catch {}
    await sleep(250)
  }
  throw new Error('Chrome nao abriu a porta de debug')
}

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pend = new Map()
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data); const p = this.pend.get(m.id)
      if (!p) return
      this.pend.delete(m.id)
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result)
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((res, rej) => this.pend.set(id, { resolve: res, reject: rej }))
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
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

const PREENCHER = (sel, val) => `
(() => {
  const el = document.querySelector(${JSON.stringify(sel)})
  if (!el) throw new Error('nao achei ${sel}')
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement
  Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, ${JSON.stringify(val)})
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`

const CLICAR = (texto, seletor = 'button') => `
(() => {
  const alvo = [...document.querySelectorAll(${JSON.stringify(seletor)})]
    .find((b) => b.textContent.trim().startsWith(${JSON.stringify(texto)}))
  if (!alvo) throw new Error('nao achei ' + ${JSON.stringify(texto)})
  alvo.click()
  return true
})()`

const CLICAR_PRIMEIRO_CARD = `
(() => {
  const card = document.querySelector('.card')
  if (!card) throw new Error('quadro vazio')
  card.click()
  return card.textContent.trim().slice(0, 40)
})()`

async function main() {
  await aguardar()
  const alvo = await (await fetch(`http://localhost:${PORT}/json/new?${SITE}`, { method: 'PUT' })).json()
  const ws = new WebSocket(alvo.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))

  const cdp = new Cdp(ws)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: WIDTH < 700,
  })

  await cdp.send('Page.navigate', { url: SITE })
  await sleep(1200)
  await cdp.eval('localStorage.clear(); true')
  await cdp.send('Page.reload')
  await sleep(2500)

  console.log('capturando:')
  await cdp.shot('1-login')

  await cdp.eval(PREENCHER('input[type=email]', 'bruno@claro.com.br'))
  await cdp.eval(PREENCHER('input[type=password]', 'Atendente123'))
  await cdp.eval(CLICAR('Entrar'))
  await sleep(2500)
  await cdp.shot('2-quadro')

  console.log('  card selecionado:', await cdp.eval(CLICAR_PRIMEIRO_CARD))
  await sleep(1600)
  await cdp.shot('3-detalhe')

  await cdp.eval(CLICAR('Assumir atendimento'))
  await sleep(1800)
  await cdp.shot('4-assumido')

  await cdp.eval(PREENCHER('textarea', 'Oi Maria. Vi que voce quer cancelar o plano movel final 9876. Antes disso, posso ver uma oferta melhor pra voce?'))
  await sleep(200)
  await cdp.eval(CLICAR('Enviar'))
  await sleep(2000)
  await cdp.shot('5-respondido')

  await cdp.eval(CLICAR('Histórico', '.tab'))
  await sleep(1500)
  await cdp.shot('6-historico')

  ws.close()
}

main().then(() => { chrome.kill(); process.exit(0) })
  .catch((e) => { console.error('falhou:', e.message); chrome.kill(); process.exit(1) })
