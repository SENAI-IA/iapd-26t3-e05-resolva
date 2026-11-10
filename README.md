# Resolva

**Plataforma de engenharia de software assistida por IA.**

O Resolva transforma tickets técnicos em Pull Requests revisáveis. A plataforma coordena triagem baseada em evidências, encaminhamento manual, implementação, validação determinística e publicação controlada, mantendo a decisão final com a equipe de engenharia.

## Proposta de valor

O Resolva reduz o trabalho operacional entre o relato de um defeito e uma mudança pronta para revisão. O produto conecta contexto, evidência de reprodução, teste de regressão, validação do diff e entrega no GitHub em um fluxo auditável.

O público inicial são equipes de engenharia que precisam acelerar correções de baixo risco sem abrir mão de escopo controlado, testes verificáveis, rastreabilidade e aprovação humana.

## Estado do projeto

**Tickets e conclusões de triagem persistidos no PostgreSQL e consultáveis por API.** O backend mantém histórico e controle de versão dos tickets, com ações de complementação, contestação, resolução e reabertura. A triagem classifica evidências estruturadas e mantém as conclusões anteriores. A execução real da triagem depende da integração com o Kiro. Interface, fila de implementação e integração GitHub permanecem pendentes.

## Fluxo previsto

1. Cadastrar um ticket com o relato, comportamento esperado e contexto disponível.
2. Analisar o ticket com a IA em modo somente leitura.
3. Classificar a solicitação como falso positivo, entendimento incorreto, bug, melhoria ou inconclusiva.
4. Explicar a conclusão no próprio ticket e, quando elegível, colocar bug ou melhoria na fila persistida.
5. Iniciar manualmente a implementação de uma solicitação elegível.
6. Reproduzir o bug ou validar os critérios da melhoria, implementar, testar e abrir ou atualizar o Pull Request.
7. Revisar, fazer merge, verificar a correção em teste e encerrar o ticket manualmente.

Cadastro, triagem, complementação e classificação não iniciam implementação automaticamente. Informações insuficientes, contradições, falhas e impedimentos ficam registrados no histórico do ticket e de suas execuções.

## Stack definida

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, Radix UI, Lucide e TanStack.
- **Backend:** Node.js, TypeScript, Fastify, tRPC e Zod.
- **Banco:** PostgreSQL em Docker, com volume persistente.
- **Persistência:** Drizzle ORM e migrações com Drizzle Kit.
- **IA:** Kiro CLI headless.
- **Testes:** Vitest e Testcontainers.
- **Ferramentas:** pnpm, Oxlint e Oxfmt.

O frontend seguirá uma identidade visual própria, adaptada ao domínio do Resolva.

## Como executar

Pré-requisitos desta entrega: **Node.js 22 (mínimo 22.12)**, **pnpm 10.28.2** e **Docker com Compose** para iniciar o PostgreSQL. O mínimo de Node acompanha a [compatibilidade do Vite](https://vite.dev/guide/).

```bash
nvm use
corepack enable
corepack prepare pnpm@10.28.2 --activate
pnpm install --frozen-lockfile
cp .env.example .env
# Edite .env e escolha uma senha local antes de iniciar o banco.
pnpm db:up
pnpm db:migrate
pnpm dev
```

A interface abre em `http://127.0.0.1:5173`. A API escuta em `http://127.0.0.1:3000`; `GET /rest/health` devolve `{"status":"ok"}`. O Vite encaminha `/rest` e `/trpc` para a API. Host e Origin são restritos ao ambiente local, com headers de proxy desabilitados conforme a [configuração do Fastify](https://fastify.dev/docs/latest/Reference/Server/#trustproxy).

O healthcheck confirma somente a disponibilidade HTTP. A interface e o healthcheck podem rodar sem PostgreSQL, Kiro ou credencial GitHub. Para usar tickets, configure `DATABASE_URL`, inicie o banco e aplique as migrações. Sem `DATABASE_URL`, as procedures retornam `PRECONDITION_FAILED`; falhas de conexão retornam erro público, sem detalhes internos. Os scripts de desenvolvimento e execução leem o `.env` da raiz. O PostgreSQL fica disponível em `127.0.0.1:5433`; altere `POSTGRES_PORT` e o mesmo valor em `DATABASE_URL` no `.env` se necessário. Após criar o volume, mudanças de usuário/senha no `.env` não alteram as credenciais já inicializadas pelo PostgreSQL.

`pnpm db:migrate` lê o `.env` da raiz e aplica as migrações versionadas, sem executá-las automaticamente ao iniciar a API. O schema inclui tickets, triagens, histórico, execuções, entregas e artefatos. Importar os módulos de banco não abre conexões. Para gerar outra migração após alterar `backend/src/db/schema.ts`, use `pnpm db:generate` e revise o SQL gerado antes de aplicar. Esse fluxo usa [geração e aplicação explícitas de migrações Drizzle](https://orm.drizzle.team/docs/migrations).

Para parar o banco preservando os dados, execute `pnpm db:down`. O volume nomeado é mantido; não use `docker compose down -v` se quiser preservá-lo.

```bash
pnpm check          # tipos, lint, formatação, testes e build
pnpm test:integration  # PostgreSQL descartável; exige Docker disponível
pnpm format        # aplica a formatação
pnpm --filter backend start  # inicia a API compilada após pnpm build
docker compose --env-file .env.example config --quiet
```

Os testes unitários verificam o servidor HTTP, os contratos de campos, as transições humanas, as cinco classificações de triagem, a validade por versão/hashes, a elegibilidade de bugs e melhorias e os validadores de configuração, sem IA nem banco. Os testes de integração usam [PostgreSQL via Testcontainers](https://github.com/testcontainers/testcontainers-node/blob/main/docs/modules/postgresql.md), com porta aleatória e recursos descartáveis; não leem `DATABASE_URL` do operador nem usam o volume da demonstração. Cobrem concorrência, rollback, busca literal, invalidação de triagem e as rotas tRPC por HTTP. O primeiro uso pode baixar imagens Docker. O pacote web ainda não possui testes de comportamento; seu script aceita a ausência de testes enquanto contém apenas a entrada estática. A verificação do Compose valida a configuração, sem iniciar o contêiner.

## API de tickets

As procedures disponíveis em `/trpc` são `tickets.create`, `list`, `byId`, `update`, `events`, `provideInformation`, `contestTriage`, `resolve` e `reopen`. Consultas usam GET e mutações usam POST. Nenhuma dessas ações chama IA, abre PR ou altera status arbitrariamente.

Com o banco migrado e a API iniciada, é possível cadastrar e listar:

```bash
curl -sS http://127.0.0.1:3000/trpc/tickets.create \
  -H 'Content-Type: application/json' \
  --data '{"title":"Quantidade incorreta","description":"O total ignora a quantidade informada.","expectedBehavior":"Multiplicar o preço pela quantidade.","category":"calculo"}'

curl -sS http://127.0.0.1:3000/trpc/tickets.list
```

A criação devolve ID, código `RES-001`, estado `aberto` e versão 1 em `result.data`. Cada mutação de ticket existente exige `ticketId` e `expectedVersion`; respostas `CONFLICT` exigem atualizar os dados antes de repetir a decisão. A edição é permitida em `aberto` ou `aguardando_informacoes`; mudanças relevantes invalidam a triagem anterior sem apagar sua conclusão.

Listas aceitam `page`, `pageSize` (máximo 50), `q`, `status` e `category`. A busca trata `%`, `_` e barra literalmente. `byId` devolve ticket e resumos de execução/entrega; `events` devolve histórico paginado. Datas são ISO UTC, e snapshots internos não são enviados nesses resumos.

Complementação exige `aguardando_informacoes` e contestação exige recusa com triagem vinculada. Resolver exige `aguardando_revisao`, `mergeConfirmed: true` e `testVerified: true`. Reabrir exige justificativa em `message`. O estado de revisão e os ajustes de PR dependem do fluxo de implementação.

## Regras de triagem

O domínio classifica evidências estruturadas e confere a versão do ticket e os hashes das fontes. Bugs precisam de plano de regressão. Melhorias precisam de escopo, critérios e plano de testes. A decisão permanece separada do início manual. [Regras de domínio da triagem](.kiro/specs/resolva-mvp/docs/triagem-dominio.md).

`triages.byId({ triageId })` consulta a conclusão e `triages.list` aceita filtros por ticket, classificação e validade, com paginação. `triages.start({ ticketId, expectedVersion, requestKey })` devolve `triageExecutionId` quando há um executor ligado. Repetir a chave da mesma intenção recupera a execução original, inclusive após mudanças no ticket. A configuração padrão devolve `PRECONDITION_FAILED` para novos inícios enquanto o supervisor e o ensaio autenticado do Kiro estão pendentes.

Cada reserva grava o snapshot da versão analisada, incluindo complementos e contestações ligados à conclusão original. Um conflito de concorrência informa `activeExecutionId` quando há outra execução ativa. A conclusão registra mensagem, fontes, hashes e critérios, e atualiza a triagem vigente na mesma transação. Se a análise falhar tecnicamente, o ticket volta a `aberto` e mantém o histórico. Os testes de integração usam um executor falso para verificar esse fluxo via HTTP e PostgreSQL.

O adaptador de triagem prepara um workspace descartável, gera o perfil Kiro V3 para as fontes selecionadas e valida o relatório antes da persistência. A integração HTTP usa um processo simulado em testes. [Compatibilidade e ensaio do Kiro](.kiro/specs/resolva-mvp/docs/kiro-compatibility.md).

## Configuração do projeto-alvo

A configuração de IA é opcional nesta fase. Copie `config/resolva.config.example.json` para `resolva.config.json` na raiz e ajuste repositório, branch, modelo explícito e comandos quando houver um alvo separado. O exemplo espera um checkout em `targets/demo-target`; esse diretório e a configuração local são ignorados pelo Git. `RESOLVA_CONFIG_PATH` permite selecionar outro arquivo.

Os caminhos são relativos ao arquivo de configuração. `allowedPaths`, `testPaths` e `documentationPaths` são diretórios dentro do alvo, sem caminhos absolutos, `..` ou globs. Testes devem ficar sob os diretórios permitidos inclusive após resolver symlinks; metadados Git, credenciais e configurações de agentes não são caminhos de escrita válidos. Workspaces e artefatos ficam fora do alvo, sem sobreposição. O carregamento verifica symlinks e os comandos devem ser objetos com executável, argumentos e `cwd`, sem strings de shell. `{reportPath}` é reservado ao backend para gerar o caminho dos relatórios de teste.

`parseProjectConfig` valida a estrutura e os limites; `loadProjectConfig` acrescenta as verificações no sistema de arquivos. O carregamento não executa comandos. A existência da branch e a revalidação imediatamente antes dos efeitos serão responsabilidade do adaptador Git e do executor nas próximas entregas. Na inicialização, a API utiliza as categorias do arquivo estruturalmente válido; arquivo ausente ou inválido utiliza as categorias padrão com aviso para arquivo inválido. A ausência do checkout ou das credenciais de IA não impede CRUD. Reinicie a API após alterar o catálogo. As demais opções ainda não iniciam execuções.

A operação completa futura exige Kiro CLI autenticado, um repositório-alvo controlado e acesso ao GitHub para publicar branches e abrir Pull Requests. Frontend, backend e Kiro rodam no host; somente o PostgreSQL fica no Docker.

Credenciais devem ser configuradas localmente e não devem ser versionadas.

## Documentação

- [PRD do produto](.kiro/specs/resolva-mvp/PRD.md).
- [Avaliação de viabilidade, riscos e estimativa](.kiro/specs/resolva-mvp/docs/viabilidade.md).
- [Divisão do trabalho e marcos propostos](.kiro/specs/resolva-mvp/docs/divisao-trabalho.md).
- [Rastreabilidade de requisitos, tarefas e evidências](.kiro/specs/resolva-mvp/docs/rastreabilidade.md).
- [Planejamento de skills e guardrails](.kiro/specs/resolva-mvp/docs/planejamento-skills.md).

A configuração nativa do Kiro IDE fica em `.kiro/`:

- [Regras ativas do projeto](.kiro/steering/project-rules.md).
- [Arquitetura vigente](.kiro/steering/architecture.md).
- [Requisitos do MVP](.kiro/specs/resolva-mvp/requirements.md).
- [Design do MVP](.kiro/specs/resolva-mvp/design.md).
- [Plano de implementação](.kiro/specs/resolva-mvp/tasks.md).
