# Recuperação do disparo — plano e evidências

## Escopo

Continuar as seções 8–9 do [design](../design.md), tarefas 10–11 e 39 do
[plano](../tasks.md). Preservar a exclusividade após envio com resposta perdida
e permitir vincular manualmente a workflow existente, sem novo disparo.

Usar tabelas, eventos e colunas existentes. Manter o checkout atual; sem novas
dependências ou migração. Testes com GitHub falso e PostgreSQL descartável.

## Decisões

- Conferir instalação/autenticação e resolver a definição da workflow antes do
  envio. `workflowRef` identifica arquivo YAML ou ID numérico, não a branch Git.
- Persistir `workflow_dispatch_requested` antes de chamar `gh workflow run`.
  Repetir a mesma intenção nunca repete a chamada externa.
- Falha comprovadamente anterior ao checkpoint pode bloquear a execução e liberar
  a fila. Erro depois do checkpoint é resultado incerto: manter execução/ticket
  ativos e registrar mensagem fixa, sem diagnóstico externo.
- A workflow deve usar `run-name: Resolva ${{ inputs.executionId }}`. O campo
  `executionId` já é enviado pelo backend. A correlação será conferida junto de
  repositório, definição da workflow, branch, evento e data de criação.
- `implementations.reconcileDispatch({ executionId, workflowId })` recebe o ID do
  run visto pelo operador no GitHub. Consulta somente esse run autenticado e
  revalida o checkpoint sob lock antes de associar a identidade e o estado.
- Run ativo conserva exclusividade. Sucesso remoto aguarda relatório/evidência,
  sem confirmar PR. Falha/cancelamento remoto confirmado pode terminar a
  execução; proposta de sucesso pendente usa a reconciliação já existente.
- Não inferir ausência pelo erro de consulta nem liberar execução sem identificar
  a workflow. Falta de run correlacionável exige intervenção do operador.
- Alternativa adiada: buscar automaticamente todos os runs por nome/data. O ID
  explícito evita escolher entre resultados incompletos, paginados ou ambíguos.

## Execução

- [x] Reproduzir e corrigir perda de exclusividade depois do envio e ausência
      do checkpoint; preservar replay e callbacks que chegaram antes da resposta.
- [x] Testar e implementar leitura da definição e metadados de correlação do run.
- [x] Testar e implementar vínculo manual autenticado e transacional, sem
      disparo, regressão, troca de run ou conclusão de sucesso sem evidência.
- [x] Revisar, executar verificações completas e registrar resultados reais.

## Foco de revisão

Queda entre checkpoint e envio; resposta perdida depois de callback; checkpoint
alterado durante consulta; run de outro ticket/definição/branch; repetição e
mudança de tentativa; término conflitante com sucesso já informado; erro remoto
que não comprova ausência; diagnóstico externo em mensagem pública.

## Limites

Nenhuma workflow é criada ou disparada no GitHub real por esta entrega. O
operador configura a workflow alvo e o `run-name` requerido. Coleta real de
relatórios, orquestração do Kiro, descoberta automática de runs e retomada
automática na inicialização continuam pendentes. O ambiente padrão fica bloqueado.

A recuperação requer o ID explícito do run e um checkpoint compatível. Uma queda
antes de enviar, mas depois de gravar o checkpoint, também conserva a reserva:
não é seguro deduzir que não houve envio. O operador precisa intervir quando não
houver run correlacionável; a API não oferece liberação baseada só nessa ausência.
Runs legados sem checkpoint não recebem um vínculo retroativo por este endpoint.

A data de criação remota deve ser posterior ao checkpoint, comparado em segundos,
e não exceder o relógio local por mais de um minuto. Após uma primeira observação,
mudança de tentativa exige intervenção. A observação de sucesso não pode regredir
para fila/execução ou liberar o ticket por callback de falha conflitante.

## Configuração da workflow alvo

O trecho abaixo deve fazer parte da workflow existente; não implementa o runner:

```yaml
run-name: Resolva ${{ inputs.executionId }}
on:
  workflow_dispatch:
    inputs:
      executionId:
        required: true
        type: string
```

O contrato completo também recebe `ticketId`, `ticketVersion`, `deliveryId` e
`branchName`, já enviados pelo backend. A definição é resolvida antes do envio e
o disparo usa seu ID numérico, preservado no checkpoint.

Fontes: [run-name](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#run-name),
[definição da workflow](https://docs.github.com/en/rest/actions/workflows#get-a-workflow)
e [metadados do run](https://docs.github.com/en/rest/actions/workflow-runs#get-a-workflow-run).

## Evidências

Os três testes iniciais reproduziram liberação indevida após timeout, ausência
de checkpoint antes do processo e bloqueio indevido de intenção já registrada.
Nove falhas no cliente demonstraram a ausência de consulta da definição e dos
metadados de correlação. Dezoito falhas adicionais reproduziram a falta da
recuperação manual e da proteção de sucesso aguardando relatório.

Os 52 testes focados de reserva/disparo passaram, assim como o typecheck. Incluem
callback anterior à resposta perdida, falha de persistência antes/depois do envio,
queda com checkpoint, vínculo por HTTP, corrida com nova proposta de sucesso,
mudança do checkpoint durante consulta e replay de término confirmado offline.

A revisão independente apontou que a conclusão comum por callback ainda poderia
contornar a definição e a tentativa preservadas no checkpoint. Cinco testes
reproduziram aprovação divergente, correlação incorreta e checkpoint alterado
durante confirmação. Aprovação e conclusão agora compartilham as mesmas restrições
do disparo, e a prova final inclui o fingerprint do checkpoint. Os 69 testes
focados de recuperação/conclusão passaram depois da correção.

Validação final em 11/11/2026 com Node 22.23.1 e pnpm 10.28.2:

- `pnpm check`: tipos, lint, formatação, 323 testes unitários e build aprovados.
- `pnpm test:integration`: 140 testes aprovados em oito arquivos, incluindo
  33 cenários de disparo/recuperação e o fluxo comum com checkpoint.
- `git diff --check`: sem erros de whitespace.

As tarefas 4 (schema) e 34 (procedures/contratos) foram marcadas como concluídas
após conferência do escopo e verificação da suíte. As tarefas de integração real,
recuperação completa e configuração operacional permanecem abertas no plano.
Nenhum disparo, PR ou banco do operador foi alterado por esses testes.
