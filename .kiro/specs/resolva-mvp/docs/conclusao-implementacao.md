# Conclusão de implementação — plano e evidências

## Escopo

Continuar as seções 8–9 do [design](../design.md) e tarefas 6, 12, 18, 39–40 do
[plano](../tasks.md). Persistir a entrega antes do disparo, registrar evidência
aprovada pelo executor interno e ligar a confirmação remota ao callback/API.
Reconciliar manualmente o sucesso já informado, sem disparar workflow ou criar PR.

Usar tabelas e colunas existentes, TypeScript, Zod, transações Drizzle e o cliente
`gh`. Manter branch e checkout da entrega atual. A alternativa de concluir apenas
com status da workflow ou JSON enviado ao callback não satisfaz o design.

## Contratos e decisões

- Reserva cria uma entrega inicial e branch
  `resolva/res-<ticketId>-<prefixo-da-execucao>`, vinculadas na mesma transação.
  Replay de `requestKey` preserva ambas. Modos de ajuste/retry seguem fora desta
  fatia; não reutilizar entrega de outra execução implicitamente.
- `recordValidationEvidence` é método interno, sem procedure pública. Exige
  identidade de execução/entrega/workflow, tentativa e definição da workflow,
  SHA, baseline aprovado, reprodução por asserção para bug (teste novo aprovado
  para melhoria), validação final aprovada, hash do teste congelado e metadados
  do relatório sanitizado. O produtor confiável continua sendo o executor;
  o callback não pode aprovar suas próprias evidências.
- Guardar evidência imutável em `validation_approved`, metadados em `artifacts`
  e SHA em `executions.validatedSha`, atomicamente. Repetição idêntica é inócua;
  evidência diferente gera conflito.
- Sucesso informado vira proposta persistida e mantém a execução ativa. Ausência
  de evidências, GitHub indisponível ou divergência não libera outra execução.
  Depois dessa proposta, callbacks diferentes de sucesso geram conflito;
  apenas replay de mensagens já aplicadas é ignorado.
- Consultar GitHub fora da transação. Conferir workflow/tentativa/definição,
  PR, marcador, branches e SHA. Revalidar a evidência e identidade sob lock na
  transação final e então persistir PR/SHA e estados/históricos juntos.
- `implementations.reconcile({ executionId })` reprocessa a proposta persistida.
  Sem proposta suficiente, retornar precondição explícita, sem inventar PR.
- Callbacks já concluídos permanecem idempotentes, mesmo com GitHub indisponível.
  Execuções legadas sem entrega/evidência não ganham aprovação retroativa.

## Execução

- [x] Testar e implementar reserva/vínculo da entrega e campos do dispatch.
- [x] Testar e implementar validação e persistência da evidência interna.
- [x] Testar e implementar proposta, confirmação e transação final, incluindo
      rejeição de sucesso sem evidência e rollback real de evento/PR/estados.
- [x] Testar e implementar reconciliação manual por HTTP, replay e concorrência.
- [x] Revisar, executar verificações completas e registrar evidências.

## Foco de revisão

Requisições concorrentes sem entregas órfãs; prova de outro SHA/run/tentativa;
validação alterada durante consulta remota; replay com GitHub fora do ar; erro de
consulta que não pode virar ausência/liberação; vazamento de diagnóstico externo.

## Limites

A coleta real do relatório da pipeline e a orquestração do Kiro permanecem
pendentes. O registro interno valida o contrato e sua identidade, mas não executa
testes nem transforma afirmações externas em evidência confiável. O ambiente
padrão continua bloqueado. Sem alterações no banco do operador ou GitHub real.
Não há nova migração. Recuperação do disparo com resposta perdida e modos de
ajuste/retry continuam pendentes; esta reconciliação trata sucesso já informado.

Limitação menor adiada: se houver propostas com o mesmo SHA e números de PR
diferentes, a reconciliação tenta a mais recente. O operador deve reenviar o
callback correto se essa proposta apontar a PR errada; o endpoint não busca
automaticamente entre identidades divergentes. Nenhuma proposta divergente
aprova a entrega nem libera a execução por si só.

## Evidências

Os testes reproduziram duas falhas na reserva, 14 no registro de evidências e
15 no fluxo de confirmação/reconciliação antes da implementação. Dois cenários
adicionais reproduziram a escolha indevida de uma proposta posterior divergente:
a reconciliação agora usa proposta compatível com o SHA aprovado e, após concluir,
a proposta correspondente ao fingerprint confirmado.

A conferência final reproduziu uma corrida entre reservas com a mesma
`requestKey`: a segunda requisição via o ticket já em andamento e recusava a
intenção original. A reserva agora consulta novamente a chave após obter o lock
do ticket e devolve a mesma execução/entrega, sem novo disparo ou entrega órfã.

Os testes usam PostgreSQL descartável e respostas GitHub falsas. Cobrem aprovação
de bug e melhoria, concorrência, mudanças do SHA durante consultas sem lock de
banco aberto, rollback de PR/estados/histórico, indisponibilidade, rejeição de
aprovação pelo callback HTTP e replay da conclusão com GitHub fora do ar.

A revisão independente identificou que falha/cancelamento posteriores ao sucesso
informado ainda liberavam a execução sem confirmação remota. Dois testes
reproduziram o problema; esses estados agora geram conflito e mantêm a execução
ativa. A limitação menor sobre propostas de PR divergentes foi documentada acima.

Verificações finais em 11/11/2026, com Node 22.23.1 e pnpm 10.28.2:

- `pnpm check`: tipos, lint, formatação, 315 testes unitários e build aprovados.
- `pnpm test:integration`: 107 testes aprovados em sete arquivos, incluindo
  36 cenários de evidência/conclusão e a reserva concorrente da mesma intenção.
- `git diff --check`: sem erros de whitespace.

O apontamento importante da revisão e a corrida da reserva receberam testes
vermelhos e correções verificadas pela suíte completa. A limitação menor adiada
está descrita acima. Nenhuma integração autenticada real foi executada.
