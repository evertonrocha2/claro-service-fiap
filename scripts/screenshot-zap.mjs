#!/usr/bin/env node
/**
 * Captura o WhatsApp simulado percorrendo o Cenario 1: conversa no site, gera o
 * link de continuidade e abre a tela do WhatsApp com a mensagem pronta.
 *
 * Sobre `cdp.eval`: e o `Runtime.evaluate` do CDP, o mesmo primitivo por tras do
 * `page.evaluate` do Playwright. Nao e o `eval()` do JavaScript. Toda expressao
 * e um literal deste arquivo, rodando numa aba headless descartavel.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const AGENTE_EMAIL = process.env.SHOT_AGENTE ?? 'bruno@claro.com.br'
const GESTOR_EMAIL = process.env.SHOT_GESTOR ?? 'leticia@claro.com.br'
const AGENTE_SENHA = process.env.SHOT_AGENTE_SENHA ?? 'Atendente123'
const PORT = 9335
const OUT = process.argv[2] ?? 'screenshots/whatsapp'
const W = 480
const H = 900

mkdirSync(OUT, { recursive: true })

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  `--user-data-dir=${join(process.env.TEMP ?? '.', 'sync-zap-shot')}`,
  `--window-size=${W},${H}`,
  'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function aguardar() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/json/version`)).ok) return } catch {}
    await sleep(250)
  }
  throw new Error('Chrome nao abriu a porta de debug')
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pend = new Map()
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data); const p = this.pend.get(m.id)
      if (!p) return
      this.pend.delete(m.id)
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result)
    }) }
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
    writeFileSync(join(OUT, `${nome}.png`), Buffer.from(data, 'base64'))
    console.log(`  ${join(OUT, nome)}.png`)
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

const SUBMETER = `(() => { document.querySelector('form').requestSubmit(); return true })()`

const api = async (caminho, corpo, token) =>
  (await fetch(`http://localhost:3333${caminho}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(corpo ?? {}),
  })).json()

async function main() {
  // O atendente entra primeiro porque a limpeza tambem passa por ele.
  const login = await api('/api/auth/agent/login', {
    email: AGENTE_EMAIL,
    password: AGENTE_SENHA,
  })

  // Encerra o que sobrou de execucoes anteriores.
  //
  // A Maria e a cliente do cenario, e uma mensagem nova dela cai na conversa
  // aberta que ela ja tem, que e o comportamento correto do produto. Sem isto a
  // captura acumulava duas jornadas na mesma tela e ficava ilegivel.
  const fila = await (await fetch('http://localhost:3333/api/admin/conversations', {
    headers: { authorization: `Bearer ${login.accessToken}` },
  })).json()

  for (const item of fila.items ?? fila) {
    await api(`/api/admin/conversations/${item.id}/resolve`, {}, login.accessToken)
  }

  // Monta o Cenario 1 pela API e pega o link de continuidade.
  const inicio = await (await fetch('http://localhost:3333/api/channels/site/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'meu cpf e 123.456.789-00, minha internet esta caindo toda hora' }),
  })).json()

  const link = await (await fetch(
    `http://localhost:3333/api/conversations/${inicio.conversationId}/handoff`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
  )).json()

  console.log(`  cenario montado. protocolo ${inicio.protocol}, codigo ${link.code}`)

  await aguardar()
  const alvo = await (await fetch(`http://localhost:${PORT}/json/new?about:blank`, { method: 'PUT' })).json()
  const ws = new WebSocket(alvo.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))

  const cdp = new Cdp(ws)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: W, height: H, deviceScaleFactor: 2, mobile: true,
  })

  await cdp.send('Page.navigate', { url: 'http://localhost:5175' })
  await sleep(1200)
  await cdp.eval('localStorage.clear(); true')

  // Abre pelo link real, com a mensagem ja pronta na URL.
  await cdp.send('Page.navigate', { url: link.url })
  await sleep(2000)

  console.log('capturando:')
  await cdp.shot('1-pede-numero')

  await cdp.eval(PREENCHER('input[type=tel]', '(11) 95555-0001'))
  await sleep(200)
  await cdp.eval(SUBMETER)
  await sleep(1800)
  await cdp.shot('2-mensagem-pronta')

  await cdp.eval(SUBMETER)
  await sleep(2600)
  await cdp.shot('3-continuidade')

  await cdp.eval(PREENCHER('input[placeholder=Mensagem]', 'quero falar com um atendente'))
  await sleep(200)
  await cdp.eval(SUBMETER)
  await sleep(2600)
  await cdp.shot('4-conversa-segue')

  // O atendente NAO abre o WhatsApp: ele responde de dentro do console do Sync,
  // que ve site e WhatsApp na mesma conversa. E o modelo de caixa unificada.
  // Esta parte prova que a resposta dele sai no aparelho do cliente.
  const id = inicio.conversationId
  await api(`/api/admin/conversations/${id}/claim`, {}, login.accessToken)
  await api(
    `/api/admin/conversations/${id}/messages`,
    { text: 'Aqui e o Bruno, da Claro. Identifiquei instabilidade na sua regiao e ja abri o reparo.' },
    login.accessToken,
  )

  // A tela consulta a API a cada quatro segundos.
  await sleep(5200)
  await cdp.shot('5-atendente-pelo-sync')

  ws.close()
}

main().then(() => { chrome.kill(); process.exit(0) })
  .catch((e) => { console.error('falhou:', e.message); chrome.kill(); process.exit(1) })
