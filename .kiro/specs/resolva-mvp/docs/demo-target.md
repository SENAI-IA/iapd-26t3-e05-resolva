# Alvo demo de lista de tarefas

## Escopo

O alvo `examples/demo-target` fornece uma aplicação pequena e versionada para
ensaiar o fluxo do Resolva sem depender de um sistema externo. A aplicação tem
uma interface web mínima, um domínio TypeScript testável e uma solicitação de
melhoria separada.

## Cenários

- Bug conhecido: `toggleTodo` encontra a tarefa pelo ID, mas aplica a alteração
  pelo título. Duas tarefas com o mesmo título expõem a divergência.
- Melhoria: filtrar tarefas por estado, com critérios em
  `examples/demo-target/docs/improvement.md`.
- Regra vigente: IDs identificam tarefas individualmente e títulos podem se
  repetir, conforme `examples/demo-target/docs/rules.md`.

O teste existente cobre o comportamento normal com títulos distintos e permanece
verde antes da inclusão do teste de regressão do bug.

## Evidências locais

- `vitest run --root examples/demo-target`: 5 testes aprovados.
- `tsc -p examples/demo-target/tsconfig.json --noEmit`: aprovado.
- `vite build examples/demo-target`: build aprovado.
- `oxfmt --check --ignore-path .gitignore --ignore-path .oxfmtignore .`: aprovado.
- `git diff --check`: aprovado.

O comando `pnpm test:demo` reproduz o smoke test a partir da raiz do Resolva.
O relatório JSON da validação da pipeline continua sendo gerado somente quando
o alvo é instalado e executado pela configuração local.

## Limites

A fixture não comprova integração com GitHub, Kiro ou pipeline autenticada. Ela
serve como alvo controlado para testes locais e para o cenário de implementação.
A correção do bug e a implementação do filtro são mudanças futuras do fluxo do
Resolva, não fazem parte desta fixture inicial.
