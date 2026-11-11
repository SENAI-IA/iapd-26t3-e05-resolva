# Regras do sistema de tarefas

- Cada tarefa possui um ID único.
- O título é obrigatório e pode ser repetido em tarefas diferentes.
- Criar uma tarefa começa com `completed: false`.
- Alternar uma tarefa altera somente a tarefa identificada pelo ID recebido.
- A lista de pendências contém todas as tarefas ainda não concluídas.
- Remover uma tarefa não altera as demais.

## Limitação conhecida para a demonstração

A implementação atual de `toggleTodo` localiza a tarefa pelo ID, mas aplica a
alteração usando o título. O comportamento passa nos testes existentes quando
os títulos são diferentes. Um teste de regressão com dois títulos iguais deve
falhar antes da correção e passar depois dela.
