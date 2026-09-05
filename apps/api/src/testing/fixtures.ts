import { hash } from '@node-rs/argon2'
import type { Agent, Customer, Invoice, InvoiceStatus, Service } from '@sync/db'
import { prisma } from '@sync/db'

/**
 * Dados de teste, criados pelo próprio teste.
 *
 * Antes existia uma base semeada e toda a suíte lia dela: buscava a Maria pelo
 * CPF, o Bruno pelo e-mail, e seguia. Era conveniente e custou caro duas vezes.
 *
 * O teste do console gravou um hash inválido na conta do Bruno e derrubou o
 * login em toda a aplicação; o sintoma foi um 401 sem explicação. O teste de
 * recuperação de senha terminava zerando a senha da Maria e quebrava os scripts
 * de captura de tela. Nos dois casos um teste estragou o trabalho de outro,
 * porque os dois mexiam na mesma linha do banco.
 *
 * Aqui cada teste cria o que precisa, com identificadores únicos, e limpa
 * depois. Sai mais lento e não se envenena.
 */

let contador = 0

/** CPF sintético e único. Não passa em validação de dígito, e não precisa. */
export function cpfUnico(): string {
  contador += 1
  return String(90000000000 + contador)
}

export function emailUnico(prefixo = 'teste'): string {
  contador += 1
  return `${prefixo}.${contador}.${Date.now()}@teste.local`
}

/** E.164 sintético, na faixa 5511 9xxxx-xxxx. */
export function telefoneUnico(): string {
  contador += 1
  return `+55119${String(10000000 + contador).slice(0, 8)}`
}

export type ClienteInput = {
  name?: string
  cpf?: string
  email?: string
  phone?: string | null
  /** Já entra com senha definida. Ausente deixa a conta sem senha. */
  password?: string
}

export async function criarCliente(input: ClienteInput = {}): Promise<Customer> {
  return prisma.customer.create({
    data: {
      name: input.name ?? 'Cliente de Teste',
      cpf: input.cpf ?? cpfUnico(),
      email: input.email ?? emailUnico('cliente'),
      phone: input.phone === null ? null : (input.phone ?? telefoneUnico()),
      ...(input.password ? { passwordHash: await hash(input.password) } : {}),
    },
  })
}

export type AtendenteInput = {
  name?: string
  email?: string
  password?: string
  role?: 'AGENT' | 'MANAGER'
}

export async function criarAtendente(input: AtendenteInput = {}): Promise<Agent> {
  return prisma.agent.create({
    data: {
      name: input.name ?? 'Atendente de Teste',
      email: input.email ?? emailUnico('atendente'),
      // Hash de verdade só quando o teste vai fazer login. Argon2 é caro de
      // propósito, e a maioria dos testes só precisa de um id de atendente.
      passwordHash: input.password ? await hash(input.password) : 'sem-senha-neste-teste',
      role: input.role ?? 'AGENT',
    },
  })
}

export type ServicoInput = {
  type?: 'INTERNET_RESIDENCIAL' | 'MOVEL' | 'TV'
  label?: string
  address?: string
}

export async function criarServico(customerId: string, input: ServicoInput = {}): Promise<Service> {
  return prisma.service.create({
    data: {
      customerId,
      type: input.type ?? 'INTERNET_RESIDENCIAL',
      label: input.label ?? 'Internet 500 Mega',
      ...(input.address ? { address: input.address } : {}),
    },
  })
}

export type FaturaInput = {
  serviceId?: string
  /** Data exata, para o teste que verifica o vencimento no texto da resposta. */
  dueDate?: Date
  /** Dias a partir de hoje. Negativo vence no passado. Ignorado se dueDate vier. */
  vencimentoEmDias?: number
  amount?: string
  status?: InvoiceStatus
  barcode?: string
}

export async function criarFatura(customerId: string, input: FaturaInput = {}): Promise<Invoice> {
  const dias = input.vencimentoEmDias ?? 10
  const dueDate = input.dueDate ?? new Date(Date.now() + dias * 24 * 60 * 60 * 1000)

  return prisma.invoice.create({
    data: {
      customerId,
      ...(input.serviceId ? { serviceId: input.serviceId } : {}),
      dueDate,
      amount: input.amount ?? '149.90',
      barcode: input.barcode ?? '00000000000 00000000000 00000000000 00000000000',
      status: input.status ?? 'OPEN',
    },
  })
}

/**
 * Cliente com plano e fatura, que é o formato que a maioria dos testes quer.
 *
 * A fatura vence em dez dias por padrão: em aberto, mas não em atraso, para não
 * disparar sem querer a política de negociação.
 */
export async function criarClienteCompleto(
  input: ClienteInput & { fatura?: FaturaInput; servico?: ServicoInput } = {},
): Promise<{ cliente: Customer; servico: Service; fatura: Invoice }> {
  const { fatura, servico, ...doCliente } = input

  const cliente = await criarCliente(doCliente)
  const criado = await criarServico(cliente.id, servico)
  const emitida = await criarFatura(cliente.id, { serviceId: criado.id, ...fatura })

  return { cliente, servico: criado, fatura: emitida }
}

/**
 * CPF do cliente dos cenários do Documento de Visão.
 *
 * É um valor fixo, e precisa ser: vários testes mandam "meu cpf é
 * 123.456.789-00" dentro da mensagem, e o teste só faz sentido se existir um
 * cliente com esse CPF. A diferença para o seed antigo é que agora o próprio
 * teste cria essa linha e a apaga em seguida.
 */
export const CPF_CENARIO = '12345678900'

/**
 * Maria Silva, com internet, plano móvel e uma fatura em aberto.
 *
 * É a cliente dos três cenários ilustrativos do documento, e os rótulos são os
 * mesmos porque as respostas automáticas citam o nome do serviço.
 */
export async function criarClienteDoCenario(
  input: ClienteInput & { fatura?: FaturaInput } = {},
): Promise<{ cliente: Customer; internet: Service; movel: Service; fatura: Invoice }> {
  const { fatura: daFatura, ...doCliente } = input

  const cliente = await criarCliente({
    name: 'Maria Silva',
    cpf: CPF_CENARIO,
    email: 'maria.silva@teste.local',
    phone: '+5511987654321',
    ...doCliente,
  })

  const internet = await criarServico(cliente.id, {
    type: 'INTERNET_RESIDENCIAL',
    label: 'Claro Net Fibra 500 Mega',
    address: 'Rua das Acácias, 120 - São Paulo/SP',
  })

  const movel = await criarServico(cliente.id, {
    type: 'MOVEL',
    label: 'Plano móvel final 9876',
  })

  const fatura = await criarFatura(cliente.id, { serviceId: internet.id, ...daFatura })

  return { cliente, internet, movel, fatura }
}

/**
 * Apaga tudo, na ordem em que as chaves estrangeiras permitem.
 *
 * Vive aqui e não em cada arquivo porque a ordem é fácil de errar e o erro só
 * aparece quando alguém adiciona uma tabela nova.
 */
export async function limparBase(): Promise<void> {
  await prisma.offerInsight.deleteMany()
  await prisma.message.deleteMany()
  await prisma.handoffToken.deleteMany()
  await prisma.conversation.deleteMany()
  await prisma.invoice.deleteMany()
  await prisma.service.deleteMany()
  await prisma.passwordResetToken.deleteMany()
  await prisma.refreshToken.deleteMany()
  await prisma.intentCache.deleteMany()
  await prisma.customer.deleteMany()
  await prisma.agent.deleteMany()
}
