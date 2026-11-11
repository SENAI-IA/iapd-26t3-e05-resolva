# Fixture de melhoria

## Solicitação

Permitir filtrar a lista por estado: todas, pendentes ou concluídas.

## Critérios de aceite

- O filtro `all` retorna todas as tarefas na ordem original.
- O filtro `pending` retorna somente tarefas não concluídas.
- O filtro `completed` retorna somente tarefas concluídas.
- Um filtro desconhecido deve ser recusado sem alterar a lista original.

A melhoria não corrige o comportamento de `toggleTodo`; esse caso pertence ao
cenário de bug documentado em `rules.md`.
