#!/usr/bin/env node
/**
 * Cria um cliente com um plano e uma fatura em aberto.
 *
 * Não é seed: nada roda sozinho, e nada nasce junto com o banco. É a ferramenta
 * que substitui, enquanto a base da Claro não é importada, o cadastro que
 * viria de lá. O produto não tem registro aberto de propósito, porque uma conta
 * criada do zero não teria plano nem fatura sobre o que conversar.
 *
 * Por isso o plano e a fatura vêm junto: cliente sem serviço faz o Sync não ter
 * o que responder, e a demonstração fica sem assunto.
 *
 * A conta nasce SEM senha, de propósito. É assim que o primeiro acesso funciona
 * na tela: a pessoa confirma CPF e e-mail e define a senha ali. Criar já com
 * senha impediria justamente esse caminho.
 *
 * Uso:
 *   npm run db:customer -- "Nome Sobrenome" 12345678900 email@exemplo.com [+5511987654321]
 */
import { prisma } from '../src/client.js'

const [nome, cpfBruto, email, telefone] = process.argv.slice(2)

function sair(mensagem) {
  console.error(mensagem)
  console.error(
    '\nuso: npm run db:customer -- "Nome Sobrenome" 12345678900 email@exemplo.com [+5511987654321]',
  )
  process.exit(1)
}

if (!nome || !cpfBruto || !email) sair('Faltam argumentos.')

const cpf = cpfBruto.replace(/\D/g, '')
if (cpf.length !== 11) sair(`CPF precisa ter 11 dígitos: ${cpfBruto}`)
if (!email.includes('@')) sair(`E-mail inválido: ${email}`)

if (await prisma.customer.findUnique({ where: { cpf } })) sair(`Já existe cliente com o CPF ${cpf}.`)
if (await prisma.customer.findUnique({ where: { email } })) sair(`Já existe cliente com ${email}.`)

const cliente = await prisma.customer.create({
  data: { name: nome, cpf, email, ...(telefone ? { phone: telefone } : {}) },
})

const internet = await prisma.service.create({
  data: {
    customerId: cliente.id,
    type: 'INTERNET_RESIDENCIAL',
    label: 'Claro Net Fibra 500 Mega',
  },
})

await prisma.service.create({
  data: { customerId: cliente.id, type: 'MOVEL', label: 'Plano móvel final 9876' },
})

// Vence em dez dias: em aberto, sem estar em atraso, para a conversa não cair
// direto na régua de negociação de dívida.
const vencimento = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)

await prisma.invoice.create({
  data: {
    customerId: cliente.id,
    serviceId: internet.id,
    dueDate: vencimento,
    amount: '149.90',
    barcode: '00000000000 00000000000 00000000000 00000000000',
    status: 'OPEN',
  },
})

console.log(`Cliente criado: ${cliente.name}, CPF ${cliente.cpf}, ${cliente.email}`)
console.log('Sem senha: use o primeiro acesso na tela para definir uma.')
await prisma.$disconnect()
