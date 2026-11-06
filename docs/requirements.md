# Resolva — requisitos verificáveis

Status: requisitos para implementação e revisão. Nenhum item marcado como validado por uma aplicação executável nesta etapa.

Fontes: [desenho funcional](superpowers/specs/2026-11-05-resolva-design.md) e [definição técnica](superpowers/specs/2026-11-05-resolva-technical-design.md). A redação EARS torna cada comportamento verificável; os testes do projeto seguem a stack TypeScript/Vitest escolhida.

| ID | Requisito em EARS | Evidência de aceitação |
| --- | --- | --- |
| R01 | WHEN o operador cadastrar um ticket com campos válidos THE SYSTEM SHALL persistir o ticket como `aberto`, gerar seu código `RES-<número>` e registrar a criação no histórico. | Criar, consultar e reiniciar backend/banco mantendo o volume; obter os mesmos dados. |
| R02 | WHEN os campos obrigatórios ou a categoria forem inválidos THE SYSTEM SHALL recusar o cadastro ou edição sem gravar dados parciais. | Entradas vazias, limites excedidos e categoria desconhecida retornam `BAD_REQUEST`. |
| R03 | WHEN o operador listar tickets THE SYSTEM SHALL aplicar busca, filtros e paginação com ordenação estável. | Busca literal com `%` ou `_`, filtros e troca de página produzem resultados consistentes. |
| R04 | WHEN o operador enviar uma alteração com versão desatualizada THE SYSTEM SHALL retornar `CONFLICT` e preservar a versão mais recente do ticket. | Duas edições sobre a mesma versão não se sobrescrevem silenciosamente. |
| R05 | WHEN o operador iniciar uma análise válida THE SYSTEM SHALL criar uma execução com snapshots imutáveis e mudar o ticket para `em_andamento` na mesma transação. | Ticket, execução e evento persistem juntos; erro na reserva não deixa ticket preso. |
| R06 | WHILE existir uma execução ativa THE SYSTEM SHALL recusar outro disparo e informar qual execução está em andamento. | Duas chamadas simultâneas produzem somente uma execução ativa. |
| R07 | WHEN a mesma requisição de início for repetida com a mesma chave THE SYSTEM SHALL devolver a execução já criada para aquele ticket sem chamar a IA novamente. | Repetição com mesma chave preserva ID; reutilização da chave em outro ticket é recusada. |
| R08 | WHEN o ambiente estiver incompleto THE SYSTEM SHALL impedir o disparo da IA e apresentar as pendências, mantendo o cadastro e a consulta de tickets disponíveis. | Falta de credencial/configuração permite cadastrar; iniciar retorna `PRECONDITION_FAILED`. |
| R09 | WHEN os testes iniciais falharem ou não puderem ser executados THE SYSTEM SHALL registrar o impedimento e encerrar a tentativa sem publicar mudanças. | Baseline com falha, sem testes ou erro de compilação não chega à publicação. |
| R10 | WHEN o Kiro retornar necessidade de informações THE SYSTEM SHALL registrar as perguntas e mudar o ticket para `aguardando_informacoes`. | Relatório validado com perguntas finaliza a execução como `bloqueada`. |
| R11 | WHEN o operador complementar um ticket aguardando informações THE SYSTEM SHALL registrar a resposta e devolver o ticket a `aberto`, preservando as execuções anteriores. | A resposta não dispara IA automaticamente; uma nova execução utiliza o novo contexto. |
| R12 | WHEN a execução tratar a correção inicial ou um ajuste de comportamento THE SYSTEM SHALL exigir uma asserção falhando no teste novo antes de solicitar a correção. | Teste já passando, falha de runner ou compilação não são aceitos como reprodução; refinamentos preservam e referenciam a reprodução anterior. |
| R13 | WHILE implementar a correção THE SYSTEM SHALL preservar os testes existentes e os que comprovaram o problema e respeitar os caminhos e limites configurados. | Alteração de teste existente, suporte/configuração da suíte, arquivo fora do módulo ou diff excessivo bloqueia publicação. |
| R14 | WHEN a validação após correção falhar THE SYSTEM SHALL fornecer os resultados ao Kiro até o limite configurado de no máximo três rodadas por execução. | Terceira rodada sem sucesso encerra com impedimento; não existe quarta chamada de correção. |
| R15 | WHEN a correção for validada THE SYSTEM SHALL publicar somente o commit correspondente às evidências e confirmar um PR real antes de concluir a execução. | SHA validado igual ao publicado; PR consultável com identidade da entrega e ticket. |
| R16 | WHEN ocorrer repetição após publicação parcial THE SYSTEM SHALL reconciliar branch e PR existentes antes de criar novos recursos. | Resposta perdida após push ou criação do PR não gera PR duplicado. |
| R17 | WHEN o operador solicitar ajustes de um PR aberto THE SYSTEM SHALL registrar observações e tipo de ajuste e permitir nova execução vinculada à mesma entrega e branch. | Comportamento exige novo teste de reprodução; refinamento preserva evidência anterior, testes e validação. Ambos atualizam o mesmo PR e mantêm a execução anterior concluída. |
| R18 | WHEN uma branch tiver mudanças remotas não reconhecidas THE SYSTEM SHALL interromper a atualização e apresentar um conflito para análise humana. | SHA remoto divergente não sofre force push nem sobrescrita. |
| R19 | WHEN o operador confirmar merge e verificação da correção em teste THE SYSTEM SHALL marcar o ticket como `resolvido` e registrar a confirmação. | Ambos os indicadores são obrigatórios; abrir PR sozinho não resolve o ticket. |
| R20 | WHEN o operador reabrir um ticket resolvido THE SYSTEM SHALL exigir justificativa e preservar entregas e execuções anteriores. | Uma nova entrega após merge recebe outra branch/PR; histórico anterior continua acessível. |
| R21 | WHEN o operador abrir uma execução THE SYSTEM SHALL apresentar etapas, diagnóstico, resultados de testes, eventos e PR a partir dos registros reais. | Atualização incremental não duplica eventos; reabrir página recupera o estado. |
| R22 | WHEN um processo exceder seu limite ou perder o supervisor pai THE SYSTEM SHALL encerrar seus descendentes e registrar a interrupção sem iniciar trabalho concorrente. | Teste Linux com timeout e término forçado do pai comprova encerramento do grupo. |
| R23 | WHEN o backend recuperar uma execução interrompida THE SYSTEM SHALL registrar `interrompida`, liberar o ticket para tratamento e exigir tentativa explícita após verificar os processos anteriores. | Reiniciar não repete comandos nem interfere com outra instância ativa. |
| R24 | WHEN uma saída de processo ou integração contiver um segredo configurado THE SYSTEM SHALL removê-lo antes de persistir ou apresentar a evidência. | Tokens fictícios não aparecem em eventos, artefatos públicos ou respostas da API. |
| R25 | THE SYSTEM SHALL manter merge, deploy e aplicação de alterações em produção sob responsabilidade humana. | Executor e API não oferecem operação automática de merge, deploy ou escrita em banco de negócio. |

## Cenário principal de aceitação

1. Subir PostgreSQL em Docker e iniciar o Resolva.
2. Configurar o projeto alvo e as integrações de teste.
3. Cadastrar: “Total do pedido ignora quantidade”; esperado para `[{ unitPriceCents: 1000, quantity: 2 }, { unitPriceCents: 500, quantity: 1 }]`: `2500` centavos.
4. Iniciar pela interface e observar preparação, análise, reprodução, correção, validação e publicação.
5. Conferir o teste falhando antes da correção e passando depois, junto à validação completa.
6. Abrir o PR no GitHub, conferir o diff e o SHA validado; ticket deve estar aguardando revisão.
7. Realizar revisão, merge e verificação em teste pelo grupo; registrar a resolução manual no Resolva.

## Cenários complementares obrigatórios

- Relato insuficiente: pedir informação, receber resposta e criar nova execução sem apagar a anterior.
- Falha técnica: mostrar motivo e permitir tentativa explícita sem publicar resultado fictício.
- Revisão com ajustes: atualizar o PR aberto após nova validação.
- Perda de resposta de publicação: recuperar o PR existente sem duplicá-lo.
- Reinício: manter dados no PostgreSQL e registrar execução interrompida de forma consistente.

Critério de conclusão do projeto: fluxo real demonstrado com Kiro e GitHub, além dos testes automatizados. Adaptadores falsos são utilizados nos testes de desenvolvimento; não substituem a demonstração real.
