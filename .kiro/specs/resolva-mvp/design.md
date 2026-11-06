# Resolva — design do MVP

## Objetivo e limites

O sistema terá um frontend próprio, um backend local e PostgreSQL em Docker. O backend coordena tickets, execuções e evidências. O Kiro CLI é um subprocesso controlado para investigação e edição; o backend mantém os comandos de preparação, testes, Git e GitHub.

A primeira demonstração usa `examples/demo-target`, um bug conhecido de cálculo em centavos e um teste de regressão executável. O projeto alvo deve ficar separado da aplicação Resolva.

## Arquitetura

```text
web (React + tRPC)
        |
backend (Fastify + serviços + executor)
        |-- PostgreSQL / Drizzle
        |-- Kiro CLI headless
        |-- Git + gh / GitHub
```

Organização prevista:

```text
backend/src/
  config/             ambiente e resolva.config.json
  db/                 conexão, schema e migrações
  domain/             estados, validações e contratos
  repository/         transações e consultas
  services/           tickets e coordenação
  trpc/routers/       tickets, execuções e ambiente
  executor/           fases, limites, processos e evidências
  integrations/kiro/  subprocesso, prompts, relatórios e eventos
  integrations/github/branch, commit, PR e reconciliação
web/src/
  components/         layout e componentes reutilizáveis
  routes/              tickets, execuções e configuração
  trpc.ts             cliente tipado
examples/demo-target/ fixture independente do piloto
config/               exemplo sem credenciais
```

O frontend importa somente `AppRouter` e tipos públicos. Não importa banco, executor ou configuração secreta.

## Domínio e persistência

Estados de ticket: `aberto`, `em_andamento`, `aguardando_informacoes`, `aguardando_revisao`, `resolvido`.

Estados de execução: `em_andamento`, `bloqueada`, `falhou`, `concluida`, `interrompida`.

Etapas: `preparando_ambiente`, `analisando_ticket`, `reproduzindo_problema`, `implementando_correcao`, `validando`, `publicando_pr`.

Tabelas:

- `tickets`: relato, categoria, status, versão otimista e datas.
- `ticket_events`: histórico imutável de estados, informações, ajustes e resolução.
- `deliveries`: agrupamento da entrega, branch, SHAs e PR.
- `executions`: snapshots sem segredo, estado, diagnóstico, rodada, SHAs e versão do Kiro.
- `execution_events`: eventos públicos ordenados por sequência.
- `artifacts`: referências a logs filtrados, diffs e resultados de testes.

Usar UUID para entidades internas, número inteiro para ticket e identificador visual `RES-001`. Usar `timestamptz` no banco e ISO 8601 UTC na API. Não excluir tickets nem históricos. Usar transação e índice único parcial para garantir uma execução ativa globalmente.

## Contratos de API

Todos os inputs e outputs são schemas Zod sem campos extras silenciosos. A API usa tRPC, com `GET /rest/health` apenas para healthcheck.

Procedures mínimas:

- `tickets.create`, `tickets.list`, `tickets.byId`, `tickets.update`, `tickets.events`.
- `tickets.provideInformation`, `tickets.requestChanges`, `tickets.resolve`, `tickets.reopen`.
- `executions.start`, `executions.list`, `executions.byId`, `executions.events`, `executions.artifact`.
- `environment.get`, `environment.check`.

Erros públicos: `BAD_REQUEST`, `NOT_FOUND`, `CONFLICT`, `PRECONDITION_FAILED` e `INTERNAL_SERVER_ERROR`. Nunca devolver stack trace, credenciais ou saída bruta não filtrada.

## Configuração segura

O arquivo `resolva.config.json` fica ignorado pelo Git. Versionar apenas `config/resolva.config.example.json`. Validar com Zod:

- repositório e branch base;
- `allowedPaths`, `testPaths` e `documentationPaths` relativos à raiz;
- categorias;
- comandos de preparação e validação como executável, argumentos e `cwd`;
- adaptador de testes e caminho de relatório;
- modelo explícito do Kiro;
- limites de rodadas, tempo e tamanho do diff.

Recusar caminhos absolutos, `..`, symlinks que escapem da raiz, glob global e comandos derivados do ticket. Variáveis previstas: `DATABASE_URL`, `POSTGRES_*`, `KIRO_API_KEY`, `GH_TOKEN` e `RESOLVA_CONFIG_PATH`. Segredos não entram em snapshots, ambiente completo, logs, prompts, navegador ou Kiro.

## Executor e Kiro

O executor é uma rotina em segundo plano com uma execução ativa global. Cada execução recebe workspace e diretório de artefatos próprios. Os subprocessos usam `spawn`, `shell: false`, argumentos separados, ambiente mínimo, timeout e captura limitada.

Invocação base:

```text
kiro-cli chat --v3 --no-interactive --output-format stream-json --agent resolva-worker --model <modelo>
```

O prompt vai por stdin. O backend captura eventos JSONL, mas só aceita resultado de negócio em relatório JSON reservado por fase. As fases são `analysis`, `regression` e `fix`.

O relatório exige `schemaVersion`, identidade da execução/fase/rodada, `outcome`, resumo, diagnóstico, referências locais, perguntas quando aplicável e dados do teste de regressão. O backend valida tamanho, caminhos, fase, execução e código de saída. Saída textual não comprova sucesso.

Permissões do perfil do executor: leitura restrita, escrita somente nos caminhos da fase, sem shell, MCP, subagentes ou web. A reprodução altera apenas teste permitido e relatório. A correção não altera nem remove testes existentes ou o teste que comprovou o problema.

## Validação e publicação

1. Registrar manifesto de testes, baseline e commit inicial.
2. Bloquear se preparação, compilação ou testes iniciais falharem.
3. Solicitar diagnóstico com referências verificáveis.
4. Solicitar reprodução com asserção nova falhando.
5. Preservar hash dos testes de reprodução.
6. Solicitar correção e executar regressão mais validação completa.
7. Permitir no máximo três rodadas de correção.
8. Conferir caminhos, arquivos sensíveis, limites do diff e mudança real.
9. Criar commit, validar SHA com árvore limpa e só então publicar.
10. Reconciliar branch/PR antes de repetir publicação.

Branch: `resolva/res-<id>-<prefixo-da-execucao>`.

PR: título `[RES-001] Corrige <resumo>`, marcador `resolva-delivery:<uuid>`, relato, diagnóstico, testes, SHA validado e limitações.

Nunca usar force push, rebase automático, merge automático ou publicação sem evidência. Divergência de SHA remoto gera `remote_conflict` e exige intervenção humana.

## Recuperação e observabilidade

Persistir eventos com sequência, comandos, códigos de saída, etapas, evidências e impedimentos filtrados. O frontend consulta estado a cada 3 segundos e eventos a cada 5 segundos durante execução, usando cursor e sem duplicar eventos.

Usar lock local e advisory lock PostgreSQL para impedir duas instâncias. Ao perder o supervisor, encerrar grupo de processos e descendentes. Na inicialização, marcar execuções remanescentes como `interrompida` apenas depois de confirmar a limpeza dos processos. Não retomar comandos automaticamente.

## Interface

Rotas: `/tickets`, `/tickets/new`, `/tickets/$ticketId`, `/executions`, `/executions/$executionId` e `/settings`.

A interface mostra relato, próxima ação, histórico, etapas, diagnóstico, testes, arquivos, logs filtrados, PR e impedimentos. O cadastro continua disponível quando o ambiente estiver incompleto. Ações indisponíveis mostram motivo e também são recusadas no backend. Manter acessibilidade, foco, teclado, estados vazios e identidade visual do Resolva.

## Decisões preservadas

- PostgreSQL em Docker e frontend/backend no host.
- Uma execução ativa global no MVP.
- Kiro CLI headless em vez de agente próprio.
- GitHub real para branch e PR, com merge humano.
- Sem autenticação de usuário no MVP local.
- Sem armazenamento de raciocínio interno do modelo.
