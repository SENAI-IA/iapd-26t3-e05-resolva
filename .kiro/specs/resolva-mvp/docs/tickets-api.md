# Tickets persistentes — terceira entrega

Continuação nas tarefas 5–7 e 9: domínio e primeira fatia dos repositories e API.
O contrato v2 da triagem prevalece sobre a antiga entrada genérica de execução.

## Plano

- [x] Testar campos/limites, categorias, estados, resolução humana e invalidação;
      implementar contratos públicos Zod em `backend/src/domain/contracts.ts` e regras
      puras em `backend/src/domain/ticket.ts`, com erros em `domain/error.ts`.
- [x] Testar em PostgreSQL concorrência de versão, rollback de evento, busca
      literal, paginação, histórico e invalidação de triagem. Implementar
      `createTicketRepository(database)` em `repository/ticketRepository.ts`;
      `createTicketService(repository, categories, targetConfig)` em
      `services/ticketService.ts`. O ticket persiste a chave, a versão e o snapshot
      hash da configuração selecionada.
- [x] Testar tRPC por HTTP com banco descartável; implementar
      `trpc/router.ts`/`trpc/routers/tickets.ts`, montar `/trpc` em `server.ts` e ligar
      banco/configuração em `main.ts` sem migrations automáticas.
- [ ] Rodar tipos, testes, integração, lint, formatação, builds e revisão
      independente; documentar operação e registrar commit local.

## Contratos e decisões

- Procedures: `tickets.create`, `list`, `byId`, `update`, `events`,
  `provideInformation`, `contestTriage`, `resolve`, `reopen`.
  Não haverá endpoint de status arbitrário, exclusão ou início de IA nesta entrega.
- Criação gera ticket aberto, versão 1, código derivado `RES-001` e evento na
  mesma transação. Cada mutação bloqueia a linha, verifica `expectedVersion`,
  aplica a regra e grava evento na mesma transação; conflitos não sobrescrevem.
- Editar somente `aberto`/`aguardando_informacoes`; complementar somente aguardando
  informações; contestar somente recusa com triagem vigente. Alterações relevantes
  invalidam triagem válida sem apagar a conclusão ou classificação anterior.
- Resolução exige estado aguardando revisão e os dois indicadores humanos; reabrir
  exige justificativa. Nenhum desses comandos faz merge ou chama integrações.
- Busca literal por código/título/descrição, incluindo `%`, `_` e barra. Listas
  ordenadas por atualização/ID descendentes; histórico por criação/ID crescentes.
- DTOs usam datas ISO UTC e campos explícitos. `byId` mostra ticket e resumos da
  execução/entrega, sem snapshots internos; erros HTTP tRPC não expõem stack,
  mensagens do banco ou dados de validação internos.
- A criação exige configuração de sistema-alvo válida; o serviço recusa chave ausente ou divergente e grava o snapshot operacional sem credenciais. Categorias são validadas contra a configuração selecionada. Ausência de banco gera erro público de pré-condição mantendo o healthcheck disponível. A ausência de GitHub CI/Kiro ainda não impede cadastro quando a configuração local está válida. O frontend continuará estático nesta entrega.
- Repositories de reserva/execução/entrega, elegibilidade completa e procedures de
  triagem ficam para a próxima fatia; tarefas amplas não serão marcadas inteiras
  só por este recorte. Testes não usam banco do operador ou serviços externos.
- `requestChanges` será ligado junto aos modos de ajuste e à reconciliação de
  entregas (tarefa 19), para preservar corretamente PR e reprodução. Nesta fatia
  não inventaremos uma decisão de validade de triagem para ajustes ainda sem
  esses contratos operacionais.

## Evidências

- Domínio: 33 testes de campos e transições, incluindo limites exatos, um caractere
  fora, campos controlados pelo servidor, NUL, trim e R19. Casos falharam contra
  contratos permissivos/transição sem comportamento e passaram após implementar.
- Repository: 12 testes PostgreSQL falharam antes da implementação e passaram
  depois. Conflito concorrente deixa uma edição; falha de trigger reverte criação,
  conteúdo, versão e invalidação. Histórico e snapshots anteriores são preservados.
- HTTP: 11 testes inicialmente retornaram 404 e depois passaram com tRPC montado,
  validação, categorias, controle de versão, mensagens, resolução/reabertura e
  respostas sem stack, query ou segredo fictício do banco.
- `pnpm check`: 99 unitários, tipos, lint, formatação e builds passaram.
  `pnpm test:integration`: 31 casos passaram em três suítes PostgreSQL descartáveis.
- API compilada iniciada em processo real com banco descartável: categoria do
  operador, criação/edição por HTTP, conflito 409 e persistência após reiniciar
  confirmados; o histórico manteve dois eventos. Nenhum `.env` local foi alterado.

- Configuração: 43 testes unitários cobrem identidade, pipeline, versão e hash do
  snapshot; 20 casos de schema/repository passaram após a migração compatível com
  tickets legados e persistiram a seleção do alvo sem expor o snapshot na API.
  Revisão independente de compatibilidade com o domínio de triagem concluída sem
  achados críticos ou importantes. Nesta continuação, a suíte unitária passou com
  214 testes e a integração manteve 41 casos aprovados. Commit local ainda pendente.
