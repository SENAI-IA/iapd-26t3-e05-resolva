# Resolva — plano de implementação

Status: desenvolvimento iniciado. A fundação e o schema base (tarefas 1, 3–4) foram implementados; a configuração estrutural da tarefa 2 e o servidor mínimo da tarefa 9 também estão disponíveis. O vínculo da configuração única do sistema-alvo ao ticket ainda precisa ser especificado no schema e validado. Evidências e limites em [docs/fundacao.md](docs/fundacao.md) e [docs/configuracao-persistencia.md](docs/configuracao-persistencia.md).
Evidências e limites em [docs/fundacao.md](docs/fundacao.md) e
[docs/configuracao-persistencia.md](docs/configuracao-persistencia.md).
O cadastro e a consulta de tickets por tRPC estão implementados na primeira fatia
das tarefas 5–7 e 9; limites e evidências em [docs/tickets-api.md](docs/tickets-api.md).
As regras de domínio de triagem e elegibilidade (tarefa 32) estão implementadas;
evidências em [docs/triagem-dominio.md](docs/triagem-dominio.md). A reserva e a
conclusão de triagem são transacionais e as consultas estão disponíveis por tRPC.
O adaptador de triagem Kiro está exercitado com processo simulado. A execução real
pelo Kiro CLI headless e a interface permanecem pendentes.

A fila, a reserva manual e as consultas de implementação estão disponíveis no
backend, com disparo pelo cliente `gh` em testes. O callback agora valida o
snapshot, preserva a identidade do workflow e trata replay/concorrência de forma
transacional. O ambiente padrão mantém novos inícios bloqueados; confirmação
remota de evidências, reconciliação e interface permanecem pendentes.
[Escopo e evidências do callback](docs/callback-pipeline.md).

As tarefas seguem dependências por fatia vertical. Cada tarefa deve atualizar testes e evidências correspondentes antes de ser marcada como concluída.

## Fundação

- [x] 1. Criar workspace pnpm com `web` e `backend`, TypeScript estrito, Node 22 e scripts de lint, formatação e teste.
  - Requisitos: R25.
- [ ] 2. Criar uma configuração validada do sistema-alvo, `.env.example`, `resolva.config.example.json`, `.gitignore` e limites de caminhos, comandos, pipeline e modelo.
  - Parcial: configuração estrutural, limites, caminhos e comandos já existem; vínculo da chave ao ticket e snapshot versionado ainda pendentes.
  - Requisitos: R08, R13, R24, R25, R33, R34, R37.
- [x] 3. Criar Docker Compose do PostgreSQL com volume nomeado, healthcheck e porta local configurável.
  - Requisitos: R01, R23.
- [ ] 4. Configurar Drizzle, conexão, migrações e schema inicial sem segredos, incluindo a configuração do sistema-alvo e seu vínculo versionado ao ticket.
  - Requisitos: R01, R04, R05, R21, R23, R24, R33, R34, R37.

## Domínio e backend

- [ ] 5. Implementar estados, classificações, validade de triagem, elegibilidade, validações de campos e códigos de erro do domínio.
  - Parcial: contratos públicos, validação de conteúdo, categorias, erros, transições humanas, decisão de triagem e elegibilidade implementados. Ajustes de PR dependem dos modos de execução da tarefa 19.
  - Requisitos: R01, R02, R04, R10, R11, R19, R20, R26, R27, R29, R30, R31, R32, R33, R34, R35, R37.
- [ ] 6. Implementar repositories transacionais para tickets, triagens, eventos, fila, execuções, entregas e artefatos, incluindo pipeline e Pull Request.
  - Parcial: tickets, histórico, controle de versão e invalidação atômica da triagem; leitura de resumos de execução/entrega. Reservas de implementação, pipeline e demais repositories pendentes.
  - Requisitos: R01, R04, R05, R06, R07, R10, R11, R16, R18, R19, R20, R21, R23, R28, R30, R31, R32, R33, R34, R36, R37.
- [ ] 7. Implementar procedures tRPC de tickets, configuração e triagem, com paginação, busca literal, seleção do sistema-alvo, controle de versão, mensagens, contestação, complementação e histórico.
  - Parcial: nove procedures de tickets implementadas com contratos de entrada/saída e testes HTTP. Seleção da configuração, fila, início de implementação e ajustes de PR permanecem pendentes.
  - Requisitos: R01, R02, R03, R04, R10, R11, R17, R19, R20, R26, R27, R31, R32, R33, R34.
- [ ] 8. Implementar procedures tRPC de triagem, fila, implementação e ambiente, incluindo seleção da configuração do ticket, idempotência por `requestKey`, validação de elegibilidade e disparo manual da pipeline CI.
  - Requisitos: R05, R06, R07, R08, R21, R23, R28, R29, R30, R32, R33, R34, R35, R37.
- [ ] 9. Implementar healthcheck, erros públicos de triagem/implementação e validações de ambiente sem stack trace ou segredos.
  - Parcial: servidor local, healthcheck, bloqueio Host/Origin e erros HTTP/tRPC públicos implementados; configuração do banco ligada ao servidor. Validação das integrações e erros de execução pendentes.
  - Requisitos: R08, R21, R24, R29, R30, R32.

## Executor controlado

- [ ] 10. Implementar exclusividade global, reserva, idempotência e recuperação de execuções/pipelines interrompidas.
  - Requisitos: R06, R07, R22, R23, R28, R29.
- [ ] 11. Implementar cliente de pipeline CI com argumentos/variáveis validados, timeout, autenticação isolada e encerramento/reconciliação da chamada externa.
  - Requisitos: R08, R13, R22, R23, R35, R37.
- [ ] 12. Implementar captura limitada, sanitização de segredos, callback, artefatos e eventos com sequência.
  - Requisitos: R21, R22, R24, R35, R36.
- [ ] 13. Definir manifesto de fontes/testes, relatório de validação e adaptador `vitest-json` usados pela pipeline CI.
  - Requisitos: R09, R12, R13, R14, R26, R28, R32, R35.
- [ ] 14. Implementar integração com a pipeline CI, prompts de triagem e implementação, relatórios JSON versionados, callback e reconciliação da execução Kiro headless.
  - Requisitos: R08, R09, R10, R12, R14, R21, R24, R26, R27, R28, R32, R34, R35, R37.
- [ ] 15. Implementar triagem somente leitura e fases de implementação para bugs e melhorias, disparadas pela pipeline CI, com limite máximo de três rodadas de correção e snapshot imutável da configuração do sistema-alvo.
  - Requisitos: R05, R09, R10, R12, R13, R14, R26, R27, R28, R29, R30, R32, R34, R35.

## GitHub e entrega

- [ ] 16. Implementar cópia de trabalho derivada da configuração do ticket, validação de caminhos, diff, arquivos sensíveis, limites e SHA validado.
  - Requisitos: R13, R15, R18, R24, R34, R37.
- [ ] 17. Implementar disparo da pipeline CI com argumentos/variáveis validados, credencial isolada, branch e commit no repositório configurado.
  - Requisitos: R15, R18, R24, R25, R34, R35.
- [ ] 18. Implementar criação, atualização e reconciliação idempotente de Pull Request vinculada ao ticket, sem force push.
  - Requisitos: R15, R16, R17, R18, R36.
- [ ] 19. Implementar modos `initial`, `retry`, `review_behavior` e `review_refinement`, preservando entregas e execuções.
  - Requisitos: R16, R17, R18, R20.

## Frontend

- [ ] 20. Criar tokens, layout, navegação e componentes acessíveis para tickets, triagem e fila, sem importar dependências secretas do backend.
  - Requisitos: R21, R25, R26, R28, R29.
- [ ] 21. Implementar lista da fila, busca, filtros, paginação, cadastro, edição e indicação de triagem desatualizada.
  - Requisitos: R01, R02, R03, R04, R28, R32.
- [ ] 22. Implementar detalhes do ticket, mensagem de triagem, ações de informação, contestação, início manual, ajustes, resolução e reabertura.
  - Requisitos: R10, R11, R17, R19, R20, R21, R26, R27, R29, R31.
- [ ] 23. Implementar histórico e acompanhamento de triagem e implementação com polling, cursor de eventos, classificação, impedimentos e PR.
  - Requisitos: R05, R08, R09, R10, R14, R15, R16, R21, R23, R26, R28, R31.
- [ ] 24. Implementar tela de configuração pública e disponibilidade das integrações sem exibir segredos.
  - Requisitos: R08, R24, R25.

## Demonstração e qualidade

- [ ] 25. Criar `examples/demo-target` com bug conhecido de quantidade, regra documentada e testes existentes passando; incluir fixture de melhoria com comportamento novo e critérios explícitos.
  - Requisitos: R12, R15, R26, R28.
- [ ] 26. Criar testes unitários de domínio, triagem, repositories, elegibilidade e contratos tRPC.
  - Requisitos: R01–R08, R10, R11, R17, R19–R21, R26–R32.
- [ ] 27. Criar testes de integração descartáveis para concorrência, idempotência, validade de triagem, fila manual, recuperação e sanitização.
  - Requisitos: R06, R07, R16, R18, R22, R23, R24, R28, R29, R31, R32.
- [ ] 28. Criar testes de executor com comandos falsos para triagem somente leitura, tentativa de alteração proibida, timeout, morte do pai, baseline, reprodução de bug, melhoria e três rodadas.
  - Requisitos: R09, R12, R13, R14, R22, R26, R27, R28.
- [ ] 29. Criar fixtures de integração da pipeline CI, GitHub e Kiro sem publicar PR real nos testes.
  - Requisitos: R15, R16, R17, R18, R25, R35, R36.
- [ ] 30. Documentar instalação, configuração, triagem, fila, implementação, execução, arquitetura, prompts, limitações, operação e evidências no README.
  - Requisitos: R01–R37.
- [ ] 31. Executar validação final, revisar diff, confirmar ausência de segredos e preparar evidências dos fluxos ticket → triagem → fila → implementação → PR.
  - Requisitos: R09, R13, R15, R21, R24, R25, R26–R37.

## Ordem de entrega recomendada

1. Tarefas 1–9 para ter cadastro e consulta persistentes.
2. Tarefas 10–15 para executar validação controlada sem publicação.
3. Tarefas 16–19 para entregar PR com reconciliação segura.
4. Tarefas 20–24 para fechar o fluxo visual.
5. Tarefas 25–31 para demonstração e validação.

## Extensão de triagem e fila — tarefas 32–37

As tarefas 1–31 permanecem preservadas. As tarefas abaixo tornam explícita a separação entre triagem e implementação; são planejamento, não execução.

- [x] 32. Definir `TriageClassification`, `ExecutionKind`, estados do ticket, validade por `ticketVersion` e regras de elegibilidade para `bug` e `melhoria`.
  - Funções puras e contratos em `domain/contracts.ts`, `domain/triage.ts` e `domain/ticket.ts`; inclui hashes das fontes, critérios, ambiente e exclusividade. Ainda sem acionamento de IA ou implementação pela API.
  - Requisitos: R04, R05, R26–R32.
- [x] 33. Persistir triagens, fontes, hashes, mensagens, contestação, snapshots e invalidação sem apagar conclusões anteriores.
  - Reserva idempotente e conclusão transacional com histórico e recuperação de falhas tratadas. Cobertura HTTP/PostgreSQL em `backend/src/trpc/triages.integration.test.ts`.
  - Validação com `pnpm check` e `pnpm test:integration` aprovados, com 195 unitários e 41 testes de integração. Dez casos de triagem cobrem concorrência, replay, snapshots, histórico, falhas e consultas com executor falso.
  - Requisitos: R05, R07, R10, R11, R21, R31, R32.
- [ ] 34. Expor `triages.start`, `triages.byId`, `triages.list`, `tickets.contestTriage`, `implementations.queue` e `implementations.start` com Zod, idempotência e validação transacional.
  - Parcial: procedures de triagem e contestação disponíveis. O início requer um executor injetado, exercitado com integração falsa. Fila e início de implementação pendentes.
  - Requisitos: R05–R08, R26–R32.
- [ ] 35. Criar prompt de triagem somente leitura, relatório estruturado das cinco classificações e integração com a pipeline CI sem edição, Git ou GitHub durante a triagem.
  - Parcial: configuração por execução, prompt e verificação de identidade, fontes, hashes e relatório v1 integrados com processo simulado. A política efetiva e o uso autenticado permanecem em [ensaio de compatibilidade](docs/kiro-compatibility.md).
  - Requisitos: R05, R09, R10, R24, R26–R28.
- [ ] 36. Implementar na interface a distinção entre `Analisar ticket` e `Iniciar implementação`, fila persistida, mensagens de decisão, contestação e triagem desatualizada.
  - Requisitos: R21, R26–R32.
- [ ] 37. Cobrir os dez cenários de triagem e elegibilidade com testes de domínio, repository, API, executor e interface, usando fakes e recursos descartáveis.
  - Parcial: classificação, perguntas, contradição, validade, elegibilidade e transições cobertos no domínio. Cenários completos de persistência, idempotência, executor e interface permanecem pendentes.
  - Requisitos: R06–R12, R21, R26–R32.
- [ ] 38. Implementar a configuração única do sistema-alvo selecionável no ticket, snapshot versionado e bloqueio por configuração ausente ou divergente.
  - Parcial: chave, versão, hash e snapshot imutável são validados e persistidos no ticket; criação/edição bloqueia configuração ausente ou chave divergente. O bloqueio transacional do início da implementação permanece pendente junto do serviço de implementação.
  - Requisitos: R33, R34, R37.
- [ ] 39. Integrar o início da implementação ao disparo de uma pipeline CI, enviando somente o snapshot do ticket, configuração, contexto necessário e `executionId`; a pipeline executa o Kiro CLI headless e devolve relatório/callback validado.
  - Requisitos: R08, R12–R16, R24, R30, R34, R35.
- [ ] 40. Criar e reconciliar a Pull Request do sistema-alvo configurado no ticket, vinculando pipeline, execução, SHA validado e histórico sem duplicação.
  - Requisitos: R15–R18, R25, R36.

A ordem recomendada passa a ser: fundação e configuração/tickets (1–9, 38), triagem e fila (32–37), integração CI/Kiro (10–15, 39), GitHub/PR (16–19, 40), frontend completo (20–24) e demonstração/qualidade (25–31). Nenhuma implementação é iniciada por esta atualização documental.

## Complemento de execução e divisão — proposta v1

As 31 tarefas originais e as extensões 32–40 preservam sua numeração. A ordem é refinada abaixo para permitir entregas entre integrantes; não significa executar primeiro todo backend e só depois considerar a interface. [PRD](PRD.md), [equipe/esforço](docs/divisao-trabalho.md), [aceitação](docs/rastreabilidade.md).

### Gate 0 — comprovar compatibilidade antes do investimento maior

- [ ] 0.1. Confirmar configuração única do sistema-alvo, pipeline, conta/modelo, orçamento e capacidade disponíveis. Donos propostos: Sergio/Lucas.
- [ ] 0.2. Registrar CLI/versão, flags instaladas, autenticação sem valor secreto e política efetiva por fase em `.kiro/specs/resolva-mvp/docs/kiro-compatibility.md`.
- [ ] 0.3. Provar leitura/edição permitidas e recusa de shell, MCP, web, subagente e caminho externo na pipeline, incluindo configurações globais/workspace/hooks.
- [ ] 0.4. Capturar eventos públicos e relatório v1, observar teste vermelho/verde e, com acesso autorizado, confirmar uma PR no repositório configurado. Testes automatizados não fazem esse ensaio.
- [ ] 0.5. Registrar duração/uso disponível e decisão prosseguir/replanejar. Conta ausente ou mock aprovado não comprovam o fluxo real.

Esforço de referência do Gate 0: 16 pessoas-hora. Não marcar concluído por documentação de intenção.

### Interfaces que devem ser estabilizadas cedo

| Arquivo                                      | Contrato público/operacional                                                                                                                                        | Dono proposto   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `backend/src/domain/contracts.ts`            | Tipos Zod `Ticket`, `TicketInput`, `TicketStatus`, `ExecutionStatus`, `ExecutionStage`, `ExecutionDetail`, `RunReport`, `PublicEnvironment`, `PullRequestReference` | Felipe + Sergio |
| `backend/src/db/index.ts`                    | `createDatabase(databaseUrl: string): AppDatabase`; `close(): Promise<void>` na instância                                                                           | Felipe          |
| `backend/src/db/migrate.ts`                  | `runMigrations(database: AppDatabase): Promise<void>`                                                                                                               | Felipe          |
| `backend/src/server.ts`                      | `buildServer(dependencies: ServerDependencies): Promise<FastifyInstance>`                                                                                           | Felipe          |
| `backend/src/domain/ticket.ts`               | `transitionTicket(current: TicketStatus, action: TicketAction): TicketStatus`                                                                                       | Felipe          |
| `backend/src/config/project.ts`              | `loadTargetSystemConfig(path: string): TargetSystemConfig` derivado de Zod                                                                                          | Sergio          |
| `backend/src/services/ticketService.ts`      | `createTicketService(database: AppDatabase, targetConfig: TargetSystemConfig): TicketService`                                                                       | Felipe          |
| `backend/src/executor/process.ts`            | `runCommand(input: CommandInput): Promise<CommandResult>`                                                                                                           | Sergio          |
| `backend/src/executor/workspace.ts`          | `createWorkspace(input: WorkspaceInput): Promise<Workspace>`; `collectValidatedDiff(workspace: Workspace, policy: ChangePolicy): Promise<DiffSummary>`              | Sergio          |
| `backend/src/executor/validation.ts`         | `runValidation(workspace: Workspace, commands: readonly ConfiguredCommand[]): Promise<ValidationResult>`                                                            | Sergio          |
| `backend/src/executor/instanceGuard.ts`      | `acquireInstanceGuard(database: AppDatabase, runtimeRoot: string): Promise<InstanceGuard>`; `assertOwned()`/`release()` assíncronos                                 | Sergio          |
| `backend/src/integrations/ci/client.ts`      | `triggerPipeline(input: PipelineInput): Promise<PipelineReference>`; `reconcilePipeline(executionId: string): Promise<PipelineResult>`                              | Lucas/Amadeu    |
| `backend/src/integrations/kiro/report.ts`    | `parseRunReport(value: unknown, expected: ReportIdentity): RunReport`                                                                                               | Lucas           |
| `backend/src/integrations/github/publish.ts` | `publishValidated(input: PublishInput): Promise<PullRequestReference>`; `reconcileDelivery(deliveryId: string): Promise<ReconciliationResult>`                      | Amadeu          |
| `backend/src/services/executionService.ts`   | `startExecution(input: StartExecutionInput): Promise<StartExecutionResult>`                                                                                         | Sergio          |
| `backend/src/executor/runExecution.ts`       | `runExecution(executionId: string, dependencies: ExecutionDependencies): Promise<void>`                                                                             | Sergio          |
| `backend/src/executor/recovery.ts`           | `recoverInterruptedExecutions(database: AppDatabase, guard: InstanceGuard): Promise<number>`                                                                        | Sergio          |
| `backend/src/trpc/router.ts`                 | Exporta `AppRouter` sem iniciar servidor/banco                                                                                                                      | Felipe + Sergio |

Tipos operacionais em `backend/src/executor/types.ts`: `CommandInput` contém executable/args/cwd/timeout/env mínimo/callback de saída; `CommandResult` contém exitCode/signal/timedOut/durationMs e referências filtradas; `Workspace` contém caminho e SHA de origem; `ChangePolicy` contém fase/caminhos/limites e manifesto de testes; `DiffSummary` contém paths/linhas/hash. `ValidationResult` normaliza total/passed/failed/errors/failedTests.

`ConfiguredCommand` e `TargetSystemConfig` vêm do schema de configuração. `WorkflowInput` contém execução, workflowRef, snapshot do ticket/configuração, branch e contexto; `WorkflowReference` contém ID e URL externos. `ReportIdentity` contém execução/fase/rodada. `PublishInput` inclui entrega/execução/workspace/validated SHA/corpo factual; `ReconciliationResult` discrimina `not_published`, `publish_pending`, `confirmed`, `blocked`, com SHAs e identidade. Entradas/saídas do serviço de execução correspondem à tabela de API do design. `InstanceGuard` invalida posse em perda de conexão, sem continuar com reconexão silenciosa.

### Arquivos e validação por tarefa

Caminhos nesta tabela são entregáveis futuros. Requisitos completos continuam na lista original acima.

| Tarefa | Dono proposto   | Arquivos principais                                                                                     | Verificação que permite revisão                                                                    |
| ------ | --------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1      | Felipe          | `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, pacotes e lockfile                         | Tipos/scripts resolvem sem `any`                                                                   |
| 2      | Sergio          | `config/resolva.config.example.json`, `backend/src/config/{project,environment}.ts`, `.env.example`     | `..`, symlink externo, comando livre e limites inválidos recusados                                 |
| 3      | Felipe          | `docker-compose.yml`                                                                                    | Config válido, healthcheck/volume/bind local                                                       |
| 4      | Felipe          | `backend/src/db/{index,schema,migrate}.ts`, `backend/drizzle/0000_init.sql`                             | Oito tabelas, incluindo perfis de sistema-alvo, triagens, FKs e índices em banco descartável       |
| 5      | Felipe          | `backend/src/domain/{ticket,contracts}.ts`                                                              | Limites, estados e confirmações humanas                                                            |
| 6      | Felipe/Sergio   | `backend/src/repository/{ticket,execution,delivery}Repository.ts`                                       | Rollback atômico; versão; snapshot imutável; unicidades                                            |
| 7      | Felipe          | `backend/src/services/ticketService.ts`, `backend/src/trpc/routers/tickets.ts`                          | Busca literal, paginação, erros e complementação                                                   |
| 8      | Sergio          | `backend/src/services/executionService.ts`, `backend/src/trpc/routers/{implementations,environment}.ts` | Reserva concorrente, configuração do ticket, replay da chave original e disparo da pipeline        |
| 9      | Felipe          | `backend/src/{main,server,logger}.ts`                                                                   | Host/Origin locais, healthcheck e erro público                                                     |
| 10     | Sergio          | `backend/src/executor/{instanceGuard,recovery}.ts`                                                      | Perda do lock impede publicar; recuperação sem repetição                                           |
| 11     | Sergio          | `backend/src/executor/{process,processSupervisor}.ts`                                                   | Timeout/morte do pai encerram grupo real em Linux                                                  |
| 12     | Sergio          | `backend/src/executor/artifacts.ts`, repositories de eventos                                            | Cursor crescente, limites e segredo fictício filtrado                                              |
| 13     | Sergio          | `backend/src/executor/validation.ts`                                                                    | Distinguir asserção de erro de compilação/runner/zero testes                                       |
| 14     | Lucas           | `backend/src/integrations/kiro/{client,report,events,prompts,profile}.ts`                               | JSONL fragmentado; relatório inválido; permissão por fase                                          |
| 15     | Sergio          | `backend/src/executor/runExecution.ts`                                                                  | Ordem real, teste congelado e ausência de quarta correção                                          |
| 16     | Sergio          | `backend/src/executor/workspace.ts`                                                                     | Diff de adições/remoções/renomes, caminhos e SHA limpo                                             |
| 17     | Amadeu          | `backend/src/integrations/ci/client.ts`, `backend/src/integrations/github/client.ts`                    | Pipeline com variáveis validadas, credencial só no processo autorizado e branch/commit controlados |
| 18     | Amadeu          | `backend/src/integrations/github/publish.ts`                                                            | Callback/resposta perdida reconcilia; consulta confirma branch/marcador/SHA e vincula PR ao ticket |
| 19     | Sergio/Amadeu   | `executionService.ts`, `runExecution.ts`, `deliveryRepository.ts`                                       | Ajuste preserva PR; reabertura após merge cria nova entrega                                        |
| 20     | Larissa         | `web/src/index.css`, componentes/layout e `web/src/trpc.ts`                                             | Teclado/tokens e bundle sem runtime secreto                                                        |
| 21     | Larissa         | `web/src/routes/tickets/{index,new}.tsx`, detalhes                                                      | Campos, busca, versão conflitante e erros acessíveis                                               |
| 22     | Larissa         | `web/src/routes/tickets/$ticketId.tsx`                                                                  | Complementar sem IA; tipo de ajuste; confirmações e reabertura                                     |
| 23     | Larissa         | `web/src/routes/executions/{index,$executionId}.tsx`                                                    | Cursor, lote final, rede falha e reabrir página                                                    |
| 24     | Larissa         | `web/src/routes/settings.tsx`                                                                           | Pendências sem bloquear cadastro; nenhum token                                                     |
| 25     | Lucas           | `examples/demo-target/{src/orders/total.ts,tests/total.test.ts,docs/rules.md}`                          | Baseline passa com bug deliberado ainda não coberto                                                |
| 26     | Felipe + donos  | Testes de domínio, repositories e routers                                                               | Entradas/estados/versões e transações                                                              |
| 27     | Amadeu + donos  | Integrações PostgreSQL/Git/recuperação                                                                  | Concorrência/idempotência/falha parcial em recursos descartáveis                                   |
| 28     | Sergio          | `backend/src/executor/*.test.ts` e `*.integration.test.ts`                                              | Processos Linux reais e comandos falsos no orquestrador                                            |
| 29     | Lucas/Amadeu    | Fixtures CI/GitHub/Kiro e adaptadores falsos                                                            | Suíte sem conta/modelo/rede; nenhuma pipeline ou PR real                                           |
| 30     | Equipe/Larissa  | `README.md`, `.kiro/specs/resolva-mvp/docs/{demo,operations,kiro-compatibility}.md`                     | Instruções executadas, cenários e limitações                                                       |
| 31     | Amadeu + equipe | Relatório de evidência filtrado e matriz de rastreabilidade                                             | Testes/checks e ensaio real separados; pendências declaradas                                       |

### Ciclos de implementação e aceite

Todos os passos abaixo são futuros. Testes de cada componente pertencem à mesma entrega do código; tarefas 26–29 não autorizam deixá-los para o fim. Executar primeiro o teste significativo e observar falha de comportamento/ausência da implementação, implementar e reexecutar. Não fabricar falha de ferramenta como teste vermelho de negócio.

#### E1 — fundação e tickets (1, 3–7, 9, 26)

- [x] Escrever `backend/src/db/schema.integration.test.ts`: sete tabelas (contrato v2), FKs, requestKey única e índice de uma execução; reconexão mantém registros.
- [ ] Escrever `backend/src/domain/ticket.test.ts` e `backend/src/trpc/tickets.test.ts`: limites exatos e um caractere fora, categoria desconhecida, estado inválido, R19 do requirements, resposta sem execução e `NOT_FOUND`.
- [ ] Escrever `backend/src/repository/ticketRepository.integration.test.ts`: duas edições versão 1 com um sucesso/um conflito, rollback e busca literal `%`/`_`/barra.
- [ ] Observar falhas, implementar os contratos/arquivos da tabela e ligar servidor/routers sem efeitos colaterais no import.
- [ ] Verificar `docker compose config --quiet`, testes unitários/integração pertinentes e `pnpm --filter backend exec tsc --noEmit`; commit `feat: implementa fundação e tickets` em PRs pequenos por entrega.

#### E2 — infraestrutura do executor (2, 10–13, 16, 27–28)

- [ ] Escrever `project.test.ts`, `workspace.test.ts` e `validation.test.ts`: caminhos externos/symlinks/remoções, teste existente alterado, teste novo já verde, zero testes, compilação, asserção e JSON inválido.
- [ ] Escrever `process.integration.test.ts`: timeout e morte forçada do pai encerram filho e neto; limite de saída falha; token fictício não persiste.
- [ ] Escrever `instanceGuard.integration.test.ts`: segundo dono recusado; perda/conexão substituída bloqueia publicação; recuperação espera encerramento e não sinaliza PID reaproveitado.
- [ ] Confirmar falhas, implementar supervisor Linux, travas, workspace, manifesto/hashes e parser Vitest por fixtures reais. Fix não toca teste/configuração; stage só paths aprovados.
- [ ] Rodar casos anteriores e integração descartável; commit `feat: prepara executor e validação verificável`.

#### E3 — adaptadores independentes (14, 17–18, 29)

- [ ] Lucas escreve `report.test.ts`, `events.test.ts`, `client.test.ts`: identidade errada, relatório acima de 64 KiB, callback repetido, resposta inválida, fragmentos JSONL/Unicode e evento desconhecido.
- [ ] Amadeu escreve `pipeline.test.ts`, `mergeRequest.test.ts`, `github.integration.test.ts`: pipeline disparada sem PR, resposta perdida, PR fechada/integrada, SHA divergente e marcador do corpo.
- [ ] Confirmar falhas; implementar adaptadores com dependências injetadas e pipeline/GitHub falsos. Nenhum teste publica pipeline ou PR real.
- [ ] Exigir callback válido, identidade completa e SHA coerente para concluir a execução; reexecutar os testes/tipos.
- [ ] PRs/commits separados: `feat: integra pipeline e Kiro` e `feat: publica e reconcilia Pull Requests`.

#### E4 — orquestração e recuperação (6, 8, 15, 19, 27–28)

- [ ] Escrever `executionRepository.integration.test.ts`: dois tickets concorrentes geram uma reserva; replay de chave devolve mesmo ID mesmo com versão posterior; chave de outro ticket recusa.
- [ ] Escrever `runExecution.test.ts`: configuração inválida não dispara pipeline; asserção antecede fix; terceira falha termina; SHA divergente não confirma PR; perguntas mudam estado; sem alterações no teste congelado.
- [ ] Acrescentar cenários `review_behavior`/`review_refinement`, checkpoint anterior ao disparo, resposta perdida reconciliada sem nova pipeline, PR fechada bloqueada, reabertura pós-merge com nova entrega e recovery sem repetição.
- [ ] Observar falhas, implementar `ExecutionDependencies`, repositories/serviço/rotina e transações finais. Iniciar em background somente após commit; tratar rejeições e indisponibilidade do banco.
- [ ] Rodar unitários, integração de reserva e tipos; commit `feat: orquestra execuções e preserva histórico`.

#### E5 — interface (20–24)

- [ ] Escrever `web/src/routes/tickets/ticketFlow.test.tsx`: cadastro, validação, conflito, complementação sem disparo e resolução/reabertura.
- [ ] Escrever `web/src/routes/executions/executionFlow.test.tsx`: mesma requestKey em retry HTTP, evento sem duplicação, término com mais de 200 eventos pendentes, rede falha e reabrir página.
- [ ] Observar falhas, implementar rotas/tokens e consumir somente contratos públicos; mostrar ajuste classificado, reprodução preservada e PR confirmado.
- [ ] Rodar `pnpm --filter web test`, `pnpm --filter web build`; conferir teclado/foco e os dois tamanhos do design; commit `feat: disponibiliza operação visual do Resolva`.

#### E6 — demonstração e operação (25, 30–31)

- [ ] Preparar fixture e documentação; executar baseline verde com bug conhecido antes do teste que Kiro acrescentará.
- [ ] Executar cenário real configurado pelo produto; registrar teste vermelho/verde, modelo, SHA e PR confirmado. Revisão, merge e verificação ficam com pessoas.
- [ ] Demonstrar informação insuficiente, ajuste e persistência após reinício; ensaiar publicação parcial/quedas em recursos de teste e identificar a natureza de cada evidência.
- [ ] Executar `pnpm --filter backend test`, `pnpm --filter backend test:integration`, `pnpm --filter backend build`, `pnpm --filter web test`, `pnpm --filter web build`, `pnpm lint`, `pnpm format:check` e `git diff --check`, após existir cada script.
- [ ] Registrar comandos/resultados reais e pendências R01–R37/Q01–Q10. Atualizar `README.md` na raiz, `.kiro/specs/resolva-mvp/README.md` e documentos de operação na spec; commit `docs: registra operação e evidências do piloto`.

### Sequência refinada e pontos de revisão

Gate 0 pode ocorrer em paralelo à fundação. E1 e E2 estabilizam tipos/infraestrutura; E3 começa após os contratos do runner/workspace de E2; E4 integra E1–E3. E5 pode iniciar com tipos/fakes, mas só termina contra API real. E6 prepara fixture cedo e conclui após integração e validação do valor do produto.

Foco de revisão: replay de chave com versão alterada; confirmação de PR após resposta perdida; relatório legítimo sem dados de teste quando há pergunta; compilação diferente de asserção; processos órfãos/perda de lock; consulta final de todos os eventos. Cada classe tem caso explícito acima.

A proposta original não executou tarefas; o estado atual está no início deste documento e em `docs/fundacao.md`. Integração real exige repositório alvo separado, pipeline GitHub, modelo/credencial Kiro e credencial de disparo. A ausência desses itens é pendência explícita, sem impedir testes locais com fakes. Depois da revisão deste pacote, a implementação pode seguir estas entregas; este pedido documental não inicia execução paga ou correção de sistemas externos.

### Contratos adicionais de triagem

- `backend/src/domain/triage.ts`: `classifyTriage(input: TriageEvidence): TriageDecision`, `isTriageValid(triage, ticket): boolean` e `canStartImplementation(ticket, triage, environment): EligibilityResult`.
- `backend/src/services/triageService.ts`: `startTriage(input: StartTriageInput): Promise<TriageStartResult>`, persistência da mensagem e invalidação por versão.
- `backend/src/services/implementationService.ts`: `queueImplementations(filter): Promise<ImplementationQueue>`, `startImplementation(input): Promise<StartImplementationResult>`.
- `backend/src/integrations/kiro/triagePrompt.ts`: prompt de leitura e relatório das cinco classificações, sem permissões de edição ou publicação.
- `backend/src/integrations/kiro/report.ts`: validar `kind`, `classification`, fontes, referências, perguntas, critérios, hashes e identidade do ticket/versão.
- `web/src/routes/tickets/$ticketId/triage.tsx` e `web/src/routes/implementations/index.tsx`: conclusão persistida, contestação, fila, elegibilidade e início manual.

A triagem deve ser testável sem Kiro pago e sem pipeline/PR real. O início de implementação deve aceitar somente uma triagem válida e idempotente para a mesma intenção; qualquer divergência retorna erro público e registra o motivo no histórico.
