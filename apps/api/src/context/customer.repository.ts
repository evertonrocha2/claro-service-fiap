import type { Customer, Invoice, PrismaClient, Service } from '@sync/db'

export type CustomerWithContext = Customer & {
  services: Service[]
  invoices: Invoice[]
}

export interface ICustomerRepository {
  findById(id: string): Promise<Customer | null>
  findByCpf(cpf: string): Promise<Customer | null>
  findByPhone(phone: string): Promise<Customer | null>
  findWithContext(id: string): Promise<CustomerWithContext | null>
}

export class PrismaCustomerRepository implements ICustomerRepository {
  constructor(private readonly db: PrismaClient) {}

  findById(id: string): Promise<Customer | null> {
    return this.db.customer.findUnique({ where: { id } })
  }

  findByCpf(cpf: string): Promise<Customer | null> {
    return this.db.customer.findUnique({ where: { cpf } })
  }

  findByPhone(phone: string): Promise<Customer | null> {
    return this.db.customer.findUnique({ where: { phone } })
  }

  /** Só faturas em aberto, mais antiga primeiro: é o que a resposta automática usa. */
  findWithContext(id: string): Promise<CustomerWithContext | null> {
    return this.db.customer.findUnique({
      where: { id },
      include: {
        services: true,
        invoices: { where: { status: 'OPEN' }, orderBy: { dueDate: 'asc' } },
      },
    })
  }
}
