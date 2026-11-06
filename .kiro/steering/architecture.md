---
inclusion: always
---

# Resolva — arquitetura vigente do MVP

## Limite do produto

O Resolva cadastra tickets, coordena uma investigação de código com Kiro CLI headless, executa testes, publica um Pull Request real e mantém evidências para revisão humana. O MVP é local, usa um projeto alvo confiável e permite uma execução ativa por vez.

Ficam fora do MVP autenticação de usuários, webhooks, deploy automático, merge automático, múltiplos projetos, fila distribuída, alterações em dados de negócio e execução em produção.

## Componentes

- `web`: React/TypeScript com as telas de tickets, execuções e configuração.
- `backend`: Fastify, tRPC, Zod, serviços de domínio, repositories Drizzle e executor em segundo plano.
- `backend/src/executor`: fases, limites, comandos, evidências e recuperação de execuções.
- `backend/src/integrations/kiro`: subprocesso headless, prompts, relatórios JSON e eventos.
- `backend/src/integrations/github`: Git, `gh`, branches, PRs e reconciliação.
- PostgreSQL em Docker: tickets, eventos, execuções, entregas, artefatos e snapshots sem segredos.

O frontend importa somente tipos públicos do backend. Não importar banco, configuração secreta ou executor no frontend.

## Fluxo de execução

1. Validar o ticket e reservar a execução em uma transação.
2. Verificar configuração, integrações, cópia de trabalho e baseline de testes.
3. Invocar o Kiro nas fases `analysis`, `regression` e `fix`.
4. Validar relatório estruturado, caminhos alterados, teste de regressão e comandos configurados.
5. Repetir a correção no máximo três vezes quando a validação falhar.
6. Validar o diff e o SHA do commit em árvore limpa.
7. Publicar ou reconciliar a branch e o PR sem sobrescrever mudanças remotas.
8. Mudar o ticket para `aguardando_revisao` somente após confirmar o PR.
9. Resolver o ticket apenas após confirmação humana de merge e verificação em teste.

## Estados públicos

Tickets: `aberto`, `em_andamento`, `aguardando_informacoes`, `aguardando_revisao`, `resolvido`.

Execuções: `em_andamento`, `bloqueada`, `falhou`, `concluida`, `interrompida`.

Etapas: `preparando_ambiente`, `analisando_ticket`, `reproduzindo_problema`, `implementando_correcao`, `validando`, `publicando_pr`.

## Persistência

- `tickets`: relato, status e versão otimista.
- `ticket_events`: histórico imutável de mudanças e ações.
- `deliveries`: vínculo entre execução, branch e PR.
- `executions`: snapshots, estado, diagnóstico, rodadas, SHAs e versão do Kiro.
- `execution_events`: eventos estruturados e ordenados por sequência.
- `artifacts`: referências a logs filtrados, diffs e resultados de testes.

Snapshots, eventos e evidências não podem carregar credenciais, variáveis secretas ou ambiente completo de processos.

## Contratos e integrações

- Todo contrato de API é validado com Zod e exposto por tRPC.
- O endpoint REST inicial é somente `GET /rest/health`.
- Comandos Git, GitHub, testes e Kiro usam executável, argumentos e `cwd` validados, com `shell: false`, timeout e ambiente mínimo.
- A invocação headless usa `kiro-cli chat --v3 --no-interactive --output-format stream-json` com modelo explícito e prompt por stdin.
- O relatório de negócio do Kiro é JSON validado pelo backend; stdout sozinho não avança a execução.
- `GH_TOKEN` só existe nas chamadas de Git/GitHub. O Kiro não recebe credencial do GitHub nem `DATABASE_URL`.

## Fontes detalhadas

- Requisitos: `.kiro/specs/resolva-mvp/requirements.md`.
- Design: `.kiro/specs/resolva-mvp/design.md`.
- Plano de implementação: `.kiro/specs/resolva-mvp/tasks.md`.
