# Triagem — regras de domínio

Continuação da tarefa 32 e das regras da tarefa 5, conforme o contrato v2 do
design e R09–R12/R26–R32. O cadastro existente permanece na branch
`feat/fundacao-mvp`; suas alterações locais são preservadas.

## Plano desta entrega

- [x] Testar e implementar contratos públicos de classificação, espécie de
      execução, validade, evidências e critérios da triagem.
- [x] Testar e implementar `classifyTriage`, `isTriageValid` e
      `canStartImplementation`, sem banco ou serviços externos.
- [x] Testar e implementar transições de análise, conclusão e início manual,
      reutilizando os bloqueios de elegibilidade.
- [x] Executar testes completos, integração PostgreSQL, tipos, lint, formatação,
      build e revisão; atualizar estado e evidências no plano.

## Decisões e interfaces

- Pre-flight: `tickets.version`, `currentTriageId` e `classification` já existem;
  o schema PostgreSQL já contém triagens, hashes, critérios e tipo de execução.
  Não é necessária migração para as funções puras desta entrega.
- Ruling: evidência recebida pelo domínio é uma avaliação estruturada, produzida
  pelo futuro adaptador de triagem, e não uma inferência sobre texto livre.
  Ausência/contradição de regra, verificação indisponível/falha e evidência
  insuficiente levam a `inconclusivo`. Os adaptadores ainda devem verificar as
  referências no disco; validação de formato não comprova o conteúdo da fonte.
- Ruling: validade exige vínculo com ticket e triagem vigente, mesma versão e
  classificação, estado `valid` e hashes atuais das fontes efetivamente usadas.
  Fontes adicionais que não participaram da análise não invalidam a conclusão.
- Ruling: a futura persistência de reservas/conclusões de triagem deve conservar
  a versão do conteúdo analisado para não invalidar a própria conclusão. Isso não
  altera as mutações humanas existentes: resolução incrementa a versão; edições,
  complementação, contestação e reabertura incrementam a versão e invalidam a
  triagem. Estado encerrado e reabertura continuam impedindo reutilização indevida.
- A disponibilidade do ambiente e os hashes atuais são entradas obrigatórias de
  elegibilidade. O cliente não poderá fornecer elegibilidade pronta à futura API.
- A reprodução vermelha do bug pertence à implementação; não é exigida nem
  fabricada durante a triagem. Bug exige plano de regressão; melhoria exige
  escopo, critérios e plano de testes antes do início manual.
- `verificationStatus: not_run` representa ausência de verificação executável
  prevista: a prova pode vir da leitura de fontes. `unavailable` representa
  verificação necessária indisponível e sempre impede uma conclusão definitiva.
- Fora desta entrega: leitura real do Kiro, reserva idempotente, persistência da
  conclusão, fila HTTP e executor. Tarefas 33–37 permanecem abertas.

## Evidências

- Baseline: `pnpm test` — 99 unitários; `pnpm test:integration` — 31 casos.
- Ambiente: Node 22.23.1, pnpm 10.28.2; shim Corepack temporário em `/tmp`,
  sem alterar o gerenciador global do operador.
- RED: 31 falhas de comportamento em classificação/elegibilidade com funções
  sem regras; 10 falhas nas transições antes de acrescentar as ações.
- GREEN: 95 novos testes de domínio passando (64 de classificação/validade/
  elegibilidade e 31 de transições). Nenhum deles usa conta de IA ou GitHub.
- `pnpm check`: tipos, lint, formatação, 194 unitários e builds backend/web
  aprovados. Web continua estático, sem testes próprios de comportamento.
- `pnpm test:integration`: 31 casos aprovados em três suítes com PostgreSQL
  descartável, incluindo o CRUD anterior, sem usar o banco do operador.
- `docker compose --env-file .env.example config --quiet` e `git diff --check`:
  aprovados.
- Revisão independente de domínio/compatibilidade CRUD concluída sem achados
  críticos, importantes ou menores. A recomendação sobre versão da resolução
  foi incorporada acima.
- Final: Ruling: verificação real de fontes, reservas e snapshots, idempotência,
  fila/API, pipeline CI, GitHub e interface não foram julgados como implementados
  nesta revisão — continuam tarefas explícitas posteriores; os testes locais
  não comprovam operação autenticada. O risco de integração futura deve ser
  coberto junto a cada adaptador e transação, sem enfraquecer o domínio.
