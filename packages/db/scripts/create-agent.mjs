#!/usr/bin/env node
/**
 * Cria uma conta da equipe.
 *
 * Existe porque não há cadastro de atendente em lugar nenhum do produto, e com
 * razão: quem entra no console é definido pela Claro, não por quem abre a
 * página. Sem uma base semeada, sem este comando o console fica inacessível
 * para sempre, e isso não é "limpo", é quebrado.
 *
 * Não é dado de mentira: é a ferramenta de administração que cria a primeira
 * pessoa de verdade. Em produção o lugar dela é o diretório de identidade da
 * empresa, e este comando some junto.
 *
 * Uso:
 *   npm run db:agent -- "Nome Sobrenome" email@claro.com.br senha [MANAGER]
 */
import { hash } from '@node-rs/argon2'
import { prisma } from '../src/client.js'

const [nome, email, senha, papel = 'AGENT'] = process.argv.slice(2)

function sair(mensagem) {
  console.error(mensagem)
  console.error('\nuso: npm run db:agent -- "Nome Sobrenome" email@claro.com.br senha [MANAGER]')
  process.exit(1)
}

if (!nome || !email || !senha) sair('Faltam argumentos.')
if (!email.includes('@')) sair(`E-mail inválido: ${email}`)
if (senha.length < 8) sair('A senha precisa ter ao menos 8 caracteres.')
if (papel !== 'AGENT' && papel !== 'MANAGER') sair(`Papel inválido: ${papel}. Use AGENT ou MANAGER.`)

const jaExiste = await prisma.agent.findUnique({ where: { email } })
if (jaExiste) sair(`Já existe uma conta com o e-mail ${email}.`)

const criado = await prisma.agent.create({
  data: { name: nome, email, passwordHash: await hash(senha), role: papel },
})

console.log(`Conta criada: ${criado.name} <${criado.email}> como ${criado.role}`)
await prisma.$disconnect()
