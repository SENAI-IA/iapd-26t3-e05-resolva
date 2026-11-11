import { addTodo, createTodo, removeTodo, toggleTodo, type Todo } from "./todo.js";
import "./style.css";

let todos: Todo[] = [];
let nextId = 1;

const form = document.querySelector<HTMLFormElement>("#todo-form");
const titleInput = document.querySelector<HTMLInputElement>("#todo-title");
const list = document.querySelector<HTMLUListElement>("#todo-list");
const count = document.querySelector<HTMLSpanElement>("#todo-count");
const emptyState = document.querySelector<HTMLParagraphElement>("#empty-state");

if (!form || !titleInput || !list || !count || !emptyState)
  throw new Error("Interface incompleta.");

const todoList = list;
const todoCount = count;
const todoEmptyState = emptyState;

function render() {
  todoList.replaceChildren(
    ...todos.map((todo) => {
      const item = document.createElement("li");
      item.className = "todo-item";
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = todo.completed;
      checkbox.addEventListener("change", () => {
        todos = toggleTodo(todos, todo.id);
        render();
      });
      const text = document.createElement("span");
      text.textContent = todo.title;
      text.className = todo.completed ? "completed" : "";
      label.append(checkbox, text);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove-button";
      remove.textContent = "Remover";
      remove.addEventListener("click", () => {
        todos = removeTodo(todos, todo.id);
        render();
      });
      item.append(label, remove);
      return item;
    }),
  );
  const pending = todos.filter((todo) => !todo.completed).length;
  todoCount.textContent = `${pending} pendente${pending === 1 ? "" : "s"}`;
  todoEmptyState.hidden = todos.length > 0;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = titleInput.value.trim();
  if (!title) return;
  todos = addTodo(todos, createTodo(`todo-${nextId++}`, title));
  titleInput.value = "";
  render();
  titleInput.focus();
});

render();
