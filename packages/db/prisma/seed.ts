import { prisma } from '../src/client.js'

/**
 * Base semeada dos três cenários do Documento de Visão.
 *
 * Os valores não são arbitrários: CPF, telefone, rótulo do plano móvel e data de
 * vencimento da fatura são exatamente os que aparecem nos cenários ilustrativos.
 * Os testes de aceitação dependem deles.
 */
async function main() {
  const maria = await prisma.customer.upsert({
    where: { cpf: '12345678900' },
    update: {},
    create: {
      cpf: '12345678900',
      name: 'Maria Silva',
      email: 'maria.silva@exemplo.com',
      phone: '+5511987654321',
    },
  })

  const internet = await prisma.service.upsert({
    where: { id: 'svc-internet-maria' },
    update: {},
    create: {
      id: 'svc-internet-maria',
      customerId: maria.id,
      type: 'INTERNET_RESIDENCIAL',
      label: 'Claro Net Fibra 500 Mega',
      address: 'Rua das Acácias, 120 - São Paulo/SP',
    },
  })

  await prisma.service.upsert({
    where: { id: 'svc-movel-maria' },
    update: {},
    create: {
      id: 'svc-movel-maria',
      customerId: maria.id,
      type: 'MOVEL',
      label: 'Plano móvel final 9876',
    },
  })

  await prisma.invoice.upsert({
    where: { id: 'inv-maria-maio' },
    update: {},
    create: {
      id: 'inv-maria-maio',
      customerId: maria.id,
      serviceId: internet.id,
      dueDate: new Date('2026-05-20T00:00:00.000Z'),
      amount: '149.90',
      barcode: '00000000000 00000000000 00000000000 00000000000',
      status: 'OPEN',
    },
  })

  const joao = await prisma.customer.upsert({
    where: { cpf: '98765432100' },
    update: {},
    create: {
      cpf: '98765432100',
      name: 'João Pereira',
      email: 'joao.pereira@exemplo.com',
      phone: '+5511912345678',
    },
  })

  await prisma.service.upsert({
    where: { id: 'svc-movel-joao' },
    update: {},
    create: {
      id: 'svc-movel-joao',
      customerId: joao.id,
      type: 'MOVEL',
      label: 'Plano móvel final 1234',
    },
  })

  console.log('seed concluído')
}

main()
  .catch((erro) => {
    console.error(erro)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
