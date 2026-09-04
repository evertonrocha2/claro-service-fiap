import { type Result, err, ok } from '@sync/contracts'
import type { ICustomerRepository } from '../context/customer.repository.js'
import { verifyPassword } from './password.js'
import type { IRefreshTokenRepository } from './refresh-token.repository.js'
import { REFRESH_TTL_SECONDS, type TokenService, newRefreshToken } from './tokens.js'

export type LoginInput = {
  email: string
  password: string
}

export type LoginOutput = {
  accessToken: string
  refreshToken: string
  customer: { id: string; name: string; email: string }
}

const CREDENCIAIS_INVALIDAS = err(
  'CREDENCIAIS_INVALIDAS',
  'E-mail ou senha incorretos.',
) as Result<never>

export class LoginUseCase {
  constructor(
    private readonly customers: ICustomerRepository,
    private readonly refreshTokens: IRefreshTokenRepository,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Todos os caminhos de falha devolvem a mesma constante: e-mail inexistente,
   * senha errada e conta sem primeiro acesso são indistinguíveis de fora. Mensagens
   * diferentes permitiriam enumerar quais e-mails têm conta na Claro.
   */
  async execute(input: LoginInput): Promise<Result<LoginOutput>> {
    const cliente = await this.customers.findByEmail(input.email)
    if (!cliente?.passwordHash) return CREDENCIAIS_INVALIDAS

    if (!(await verifyPassword(cliente.passwordHash, input.password))) {
      return CREDENCIAIS_INVALIDAS
    }

    const refreshToken = newRefreshToken()
    await this.refreshTokens.issue({
      token: refreshToken,
      subjectId: cliente.id,
      subjectKind: 'CUSTOMER',
      ttlSeconds: REFRESH_TTL_SECONDS,
    })

    return ok({
      accessToken: await this.tokens.signAccess({ subjectId: cliente.id, kind: 'CUSTOMER' }),
      refreshToken,
      customer: { id: cliente.id, name: cliente.name, email: cliente.email },
    })
  }
}
