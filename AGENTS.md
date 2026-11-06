# Resolva — regras do projeto

1. Escreva documentação, mensagens da interface e commits em português; use commits convencionais.
2. Use TypeScript estrito, sem `any`, no monorepo pnpm com pacotes `web` e `backend`.
3. Preserve a identidade visual e seus tokens; adapte componentes ao domínio de tickets do Resolva.
4. Valide entradas com Zod e mantenha contratos tRPC tipados; regras de negócio pertencem aos serviços e estados do domínio.
5. Mantenha acesso ao PostgreSQL nos repositories, schema em `backend/src/db/schema.ts` e migrações Drizzle versionadas.
6. Configure segredos pelo ambiente; não os versione, registre em logs ou envie ao navegador/contexto do Kiro.
7. Execute subprocessos com argumentos separados e sem shell; comandos, caminhos e limites vêm da configuração validada.
8. O Kiro investiga e edita; o backend verifica testes, diff e commit e confirma o PR antes de concluir a execução.
9. Preserve histórico e revisão humana; o executor não faz merge, deploy ou alterações em dados de produção.
10. Execute as verificações pertinentes às mudanças. Testes automatizados usam integrações falsas ou recursos descartáveis e não gastam créditos de IA nem publicam PRs reais.
