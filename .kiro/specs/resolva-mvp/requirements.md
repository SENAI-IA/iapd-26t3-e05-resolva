# Resolva — requisitos do MVP

## Contexto

O Resolva recebe solicitações técnicas, realiza uma triagem baseada em evidências e, somente após decisão explícita do usuário, implementa uma correção ou melhoria e entrega um Pull Request para revisão humana. Triagem, classificação, implementação e resultado de execução são conceitos distintos.

Os requisitos ativos desta spec são a fonte de verdade para o MVP do Resolva.

## Requisitos funcionais

| ID | Requisito em EARS | Evidência de aceitação |
| --- | --- | --- |
| R01 | QUANDO o operador cadastrar um ticket com campos válidos, O SISTEMA DEVE persistir o ticket como `aberto`, gerar `RES-<número>` e registrar a criação no histórico. | Criar, consultar e reiniciar o backend mantendo o volume retorna os mesmos dados. |
| R02 | QUANDO campos obrigatórios ou a categoria forem inválidos, O SISTEMA DEVE recusar o cadastro ou edição sem gravar dados parciais. | Entradas vazias, limites excedidos e categoria desconhecida retornam `BAD_REQUEST`. |
| R03 | QUANDO o operador listar tickets, O SISTEMA DEVE aplicar busca literal, filtros e paginação com ordenação estável. | `%` e `_` não funcionam como curingas e a troca de página é consistente. |
| R04 | QUANDO o operador enviar alteração com versão desatualizada, O SISTEMA DEVE retornar `CONFLICT`, preservar a versão mais recente e invalidar uma triagem vinculada à versão anterior. | Duas edições sobre a mesma versão não se sobrescrevem; a implementação exige nova triagem. |
| R05 | QUANDO o operador solicitar análise, O SISTEMA DEVE criar uma execução de triagem com snapshot imutável do ticket, mudar o ticket para `em_triagem` e não iniciar implementação. | A triagem persiste ticket, snapshot e evento na mesma transação; nenhum workspace de alteração ou PR é criado. |
| R06 | ENQUANTO existir triagem ou implementação ativa, O SISTEMA DEVE recusar outra execução incompatível e informar a execução em andamento. | Chamadas simultâneas produzem uma única execução ativa global. |
| R07 | QUANDO a mesma requisição de triagem ou implementação for repetida com a mesma chave, O SISTEMA DEVE devolver a execução já criada sem repetir IA nem efeitos externos. | A mesma chave preserva o ID; uso em outro ticket é recusado. |
| R08 | QUANDO o ambiente estiver incompleto, O SISTEMA DEVE impedir a execução que dependa da configuração ausente e manter cadastro, triagem local e consulta disponíveis quando não dependerem dela. | A implementação retorna `PRECONDITION_FAILED`; a triagem informa a dependência ausente sem publicar alterações. |
| R09 | QUANDO verificações autorizadas da triagem falharem ou não puderem ser executadas, O SISTEMA DEVE registrar a limitação e classificar o ticket como `inconclusivo`, sem recusar nem implementar. | Falha de runner, compilação ou evidência insuficiente gera pergunta ou revisão humana. |
| R10 | QUANDO a triagem solicitar informação, O SISTEMA DEVE persistir as perguntas, classificar o ticket como `inconclusivo` e mudar o ticket para `aguardando_informacoes`. | Relatório com perguntas encerra a triagem sem alteração de código ou publicação. |
| R11 | QUANDO o operador complementar um ticket em `aguardando_informacoes`, O SISTEMA DEVE registrar a resposta, invalidar a triagem anterior, devolver o ticket a `aberto` e preservar o histórico. | A resposta não inicia triagem nem implementação automaticamente. |
| R12 | QUANDO a implementação tratar um `bug`, O SISTEMA DEVE exigir uma asserção nova falhando antes da correção; QUANDO tratar uma `melhoria`, DEVE exigir escopo e critérios de aceite explícitos e testes do comportamento novo, sem fabricar uma falha do comportamento anterior. | Bug comprova teste vermelho/verde; melhoria comprova critérios e teste novo sem simular defeito. |
| R13 | ENQUANTO implementar uma solução, O SISTEMA DEVE preservar testes existentes, testes de reprodução, caminhos e limites configurados. | Alteração de teste existente, suporte da suíte, arquivo fora do módulo ou diff excessivo bloqueia publicação. |
| R14 | QUANDO a validação da implementação falhar, O SISTEMA DEVE enviar resultados ao Kiro até no máximo três rodadas de correção. | A terceira falha encerra com impedimento; não existe quarta rodada. |
| R15 | QUANDO a solução for validada, O SISTEMA DEVE publicar somente o commit correspondente às evidências e confirmar um PR real antes de concluir. | SHA validado é igual ao publicado e o PR é consultável. |
| R16 | QUANDO ocorrer repetição após publicação parcial, O SISTEMA DEVE reconciliar branch e PR existentes antes de criar recursos ou chamar nova IA. | Resposta perdida não gera PR duplicado nem nova implementação. |
| R17 | QUANDO o operador solicitar ajuste de PR aberto, O SISTEMA DEVE registrar observação e tipo, exigir nova triagem quando o escopo ou regra mudar e permitir implementação elegível na mesma entrega. | Ajuste de comportamento preserva a classificação válida; mudança de regra exige nova análise e critérios. |
| R18 | QUANDO uma branch tiver mudança remota não reconhecida, O SISTEMA DEVE interromper a atualização e apresentar conflito para análise humana. | SHA divergente não sofre force push nem sobrescrita. |
| R19 | QUANDO o operador confirmar merge e verificação em teste, O SISTEMA DEVE marcar o ticket como `resolvido` e registrar a confirmação. | Ambos os indicadores são obrigatórios; abrir PR não resolve. |
| R20 | QUANDO o operador reabrir ticket resolvido, O SISTEMA DEVE exigir justificativa, invalidar a elegibilidade anterior e preservar entregas e execuções anteriores. | Nova triagem e nova implementação usam histórico preservado. |
| R21 | QUANDO o operador abrir um ticket ou execução, O SISTEMA DEVE apresentar relato, classificação, justificativa, fontes, perguntas, critérios, etapas, eventos, testes, impedimentos e PR a partir de registros reais. | Atualização incremental não duplica eventos e reabrir a página recupera o estado completo. |
| R22 | QUANDO um processo exceder seu limite ou perder o supervisor pai, O SISTEMA DEVE encerrar descendentes e registrar interrupção sem trabalho concorrente. | Teste de timeout e morte do pai comprova encerramento do grupo. |
| R23 | QUANDO o backend recuperar execução interrompida, O SISTEMA DEVE registrar `interrompida`, liberar o ticket e exigir nova triagem ou implementação explícita conforme a etapa interrompida. | Reiniciar não repete comandos nem interfere em instância ativa. |
| R24 | QUANDO saída de processo ou integração contiver segredo configurado, O SISTEMA DEVE removê-lo antes de persistir ou apresentar evidência. | Tokens fictícios não aparecem em eventos, artefatos públicos ou API. |
| R25 | O SISTEMA DEVE manter merge, deploy e alterações em produção sob responsabilidade humana. | Executor e API não oferecem essas operações automaticamente. |
| R26 | QUANDO a triagem concluir com evidências suficientes, O SISTEMA DEVE classificar o ticket exatamente como `falso_positivo`, `entendimento_incorreto`, `bug`, `melhoria` ou `inconclusivo`. | Cada classificação possui justificativa, evidências, fontes, limitações e próxima ação persistidas. |
| R27 | QUANDO a classificação for `falso_positivo` ou `entendimento_incorreto`, O SISTEMA DEVE recusar a implementação, explicar respeitosamente a conclusão no ticket e orientar o uso correto quando aplicável. | O ticket fica `recusado`; nenhuma fila de implementação, alteração de código ou PR é criada. |
| R28 | QUANDO a classificação for `bug` ou `melhoria`, O SISTEMA DEVE colocar o ticket em `aguardando_implementacao` numa fila persistida, sem consumo automático por worker. | O ticket aparece no backlog com classificação, escopo, critérios e próxima ação; nenhum processo inicia sozinho. |
| R29 | QUANDO o usuário solicitar início manual, O SISTEMA DEVE permitir implementação somente para ticket em `aguardando_implementacao`, com triagem válida para a mesma versão e classificação elegível. | Botão indisponível na interface e procedure retorna `CONFLICT` ou `PRECONDITION_FAILED` para estados inválidos. |
| R30 | QUANDO o usuário iniciar uma implementação elegível, O SISTEMA DEVE registrar a decisão, criar snapshot da triagem e iniciar o fluxo existente de preparação, validação, PR e revisão humana. | O início manual gera evento próprio e não pode ser confundido com a execução de triagem. |
| R31 | QUANDO o usuário contestar uma recusa, complementar evidências ou solicitar nova triagem, O SISTEMA DEVE preservar a conclusão anterior, registrar a contestação e criar uma nova triagem vinculada à nova versão ou intenção. | Histórico mostra conclusões em sequência; a nova triagem não sobrescreve a anterior. |
| R32 | QUANDO o relato, comportamento esperado, regra ou evidência analisada mudar de forma relevante, O SISTEMA DEVE invalidar a triagem anterior e exigir nova triagem antes da implementação. | `triageVersion`/hashes não correspondem ao ticket atual; início manual é recusado. |

## Estados e conceitos

- Tickets: `aberto`, `em_triagem`, `recusado`, `aguardando_informacoes`, `aguardando_implementacao`, `em_andamento`, `aguardando_revisao`, `resolvido`.
- Execuções de triagem: `em_andamento`, `bloqueada`, `concluida`, `falhou`, `interrompida`.
- Execuções de implementação: `em_andamento`, `bloqueada`, `falhou`, `concluida`, `interrompida`.
- Classificações: `falso_positivo`, `entendimento_incorreto`, `bug`, `melhoria`, `inconclusivo`.
- A classificação, o estado do ticket, a validade da triagem e o resultado da execução são armazenados separadamente.

## Critérios de demonstração

- Cadastrar um ticket e analisar somente a triagem.
- Demonstrar falso positivo e recusa fundamentada no próprio ticket.
- Demonstrar entendimento incorreto com explicação da regra vigente.
- Demonstrar bug confirmado na fila sem implementação automática.
- Demonstrar melhoria válida com escopo e critérios de aceite.
- Demonstrar problema não reproduzido como `inconclusivo` quando faltar evidência.
- Demonstrar documentação contraditória encaminhada para esclarecimento.
- Contestar uma recusa e executar nova triagem preservando o histórico.
- Alterar o ticket e invalidar a triagem anterior.
- Iniciar manualmente uma implementação e concluir o fluxo de teste, validação, PR e revisão humana.

## Fora do escopo

- Login e gestão de usuários no MVP local.
- Consumo automático da fila por worker ou scheduler.
- Webhooks, fila distribuída, Redis e execução remota.
- Merge, deploy ou alteração automática em produção.
- Múltiplos projetos alvo.
- Correção de dados ou consultas em bancos de negócio.
- Sandbox de sistema operacional para código arbitrário.

## Fontes

- Esta spec de requisitos.
- `.kiro/specs/resolva-mvp/design.md`.
- `.kiro/steering/project-rules.md`.
- `.kiro/steering/architecture.md`.

## Critérios transversais de qualidade — proposta para revisão

Estes itens detalham condições operacionais do mesmo MVP; não substituem nem renumeram R01–R32. Status de todos: planejado/não executado.

| ID | Requisito verificável | Evidência |
| --- | --- | --- |
| Q01 | O SISTEMA DEVE manter frontend/API em loopback e validar Host/Origin locais, sem CORS irrestrito. | Host externo e Origin externo/nulo recusados; origem local configurada aceita |
| Q02 | QUANDO frontend importar contratos, O SISTEMA DEVE exportar apenas tipos públicos sem iniciar conexão nem incluir segredos no bundle. | Verificação de tipos/build e importação sem efeitos colaterais |
| Q03 | QUANDO testes automatizados executarem, O SISTEMA DEVE usar fakes/recursos descartáveis sem modelo pago ou PR real. | Suíte funciona sem credenciais Kiro/GitHub; integração não toca banco da demonstração |
| Q04 | QUANDO operador navegar, O SISTEMA DEVE oferecer rótulos, foco, teclado e estados de erro recuperáveis nas telas. | Ensaios em 1366×768/390×844 e erro de rede sem spinner indefinido |
| Q05 | QUANDO o agente referenciar contexto, O SISTEMA DEVE validar referências locais e registrar versões/hashes de fontes e prompts. | Caminho/linhas existentes e correlação com diagnóstico; sem contexto bruto ou raciocínio interno |
| Q06 | QUANDO o piloto for apresentado, A EQUIPE DEVE distinguir evidência real de integração falsa e declarar pendências. | Registro de versão/modelo, teste vermelho/verde e PR consultado; mocks identificados |
| Q07 | QUANDO a triagem concluir, O SISTEMA DEVE persistir classificação, mensagem, fontes, incertezas e próxima ação sem permitir implementação fora da elegibilidade. | Contrato de triagem cobre as cinco classificações e recusa a fila para estados inválidos |
| Q08 | QUANDO uma triagem estiver desatualizada, O SISTEMA DEVE impedir implementação e explicar a versão que exige nova análise. | Alteração do ticket/regra/evidência torna `triageVersion` inválida |

### Exemplo de aceitação escrito para R19

Teste previsto em `backend/src/domain/ticket.test.ts`, após existir a função de domínio descrita no design. O bloco abaixo é especificação de um teste futuro, não teste executado nesta fase:

```typescript
import { describe, expect, it } from 'vitest';
import { transitionTicket } from './ticket';

describe('R19: resolução manual', () => {
  it('resolve somente com merge e verificação em teste confirmados', () => {
    expect(transitionTicket('aguardando_revisao', {
      type: 'resolve', mergeConfirmed: true, testVerified: true,
    })).toBe('resolvido');
    expect(() => transitionTicket('aguardando_revisao', {
      type: 'resolve', mergeConfirmed: true, testVerified: false,
    })).toThrow();
    expect(() => transitionTicket('aberto', {
      type: 'resolve', mergeConfirmed: true, testVerified: true,
    })).toThrow();
  });
});
```

O schema público exige indicadores verdadeiros; o domínio também deve recusar confirmação incompleta se chamado diretamente. Outros casos de borda estão no [plano](tasks.md) e na [rastreabilidade](docs/rastreabilidade.md).
