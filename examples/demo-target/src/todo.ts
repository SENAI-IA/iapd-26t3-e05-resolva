export type Todo = {
  id: string;
  title: string;
  completed: boolean;
};

export function createTodo(id: string, title: string): Todo {
  const normalizedId = id.trim();
  const normalizedTitle = title.trim();
  if (!normalizedId || !normalizedTitle) throw new Error("Uma tarefa precisa de ID e título.");
  return { id: normalizedId, title: normalizedTitle, completed: false };
}

export function addTodo(todos: readonly Todo[], todo: Todo): Todo[] {
  return [...todos, todo];
}

export function toggleTodo(todos: readonly Todo[], id: string): Todo[] {
  const selected = todos.find((todo) => todo.id === id);
  if (!selected) return [...todos];
  return todos.map((todo) =>
    todo.title === selected.title ? { ...todo, completed: !todo.completed } : todo,
  );
}

export function pendingTodos(todos: readonly Todo[]): Todo[] {
  return todos.filter((todo) => !todo.completed);
}

export function removeTodo(todos: readonly Todo[], id: string): Todo[] {
  return todos.filter((todo) => todo.id !== id);
}
