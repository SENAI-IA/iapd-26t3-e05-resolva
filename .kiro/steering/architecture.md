---
inclusion: always
---

# Resolva — arquitetura vigente do MVP

## Limite do produto

O Resolva recebe tickets, realiza triagem baseada em evidências e, somente após início manual, dispara uma execução controlada para implementar uma correção ou melhoria no sistema-alvo configurado no ticket, executa testes, publica um Pull Request no GitHub e mantém evidências para revisão humana. O MVP é local, usa uma configuração de sistema-alvo e permite uma execução ativa por vez.

Ficam fora do MVP autenticação de usuários, múltiplos sistemas-alvo, múltiplos provedores, cadastro livre de repositórios/comandos pelo ticket, webhooks, deploy automático, merge automático, fila distribuída, alterações em dados de negócio e execução em produção. A fila de implementação é persistida, mas não é consumida automaticamente por worker ou scheduler.

## Componentes

- `web`: React/TypeScript com telas de tickets, triagem, fila, execuções e configuração.
- `backend`: Fastify, tRPC, Zod, serviços de domínio, repositories Drizzle e executor em segundo plano.
- `backend/src/domain`: estados, classificações, elegibilidade, validade de triagem e transições.
- `backend/src/executor`: fases, limites, comandos, evidências e recuperação de triagem e implementação.
- `backend/src/integrations/ci`: disparo, callback e reconciliação da pipeline.
- `backend/src/integrations/kiro`: prompts, relatórios JSON e eventos usados pela pipeline.
- `backend/src/integrations/github`: autenticação, branch, commit, Pull Request e reconciliação usando o executável local `gh`.
- PostgreSQL em Docker: configuração, tickets, triagens, eventos, execuções, fila, entregas, artefatos e snapshots sem segredos.

O frontend importa somente tipos públicos do backend. Não importa banco, configuração secreta ou executor.

## Fluxo de execução

1. Validar e persistir o ticket em `aberto`, exigindo a configuração do sistema-alvo.
2. O usuário aciona `analisar ticket`; o backend reserva uma execução de triagem, registra snapshot e muda o ticket para `em_triagem`.
3. A triagem consulta relato, comportamento esperado, regras, documentação, código e evidências autorizadas. Ela não edita código, não cria branch e não publica PR.
4. Persistir uma mensagem de triagem com classificação, justificativa, comportamento observado, regra esperada, fontes, incertezas e próxima ação.
5. `falso_positivo` e `entendimento_incorreto` mudam o ticket para `recusado`. `inconclusivo` muda para `aguardando_informacoes` ou permanece `aberto` quando aguarda revisão humana. `bug` e `melhoria` mudam para `aguardando_implementacao`.
6. O usuário decide manualmente iniciar uma implementação elegível. O backend valida classificação, triagem, configuração, critérios e exclusividade.
7. O backend inicia a execução controlada usando o `gh` instalado na máquina da aplicação. A execução chama os workflows configurados, executa o Kiro CLI headless, testes e validações, e cria o Pull Request.
8. Após callback válido com PR e SHA aprovados, mudar o ticket para `aguardando_revisao`.
9. Resolver somente após confirmação humana de merge e verificação em teste.
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

- `config/resolva.config.json`: uma configuração validada do sistema-alvo, sem credenciais versionadas.
- `tickets`: chave do sistema-alvo, snapshot/version da configuração, relato, comportamento esperado, categoria, status, versão otimista, classificação vigente e datas.
- `triages`: execução de triagem, versão do ticket e da configuração, snapshot do relato e do alvo, classificação, justificativa, comportamento observado, regra esperada, fontes, incertezas, próxima ação, hashes de contexto e validade.
- `ticket_events`: histórico imutável de estados, triagens, mensagens, complementações, contestações e decisões de implementação.
- `deliveries`: vínculo entre implementação, branch, SHA e Pull Request.
- `executions`: tipo `triage|implementation`, pipeline, snapshots sem segredo, modo, estado, diagnóstico, rodada, SHAs e versão do Kiro.
- `execution_events`: eventos públicos ordenados por sequência.
- `artifacts`: referências a logs filtrados, diffs, relatórios e resultados de testes.

Snapshots, eventos e evidências não podem carregar credenciais, variáveis secretas ou ambiente completo de processos. Uma alteração relevante no ticket ou nos hashes das fontes invalida a triagem para implementação.

## Contratos e integrações

- Todo contrato de API é validado com Zod e exposto por tRPC.
- O endpoint REST inicial é somente `GET /rest/health`.
- Comandos de teste e integração usam executável, argumentos e `cwd` validados, com timeout e ambiente mínimo. O backend usa o executável local `gh`, sem shell, para consultar o GitHub, iniciar workflows e criar ou reconciliar Pull Requests.
- A triagem usa somente leitura e não cria branch, commit ou PR.
- A execução usa o snapshot da triagem e da configuração do ticket; o Kiro executa com as permissões locais da fase e o `gh` usa somente a autenticação configurada na máquina da aplicação.
- O relatório de negócio da execução/Kiro é JSON validado pelo backend; stdout sozinho não avança etapa.
- Credenciais do GitHub ficam somente no ambiente local protegido da aplicação; tokens não entram no ticket, snapshot ou relatório.

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

Validar caminhos, permissões, segredos, diffs, SHAs e estado do Pull Request antes de publicar. Não usar force push, rebase automático, merge automático ou publicação sem evidência. Merge, deploy e alterações em dados de produção permanecem sob responsabilidade humana.

## Fontes detalhadas

- Requisitos: `.kiro/specs/resolva-mvp/requirements.md`.
- Design: `.kiro/specs/resolva-mvp/design.md`.
- Plano de implementação: `.kiro/specs/resolva-mvp/tasks.md`.
