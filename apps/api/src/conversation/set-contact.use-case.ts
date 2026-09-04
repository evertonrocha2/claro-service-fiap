import { err, ok, type Result } from '@sync/contracts'
import type { IConversationRepository } from '../context/index.js'
import { normalizePhone } from '../identity/phone.js'

/**
 * Registra o telefone de contato de um atendimento.
 *
 * Sem isto, quem conversa no site sem estar logado não tem como ser reconhecido
 * ao escrever no WhatsApp depois, e o atendimento recomeça do zero. O número é a
 * única chave que os dois canais compartilham.
 *
 * ATENÇÃO, e o motivo de este arquivo ser curto: o telefone informado aqui é
 * NÃO VERIFICADO e nunca concede identidade.
 *
 * A primeira versão promovia a conversa ao cliente dono daquele número. Era
 * falha de divulgação de dados: telefone não é segredo, então qualquer pessoa
 * digitava o número de outra e o bot respondia com o nome, o serviço e o
 * vencimento da fatura dela, sem token nenhum. Identidade vem de login ou de
 * CPF no diálogo, não de um campo que o visitante preenche.
 *
 * O número serve só para reencontrar a conversa. E isso é seguro porque a ponte
 * entre canais resolve o cliente registrado antes: mensagem do WhatsApp tem o
 * telefone validado pela própria Meta, então `findOpenByCustomer` decide primeiro
 * e o `contactPhone` não verificado só é consultado para números sem dono
 * cadastrado, onde as duas pontas são igualmente anônimas.
 *
 * Para produção, o caminho é confirmar a posse com código enviado por SMS antes
 * de gravar. Fora do escopo deste MVP, e anotado como dívida consciente.
 *
 * Acesso: possuir o id da conversa basta, mesma regra da leitura e do handoff.
 * Como o telefone não concede identidade nenhuma, não há o que proteger além do
 * próprio id.
 */
export class SetContactUseCase {
  constructor(private readonly conversations: IConversationRepository) {}

  async execute(conversationId: string, phoneBruto: string): Promise<Result<{ phone: string }>> {
    const normalizado = normalizePhone(phoneBruto)
    if (!normalizado.success) return normalizado

    const conversa = await this.conversations.findById(conversationId)
    if (!conversa) {
      return err('CONVERSA_NAO_ENCONTRADA', 'Não encontramos este atendimento.')
    }

    const phone = normalizado.data
    await this.conversations.update(conversationId, { contactPhone: phone })

    // A resposta não diz se o número pertence a um cliente cadastrado. Dizer
    // transformaria esta rota num oráculo para descobrir quais telefones são
    // clientes da Claro, testando um por um.
    return ok({ phone })
  }
}
