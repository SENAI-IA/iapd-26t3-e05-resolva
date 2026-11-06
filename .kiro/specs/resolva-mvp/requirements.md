# Resolva — requisitos do MVP

## Contexto

O Resolva é uma aplicação local que recebe um ticket de correção, conduz uma investigação com Kiro CLI headless, valida uma mudança sustentada por teste e entrega um Pull Request para revisão humana. O MVP não faz merge, deploy ou alterações em produção.

Os requisitos ativos desta spec são a fonte de verdade para o MVP do Resolva.

## Requisitos funcionais

| ID | Requisito em EARS | Evidência de aceitação |
| --- | --- | --- |
| R01 | QUANDO o operador cadastrar um ticket com campos válidos, O SISTEMA DEVE persistir o ticket como `aberto`, gerar `RES-<número>` e registrar a criação no histórico. | Criar, consultar e reiniciar o backend mantendo o volume retorna os mesmos dados. |
| R02 | QUANDO campos obrigatórios ou a categoria forem inválidos, O SISTEMA DEVE recusar o cadastro ou edição sem gravar dados parciais. | Entradas vazias, limites excedidos e categoria desconhecida retornam `BAD_REQUEST`. |
| R03 | QUANDO o operador listar tickets, O SISTEMA DEVE aplicar busca literal, filtros e paginação com ordenação estável. | `%` e `_` não funcionam como curingas e a troca de página é consistente. |
| R04 | QUANDO o operador enviar alteração com versão desatualizada, O SISTEMA DEVE retornar `CONFLICT` e preservar a versão mais recente. | Duas edições sobre a mesma versão não se sobrescrevem. |
| R05 | QUANDO o operador iniciar uma análise válida, O SISTEMA DEVE criar execução com snapshots imutáveis e mudar o ticket para `em_andamento` na mesma transação. | Ticket, execução e evento persistem juntos; falha na reserva não prende o ticket. |
| R06 | ENQUANTO existir execução ativa, O SISTEMA DEVE recusar outro disparo e informar a execução em andamento. | Chamadas simultâneas produzem uma única execução ativa. |
| R07 | QUANDO a mesma requisição de início for repetida com a mesma chave, O SISTEMA DEVE devolver a execução já criada sem chamar a IA novamente. | A mesma chave preserva o ID; uso em outro ticket é recusado. |
| R08 | QUANDO o ambiente estiver incompleto, O SISTEMA DEVE impedir o disparo da IA e apresentar as pendências, mantendo cadastro e consulta disponíveis. | Falta de configuração retorna `PRECONDITION_FAILED`. |
| R09 | QUANDO os testes iniciais falharem ou não puderem ser executados, O SISTEMA DEVE registrar o impedimento, encerrar a tentativa e não publicar mudanças. | Baseline inválido, ausência de testes ou erro de compilação bloqueia a publicação. |
| R10 | QUANDO o Kiro solicitar informação, O SISTEMA DEVE registrar perguntas e mudar o ticket para `aguardando_informacoes`. | Relatório com perguntas encerra a execução como `bloqueada`. |
| R11 | QUANDO o operador complementar ticket aguardando informação, O SISTEMA DEVE registrar resposta, devolver o ticket a `aberto` e preservar execuções anteriores. | A resposta não dispara IA automaticamente. |
| R12 | QUANDO a execução tratar correção ou ajuste de comportamento, O SISTEMA DEVE exigir asserção falhando no teste novo antes da correção. | Teste passando, falha de runner ou compilação não comprovam reprodução. |
| R13 | ENQUANTO implementar a correção, O SISTEMA DEVE preservar testes existentes, testes de reprodução e caminhos e limites configurados. | Alteração de teste existente, suporte da suíte, arquivo fora do módulo ou diff excessivo bloqueia publicação. |
| R14 | QUANDO a validação após correção falhar, O SISTEMA DEVE enviar resultados ao Kiro até no máximo três rodadas. | A terceira falha encerra com impedimento; não existe quarta rodada. |
| R15 | QUANDO a correção for validada, O SISTEMA DEVE publicar somente o commit correspondente às evidências e confirmar um PR real antes de concluir. | SHA validado é igual ao publicado e o PR é consultável. |
| R16 | QUANDO ocorrer repetição após publicação parcial, O SISTEMA DEVE reconciliar branch e PR existentes antes de criar recursos. | Resposta perdida não gera PR duplicado. |
| R17 | QUANDO o operador solicitar ajuste de PR aberto, O SISTEMA DEVE registrar observação e tipo, permitir nova execução na mesma entrega e atualizar o PR existente. | Ajuste de comportamento exige nova reprodução; refinamento preserva evidência anterior. |
| R18 | QUANDO uma branch tiver mudança remota não reconhecida, O SISTEMA DEVE interromper a atualização e apresentar conflito para análise humana. | SHA divergente não sofre force push nem sobrescrita. |
| R19 | QUANDO o operador confirmar merge e verificação em teste, O SISTEMA DEVE marcar o ticket como `resolvido` e registrar a confirmação. | Ambos os indicadores são obrigatórios; abrir PR não resolve. |
| R20 | QUANDO o operador reabrir ticket resolvido, O SISTEMA DEVE exigir justificativa e preservar entregas e execuções anteriores. | Nova entrega usa outra branch/PR. |
| R21 | QUANDO o operador abrir uma execução, O SISTEMA DEVE apresentar etapas, diagnóstico, testes, eventos e PR a partir de registros reais. | Atualização incremental não duplica eventos e reabrir a página recupera o estado. |
| R22 | QUANDO um processo exceder seu limite ou perder o supervisor pai, O SISTEMA DEVE encerrar descendentes e registrar interrupção sem trabalho concorrente. | Teste de timeout e morte do pai comprova encerramento do grupo. |
| R23 | QUANDO o backend recuperar execução interrompida, O SISTEMA DEVE registrar `interrompida`, liberar o ticket e exigir nova tentativa explícita. | Reiniciar não repete comandos nem interfere em instância ativa. |
| R24 | QUANDO saída de processo ou integração contiver segredo configurado, O SISTEMA DEVE removê-lo antes de persistir ou apresentar evidência. | Tokens fictícios não aparecem em eventos, artefatos públicos ou API. |
| R25 | O SISTEMA DEVE manter merge, deploy e alterações em produção sob responsabilidade humana. | Executor e API não oferecem essas operações automaticamente. |

## Critérios de demonstração

- Cadastrar um ticket sobre cálculo incorreto, com comportamento esperado verificável.
- Demonstrar preparação, análise, reprodução, correção, validação e publicação.
- Exibir teste falhando antes da correção e passando depois.
- Confirmar PR, diff e SHA validado.
- Demonstrar relato insuficiente, falha técnica, ajuste de revisão, perda de resposta de publicação e reinício.
- Manter histórico das execuções e dos impedimentos.

## Fora do escopo

- Login e gestão de usuários.
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
