# Resolva

**Plataforma de engenharia de software assistida por IA.**

O Resolva transforma tickets técnicos em Pull Requests revisáveis. A plataforma coordena triagem baseada em evidências, encaminhamento manual, implementação, validação determinística e publicação controlada, mantendo a decisão final com a equipe de engenharia.

## Proposta de valor

O Resolva reduz o trabalho operacional entre o relato de um defeito e uma mudança pronta para revisão. O produto conecta contexto, evidência de reprodução, teste de regressão, validação do diff e entrega no GitHub em um fluxo auditável.

O público inicial são equipes de engenharia que precisam acelerar correções de baixo risco sem abrir mão de escopo controlado, testes verificáveis, rastreabilidade e aprovação humana.

## Estado do projeto

**Desenvolvimento iniciado.** A fundação inclui workspace pnpm, entrada React/Vite, API local Fastify com healthcheck e PostgreSQL via Docker Compose. Cadastro de tickets, persistência, triagem, executor e integração GitHub permanecem em implementação futura. O fluxo ponta a ponta ainda não está disponível.

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
pnpm dev
```

A interface abre em `http://127.0.0.1:5173`. A API escuta em `http://127.0.0.1:3000`; `GET /rest/health` devolve `{"status":"ok"}`. O Vite encaminha `/rest` e `/trpc` para a API; ainda não há procedures tRPC. Host e Origin são restritos ao ambiente local, com headers de proxy desabilitados conforme a [configuração do Fastify](https://fastify.dev/docs/latest/Reference/Server/#trustproxy).

O healthcheck confirma somente a disponibilidade HTTP. A interface e a API desta entrega podem rodar sem PostgreSQL, Kiro ou credencial GitHub. O PostgreSQL fica disponível em `127.0.0.1:5433`; altere `POSTGRES_PORT` e o mesmo valor em `DATABASE_URL` no `.env` se necessário. O banco ainda não possui schema nem migrações. Após criar o volume, mudanças de usuário/senha no `.env` não alteram as credenciais já inicializadas pelo PostgreSQL.

Para parar o banco preservando os dados, execute `pnpm db:down`. O volume nomeado é mantido; não use `docker compose down -v` se quiser preservá-lo.

```bash
pnpm check          # tipos, lint, formatação, testes e build
pnpm format        # aplica a formatação
pnpm --filter backend start  # inicia a API compilada após pnpm build
docker compose --env-file .env.example config --quiet
```

Os testes atuais verificam a API via injeção HTTP do Fastify, sem IA, rede ou banco. O pacote web ainda não possui testes de comportamento; seu script aceita a ausência de testes enquanto contém apenas a entrada estática. A verificação do Compose valida a configuração, sem iniciar o contêiner.

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
