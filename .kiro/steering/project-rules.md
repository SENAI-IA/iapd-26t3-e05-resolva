---
inclusion: always
---

# Resolva — regras do projeto

Estas regras são a configuração ativa do Kiro IDE para o repositório Resolva.

## Comunicação e histórico

- Escrever documentação, mensagens da interface e mensagens de commit em português.
- Usar commits convencionais, curtos e focados em uma mudança.
- Não incluir ID de task nem placeholder nas mensagens de commit; não solicitar esse dado antes de commitar.
- Preservar histórico, branches e revisão humana.
- O executor não faz merge, deploy nem alterações em dados de produção.

## Stack e organização

- Usar TypeScript estrito e não usar `any`.
- Manter o monorepo pnpm com os pacotes `web` e `backend`.
- Usar React, Vite, Tailwind CSS, Radix UI, Lucide e TanStack no frontend.
- Usar Node.js, Fastify, tRPC e Zod no backend.
- Usar PostgreSQL, Drizzle ORM e migrações versionadas.
- Manter o schema em `backend/src/db/schema.ts` e o acesso ao banco nos repositories.
- Colocar regras de negócio nos serviços e estados do domínio; não espalhá-las em rotas ou componentes.
- Preservar a identidade visual e os tokens do Resolva ao adaptar componentes para o domínio de tickets.

## Segurança e configuração

- Validar entradas nas fronteiras com Zod e manter contratos tRPC tipados.
- Configurar segredos somente pelo ambiente ou por um cofre.
- Nunca versionar, registrar em logs, persistir em evidências ou enviar ao navegador/contexto do Kiro valores secretos.
- Executar subprocessos com argumentos separados e sem shell.
- Obter comandos, caminhos, limites e integrações de configuração validada, nunca do texto livre do ticket.
- Restringir alterações aos caminhos permitidos e bloquear mudanças fora do escopo.
- Não usar `git add .` no repositório alvo.
- Não usar `--force`, merge automático, deploy automático ou escrita em produção.

## Execução do agente

- O Kiro investiga e edita o repositório alvo em fases controladas.
- O backend executa preparação, testes, revisão do diff, commit, publicação e confirmação do PR.
- A conclusão do Kiro não comprova sucesso: a execução só avança com relatório estruturado, testes e evidências válidas.
- Usar integrações falsas ou recursos descartáveis nos testes automatizados.
- Os testes não podem gastar créditos de IA nem publicar PRs reais.
- Registrar impedimentos, evidências e limitações em português.

## Implementação

- Entender o fluxo existente antes de alterar arquivos.
- Reutilizar padrões e dependências já presentes antes de criar abstrações.
- Fazer a menor alteração correta, sem refatorações não solicitadas.
- Não adicionar comentários ou Javadoc que apenas repitam a implementação.
- Executar as verificações pertinentes à mudança e revisar o diff antes de concluir.
