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

/**
 * Prepara a conta que o script vai usar para entrar.
 *
 * Nao existe mais base semeada: quem roda isto precisa ter criado o cliente
 * antes, e diz qual e por variavel de ambiente. O script so garante que a conta
 * tenha uma senha conhecida, tentando primeiro acesso e, se ja houver senha,
 * recuperacao.
 */
const CLIENTE_CPF = process.env.SHOT_CPF ?? '12345678900'
const CLIENTE_EMAIL = process.env.SHOT_EMAIL ?? 'maria.silva@exemplo.com'
const SENHA_DEMO = process.env.SHOT_SENHA ?? 'MinhaSenha123'

async function garantirSenhaDaMaria() {
  const api = async (caminho, corpo) => {
    const r = await fetch(`http://localhost:3333${caminho}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    })
    return { ok: r.ok, body: await r.json().catch(() => null) }
  }

  const dados = { cpf: CLIENTE_CPF, email: CLIENTE_EMAIL }

  const primeiro = await api('/api/auth/first-access', { ...dados, password: SENHA_DEMO })
  if (primeiro.ok) {
    console.log('  senha da Maria definida pelo primeiro acesso')
    return
  }

  const pedido = await api('/api/auth/password-reset', dados)
  const code = pedido.body?.devCode
  if (!code) {
    throw new Error(
      `Nao existe cliente com CPF ${CLIENTE_CPF} e e-mail ${CLIENTE_EMAIL}. ` +
        'A base nao e mais semeada: crie o cliente antes, ou informe SHOT_CPF e SHOT_EMAIL.',
    )
  }

  const trocou = await api('/api/auth/password-reset/confirm', { code, password: SENHA_DEMO })
  if (!trocou.ok) throw new Error('nao consegui redefinir a senha da Maria')
  console.log('  senha da Maria redefinida pela recuperacao')
}

async function main() {
  await garantirSenhaDaMaria()
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

  await cdp.eval(PREENCHER('input[type=email]', CLIENTE_EMAIL))
  await cdp.eval(PREENCHER('input[type=password]', SENHA_DEMO))
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

  // Caminho anonimo: e nele que o pedido de telefone aparece, depois da
  // primeira troca. Quem esta logado nao ve, porque o cadastro ja tem o numero.
  await cdp.eval('localStorage.clear(); true')
  await cdp.send('Page.reload')
  await sleep(2500)
  await cdp.eval(CLICAR_TEXTO('Continuar sem identificacao'))
    .catch(() => cdp.eval(CLICAR_TEXTO('Continuar sem')))
  await sleep(1500)
  await cdp.eval(PREENCHER('textarea', 'minha internet esta caindo toda hora'))
  await sleep(200)
  await cdp.eval(CLICAR_TEXTO('↑'))
  await sleep(2500)
  await cdp.shot('7-pede-telefone')

  // Recuperacao por ultimo: ela troca a senha da Maria, e capturar antes
  // invalidaria o login das telas acima.
  await cdp.eval('localStorage.clear(); true')
  await cdp.send('Page.reload')
  await sleep(2500)
  await cdp.eval(CLICAR_TEXTO('Esqueci minha senha'))
  await sleep(600)
  await cdp.eval(PREENCHER('input[inputmode=numeric]', CLIENTE_CPF))
  await cdp.eval(PREENCHER('input[type=email]', CLIENTE_EMAIL))
  await sleep(200)
  await cdp.shot('8-recuperar-pedido')

  await cdp.eval(CLICAR_TEXTO('Enviar código'))
  await sleep(2000)
  await cdp.shot('9-recuperar-codigo')

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
