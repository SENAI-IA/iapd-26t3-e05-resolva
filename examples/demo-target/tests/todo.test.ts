import { describe, expect, it } from "vitest";
import { addTodo, createTodo, pendingTodos, removeTodo, toggleTodo } from "../src/todo.js";

const firstTodo = createTodo("todo-1", "Estudar requisitos");
const secondTodo = createTodo("todo-2", "Executar testes");

describe("lista de tarefas", () => {
  it("cria tarefas sem espaços nas extremidades", () => {
    expect(createTodo(" todo-3 ", "  Revisar diff  ")).toEqual({
      id: "todo-3",
      title: "Revisar diff",
      completed: false,
    });
  });

  it("adiciona uma tarefa ao final da lista", () => {
    expect(addTodo([firstTodo], secondTodo)).toEqual([firstTodo, secondTodo]);
  });

  it("alterna a tarefa selecionada", () => {
    expect(toggleTodo([firstTodo, secondTodo], firstTodo.id)).toEqual([
      { ...firstTodo, completed: true },
      secondTodo,
    ]);
  });

  it("lista apenas tarefas pendentes", () => {
    expect(pendingTodos([{ ...firstTodo, completed: true }, secondTodo])).toEqual([secondTodo]);
  });

  it("remove a tarefa pelo ID", () => {
    expect(removeTodo([firstTodo, secondTodo], firstTodo.id)).toEqual([secondTodo]);
  });
});
