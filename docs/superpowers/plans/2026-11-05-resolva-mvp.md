# Resolva MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. A execução direta pelo implementador é a recomendação inicial para este projeto escolar; o método será confirmado antes da implementação.

**Goal:** Entregar cadastro visual de tickets e um executor Kiro headless que reproduza um bug, valide uma correção e abra ou atualize um PR real no GitHub.

**Architecture:** Monorepo `web`/`backend`, com PostgreSQL no Docker. Um backend local controla uma execução por vez, invoca o Kiro em fases, valida o commit e publica no GitHub. A interface acompanha registros persistidos com identidade visual própria.

**Tech Stack:** Node.js 22.12+, pnpm 10.32.1, TypeScript 6, React 19, Vite 8, Tailwind 4, TanStack Router/Query, Fastify 5, tRPC 11, Zod 4, PostgreSQL 17, Drizzle, Vitest, Testcontainers, Git, gh e Kiro CLI V3 headless.

**Spec:** [Desenho funcional](../specs/2026-11-05-resolva-design.md), [definição técnica](../specs/2026-11-05-resolva-technical-design.md) e [requisitos R01–R25](../../requirements.md).

## Global Constraints

- Projeto escolar local, host Linux, um projeto alvo configurado e uma execução ativa globalmente.
- Frontend, backend e Kiro no host; PostgreSQL 17 em Docker, porta local padrão 5433 e volume persistente.
- Identidade visual própria, sem importar domínio de telemetria, Azure DevOps ou GitLab.
- Tickets: `aberto`, `em_andamento`, `aguardando_informacoes`, `aguardando_revisao`, `resolvido`.
- Execuções: `em_andamento`, `bloqueada`, `falhou`, `concluida`, `interrompida`.
- Máximo padrão de três rodadas de correção por execução; timeout global padrão 1.800 segundos.
- Comandos com argumentos separados e `shell: false`; Kiro não recebe credencial GitHub ou do banco.
- Publicar somente o SHA validado; sem force push, merge automático, deploy ou alteração em dados de produção.
- Testes existentes e testes de reprodução permanecem protegidos contra edição nas fases de correção.
- Testes automatizados não fazem chamadas pagas de IA nem publicam recursos reais. O piloto real é uma validação manual separada.
- Trabalhar em branch, produzir commits convencionais em português e entregar PR para revisão; não fazer merge por conta própria.

## Review Focus

1. Dois cliques/chamadas simultâneas ou resposta HTTP perdida: uma execução por chave e reserva transacional; testes na tarefa 6.
2. JSONL fragmentado, relatório Kiro inválido ou pedido de informações legítimo: distinguir evento de transporte e resultado de negócio; testes na tarefa 4.
3. Push/PR criado com resposta perdida: recuperar a mesma entrega e seu SHA sem nova IA ou PR duplicado; testes nas tarefas 5 e 6.
4. Teste modificado para passar ou erro de compilação apresentado como reprodução: proteger suíte e exigir asserção real; testes nas tarefas 3 e 6.
5. Queda do backend, perda da conexão de lock e processos descendentes vivos: bloquear publicação, encerrar grupos e recuperar sem concorrência; testes nas tarefas 3 e 6.

---

## Estrutura e contratos compartilhados

Os campos e limites são os definidos na especificação técnica; o plano não os redefine. Cada tarefa produz arquivos pequenos e uma entrega verificável. Os nomes abaixo são os contratos de implementação.

Tipos públicos em `backend/src/domain/contracts.ts`: `Ticket`, `TicketInput`, `TicketStatus`, `ExecutionStatus`, `ExecutionStage`, `ExecutionDetail`, `RunReport`, `PublicEnvironment`, `PullRequestReference`. Derivar entradas e relatórios de schemas Zod; registros do banco são inferidos do schema Drizzle. `Ticket` inclui código derivado, versão e datas ISO. `RunReport` implementa o relatório v1 por fase/resultado.

Tipos operacionais em `backend/src/executor/types.ts`: `CommandInput`, `CommandResult`, `Workspace`, `ValidationResult`, `ExecutionDependencies`. `CommandInput` contém executável, argumentos, cwd, timeout, ambiente mínimo e callback opcional de saída; `CommandResult` contém código/sinal, timeout, duração e referências a stdout/stderr filtrados. `ValidationResult` contém total de testes, aprovados, falhos, erros de infraestrutura e testes falhos identificados.

Configuração em `backend/src/config/project.ts`: `ProjectConfig` corresponde aos campos da seção 6 da definição técnica. Os serviços recebem configuração/dependências por parâmetro para testes, em vez de ler ambiente durante importações.

### Tarefa 1: fundação executável e persistência PostgreSQL

**Files:**
- Criar `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json`, `.env.example`, `docker-compose.yml`.
- Criar `backend/package.json`, `backend/tsconfig.json`, `backend/vitest.config.ts`, `backend/vitest.integration.config.ts`, `backend/drizzle.config.ts`.
- Criar `backend/src/main.ts`, `backend/src/server.ts`, `backend/src/logger.ts`, `backend/src/db/index.ts`, `backend/src/db/schema.ts`, `backend/src/db/migrate.ts`, `backend/src/domain/contracts.ts` e `backend/drizzle/0000_init.sql`.
- Testar `backend/src/db/schema.integration.test.ts`, `backend/src/server.test.ts`.

**Interfaces:**
- Consome: tabelas, restrições e tipos da especificação técnica.
- Produz: `createDatabase(databaseUrl: string): AppDatabase`, com cliente e `close(): Promise<void>`; `runMigrations(database: AppDatabase): Promise<void>`; `buildServer(dependencies: ServerDependencies): Promise<FastifyInstance>`.
- `AppDatabase` contém a instância Drizzle tipada e o cliente PostgreSQL. `ServerDependencies` começa com banco e logger; routers são acrescentados pelas tarefas seguintes.

- [ ] Escrever o teste de migração que consulta `tickets`, insere um ticket e recusa duas execuções com status `em_andamento`; testar FKs, chave de requisição única e preservação de registros após reconectar.
- [ ] Executar `pnpm --filter backend test:integration -- src/db/schema.integration.test.ts`; após criar o mínimo de configuração de teste, esperar falha pela ausência do schema/migração.
- [ ] Implementar schema completo das seis tabelas, índices e migração; exportar tipos sem conectar ao banco ao importar contratos.
- [ ] Configurar Compose com PostgreSQL 17, healthcheck, volume e bind local 5433; registrar a tag exata no arquivo e as dependências no lockfile.
- [ ] Implementar inicialização com migração antes da API e healthcheck sem segredos; testar banco indisponível com resposta clara.
- [ ] Verificar `docker compose config --quiet`, teste de integração, `pnpm --filter backend exec tsc --noEmit` e healthcheck local. Docker é exigido para integração; teste não deve usar o banco da demonstração.
- [ ] Commit: `chore: prepara aplicação e persistência PostgreSQL`.

**Entrega:** backend inicializa com banco migrado e healthcheck; persistência real disponível para as próximas tarefas. Não criar configuração de IA ficticiamente funcional.

### Tarefa 2: tickets, estados, histórico e API

**Files:**
- Criar `backend/src/domain/ticket.ts`, `backend/src/domain/ticket.test.ts`, `backend/src/repository/ticketRepository.ts`, `backend/src/services/ticketService.ts`.
- Criar `backend/src/trpc/trpc.ts`, `backend/src/trpc/router.ts`, `backend/src/trpc/routers/tickets.ts`.
- Testar `backend/src/repository/ticketRepository.integration.test.ts` e `backend/src/trpc/tickets.test.ts`.
- Modificar `backend/src/server.ts` para registrar `/trpc`.

**Interfaces:**
- Consome: `AppDatabase`, schema e contratos da tarefa 1.
- Produz: `createTicketService(database: AppDatabase, categories: readonly Category[]): TicketService`; `Category = { id: string; label: string }`.
- `TicketService` oferece `create`, `list`, `byId`, `update`, `events`, `provideInformation`, `requestChanges`, `resolve`, `reopen`, com entradas/saídas da tabela da API. Exportar `AppRouter` sem inicializar servidor.
- Produz: `transitionTicket(current: TicketStatus, action: TicketAction): TicketStatus`; `TicketAction` é a união das ações da seção 4 técnica.

- [ ] Escrever testes para limites exatos, trim, categoria inválida, estado inválido e versão antiga. Exemplos: resolver sem ambas as confirmações é recusado; `provideInformation` volta a `aberto` sem criar execução; `reopen` exige justificativa.
- [ ] Rodar `pnpm --filter backend test -- src/domain/ticket.test.ts src/trpc/tickets.test.ts` e confirmar falhas antes da implementação.
- [ ] Implementar transições puras, repositories transacionais e serviço; cada mutação de ticket/histórico incrementa versão atomicamente e preserva snapshots anteriores.
- [ ] Expor os nove procedimentos de tickets definidos na especificação, serializando datas e recusando entradas extras. Busca deve escapar `%`, `_` e barra invertida; ordenação tem desempate por ID.
- [ ] Testar duas edições simultâneas sobre a mesma versão: exatamente uma vence. Testar paginação sem duplicação, entrada de busca com curingas e `NOT_FOUND`.
- [ ] Verificar testes unitários, `pnpm --filter backend test:integration -- src/repository/ticketRepository.integration.test.ts` e tipos.
- [ ] Commit: `feat: implementa tickets e histórico de estados`.

**Entrega:** cadastrar, consultar e operar tickets via tRPC, com todas as transições humanas testadas. Cobre R01–R04, R11, R19 e R20.

### Tarefa 3: configuração, processos, cópias de trabalho e testes

**Files:**
- Criar `config/resolva.config.example.json`, `backend/src/config/environment.ts`, `backend/src/config/project.ts`.
- Criar `backend/src/executor/types.ts`, `backend/src/executor/process.ts`, `backend/src/executor/processSupervisor.ts`, `backend/src/executor/instanceGuard.ts`, `backend/src/executor/workspace.ts`, `backend/src/executor/validation.ts`, `backend/src/executor/artifacts.ts`.
- Criar `backend/src/trpc/routers/environment.ts`; ajustar `main.ts` e router.
- Testar `backend/src/config/project.test.ts`, `backend/src/executor/process.integration.test.ts`, `backend/src/executor/workspace.test.ts`, `backend/src/executor/validation.test.ts`, `backend/src/executor/instanceGuard.integration.test.ts`.

**Interfaces:**
- Produz: `loadProjectConfig(path: string): ProjectConfig`; `getPublicEnvironment(): Promise<PublicEnvironment>` sem segredos; `checkEnvironment(): Promise<EnvironmentCheck>` sem chamar modelo.
- Produz: `runCommand(input: CommandInput): Promise<CommandResult>`; `createWorkspace(input: WorkspaceInput): Promise<Workspace>`; `collectValidatedDiff(workspace: Workspace, policy: ChangePolicy): Promise<DiffSummary>`; `runValidation(workspace: Workspace, commands: readonly ConfiguredCommand[]): Promise<ValidationResult>`.
- `WorkspaceInput` contém execução, configuração e branch/SHA de partida; `Workspace` inclui caminhos absolutos controlados e SHA inicial. `ChangePolicy` contém fase, caminhos, manifesto/hash dos testes protegidos e limites; `DiffSummary` lista caminhos, linhas e hash do diff.
- Produz: `acquireInstanceGuard(database: AppDatabase, runtimeRoot: string): Promise<InstanceGuard>`; `InstanceGuard.assertOwned(): Promise<void>` e `release(): Promise<void>`, com encerramento obrigatório em perda de posse.

- [ ] Escrever testes de configuração incompleta, `..`, symlink externo, timeout, limite de saída, segredo fictício e leitura de artefato por ID. Nenhum teste deve executar comandos recebidos de ticket.
- [ ] Confirmar falhas com `pnpm --filter backend test -- src/config/project.test.ts src/executor/workspace.test.ts src/executor/validation.test.ts`.
- [ ] Implementar supervisão Linux com IPC, encerramento do grupo em perda do pai e TERM/KILL em timeout; registrar identidade dos processos e aguardar limpeza antes de nova execução.
- [ ] Implementar trava local e conexão PostgreSQL de lock; simular perda/reconexão e provar que `assertOwned()` bloqueia publicação e encerra os comandos.
- [ ] Implementar clone temporário via Git com credencial fora da URL; diretórios reservados excluídos localmente do commit. Validar arquivos novos, modificados, removidos e symlinks no diff.
- [ ] Implementar leitura de relatórios Vitest JSON com fixtures: asserção falha identificada é reprodução; erro de compilação, zero testes, JSON inválido e runner inexistente são impedimentos. Congelar testes existentes e de reprodução por manifesto/hashes.
- [ ] Expor `environment.get`/`environment.check`, com categorias padrão disponíveis mesmo sem projeto alvo. Gerar exemplo dos comandos com `{reportPath}` e suas regras de substituição.
- [ ] Rodar os testes anteriores e `pnpm --filter backend test:integration -- src/executor/process.integration.test.ts src/executor/instanceGuard.integration.test.ts`; o teste de morte do pai deve provar que o descendente também encerrou.
- [ ] Commit: `feat: prepara execução local e validação de projetos`.

**Entrega:** componentes de execução verificáveis sem IA, configuração pública e detecção de pendências. Cobre R08, R09, R12, R13, R22–R24.

### Tarefa 4: adaptador Kiro e relatórios por fase

**Files:**
- Criar `backend/src/integrations/kiro/client.ts`, `backend/src/integrations/kiro/report.ts`, `backend/src/integrations/kiro/events.ts`, `backend/src/integrations/kiro/prompts.ts` e `backend/src/integrations/kiro/profile.ts`.
- Testar `backend/src/integrations/kiro/client.test.ts`, `backend/src/integrations/kiro/report.test.ts`, `backend/src/integrations/kiro/events.test.ts`; fixtures em `backend/src/integrations/kiro/fixtures/`.
- Documentar o teste manual de compatibilidade em `docs/kiro-compatibility.md`.

**Interfaces:**
- Consome: `ProjectConfig`, `runCommand`, `Workspace` e `RunReport`.
- Produz: `runKiroPhase(input: KiroPhaseInput): Promise<RunReport>`; `KiroPhaseInput` contém ID da execução, fase, rodada, workspace, snapshot do ticket, diagnóstico, referências de reprodução, resultados anteriores e limites.
- Produz: `parseRunReport(value: unknown, expected: ReportIdentity): RunReport`; `ReportIdentity` contém ID/fase/rodada esperados. `decodeKiroEvents(chunks: AsyncIterable<string>): AsyncIterable<PublicRunEvent>` lida com JSONL fragmentado sem presumir fronteiras de chunk iguais às de linha.

- [ ] Escrever casos de relatório válido, fase/ID errado, mais de 64 KiB, path externo, ausência de referências em `ready` e `needs_information` em reprodução sem teste inventado.
- [ ] Escrever teste com linhas divididas entre chunks, múltiplas linhas num chunk, Unicode parcial, evento desconhecido e término interrompido; eventos não podem concluir o fluxo por conta própria.
- [ ] Rodar `pnpm --filter backend test -- src/integrations/kiro` e observar falhas antes de implementar.
- [ ] Implementar prompts em constantes TypeScript, comando headless V3 com stdin e perfil de leitura/edição por fase; excluir GitHub/banco do ambiente e negar shell/MCP/subagentes/web.
- [ ] Validar relatório salvo no caminho reservado; exit code 0 sem relatório válido continua sendo falha. Emitir somente eventos públicos permitidos e filtrados, sem persistir raciocínio interno.
- [ ] Verificar os testes com runner de processo falso; não chamar modelo na suíte. Documentar um ensaio manual curto para capturar fixtures reais, verificar permissões de leitura/escrita e recusa de shell na versão instalada.
- [ ] Commit: `feat: integra Kiro headless com relatórios verificáveis`.

**Entrega:** adaptador testável, protocolo de negócio v1 e procedimento de compatibilidade. Compatibilidade real só é marcada como verificada após o ensaio com credencial configurada. Cobre R10, R12, R24.

### Tarefa 5: entrega GitHub e recuperação de publicação

**Files:**
- Criar `backend/src/repository/deliveryRepository.ts`, `backend/src/integrations/github/client.ts`, `backend/src/integrations/github/publish.ts`, `backend/src/integrations/github/prBody.ts`.
- Testar `backend/src/integrations/github/publish.test.ts`, `backend/src/integrations/github/prBody.test.ts` e `backend/src/integrations/github/git.integration.test.ts`.

**Interfaces:**
- Consome: `runCommand`, `Workspace`, `AppDatabase`, `InstanceGuard` e checkpoints da execução.
- Produz: `reconcileDelivery(deliveryId: string): Promise<ReconciliationResult>`; resultados `not_published`, `publish_pending`, `confirmed`, `blocked`, sempre com entrega e SHAs pertinentes.
- Produz: `publishValidated(input: PublishInput): Promise<PullRequestReference>`; `PublishInput` contém ID da execução/entrega, workspace, SHA validado e dados factuais do corpo. `PullRequestReference` contém número, URL, branch, head SHA e estado `open`, `closed` ou `merged`.
- Produz: `buildPullRequestBody(input: PullRequestBodyInput): string`, com ticket, diagnóstico, referências, resultados de comandos, SHA e marcador da entrega.

- [ ] Escrever casos de publicação inicial, PR existente, branch já publicada sem PR, resposta perdida após criar PR, estado fechado/integrado, SHA remoto divergente e SHA local diferente do validado.
- [ ] Rodar `pnpm --filter backend test -- src/integrations/github` e confirmar falhas.
- [ ] Implementar checkpoints antes/depois dos efeitos externos, consulta por branch/marcador e confirmação da identidade do PR; execuções de retry reutilizam a entrega pendente mesmo sem URL conhecida.
- [ ] Implementar push sem force e recusa de conflito remoto. Usar apenas arquivos do diff aprovado no commit e corpo por arquivo temporário; nenhuma credencial na URL ou logs.
- [ ] Simular `gh` e rede nos testes de aplicação. Usar um repositório bare temporário para testar Git real, com refs e conflito, sem publicar no GitHub.
- [ ] Verificar teste unitário, `pnpm --filter backend test:integration -- src/integrations/github/git.integration.test.ts` e tipos.
- [ ] Commit: `feat: publica PRs com reconciliação de entregas`.

**Entrega:** publicação e recuperação idempotentes, sem depender de IA. Cobre R15–R18 e R24.

### Tarefa 6: fluxo completo, reserva e API de execuções

**Files:**
- Criar `backend/src/repository/executionRepository.ts`, `backend/src/services/executionService.ts`, `backend/src/executor/runExecution.ts`, `backend/src/executor/recovery.ts`, `backend/src/trpc/routers/executions.ts`.
- Testar `backend/src/executor/runExecution.test.ts`, `backend/src/repository/executionRepository.integration.test.ts`, `backend/src/trpc/executions.test.ts`.
- Modificar `main.ts`, `trpc/router.ts` e serviços de tickets para conectar resultados do executor.

**Interfaces:**
- Consome: serviços de tickets e todos os adaptadores das tarefas 3–5, via `ExecutionDependencies`.
- Produz: `startExecution(input: StartExecutionInput): Promise<StartExecutionResult>`, com ticket, versão e chave UUID; resultado contém ID/ticket/status.
- Produz: `runExecution(executionId: string, dependencies: ExecutionDependencies): Promise<void>`; `recoverInterruptedExecutions(database: AppDatabase, guard: InstanceGuard): Promise<number>`.
- Repositories expõem `reserveExecution`, `appendExecutionEvent`, `completeExecution`, `getExecution`, `listExecutions`, `listExecutionEvents`, `getArtifact`, com inputs/outputs dos contratos públicos e aplicação transacional das mudanças de ticket/execução.

- [ ] Testar duas reservas simultâneas de tickets distintos: uma vence, outra recebe conflito, sem ticket parcialmente alterado. Mesma chave/ticket devolve o mesmo ID mesmo se versão ou configuração mudarem depois; chave de outro ticket é recusada.
- [ ] Confirmar falhas com testes unitários e integração da reserva antes de implementar o serviço.
- [ ] Implementar reserva transacional, início em segundo plano após commit e tratamento de todas as rejeições; processo HTTP devolve o ID sem esperar a IA.
- [ ] Implementar sequência preparação → análise → reprodução → correção → validação → publicação, com no máximo três rodadas, mudanças transacionais e artefatos. Verificar commit limpo e SHA final validado.
- [ ] Implementar `review_behavior` com novo teste e `review_refinement` com reprodução anterior vinculada e suíte preservada. Registrar etapa herdada explicitamente; não simular eventos de teste que não rodaram.
- [ ] Reconciliar entrega pendente antes de chamar IA. Se commit remoto validado já existir, concluir publicação/recuperar PR; sem evidência, bloquear.
- [ ] Testar baseline inválida, teste já passando, teste antigo modificado, relatório ilegítimo, falta de informações, terceira rodada falhando, perda de lock e recuperação. Falhas não chegam ao publicador.
- [ ] Expor os cinco procedimentos `executions.*` da especificação, incluindo lote de eventos com cursor e leitura de artefato por vínculo; execução ativa é informada por `environment.get`.
- [ ] Verificar `pnpm --filter backend test -- src/executor/runExecution.test.ts src/trpc/executions.test.ts` e `pnpm --filter backend test:integration -- src/repository/executionRepository.integration.test.ts`. Usar adaptadores falsos com contadores para comprovar zero publicações/chamadas extras.
- [ ] Commit: `feat: coordena o fluxo do ticket ao PR`.

**Entrega:** fluxo completo testado sem serviços pagos, incluindo interrupções e ajustes. Cobre R05–R18 e R21–R25.

### Tarefa 7: frontend adaptado e operação visual

**Files:**
- Criar `web/package.json`, `web/index.html`, `web/vite.config.ts`, `web/tsconfig.json`, `web/tsconfig.app.json`, `web/vitest.config.ts`.
- Criar `web/src/main.tsx`, `web/src/router.tsx`, `web/src/trpc.ts`, `web/src/index.css` e `web/src/lib/`.
- Criar componentes de layout e interface próprios em `web/src/components/layout/` e `web/src/components/ui/`.
- Criar rotas `web/src/routes/tickets/index.tsx`, `web/src/routes/tickets/new.tsx`, `web/src/routes/tickets/$ticketId.tsx`, `web/src/routes/executions/index.tsx`, `web/src/routes/executions/$executionId.tsx`, `web/src/routes/settings.tsx` e raiz/redirect inicial para `/tickets`.
- Testar `web/src/routes/tickets/ticketFlow.test.tsx` e `web/src/routes/executions/executionFlow.test.tsx`.

**Interfaces:**
- Consome: `AppRouter` e tipos públicos, rotas e ações definidos na especificação; importa apenas tipos do backend.
- Produz: aplicação navegável com Tickets, Execuções e Configuração, acessando somente os endpoints do Resolva.

- [ ] Testar fluxo do formulário, erro de versão, ação de complementação sem disparo automático, confirmação de resolução e escolha obrigatória do tipo de ajuste.
- [ ] Rodar `pnpm --filter web test` e confirmar as falhas antes de construir as telas correspondentes.
- [ ] Criar a identidade visual, fontes e componentes usados; retirar autenticação Google, integrações antigas e imports de domínios externos. Usar tokens definidos no CSS do projeto.
- [ ] Implementar as seis telas e todas as ações humanas da API; mostrar o motivo de ações indisponíveis e campos com erros acessíveis.
- [ ] Implementar polling 3s/5s com cursor, consulta final até esgotar eventos e interrupção ao terminar. Testar resposta final com mais de um lote de eventos e retorno após reabrir página.
- [ ] Manter `requestKey` estável nas repetições da mesma intenção e renovar em nova tentativa. Exibir falha de conexão e histórico preservado; nunca mostrar dados fictícios como execução real.
- [ ] Verificar testes, `pnpm --filter web build`, navegação por teclado e layout em 1366×768 e 390×844; executar os estados vazio, ativo, bloqueado, falho e PR pronto.
- [ ] Commit: `feat: adapta interface para tickets e execuções do Resolva`.

**Entrega:** aplicação operável pela interface, com identidade visual própria e dados reais do backend. Cobre R01–R08, R10–R11, R17, R19–R21 e R24.

### Tarefa 8: fixture, demonstração real e documentação de operação

**Files:**
- Criar `examples/demo-target/package.json`, `examples/demo-target/src/orders/total.ts`, `examples/demo-target/tests/total.test.ts`, `examples/demo-target/tests/regressions/.gitkeep`, `examples/demo-target/docs/rules.md` e configuração Vitest.
- Criar `docs/demo.md`, `docs/operations.md`; atualizar README, exemplo de configuração e `.env.example`.

**Interfaces:**
- Consome: aplicação das tarefas anteriores e credenciais/repositório de demonstração configurados pelo operador.
- Produz: cenário de bug conhecido e roteiro reproduzível, com evidências reais vinculadas ao ticket e ao PR.

- [ ] Criar fixture com bug de quantidade documentado e testes iniciais aprovados sem a cobertura do caso `2 × 1000 + 1 × 500 = 2500` centavos. A ausência deliberada dessa cobertura é parte do cenário de demonstração, não uma correção da aplicação Resolva.
- [ ] Verificar instalação, preparação e adaptador Vitest com a fixture local antes de configurar GitHub/IA.
- [ ] Documentar comandos: `docker compose up -d postgres`, `pnpm install --frozen-lockfile`, `pnpm --filter backend db:migrate`, `pnpm --filter backend dev` e `pnpm --filter web dev`; confirmar que correspondem aos scripts entregues.
- [ ] Configurar o repositório alvo de demonstração e executar o ensaio de compatibilidade Kiro, registrando versão, modelo, permissões e fixtures de eventos. Nunca registrar credenciais. Se faltar acesso, manter esta verificação explicitamente pendente.
- [ ] Cadastrar o bug pela interface, iniciar a execução e conferir teste vermelho/verde, SHA e PR reais. O operador faz revisão/merge e registra resolução. Demonstrar separadamente informação insuficiente e ajuste de refinamento no PR aberto.
- [ ] Executar verificações finais: `pnpm --filter backend test`, `pnpm --filter backend test:integration`, `pnpm --filter web test`, `pnpm --filter web build`, `pnpm --filter backend build`, `pnpm lint`, `pnpm format:check` e `git diff --check`.
- [ ] Registrar os resultados reais e as pendências de R01–R25. Não marcar sucesso do piloto apenas porque mocks passaram. Entregar branch/PR para revisão humana.
- [ ] Commit: `docs: registra operação e evidências da demonstração`.

**Entrega:** demonstração real e documentação utilizável pelo grupo. Cobre R01, R09–R25 e persistência após reinicialização.

## Dependências e ponto de parada

Ordem de execução proposta: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. As tarefas 1–7 podem avançar com recursos locais e integrações falsas nos testes. A tarefa 8 exige repositório alvo, modelo/credencial Kiro e credencial GitHub válidos; a falta desses dados impede afirmar conclusão do fluxo real, mas não impede construir a aplicação.

Esta entrega contém somente definições e plano. Antes de iniciar código, revisar estes artefatos e escolher execução direta ou por subagentes. Pela dimensão escolar e interfaces compartilhadas, a recomendação é execução direta nesta sessão, seguindo as tarefas e suas verificações.

## Auto-revisão do plano

- Cobertura funcional: cadastro/estados/histórico nas tarefas 1–2; ambiente/processos/testes na 3; IA na 4; publicação na 5; fluxo/recuperação na 6; telas na 7; validação real na 8.
- Tipos e interfaces: nomes públicos centralizados, tipos operacionais na tarefa 3 e contratos de integração nas tarefas 4–5; não importar runtime do backend no frontend.
- Review Focus: os cinco grupos de falha possuem testes nomeados nas respectivas tarefas.
- Proporção: sem serviços distribuídos, autenticação corporativa, edição visual de credenciais ou automação de produção. O supervisor e as travas existem para preservar o limite de uma execução local.
- Pendências externas explicitadas: projeto alvo e credenciais do piloto, além da modalidade acadêmica de entrega; nenhuma apresentada como já verificada.
