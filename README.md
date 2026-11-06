# Resolva

**Plataforma de engenharia de software assistida por IA.**

O Resolva transforma tickets técnicos em Pull Requests revisáveis. A plataforma coordena triagem baseada em evidências, encaminhamento manual, implementação, validação determinística e publicação controlada, mantendo a decisão final com a equipe de engenharia.

## Proposta de valor

O Resolva reduz o trabalho operacional entre o relato de um defeito e uma mudança pronta para revisão. O produto conecta contexto, evidência de reprodução, teste de regressão, validação do diff e entrega no GitHub em um fluxo auditável.

O público inicial são equipes de engenharia que precisam acelerar correções de baixo risco sem abrir mão de escopo controlado, testes verificáveis, rastreabilidade e aprovação humana.

## Estado do projeto

**MVP em planejamento e validação de produto.** A arquitetura, os contratos e os critérios de aceite estão definidos; a implementação e a validação ponta a ponta ainda serão executadas.

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

A aplicação está em planejamento; os comandos de instalação, migração e execução serão adicionados com a implementação.

O ambiente previsto utiliza **Node.js 22**, **pnpm 10**, **Docker com Compose** e **Kiro CLI autenticado para execução headless**. Frontend, backend e Kiro rodarão no host; o PostgreSQL ficará no Docker. A operação completa exige um repositório-alvo controlado e acesso ao GitHub para publicar branches e abrir Pull Requests.

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
