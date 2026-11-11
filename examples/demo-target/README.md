# Alvo demo do Resolva

Fixture mínima de uma lista de tarefas usada para validar o fluxo do Resolva
sem depender de um sistema externo. O alvo contém um bug conhecido e uma
solicitação de melhoria separada.

## Executar

```bash
pnpm install
pnpm dev
pnpm test
pnpm test:json
pnpm build
```

A interface fica disponível em `http://127.0.0.1:5173`. O relatório JSON
gerado por `test:json` fica em `reports/vitest.json` e deve ser usado somente
como artefato local da execução.

- Bug conhecido: `toggleTodo` altera tarefas com o mesmo título, em vez de
  alterar somente o ID selecionado.
- Melhoria: filtrar tarefas por estado, conforme `docs/improvement.md`.
