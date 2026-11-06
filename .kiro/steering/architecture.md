---
inclusion: always
---

# Resolva — arquitetura vigente do MVP

## Limite do produto

O Resolva recebe tickets, realiza triagem baseada em evidências e, somente após início manual, implementa uma correção ou melhoria, executa testes, publica um Pull Request e mantém evidências para revisão humana. O MVP é local, usa um projeto-alvo confiável e permite uma execução ativa por vez.

Ficam fora do MVP autenticação de usuários, webhooks, deploy automático, merge automático, múltiplos projetos, fila distribuída, alterações em dados de negócio e execução em produção. A fila de implementação é persistida, mas não é consumida automaticamente por worker ou scheduler.

## Componentes

- `web`: React/TypeScript com telas de tickets, triagem, fila, execuções e configuração.
- `backend`: Fastify, tRPC, Zod, serviços de domínio, repositories Drizzle e executor em segundo plano.
- `backend/src/domain`: estados, classificações, elegibilidade, validade de triagem e transições.
- `backend/src/executor`: fases, limites, comandos, evidências e recuperação de triagem e implementação.
- `backend/src/integrations/kiro`: subprocesso headless, prompts, relatórios JSON e eventos.
- `backend/src/integrations/github`: Git, `gh`, branches, PRs e reconciliação.
- PostgreSQL em Docker: tickets, triagens, eventos, execuções, fila, entregas, artefatos e snapshots sem segredos.

O frontend importa somente tipos públicos do backend. Não importa banco, configuração secreta ou executor.

## Fluxo de execução

1. Validar e persistir o ticket em `aberto`.
2. O usuário aciona `analisar ticket`; o backend reserva uma execução de triagem, registra snapshot e muda o ticket para `em_triagem`.
3. A triagem consulta relato, comportamento esperado, regras, documentação, código e evidências autorizadas. Ela não edita código, não cria branch e não publica PR.
4. Persistir uma mensagem de triagem com classificação, justificativa, comportamento observado, regra esperada, fontes, incertezas e próxima ação.
5. `falso_positivo` e `entendimento_incorreto` mudam o ticket para `recusado`. `inconclusivo` muda para `aguardando_informacoes` ou permanece `aberto` quando aguarda revisão humana. `bug` e `melhoria` mudam para `aguardando_implementacao`.
6. O usuário decide manualmente iniciar uma implementação elegível. O backend valida classificação, triagem vinculada à versão atual, critérios, configuração e exclusividade.
7. A implementação prepara workspace e baseline, executa regressão/validação, usa até três rodadas de correção, valida diff e SHA, e publica ou reconcilia o PR.
8. Após confirmar o PR, mudar o ticket para `aguardando_revisao`.
9. Resolver somente após confirmação humana de merge e verificação em teste.

Não conseguir reproduzir, por si só, não classifica o ticket como falso positivo. Falta ou contradição de documentação exige informação ou revisão humana.

## Estados públicos

Tickets: `aberto`, `em_triagem`, `recusado`, `aguardando_informacoes`, `aguardando_implementacao`, `em_andamento`, `aguardando_revisao`, `resolvido`.

Classificações: `falso_positivo`, `entendimento_incorreto`, `bug`, `melhoria`, `inconclusivo`.

Execuções: `em_andamento`, `bloqueada`, `falhou`, `concluida`, `interrompida`.

Etapas de triagem: `preparando_contexto`, `analisando_ticket`, `consolidando_triagem`.

Etapas de implementação: `preparando_ambiente`, `reproduzindo_problema`, `implementando_correcao`, `validando`, `publicando_pr`.

O estado do ticket, a classificação, a validade da triagem e o resultado da execução são conceitos persistidos separadamente.

## Persistência

- `tickets`: relato, comportamento esperado, categoria, status, versão otimista, classificação vigente e datas.
- `triages`: execução de triagem, versão do ticket, snapshot do relato, classificação, justificativa, comportamento observado, regra esperada, fontes, incertezas, próxima ação, hashes de contexto e validade.
- `ticket_events`: histórico imutável de estados, triagens, mensagens, complementações, contestações e decisões de implementação.
- `deliveries`: vínculo entre implementação, branch, SHAs e PR.
- `executions`: tipo `triage|implementation`, modo, snapshots sem segredo, estado, diagnóstico, rodada, SHAs e versão do Kiro.
- `execution_events`: eventos públicos ordenados por sequência.
- `artifacts`: referências a logs filtrados, diffs, relatórios e resultados de testes.

Snapshots, eventos e evidências não podem carregar credenciais, variáveis secretas ou ambiente completo de processos. Uma alteração relevante no ticket ou nos hashes das fontes invalida a triagem para implementação.

## Contratos e integrações

- Todo contrato de API é validado com Zod e exposto por tRPC.
- O endpoint REST inicial é somente `GET /rest/health`.
- Comandos Git, GitHub, testes e Kiro usam executável, argumentos e `cwd` validados, com `shell: false`, timeout e ambiente mínimo.
- A triagem usa perfil somente leitura, com verificações previamente autorizadas. Não recebe capacidade de editar código, criar branch, fazer commit, fazer push ou abrir PR.
- A implementação usa perfil de alteração restrito aos caminhos permitidos e recebe snapshot da triagem validada.
- A invocação headless usa `kiro-cli chat --v3 --no-interactive --output-format stream-json` com modelo explícito e prompt por stdin.
- O relatório de negócio do Kiro é JSON validado pelo backend; stdout sozinho não avança etapa.
- `GH_TOKEN` só existe nas chamadas de Git/GitHub. O Kiro não recebe credencial do GitHub nem `DATABASE_URL`.

## Fases do Kiro

- `triage`: leitura de ticket, regras, documentação, código e evidências; produz somente relatório de classificação.
- `analysis`: análise técnica do bug ou da melhoria após início manual; sem alteração de código.
- `regression`: cria teste de reprodução somente para `bug`; para `melhoria`, formaliza ou valida testes do comportamento novo.
- `fix`: altera código permitido somente na implementação iniciada pelo usuário.

Relatórios de triagem e implementação têm identidade, limites, referências locais e fontes verificáveis. A triagem nunca é suficiente para publicar.

## Recuperação e exclusividade

A chave idempotente identifica a intenção de analisar ou implementar. Uma execução ativa global impede conflito entre triagens e implementações. Respostas perdidas são reconciliadas antes de repetir IA ou efeitos externos.

Usar lock local e advisory lock PostgreSQL para impedir duas instâncias. Ao perder o supervisor, encerrar grupo de processos e descendentes. Na inicialização, marcar execuções remanescentes como `interrompida` somente depois de confirmar a limpeza dos processos. Não retomar triagem ou implementação automaticamente.

## Segurança e revisão

Validar caminhos, permissões, segredos, diffs, limites e SHAs antes de publicar. Não usar force push, rebase automático, merge automático ou publicação sem evidência. Merge, deploy e alterações em dados de produção permanecem sob responsabilidade humana.

## Fontes detalhadas

- Requisitos: `.kiro/specs/resolva-mvp/requirements.md`.
- Design: `.kiro/specs/resolva-mvp/design.md`.
- Plano de implementação: `.kiro/specs/resolva-mvp/tasks.md`.
