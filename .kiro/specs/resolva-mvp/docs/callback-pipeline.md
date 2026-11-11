# Callback da pipeline — implementação e evidências

## Objetivo e escopo

Continuar as tarefas 12, 14 e 39 do [plano canônico](../tasks.md), seguindo
as seções 3, 8 e 9 do [design](../design.md). Conferir o callback contra o
snapshot imutável do repositório, registrar a identidade do workflow e impedir
que respostas atrasadas alterem o progresso ou dupliquem o histórico.

A validação permanece no repository, dentro da transação que bloqueia a execução.
Isso cobre tanto tRPC quanto chamadas internas. A primeira mensagem válida vincula
o workflow; mensagens posteriores devem preservar ID e URL. O estado só avança de
`queued` para `running` e depois para um estado terminal, admitindo saltos quando
mensagens intermediárias se perdem. Repetir qualquer callback já aplicado devolve
`applied: false`, inclusive depois da conclusão.

Esta entrega não comprova remotamente o SHA, os testes ou a identidade da PR.
A confirmação autenticada no GitHub e a reconciliação continuam pendentes.

## Plano de execução

- [x] Reproduzir com testes PostgreSQL o aceite indevido de outro repositório,
      sucesso incompleto, troca de workflow, regressão de estado e replay antigo.
- [x] Aplicar `parsePipelineCallback` com a identidade persistida e erros públicos;
      validar URLs canônicas, sem credenciais, porta alternativa, consulta ou fragmento.
- [x] Adicionar `workflowId` e `workflowUrl` ao schema/migração e aos detalhes públicos;
      persistir a identidade junto ao evento e às transições, com rollback integral.
- [x] Cobrir concorrência de callbacks, exposição por HTTP e migração descartável.
- [x] Executar verificações pertinentes, revisar o diff e registrar resultados.

## Decisões de implementação

- Usar Zod, transações e locks já existentes, sem novas dependências.
- Manter a branch de desenvolvimento atual `feat/fundacao-mvp` e o workspace
  fornecido, inicialmente limpo, para continuar a entrega existente.
- Tratar callback inválido como `BAD_REQUEST`, conflito de identidade/progresso
  como `CONFLICT` e snapshot sem repositório válido como `PRECONDITION_FAILED`.
- Não persistir o diagnóstico livre de falha: manter a mensagem pública fixa já
  usada pelo repository, evitando copiar conteúdo externo para o histórico.
- Confirmar o disparo usando a próxima sequência sob lock e sem duplicar eventos.
  Quando um callback já confirmou o workflow, uma resposta perdida do disparo
  não bloqueia nem libera a execução ativa.
- A migração `0002_identidade_workflow.sql` recupera a primeira identidade do
  histórico existente. Havendo workflows divergentes em uma execução ativa,
  preserva a exclusividade e exige reconciliação antes de aceitar callbacks
  (`WORKFLOW_IDENTITY_CONFLICT` / `PRECONDITION_FAILED`). Essa decisão conserva
  o trabalho remoto potencialmente ativo; pode exigir intervenção manual em
  um histórico ambíguo. Não há reconciliação automática nesta entrega.
- Reutilizar `hasControlCharacters` no cliente CI para eliminar o aviso de lint
  da expressão regular anterior, preservando a validação existente.

## Evidências

Os testes iniciais reproduziram sete falhas no parser e dez no repository/HTTP.
Dois testes adicionais reproduziram a colisão de sequência na confirmação do
disparo; os dois cenários de upgrade reproduziram a perda da identidade histórica.
Após as correções, parser, repository e upgrade passaram nas verificações focadas.

A revisão independente apontou a corrida na confirmação do disparo e a perda de
identidade na migração; ambos receberam testes e correções. As verificações usam
processos falsos e PostgreSQL descartável, sem IA, PR real ou banco do operador.

Validação final aprovada em 11/11/2026 com Node 22.23.1 e pnpm 10.28.2:

- `pnpm check`: tipos, lint, formatação, 268 testes unitários e build aprovados.
- `pnpm test:integration`: 68 testes aprovados em seis arquivos, incluindo
  concorrência, rollback, HTTP e atualização de bancos com histórico anterior.
- `git diff --check`: sem erros de whitespace.

Aplicar a migração no banco local com `pnpm db:migrate` antes de iniciar a API.
Os testes não aplicaram mudanças ao banco do operador.
