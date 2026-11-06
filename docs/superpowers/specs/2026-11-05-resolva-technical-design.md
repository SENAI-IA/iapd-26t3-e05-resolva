# Resolva — definição técnica do MVP

Status: definição técnica para revisão, sem implementação da aplicação. As decisões abaixo complementam o desenho funcional e são propostas técnicas do implementador, dentro do escopo já escolhido pelo usuário.

Referência funcional: [desenho do Resolva](2026-11-05-resolva-design.md). Equipe: **IAPD-26T3-E05**. Repositório: **SENAI-IA/iapd-26t3-e05-resolva**.

## 1. Decisões de arquitetura

- Monorepo pnpm com `web` e `backend`. React/TypeScript/Vite/Tailwind no frontend; Node.js/TypeScript/Fastify/tRPC/Zod no backend; PostgreSQL 17 em Docker e Drizzle para persistência e migrações.
- Frontend e API locais, vinculados a `127.0.0.1`; portas padrão `5173` e `3000`. Vite encaminha `/trpc` e `/rest` ao backend. Sem autenticação de usuários no MVP local.
- Um processo de backend, um executor em segundo plano e uma execução ativa globalmente. Não há fila de espera, Redis, serviço de worker independente ou agendamento de correções.
- O backend permanece responsável pelos comandos de preparação, testes, Git e GitHub. O Kiro é chamado como subprocesso, em fases específicas de leitura e edição.
- Integração GitHub por `git` e `gh` executados com argumentos separados. Credencial configurada no servidor via `GH_TOKEN`; nada depende da identidade da pessoa com a página aberta.
- Configuração de um projeto alvo por arquivo local `resolva.config.json`, validado por Zod. Segredos vêm do ambiente. O banco armazena snapshots sem segredos, não um cadastro de múltiplos projetos.
- Linux como plataforma de referência para o executor do MVP, incluindo encerramento de subprocessos. O frontend funciona no navegador; executar o backend em outras plataformas exige validar o controle de processos.

## 2. Organização dos arquivos

```text
backend/
  src/
    main.ts                     inicialização, migrações e recuperação de execuções
    server.ts                   Fastify, tRPC e healthcheck
    config/                     ambiente e configuração do projeto alvo
    db/                         schema Drizzle, conexão e migrações
    domain/                     estados, validações e contratos compartilhados
    repository/                 transações e consultas PostgreSQL
    services/                   regras dos tickets e coordenação das execuções
    trpc/routers/               tickets, execuções e ambiente
    executor/                   fases, comandos, evidências e recuperação
    integrations/kiro/          processo headless, prompts, relatórios e eventos
    integrations/github/        publicação e reconciliação de PRs
  drizzle/                      migrações versionadas
web/
  src/
    components/layout/          estrutura da aplicação
    components/ui/              componentes reutilizáveis
    routes/                     tickets, execuções e configuração
    trpc.ts                     cliente tipado do backend do Resolva
examples/demo-target/           projeto local de exemplo para preparação do piloto
config/                         exemplo de configuração sem credenciais
docs/                           requisitos, decisões e roteiro de apresentação
```

`backend` exporta `AppRouter` e tipos públicos sem efeitos colaterais de conexão. O frontend importa esses tipos com `import type`; jamais importa cliente de banco, configuração secreta ou módulos do executor.

## 3. Modelo de dados

Datas são `timestamptz`, produzidas pelo servidor e expostas em ISO 8601 UTC. A interface apresenta horário local. IDs de tickets são inteiros positivos; demais IDs são UUID. O identificador visual é derivado do número: `RES-001`, `RES-002`, continuando naturalmente após `RES-999`.

| Tabela | Campos e função |
| --- | --- |
| `tickets` | `id`, `title`, `description`, `expected_behavior`, `reproduction_steps`, `category`, `status`, `version`, `created_at`, `updated_at`, `resolved_at`. `version` começa em 1 e permite detectar edição concorrente. |
| `ticket_events` | `id`, `ticket_id`, `type`, `from_status`, `to_status`, `message`, `payload`, `created_at`. Registra criação, edição, pedidos/respostas de informação, ajustes, resolução e reabertura. |
| `deliveries` | `id`, `ticket_id`, `number`, `first_execution_id`, `repository`, `base_branch`, `branch_name`, `base_sha`, `remote_head_sha`, `pr_number`, `pr_url`, `pr_state`, `created_at`, `updated_at`. Agrupa as execuções que produzem ou atualizam o mesmo PR. |
| `executions` | `id`, `ticket_id`, `delivery_id`, `previous_execution_id`, `reproduction_execution_id`, `request_key`, `mode`, `status`, `stage`, `round`, `ticket_snapshot`, `config_snapshot`, `diagnosis`, `blocker_code`, `blocker_message`, `base_sha`, `validated_sha`, `published_sha`, `kiro_version`, `kiro_model`, `started_at`, `completed_at`. |
| `execution_events` | `id`, `execution_id`, `sequence`, `type`, `stage`, `message`, `payload`, `created_at`. Eventos estruturados e cronológicos, incluindo resultados dos comandos e mudanças de etapa. |
| `artifacts` | `id`, `execution_id`, `kind`, `relative_path`, `content_type`, `size_bytes`, `sha256`, `created_at`. Aponta para logs filtrados, diff e resultados dos testes no diretório local de artefatos. |

`payload`, `ticket_snapshot` e `config_snapshot` são JSONB com validação Zod antes da escrita e da leitura pública. Arquivos grandes não entram no JSONB. `previous_execution_id` e `first_execution_id` são referências vinculadas após criar os registros na mesma transação, evitando dependência circular na inserção.

Restrições: FKs sem exclusão em cascata do histórico, `unique(ticket_id, number)` em entregas, `unique(request_key)` em execuções, `unique(execution_id, sequence)` nos eventos e branch única por repositório. Não há exclusão de tickets no MVP.

Para garantir uma execução ativa inclusive diante de chamadas simultâneas, criar índice parcial PostgreSQL: `CREATE UNIQUE INDEX executions_one_active ON executions ((1)) WHERE status = 'em_andamento'`. A transação de início bloqueia o ticket, verifica estado/versão, cria execução e evento e atualiza o ticket; uma violação do índice retorna conflito e desfaz toda a transação.

Não persistir tokens, variáveis secretas, chave Kiro, credencial de banco ou ambiente completo dos processos. Depois da criação, snapshots e eventos são imutáveis; o resultado e o estado da execução são atualizados por transições condicionais.

## 4. Contratos de entrada e ações do ticket

Campos textuais recebem trim. Limites: título 5–140 caracteres; descrição 20–10.000; comportamento esperado 10–5.000; passos de reprodução até 10.000; observações e respostas 1–10.000. Categorias são os identificadores permitidos pela configuração; padrões iniciais: `validacao_entrada`, `regra_negocio`, `calculo`.

Estados do ticket: `aberto`, `em_andamento`, `aguardando_informacoes`, `aguardando_revisao`, `resolvido`. Estados da execução: `em_andamento`, `bloqueada`, `falhou`, `concluida`, `interrompida`. São contratos públicos e valores persistidos, conforme o desenho funcional.

| Ação | Estado permitido | Resultado |
| --- | --- | --- |
| Criar | — | `aberto`, versão 1 e evento de criação |
| Editar conteúdo | `aberto` ou `aguardando_informacoes` | Incrementa versão; não muda estado e preserva snapshots anteriores |
| Complementar informações | `aguardando_informacoes` | Registra resposta, volta a `aberto` e incrementa versão; iniciar a IA é uma ação posterior explícita |
| Iniciar análise | `aberto` | Reserva execução e muda para `em_andamento` |
| Pedir esclarecimento | Execução ativa | Finaliza execução como `bloqueada` e muda ticket para `aguardando_informacoes` |
| Finalizar com PR confirmado | Execução ativa | Execução `concluida` e ticket `aguardando_revisao` |
| Falhar, interromper ou bloquear por outro motivo | Execução ativa | Finaliza a execução e devolve o ticket a `aberto`, preservando o impedimento |
| Solicitar ajustes | `aguardando_revisao` | Registra observações e volta a `aberto`; a próxima execução atualiza a entrega existente |
| Resolver | `aguardando_revisao` | Operador confirma merge e verificação em teste; muda para `resolvido` |
| Reabrir | `resolvido` | Exige justificativa e volta a `aberto`; a entrega anterior é preservada |

Não editar relato enquanto existe execução ativa. Toda ação que altera um ticket existente exige `expectedVersion`; divergência retorna `CONFLICT`, sem sobrescrever alterações. O histórico usa o operador local único, sem inventar atribuição a uma conta GitHub ou usuário autenticado.

## 5. API tRPC e consultas da interface

Todos os contratos são Zod, sem campos extras aceitos silenciosamente. Datas saem como strings ISO; listas retornam `{ items, total, page, pageSize }`, com página inicial 1 e tamanho padrão 15, máximo 50. Ordenação é estável, por data decrescente e ID como desempate. IDs inexistentes retornam `NOT_FOUND`.

| Procedimento | Entrada | Saída e comportamento |
| --- | --- | --- |
| `tickets.create` | Conteúdo validado do formulário | Ticket criado |
| `tickets.list` | `page?`, `pageSize?`, `q?`, `status?`, `category?` | Lista paginada; busca literal por código, título ou descrição, sem tratar `%` e `_` como curingas |
| `tickets.byId` | `ticketId` | Ticket, última execução e resumo da entrega atual |
| `tickets.update` | `ticketId`, `expectedVersion`, conteúdo | Ticket atualizado |
| `tickets.events` | `ticketId`, `page?`, `pageSize?` | Histórico paginado do ticket |
| `tickets.provideInformation` | `ticketId`, `expectedVersion`, `message` | Ticket aberto e resposta registrada |
| `tickets.requestChanges` | `ticketId`, `expectedVersion`, `kind: behavior \| refinement`, `message` | Pedido de ajuste classificado pelo operador e ticket aberto |
| `tickets.resolve` | `ticketId`, `expectedVersion`, `mergeConfirmed: true`, `testVerified: true`, `message?` | Resolução manual registrada; não executa merge |
| `tickets.reopen` | `ticketId`, `expectedVersion`, `message` | Reabertura com justificativa |
| `executions.start` | `ticketId`, `expectedVersion`, `requestKey` UUID | `{ executionId, ticketId, status }`; devolve a mesma execução se a mesma chave já existir para esse ticket |
| `executions.list` | `ticketId?`, `status?`, `page?`, `pageSize?` | Histórico global ou por ticket |
| `executions.byId` | `executionId` | Estado, etapa, diagnóstico, bloqueio, evidências resumidas e PR |
| `executions.events` | `executionId`, `afterSequence?`, `limit?` | `{ items, nextSequence, hasMore }`, lote padrão 100 e máximo 200, em ordem crescente |
| `executions.artifact` | `executionId`, `artifactId` | Texto filtrado de um artefato daquela execução, até 1 MiB; não recebe caminho arbitrário |
| `environment.get` | — | Configuração pública, categorias, limites, disponibilidade das ferramentas e execução ativa |
| `environment.check` | — | Verifica PostgreSQL, binários, versão suportada e acesso de leitura ao repositório; não chama modelo nem cria branches ou PRs |

Erros de entrada usam `BAD_REQUEST`; estado/versão/concorrrência usam `CONFLICT`; ambiente incompleto usa `PRECONDITION_FAILED`; falhas inesperadas usam `INTERNAL_SERVER_ERROR` com mensagem pública e log filtrado. Não devolver stack trace ou saída bruta com credenciais.

`GET /rest/health` é o único endpoint REST necessário inicialmente e indica disponibilidade do servidor/banco. Demais operações usam `/trpc`. Uma mesma `requestKey` usada para outro ticket é rejeitada, nunca reaproveitada como autorização cruzada.

## 6. Configuração e limites

Arquivo `resolva.config.json` ignorado pelo Git; exemplo em `config/resolva.config.example.json`. Caminhos são relativos à raiz da cópia do projeto, sem caminhos absolutos, `..` ou symlinks escapando da raiz.

| Campo | Valor ou regra |
| --- | --- |
| `repository` | `owner/name` no GitHub; URL de clone HTTPS derivada, sem token na URL |
| `baseBranch` | Branch existente; explicitamente configurada e validada com Git |
| `allowedPaths` | Diretórios de código/testes/documentação alteráveis; sem padrões globais que incluam todo o projeto |
| `testPaths` | Subconjunto de `allowedPaths`, exclusivo dos testes de regressão |
| `documentationPaths` | Fontes locais legíveis do projeto alvo; sem download de documentos durante a execução |
| `categories` | Slugs e rótulos aceitos no cadastro |
| `preparationCommands` | Lista de `{ id, executable, args, cwd }` definida pelo operador |
| `validationCommands` | Lista de `{ id, executable, args, cwd, kind }`, com `kind` igual a `check` ou `test`; incluir ao menos um `test`. Comandos `test` produzem relatório estruturado no caminho `{reportPath}` dos argumentos |
| `regressionCommand` | Comando fixo de tipo `test` para os testes de regressão; o backend injeta somente o caminho gerado em `{reportPath}`, nunca comandos derivados do ticket |
| `testAdapter` | `vitest-json` no primeiro piloto; outro runner exige adaptador implementado e validado |
| `kiroModel` | ID explícito disponível na conta; não escolher silenciosamente outro modelo |
| `maxRounds` | Padrão 3, permitido 1–3 |
| `runTimeoutSeconds` | Padrão 1.800, permitido 60–3.600 |
| `commandTimeoutSeconds` | Padrão 300, limitado pelo tempo restante da execução |
| `kiroTimeoutSeconds` | Padrão 300 por chamada, limitado pelo tempo restante |
| `maxChangedFiles` / `maxChangedLines` | Padrões 20 / 1.000, incluindo adições e remoções |
| `workspaceRoot` / `artifactRoot` | Diretórios locais do Resolva, fora de qualquer repositório alvo publicado |

Os limites são decisões iniciais de implementação, não garantias de duração ou custo. Falta de configuração impede disparar IA, mas não impede cadastrar tickets, consultar histórico ou visualizar as pendências na tela Configuração.

Ambiente: `DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`, `KIRO_API_KEY`, `GH_TOKEN`, `RESOLVA_CONFIG_PATH`. Bind local fixado no MVP; portas de API e frontend configuráveis com padrões 3000/5173. O PostgreSQL usa `127.0.0.1:5433:5432`, volume nomeado e healthcheck. Node.js mínimo 22.12, compatível com os [requisitos do Vite 8](https://vite.dev/blog/announcing-vite8); pnpm 10.32.1 conforme a configuração do projeto.

## 7. Contrato do Kiro

Invocação base: `kiro-cli chat --v3 --no-interactive --output-format stream-json --agent resolva-worker --model <modelo-configurado>`, por `spawn` com `shell: false` e prompt em stdin. Registrar versão, motor, modelo e código de saída. O perfil é gerenciado pelo Resolva; as opções precisam ser verificadas no CLI instalado antes de habilitar o executor.

A integração usa três fases: `analysis`, `regression`, `fix`. Em cada fase, o backend produz uma instrução própria com snapshot do ticket, regras/documentação, diagnóstico anterior, limites, caminhos e resultados de testes pertinentes. Não há perguntas interativas: dúvidas devem retornar no relatório estruturado.

Além dos eventos do CLI, o Kiro escreve um relatório JSON no caminho reservado `.resolva/reports/<executionId>/<phase>-<round>.json` da cópia de trabalho. Esse diretório é excluído localmente da publicação e é uma exceção gerenciada à lista de edição. O backend valida JSON, tamanho máximo de 64 KiB, identidade da fase/execução, referências e caminhos. Texto de stdout, sozinho, não é resultado de negócio.

| Campo do relatório v1 | Contrato |
| --- | --- |
| `schemaVersion` | Literal `1` |
| `executionId`, `phase`, `round` | Correspondem à chamada atual; `round` 0 em análise/reprodução, 1–3 na correção |
| `outcome` | `ready`, `needs_information` ou `unsupported` |
| `summary` | Resumo de até 2.000 caracteres |
| `diagnosis` | Explicação de até 10.000 caracteres com causa e relação com o ticket |
| `references` | Até 20 itens `{ path, startLine, endLine }` locais, existentes e legíveis |
| `questions` | 1–5 perguntas concretas se `needs_information`; vazio nos demais casos |
| `regressionTestPaths` | Caminhos de teste em `testPaths`; obrigatórios para `ready` na reprodução/correção de comportamento e herdados em ajustes de refinamento |
| `expectedFailure` | Identificador/nome do teste e resumo da falha esperada; obrigatório somente em `regression` com `outcome: ready` |

`ready` exige diagnóstico e referências; não significa que o código está correto. `needs_information` bloqueia a execução e pede resposta ao usuário. `unsupported` registra ausência de correção sustentada ou escopo incompatível. Relatório ausente, inválido, incompatível com a chamada ou processo com código diferente de zero produz `falhou`, sem publicar. Não há tentativa automática de consertar JSON inválido.

Em `needs_information` ou `unsupported`, `regressionTestPaths` pode ser vazio e `expectedFailure` é ausente: não exigir que o agente invente um teste ou uma falha para registrar um impedimento legítimo. Os campos obrigatórios de reprodução dependem da combinação fase/resultado.

O adaptador transforma o JSONL do CLI em eventos internos: mensagem pública, ferramenta iniciada/finalizada, aviso e término. Não inventar nomes de campos do protocolo: capturar fixtures reais da versão instalada no teste de compatibilidade. Eventos desconhecidos não avançam etapas nem indicam sucesso; mensagens malformadas são registradas como aviso limitado, sem persistir seu corpo bruto. Não guardar eventos de raciocínio interno, contexto completo ou payloads desconhecidos. O relatório v1 é um contrato do Resolva, independente do formato nativo do Kiro.

Permissões: leitura limitada ao contexto necessário; escrita somente nos caminhos permitidos para a fase; fase de reprodução edita apenas testes e seu relatório. Negar shell, MCP, subagentes e acesso web ao perfil do executor. Não usar `--trust-all-tools`. Testes rodam no backend. Retirar `GH_TOKEN` e `DATABASE_URL` do ambiente entregue ao Kiro; passar apenas ambiente mínimo, autenticação Kiro e variáveis indispensáveis. Registrar e apresentar somente saídas filtradas.

O Kiro possui políticas próprias para ferramentas e leitura/escrita; a integração precisa comprovar as permissões efetivas com um teste pequeno antes do piloto. Repositórios de demonstração são confiáveis e não podem carregar configurações adicionais de Hooks/MCP não revisadas. Isso não transforma a cópia local em sandbox do sistema operacional nem protege o host de código de testes não confiável.

Base consultada: [modo headless](https://kiro.dev/docs/cli/headless/) e [permissões do Kiro](https://kiro.dev/docs/permissions/). As fases, relatórios, limites e decisões de publicação aqui descritos são contratos do Resolva, não recursos nativos presumidos do CLI.

## 8. Testes e decisão de publicação

1. Preparação e validação completa iniciais precisam passar antes da IA editar arquivos. Ambiente sem dependências, testes já falhando ou ausência de testes executados geram impedimento.
2. A fase `regression` pode criar testes, mas não alterar código funcional, configurações ou testes já existentes. O backend confere isso antes de executar o teste novo. Em todas as fases, preservar os testes anteriores à execução e seus arquivos de suporte/configuração; `fix` não pode editar nem remover nenhum arquivo de teste, incluindo os recém-criados. O manifesto de testes existente é obtido antes da primeira chamada ao Kiro, a partir dos caminhos de testes declarados e dos arquivos de configuração do runner.
3. O adaptador `vitest-json` normaliza `{ total, passed, failed, errors, failedTests }`. Exigir testes executados e uma asserção falhando no teste novo identificado; erro de compilação, runner inexistente, timeout ou erro de preparação não comprova reprodução do bug.
4. Se o teste novo já passar, registrar `problem_not_reproduced` e pedir análise humana. O sistema não força uma correção sem evidência.
5. Após comprovar reprodução, registrar hash dos arquivos de teste novos e mantê-los imutáveis nas rodadas `fix`. Se precisarem de ajuste, encerrar e exigir nova execução de reprodução. Não aceitar exclusão ou enfraquecimento do teste que comprovou o bug.
6. Em cada correção, executar o teste de regressão e toda a validação configurada. Depois de três rodadas sem sucesso, registrar `validation_failed` e manter os arquivos apenas como evidência local.
7. Antes de publicar, conferir caminhos, tamanho do diff, ausência de arquivos sensíveis e existência de mudanças reais no código, além do teste. Adicionar ao índice Git somente os arquivos aprovados; nunca `git add .` no repositório alvo.
8. Criar o commit final e validar esse commit com árvore de trabalho limpa. Registrar seu SHA e exigir que o SHA a publicar corresponda ao validado. Qualquer mudança posterior invalida a evidência.

Modos de execução: `initial` (primeira tentativa), `retry` (nova tentativa de uma entrega ainda não concluída), `review_behavior` e `review_refinement` (ajustes explicitamente classificados pelo operador). Ajustes de comportamento precisam de nova reprodução com teste adicional falhando na branch do PR, preservando os testes existentes. Ajustes de legibilidade/refatoração não exigem fabricar outra falha: podem omitir `regression`, vinculam `reproduction_execution_id` à evidência anterior da mesma entrega e reexecutam o teste original e toda a validação, sem alterar testes ou comportamento esperado. A interface exibe “Reprodução anterior preservada” nessa etapa, em vez de simular uma execução. O modelo não escolhe sozinho esse modo.

Bloqueios de negócio usam códigos estáveis: `information_required`, `unsupported_scope`, `baseline_failed`, `problem_not_reproduced`, `validation_failed`, `changes_out_of_scope`, `review_required`, `remote_conflict`. Falhas técnicas usam, por exemplo, `kiro_process_failed`, `invalid_agent_report`, `command_timeout`, `github_unavailable`. A mensagem explica a próxima ação em português.

## 9. GitHub, entregas e reconciliação

- Branch: `resolva/res-<id-com-tres-digitos>-<oito-primeiros-caracteres-da-primeira-execucao>`. Validar o nome com Git. Exemplo: `resolva/res-001-a1b2c3d4`.
- Título do PR: `[RES-001] Corrige <resumo>`. Corpo inclui um marcador estável `<!-- resolva-delivery:<uuid> -->`, identificador do ticket, relato, esperado, diagnóstico, arquivos, testes/códigos de saída, SHA validado e limitações.
- A primeira execução cria a entrega antes de chamar integrações. Modos `initial`/`retry` reutilizam a entrega pendente mesmo quando ela ainda não possui PR ou o banco ainda não conhece a URL. Ajustes reutilizam a entrega cujo PR está aberto. Uma nova entrega só é criada quando ainda não existe nenhuma ou após reabertura explícita de uma entrega integrada. PR fechado sem merge exige tratamento humano, sem criar outra entrega automaticamente.
- O backend usa `git` e `gh` com argumentos separados e corpo do PR em arquivo temporário. GitHub recebe uma credencial configurada com permissão para publicar branches e PRs naquele repositório. Kiro e frontend não recebem essa credencial.
- Para HTTPS autenticado, usar o helper fixo `gh auth git-credential` somente nessas chamadas Git, com os argumentos `-c`, `credential.helper=`, `-c`, `credential.helper=!gh auth git-credential` e o ambiente `GIT_TERMINAL_PROMPT=0`. O helper é uma instrução fixa do adaptador e não recebe texto do ticket. `GH_TOKEN` existe somente no ambiente das chamadas Git/GitHub; não alterar a configuração Git global do operador.
- Não existe force push, merge, rebase automático de mudanças humanas ou deploy. Antes de atualizar, comparar SHA remoto com `remote_head_sha`; divergência gera `remote_conflict` e preserva o PR para intervenção humana.
- Se push funcionar e a resposta de criação do PR se perder, uma nova tentativa consulta os PRs pela branch/repositório e pelo marcador da entrega antes de criar outro. Encontrando o PR e o commit validado, confirma e recupera o vínculo; não executa IA novamente sem necessidade.
- Persistir o SHA validado antes de publicar. Se houver interrupção, o artefato e o checkpoint permitem verificar o commit remoto. Ausência de evidências verificáveis impede tratar um PR recuperado como sucesso.
- Ao iniciar uma tentativa de entrega pendente, reconciliar os checkpoints antes de chamar o Kiro. Se apenas a branch tiver sido publicada e seu SHA possuir validação persistida, criar ou recuperar o PR com aquele commit, sem repetir a IA. Se o PR já existir, recuperar seu vínculo. Se não houver publicação, a nova tentativa usa outra cópia de trabalho e o mesmo identificador de entrega. Divergências de branch, SHA ou evidências são impedimentos, não motivo para inventar sucesso.
- PR fechado sem merge bloqueia a entrega para decisão humana. PR integrado exige resolução ou reabertura explícita, nunca atualização de uma branch como se o PR continuasse aberto.
- O PR só recebe status de entrega concluída depois de sua existência e identidade serem confirmadas pela integração. Não mudar manualmente `pr_url` pela interface.

## 10. Processos, recuperação e evidências

Todos os comandos usam executável/argumentos/cwd validados, `shell: false`, timeout, ambiente mínimo e captura limitada. Ao expirar o tempo, enviar encerramento ao grupo do processo e forçar após 5 segundos, aguardando sua finalização antes de liberar o executor. A cópia de trabalho de uma execução não é reutilizada por outra; ajustes de PR obtêm uma cópia nova da branch remota conhecida.

No MVP de host único, a inicialização obtém uma trava local por criação atômica de `.resolva/instance.lock/`, registrando PID, identidade de início do processo e token do proprietário. Outra instância com proprietário vivo deve falhar a inicialização. Trava de um processo encerrado só é removida depois de verificar os supervisores pendentes. Não há coordenação entre hosts no escopo.

Adquirir também um advisory lock PostgreSQL em conexão exclusiva e registrar seu `pg_backend_pid()`. Verificar a conexão a cada segundo e antes de publicar; perda, timeout de 3 segundos ou reconexão com outro PID invalida a posse. Nesse caso, bloquear imediatamente novos disparos/publicações, encerrar os processos supervisionados e finalizar o backend. Não reconectar silenciosamente e continuar trabalhando sem o lock. Enquanto o proprietário anterior estiver vivo, sua trava local impede outra instância do mesmo host de assumir a execução.

Somente após adquirir as travas e confirmar o encerramento dos processos anteriores, marcar execuções remanescentes como `interrompida` e devolver seus tickets a `aberto`, na mesma transação. O índice parcial de execução ativa continua protegendo as chamadas de início. Se a conexão cair ao finalizar a execução, a próxima inicialização faz essa recuperação; nunca liberar o disparo por uma atualização apenas em memória.

Para acompanhar a vida do pai, cada comando passa por um pequeno supervisor Node iniciado por `fork` com canal IPC. O supervisor inicia o comando em um grupo de processos próprio, grava PID/grupo e identificador da execução em `.resolva/processes/` e, em timeout ou desconexão do pai, encerra o grupo com TERM e depois KILL após 5 segundos. Só remove o registro depois de confirmar o encerramento. Na inicialização, o backend aguarda até 10 segundos pela limpeza desses registros antes de permitir nova execução; se ainda houver processo cuja finalização não possa ser confirmada, mantém o disparo bloqueado com um impedimento operacional. Nunca enviar sinais a um PID reaproveitado sem confirmar sua identidade. O teste de integração deve simular a morte forçada do pai e verificar o encerramento do comando e de seus descendentes.

Artefatos ficam em `.resolva/artifacts/<executionId>/`; cópias em `.resolva/workspaces/<executionId>/`. Não há remoção automática no MVP. Remover valores secretos conhecidos antes de persistir saídas; não armazenar raciocínio interno ou ambiente completo. Limitar cada log público a 1 MiB e o total de saída capturada por comando a 10 MiB; excesso encerra o comando com falha explícita, sem preencher disco indefinidamente. A interface informa quando um artefato esperado não está mais disponível e preserva o histórico no banco.

Limites de processo e permissões não representam sandbox para executar projetos arbitrários. O MVP aceita somente o projeto de demonstração confiável e suas dependências revisadas.

## 11. Telas e comportamento da interface

| Rota | Conteúdo e ações |
| --- | --- |
| `/tickets` | Lista, busca, filtros por estado/categoria, paginação e botão Novo ticket |
| `/tickets/new` | Formulário e validação de campos |
| `/tickets/$ticketId` | Relato, próxima ação, impedimento, eventos do ticket, execuções e entregas/PRs |
| `/executions` | Histórico com filtros de estado e ticket |
| `/executions/$executionId` | Seis etapas reais, diagnóstico, testes, arquivos, logs filtrados e PR |
| `/settings` | Configuração pública e disponibilidade de banco, Git, gh, Kiro e projeto alvo |

Durante execução ativa, consultar estado a cada 3 segundos e eventos a cada 5 segundos, usando cursor de sequência e sem repetir eventos já exibidos. Ao terminar, fazer consulta final de eventos até esgotar os lotes e suspender a consulta periódica. Reabrir a página recupera o estado persistido. Ações indisponíveis mostram o motivo e também são recusadas no backend.

Não mostrar spinner indefinido após falha de rede: apresentar erro e opção de atualizar. Gerar uma `requestKey` por intenção de início e reutilizá-la em repetição da mesma requisição HTTP. Criar outra chave somente para uma nova tentativa explícita. Antes de disparar, mostrar pendências de ambiente sem bloquear o cadastro de tickets.

Tema e componentes serão definidos pelo Resolva. Manter as telas sem dependências de sessão Google, filtros de telemetria, Azure DevOps e GitLab. Preservar rótulos acessíveis, foco, navegação por teclado e estados vazios.

## 12. Piloto demonstrável e pendências externas

Preparar uma fixture local independente em `examples/demo-target`, com TypeScript/Vitest, regra documentada e cálculo de total em centavos. Bug conhecido: somar preço unitário sem multiplicar pela quantidade. Para dois itens de 1.000 centavos e um de 500, o esperado é 2.500, mas o código retorna 1.500. Os testes existentes passam, pois ainda não cobrem quantidade maior que um. O Kiro deve acrescentar a cobertura e corrigir o cálculo.

A fixture é um exemplo proposto para tornar a implementação verificável sem aguardar um sistema externo. O piloto real pode usar outro projeto do grupo, desde que forneça comandos, módulo permitido e um adaptador de relatório compatível. O primeiro adaptador definido é Vitest JSON; suporte a outros runners não está implícito.

Antes da demonstração real, configurar um repositório GitHub alvo separado do Resolva, branch base, permissões, documentação, comandos e modelo/autenticação Kiro. Criar outro repositório, gastar créditos de IA e executar correções reais não foram realizados nesta etapa de definição. Testes automatizados de desenvolvimento usam adaptadores falsos e repositórios temporários, sem chamar modelo ou publicar PRs.

Pendências que dependem do grupo: repositório alvo final; credenciais e modelo disponíveis; confirmação da modalidade individual/coletiva da entrega acadêmica. O restante deste documento fornece decisões para a implementação, sem exigir escolher bibliotecas ou endpoints durante a programação.
