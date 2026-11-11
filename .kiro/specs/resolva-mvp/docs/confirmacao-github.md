# Confirmação remota no GitHub — plano e evidências

Continuação implementada: [persistência, callback e reconciliação pela API](conclusao-implementacao.md).
O escopo e os resultados abaixo registram a entrega original do adaptador.

## Escopo

Continuar os adaptadores das tarefas 18, 29 e 40 do [plano](../tasks.md),
conforme a seção 8 do [design](../design.md). Disponibilizar consultas autenticadas
de workflow, PR e branch e uma verificação de entrega contra identidade e SHA
previamente aprovados pelo chamador. Uma resposta perdida pode ser conferida
novamente, sem criar PR nem disparar workflow.

Esta fatia entrega o adaptador; não conecta a confirmação ao callback. Faltam
persistir a entrega antes do disparo, validar/persistir evidências de teste e
coordenar reconciliação/transições pela API. Um callback ou workflow verde não
constitui evidência de teste aprovada.

## Decisões

- Reutilizar TypeScript, Zod e o executor `gh` existente, sem dependências novas.
- Consultar endpoints REST com `gh api --hostname github.com --method GET`;
  validar JSON e identidade antes de devolver um objeto normalizado.
- Conferir PR aberta, fora de rascunho, repositórios de origem/destino, branches,
  marcador `<!-- resolva-delivery:<uuid> -->`, SHA da PR e SHA atual da branch.
- Tratar divergência como conflito e indisponibilidade como erro de consulta;
  nenhum dos dois autoriza repetir publicação.
- Receber `validatedSha` do estado/evidências aprovados pelo chamador. Não obter
  esse valor do callback sem validação prévia. O `head_sha` de uma workflow
  disparada na branch base não comprova o commit que a implementação publicará.
- Manter o checkout e a branch `feat/fundacao-mvp` da entrega em andamento.
- Alternativa descartada: usar apenas `pr list`/status da workflow. Esses dados
  não conferem o marcador, os dois repositórios e a ponta atual da branch.

## Execução

- [x] Escrever e observar falhas de testes de leitura: identidade incorreta,
      JSON inválido, endpoints/host fixos, estado remoto e falhas do executor.
- [x] Implementar `inspection.ts`, integrado ao cliente CLI, com
      `getWorkflowRun`, `getPullRequest` e `getBranchHead`.
- [x] Escrever e observar falhas de confirmação: PR correta, fechada/integrada,
      fork, branch/base/marcador/SHA divergentes e indisponibilidade.
- [x] Implementar `confirmDelivery(input)` em `confirmation.ts`; confirmar
      somente após conferir PR e branch, sem operações de escrita.
- [x] Executar `pnpm check`, revisar o diff e registrar resultados reais.

## Foco de revisão

URLs de outro host/repositório; PR de fork com mesmo nome de branch; branch que
avançou depois da validação; marcador de outra entrega; falha remota que não
pode ser interpretada como ausência. Respostas REST podem conter campos extras;
nenhum texto remoto livre deve aparecer nos erros públicos.

## Evidências

Os 26 testes de inspeção e os 21 testes de confirmação falharam inicialmente
pela ausência das operações. Após a implementação, os 52 testes focados
(incluindo os cinco testes anteriores do cliente CLI) e o typecheck do backend
passaram. Respostas de GitHub são fixtures; não houve consulta autenticada real,
disparo de workflow nem publicação de PR.

As consultas são observações remotas sequenciais, sem lock no GitHub: a branch
pode mudar depois da leitura. A futura transação de confirmação deve conferir a
identidade da execução/entrega e o SHA aprovado ainda vigentes; publicação e
reconciliação não podem tratar este resultado como autorização permanente.

Fontes dos contratos de leitura: [workflow run](https://docs.github.com/en/rest/actions/workflow-runs#get-a-workflow-run),
[Pull Request](https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request),
[referência Git](https://docs.github.com/en/rest/git/refs#get-a-reference) e
[`gh api`](https://cli.github.com/manual/gh_api).

Validação em 11/11/2026 com Node 22.23.1 e pnpm 10.28.2:

- `pnpm check`: tipos, lint, formatação, 315 testes unitários e build aprovados.
- `pnpm test:integration`: 68 testes aprovados em PostgreSQL descartável,
  incluindo os cenários existentes de disparo e callback.
- `git diff --check`: sem erros de whitespace.

A revisão independente não encontrou problemas críticos ou importantes.
Apontou uma ambiguidade entre ID do run e ID da definição de workflow: o campo
da definição foi renomeado para `workflowDefinitionId`, com teste que falhou antes
da correção. O resultado conserva `id` como identidade do run; o parâmetro
`workflowId` segue a nomenclatura do callback existente, que identifica o run.
