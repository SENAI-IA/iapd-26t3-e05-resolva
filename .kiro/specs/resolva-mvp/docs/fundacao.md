# Fundação — primeira entrega

Escopo autorizado pelo pedido de iniciar o desenvolvimento: tarefas 1 e 3,
com o servidor mínimo da tarefa 9. Referência: `../design.md` e `../tasks.md`.

## Plano de execução

- [x] Criar branch `feat/fundacao-mvp` e workspace pnpm/TypeScript estrito.
- [x] Escrever testes da API local: healthcheck, Host/Origin, 404 e erros públicos;
      observar falhas antes de registrar as rotas e os bloqueios.
- [x] Implementar `createServer()` sem iniciar servidor no import e entrada separada
      em `backend/src/main.ts`, vinculada a `127.0.0.1:3000`.
- [x] Criar entrada React/Vite, Tailwind e proxy local nas portas 5173/3000.
- [x] Criar Compose PostgreSQL com volume, healthcheck e porta local configurável.
- [x] Verificar instalação congelada, tipos, testes, lint, formatação, build e Compose.
- [x] Atualizar README, tarefas e evidências desta entrega.

## Limites e decisões

- O plano de produto existente orienta esta entrega; não há alteração de arquitetura.
- O healthcheck informa somente a disponibilidade HTTP, sem afirmar prontidão de
  banco, GitLab CI ou Kiro. Essas verificações pertencem às próximas tarefas.
- A interface inicial é apenas a entrada do aplicativo, sem dados ou ações simuladas.
- A validação completa da configuração (tarefa 2), persistência (4) e tickets (5–8)
  permanecem pendentes. Esta entrega não usa IA nem publica PRs no projeto-alvo.
- Contrato compartilhado nesta entrega: Vite encaminha `/rest` e `/trpc` para
  `127.0.0.1:3000`; API permite Host dessas portas e Origin local 5173.

## Evidências

Ambiente verificado: Node 22.23.1, pnpm 10.28.2, Docker Compose 5.6.1.
Dependências resolvidas no `pnpm-lock.yaml`.

- `pnpm install --offline --frozen-lockfile`: instalação reproduzível após o
  download inicial; lockfile atualizado e nenhuma resolução adicional.
- `pnpm --filter backend test`: 14 casos falharam contra servidor sem rotas e
  bloqueios; passaram após a implementação. A revisão independente identificou
  respostas de URL malformada anteriores aos hooks. Dois testes adicionais
  falharam, a correção usou `frameworkErrors` e a suíte passou com 16/16 casos.
- `pnpm check`: tipos de ambos os pacotes, Oxlint sem avisos, Oxfmt, testes e builds
  executados com sucesso. O pacote web aceita ausência de testes por conter apenas
  uma entrada estática; não há evidência de fluxo de tickets nesta entrega.
- `docker compose --env-file .env.example config --quiet`: configuração válida;
  inspeção da configuração normalizada confirmou loopback, porta 5433,
  volume nomeado e healthcheck. O contêiner não foi iniciado nesta entrega.
- `pnpm dev`: ambos os processos iniciaram nas portas previstas. HTTP real via
  Vite em `/rest/health` retornou 200 e `{"status":"ok"}`; origem externa na API
  retornou 403 com mensagem pública.
- Chrome headless: a aplicação React renderizou o título e a informação de
  desenvolvimento sem depender de serviços externos.
- `git diff --check`: sem erros de whitespace.

A sandbox exige permissão para gravar referências Git, baixar dependências e
iniciar sockets. As verificações usaram Node 22 e pnpm instalados fora do PATH
inicial do terminal, sem alterar a configuração global do usuário.

Próxima entrega: configuração validada com Zod (2), schema e migrações (4),
seguidos por domínio e cadastro persistente de tickets (5–7). Gate 0 do Kiro
permanece pendente; nenhuma IA externa foi invocada.
