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
  findByEmail(email: string): Promise<Customer | null>
  setPasswordHash(id: string, hash: string): Promise<void>
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

  findByEmail(email: string): Promise<Customer | null> {
    return this.db.customer.findUnique({ where: { email: email.trim().toLowerCase() } })
  }

  async setPasswordHash(id: string, hash: string): Promise<void> {
    await this.db.customer.update({ where: { id }, data: { passwordHash: hash } })
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
