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
const AGENTE_EMAIL = process.env.SHOT_AGENTE ?? 'bruno@claro.com.br'
const GESTOR_EMAIL = process.env.SHOT_GESTOR ?? 'leticia@claro.com.br'
const AGENTE_SENHA = process.env.SHOT_AGENTE_SENHA ?? 'Atendente123'
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

// O cartao virou article para caber o link da pagina inteira ao lado do botao.
// Clicar no article nao seleciona nada: a superficie de escolha e o botao.
const CLICAR_PRIMEIRO_CARD = `
(() => {
  const card = document.querySelector('.card')
  if (!card) throw new Error('quadro vazio')
  const pick = card.querySelector('.card__pick') ?? card
  pick.click()
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

  const usuario = process.env.SHOT_MANAGER === '1' ? GESTOR_EMAIL : AGENTE_EMAIL
  await cdp.eval(PREENCHER('input[type=email]', usuario))
  await cdp.eval(PREENCHER('input[type=password]', AGENTE_SENHA))
  await cdp.eval(CLICAR('Entrar'))
  await sleep(2500)
  await cdp.shot('2-quadro')

  console.log('  card selecionado:', await cdp.eval(CLICAR_PRIMEIRO_CARD))
  await sleep(1600)
  await cdp.shot('3-detalhe')

  const talvez = async (rotulo, fn) => {
    try {
      await fn()
    } catch (e) {
      console.log(`  (pulou ${rotulo}: ${e.message})`)
    }
  }

  await talvez('assumir', async () => {
    await cdp.eval(CLICAR('Assumir atendimento'))
    await sleep(1800)
  })
  await cdp.shot('4-assumido')

  await talvez('responder', async () => {
    await cdp.eval(
      PREENCHER(
        'textarea',
        'Oi Maria. Vi que voce quer cancelar o plano movel final 9876. Antes disso, posso ver uma oferta melhor pra voce?',
      ),
    )
    await sleep(200)
    await cdp.eval(CLICAR('Enviar'))
    await sleep(2000)
  })
  await cdp.shot('5-respondido')

  await cdp.eval(CLICAR('Histórico', '.nav__item'))
  await sleep(1500)
  await cdp.shot('6-historico')

  // A gestao nao tem "Meu painel": o painel dela e uma linha na lista da
  // equipe. Cada perfil captura o menu que realmente tem.
  const gestora = process.env.SHOT_MANAGER === '1'

  if (!gestora) {
    await cdp.eval(CLICAR('Meu painel', '.nav__item'))
    await sleep(1800)
    await cdp.shot('7-meu-painel')
  }

  if (gestora) {
    await cdp.eval(CLICAR('Equipe', '.nav__item'))
    await sleep(1800)
    await cdp.shot('8-equipe')

    await cdp.eval(`document.querySelector('.team__row').click(); true`)
    await sleep(1600)
    await cdp.shot('9-desempenho-do-atendente')
  }

  // A pagina inteira do atendimento, para os dois perfis. Tem endereco proprio
  // por hash, entao basta navegar: e o mesmo endereco que o icone do cartao
  // abre em outra aba. O token sai do localStorage desta aba, que ja fez login
  // pela interface.
  const sessao = await cdp.eval("localStorage.getItem('sync.console.sessao')")
  const acesso = sessao ? JSON.parse(sessao).accessToken : null

  const fila = acesso
    ? await (await fetch('http://localhost:3333/api/admin/conversations', {
        headers: { authorization: `Bearer ${acesso}` },
      })).json()
    : { items: [] }

  const alvoId = (fila.items ?? fila)[0]?.id

  if (alvoId) {
    await cdp.send('Page.navigate', { url: `http://localhost:5174/#/atendimento/${alvoId}` })
    await sleep(2600)
    await cdp.shot('10-atendimento-pagina-inteira')
  } else {
    console.log('  (sem atendimento na fila para a pagina inteira)')
  }

  ws.close()
}

main().then(() => { chrome.kill(); process.exit(0) })
  .catch((e) => { console.error('falhou:', e.message); chrome.kill(); process.exit(1) })
