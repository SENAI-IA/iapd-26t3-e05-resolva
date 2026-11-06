# Resolva — plano de implementação

Status inicial: planejamento. Nenhuma tarefa foi executada.

As tarefas seguem dependências por fatia vertical. Cada tarefa deve atualizar testes e evidências correspondentes antes de ser marcada como concluída.

## Fundação

- [ ] 1. Criar workspace pnpm com `web` e `backend`, TypeScript estrito, Node 22 e scripts de lint, formatação e teste.
  - Requisitos: R25.
- [ ] 2. Criar configuração de ambiente, `.env.example`, `resolva.config.example.json`, `.gitignore` e validação Zod de limites, caminhos e comandos.
  - Requisitos: R08, R13, R24, R25.
- [ ] 3. Criar Docker Compose do PostgreSQL com volume nomeado, healthcheck e porta local configurável.
  - Requisitos: R01, R23.
- [ ] 4. Configurar Drizzle, conexão, migrações e schema inicial sem segredos.
  - Requisitos: R01, R04, R05, R21, R23, R24.

## Domínio e backend

- [ ] 5. Implementar estados, transições, validações de campos, categorias e códigos de erro do domínio.
  - Requisitos: R01, R02, R04, R10, R11, R19, R20.
- [ ] 6. Implementar repositories transacionais para tickets, eventos, execuções, entregas e artefatos.
  - Requisitos: R01, R04, R05, R06, R07, R10, R11, R16, R18, R19, R20, R21, R23.
- [ ] 7. Implementar procedures tRPC de tickets, com paginação, busca literal, controle de versão e histórico.
  - Requisitos: R01, R02, R03, R04, R10, R11, R17, R19, R20.
- [ ] 8. Implementar procedures tRPC de execuções e ambiente, incluindo idempotência por `requestKey`.
  - Requisitos: R05, R06, R07, R08, R21, R23.
- [ ] 9. Implementar healthcheck e tratamento público de erros sem stack trace ou segredos.
  - Requisitos: R08, R21, R24.

## Executor controlado

- [ ] 10. Implementar lock de instância, advisory lock PostgreSQL e recuperação de execuções interrompidas.
  - Requisitos: R06, R22, R23.
- [ ] 11. Implementar supervisor de subprocessos com `shell: false`, argumentos validados, timeout e encerramento de descendentes.
  - Requisitos: R08, R13, R22, R23.
- [ ] 12. Implementar captura limitada, sanitização de segredos, artefatos e eventos com sequência.
  - Requisitos: R21, R22, R24.
- [ ] 13. Implementar baseline de preparação, manifesto de testes, execução de comandos e adaptador `vitest-json`.
  - Requisitos: R09, R12, R13, R14.
- [ ] 14. Implementar adaptador Kiro headless, prompts por fase, relatório JSON versionado e captura de eventos.
  - Requisitos: R08, R10, R12, R14, R21, R24.
- [ ] 15. Implementar as fases de análise, reprodução, correção e validação com limite máximo de três rodadas.
  - Requisitos: R09, R10, R12, R13, R14.

## GitHub e entrega

- [ ] 16. Implementar cópia de trabalho, validação de caminhos, diff, arquivos sensíveis, limites e SHA validado.
  - Requisitos: R13, R15, R18, R24.
- [ ] 17. Implementar adaptador Git/GitHub com argumentos separados, credencial isolada, branch e commit.
  - Requisitos: R15, R18, R24, R25.
- [ ] 18. Implementar criação, atualização e reconciliação idempotente de PRs, sem force push.
  - Requisitos: R15, R16, R17, R18.
- [ ] 19. Implementar modos `initial`, `retry`, `review_behavior` e `review_refinement`, preservando entregas e execuções.
  - Requisitos: R16, R17, R18, R20.

## Frontend

- [ ] 20. Criar tokens, layout, navegação e componentes acessíveis do Resolva sem importar dependências secretas do backend.
  - Requisitos: R21, R25.
- [ ] 21. Implementar lista, busca, filtros, paginação, cadastro e edição de tickets.
  - Requisitos: R01, R02, R03, R04.
- [ ] 22. Implementar detalhes do ticket, ações de informação, ajustes, resolução e reabertura.
  - Requisitos: R10, R11, R17, R19, R20, R21.
- [ ] 23. Implementar histórico e acompanhamento de execução com polling, cursor de eventos, impedimentos e PR.
  - Requisitos: R05, R08, R09, R10, R14, R15, R16, R21, R23.
- [ ] 24. Implementar tela de configuração pública e disponibilidade das integrações sem exibir segredos.
  - Requisitos: R08, R24, R25.

## Demonstração e qualidade

- [ ] 25. Criar `examples/demo-target` com bug conhecido de quantidade, regra documentada e testes existentes passando.
  - Requisitos: R12, R15.
- [ ] 26. Criar testes unitários de domínio, repositories e contratos tRPC.
  - Requisitos: R01–R08, R10, R11, R17, R19–R21.
- [ ] 27. Criar testes de integração descartáveis com Testcontainers para concorrência, idempotência, recuperação e sanitização.
  - Requisitos: R06, R07, R16, R18, R22, R23, R24.
- [ ] 28. Criar testes de executor com comandos falsos para timeout, morte do pai, baseline, reprodução e três rodadas.
  - Requisitos: R09, R12, R13, R14, R22.
- [ ] 29. Criar fixtures de integração GitHub/Kiro sem publicar PRs reais nos testes.
  - Requisitos: R15, R16, R17, R18, R25.
- [ ] 30. Documentar instalação, configuração, execução, cenários, arquitetura, tools, prompts, limitações e roteiro de apresentação no README.
  - Requisitos: R01–R25.
- [ ] 31. Executar validação final, revisar diff, confirmar ausência de segredos e preparar evidências do fluxo ticket → PR.
  - Requisitos: R09, R13, R15, R21, R24, R25.

## Ordem de entrega recomendada

1. Tarefas 1–9 para ter cadastro e consulta persistentes.
2. Tarefas 10–15 para executar validação controlada sem publicação.
3. Tarefas 16–19 para entregar PR com reconciliação segura.
4. Tarefas 20–24 para fechar o fluxo visual.
5. Tarefas 25–31 para demonstração e validação.
