import { err, ok, type Result } from '@sync/contracts'
import type { TokenSubject } from '../auth/tokens.js'

/** Quem chegou na porta. `undefined` é sessão anônima do site, que é permitida. */
export type Requester = TokenSubject | undefined

/**
 * Decide se este requisitante pode tocar nesta conversa.
 *
 * A regra é a mais forte que cabe aqui sem quebrar o fluxo principal, e vale
 * escrever por quê, porque a leitura ingênua diz que deveria ser mais rígida.
 *
 * O que fecha: cliente autenticado só mexe na conversa dele. Antes, quem
 * estivesse logado como João e tivesse o id de uma conversa da Maria lia o nome,
 * o serviço e a fatura dela, e escrevia como se fosse ela. Isso agora é 403.
 *
 * O que não fecha, de propósito: sessão sem token continua entrando com o id.
 * Exigir dono aqui mataria o Cenário 1 do documento, que é o caminho previsto no
 * RF002: a pessoa começa anônima, informa o CPF no meio da conversa, a conversa
 * passa a ter dono, e a própria aba que estava conversando perderia o acesso no
 * instante seguinte, sem nunca ter feito login.
 *
 * Então para o visitante anônimo o id da conversa é a credencial. É um cuid, não
 * é enumerável, e vaza uma conversa só. O caminho de produção é um segredo por
 * conversa com prazo, entregue a quem a criou, e está anotado como dívida no
 * README. Trocar o id por esse segredo é a próxima peça, não uma reescrita.
 */
export function assertPodeAcessar(
  conversaCustomerId: string | null,
  requester: Requester,
): Result<null> {
  const clienteLogado = requester?.kind === 'CUSTOMER' ? requester.subjectId : null

  if (clienteLogado && conversaCustomerId && clienteLogado !== conversaCustomerId) {
    return err('CONVERSA_DE_OUTRO_CLIENTE', 'Este atendimento não é da sua conta.')
  }

  return ok(null)
}
