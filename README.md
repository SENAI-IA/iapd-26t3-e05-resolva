# Resolva

**Do ticket ao Pull Request com IA.**

Aplicação escolar que permite cadastrar tickets, iniciar uma investigação pela interface e acompanhar um agente de IA até a entrega de uma correção validada em um Pull Request real no GitHub.

O Kiro CLI headless investiga e altera o código. O backend do Resolva coordena a execução, valida as mudanças, registra evidências e publica o PR para revisão humana. Merge e alterações em produção permanecem sob responsabilidade do time.

## Equipe

- Organização: [SENAI-IA](https://github.com/SENAI-IA).
- Turma: **IAPD-26T3**.
- Grupo: **05**.
- Equipe GitHub: [IAPD-26T3-E05](https://github.com/orgs/SENAI-IA/teams/iapd-26t3-e05).

Membros vinculados à equipe no GitHub na criação deste repositório:

- [SergioPacheco](https://github.com/SergioPacheco)
- [FelipeRamosOliveira](https://github.com/FelipeRamosOliveira)
- [lucasspecht-sn](https://github.com/lucasspecht-sn)
- [amadeujw](https://github.com/amadeujw)
- [larissasampaio-lcos](https://github.com/larissasampaio-lcos)

## Estado do projeto

**Planejamento e design.** O repositório contém a documentação do produto. A aplicação ainda não foi implementada e não existem scripts de inicialização nesta fase.

## Fluxo previsto

1. Cadastrar um ticket com o problema e o comportamento esperado.
2. Iniciar a análise visualmente.
3. Investigar código e documentação com o Kiro.
4. Reproduzir o problema com teste e implementar a correção.
5. Executar a validação e abrir ou atualizar o PR.
6. Revisar, fazer merge, verificar a correção em teste e encerrar o ticket manualmente.

Informações insuficientes, falhas e impedimentos ficam registrados no histórico do ticket e de suas execuções.

## Stack definida

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, Radix UI, Lucide e TanStack.
- **Backend:** Node.js, TypeScript, Fastify, tRPC e Zod.
- **Banco:** PostgreSQL em Docker, com volume persistente.
- **Persistência:** Drizzle ORM e migrações com Drizzle Kit.
- **IA:** Kiro CLI headless.
- **Testes:** Vitest e Testcontainers.
- **Ferramentas:** pnpm, Oxlint e Oxfmt.

O frontend utilizará a base visual e os componentes do Error Hub, adaptados ao domínio do Resolva.

## Como executar

A aplicação está em planejamento; os comandos de instalação, migração e execução serão adicionados com a implementação.

O ambiente previsto utiliza **Node.js 22**, **pnpm 10**, **Docker com Compose** e **Kiro CLI autenticado para execução headless**. Frontend, backend e Kiro rodarão no host; o PostgreSQL ficará no Docker. A demonstração completa exigirá um repositório alvo e acesso ao GitHub para publicar branches e abrir PRs.

Credenciais devem ser configuradas localmente e não devem ser versionadas.

## Documentação

- [Desenho do produto, arquitetura, stack e ciclo de vida dos tickets](docs/superpowers/specs/2026-11-05-resolva-design.md).
- [Análise do Error Hub como referência](docs/research/2026-11-05-error-hub-analysis.md).
- [Convenções da organização SENAI-IA](https://github.com/SENAI-IA/.github/blob/main/profile/README.md).
