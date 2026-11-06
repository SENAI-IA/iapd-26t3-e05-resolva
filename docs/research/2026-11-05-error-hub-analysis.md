# Análise do Error Hub como referência para o Resolva

Data: 2026-11-05. Fonte: código local em `/home/user-sn-387444/dev/work/ia/error-hub`.

Análise estática de código, configuração de exemplo e testes existentes. Nenhuma pipeline, API de IA ou operação no GitLab foi executada. O repositório analisado não foi modificado.

## Conclusão principal

O Error Hub implementa a interface e a orquestração da correção. O executor que modifica o código e cria o Merge Request fica em outro projeto GitLab, identificado nos comentários como `error-hub-agent` e selecionado por `AGENT_GITLAB_PROJECT_ID`.

Os comentários e o `.env.example` descrevem esse executor como uma pipeline que clona o projeto alvo e executa o Kiro em modo headless. O código dessa pipeline não está no repositório analisado; portanto, não foi possível verificar os comandos do agente, o modelo utilizado, a execução de testes, o commit, o push ou a chamada de criação do MR. Não há pasta irmã imediata chamada `error-hub-agent` na área examinada.

## Fluxo confirmado pelo código disponível

1. **Triagem com IA.** `backend/src/llm/agentEligibility.ts:50` define uma instrução conservadora para decidir se o erro provavelmente pode ser corrigido apenas com código. `evaluateEligibility` envia título e stack trace a uma API HTTP autenticada. Espera `{ eligible, reason }` dentro do campo `content` da resposta. A triagem não recebe o repositório para análise.
2. **Disparo pela interface.** `web/src/routes/_protected/agent/$errorId.tsx` permite verificar elegibilidade, escolher um ticket vinculado e adicionar instruções. Um resultado não elegível pode ser explicitamente ignorado pelo operador. Também existe uma triagem periódica em `backend/src/workers/eligibility.ts`; ela avalia elegibilidade, não dispara a correção automaticamente.
3. **Preparação no backend.** `backend/src/trpc/routers/agent.ts:83` carrega o projeto, exige agente habilitado e repositório configurado, obtém o stack trace e verifica a triagem. Em seguida, monta o prompt, escolhe a branch de correção, registra a execução e dispara a pipeline externa.
4. **Contexto enviado ao executor.** `backend/src/integrations/agentGitlab.ts:111` monta um prompt com título, projeto, ambiente, severidade, número de ocorrências, ID da task, stack trace e instruções opcionais. O corpo completo do ticket e seu comportamento esperado não são carregados por essa função.
5. **Integração GitLab.** `backend/src/integrations/agentGitlab.ts:28` faz POST em `/projects/{id}/trigger/pipeline`. Envia prompt, repositório alvo, branch de correção, branch de destino, identificador da execução e configuração de callback. A referência da pipeline executora é fixada em `master`; a branch do projeto alvo é um parâmetro separado.
6. **Retorno da pipeline.** `backend/src/server/agentCallbackRoute.ts:26` recebe `POST /rest/agent/callback`, protegido por token. Aceita `running`, `mr_created`, `failed` e `no_changes`, além de URL do MR, motivo de falha, duração e créditos. Atualiza o banco e, quando recebe a criação do MR, tenta comentar o resultado no ticket do Azure DevOps.
7. **Acompanhamento visual.** `web/src/routes/_protected/agent/runs/$runId.tsx:57` consulta o estado a cada 3 segundos durante a execução. Os logs são consultados a cada 5 segundos. `backend/src/trpc/routers/agent.ts:330` os obtém da API GitLab: lista jobs da pipeline e busca o trace do primeiro job retornado. A interface mostra elegibilidade, correção e resultado, com links para pipeline e MR.
8. **Histórico.** `backend/src/db/schema.ts:331` define `agent_runs`, contendo erro, ticket, status, prompt, branch, pipeline, MR, autor, horários, motivo de falha, créditos e duração.

## Papéis diferentes da IA

- **Redação de tickets:** `backend/src/llm/ticketAssistant.ts` chama um assistente HTTP. O backend fornece fatos, solicita campos analíticos e monta o ticket final de forma determinística.
- **Elegibilidade:** outro prompt solicita uma classificação e uma justificativa. Ambos os clientes consultam a mesma variável de override `TICKET_ASSISTANT_URL`, mas possuem URLs padrão distintas. Uma configuração comum dessa variável substitui os dois defaults.
- **Correção:** é delegada ao agente externo, descrito como Kiro headless. Não há um ciclo local de ferramentas de edição implementado no Error Hub.

O modelo exato por trás dos assistentes HTTP e o modelo usado pelo executor não são determinados pelo código disponível. A menção a Claude/Kiro na documentação não comprova um modelo específico em execução.

## Pontos relevantes para o desenho do Resolva

### Aproveitar

- Separação entre interface/orquestração e execução demorada da correção.
- Registro de uma execução antes do disparo, para manter rastreabilidade mesmo quando a integração falha.
- Contexto construído pelo backend, incluindo informações factuais e instruções do operador.
- Identificador de execução compartilhado com o executor.
- Persistência de status, diagnóstico, branch, PR e falhas.
- Atualização visual por consultas periódicas; não é necessário streaming de tokens.
- Distinção entre erro técnico, execução sem mudanças e entrega para revisão.

### Adaptar ao projeto escolar

- Substituir o erro coletado por telemetria pelo ticket cadastrado manualmente no Resolva.
- Incluir descrição, comportamento esperado, reprodução e regras de negócio no contexto da correção. Stack trace é opcional, não uma exigência de todo chamado.
- Usar o GitHub como destino de publicação de branch e PR.
- Manter o executor como uma rotina local do backend no MVP, se essa opção for aprovada; CI remoto não é obrigatório para reproduzir a separação de responsabilidades observada.
- Considerar um agente de programação existente, acionado sem interface, como alternativa à implementação de um ciclo próprio de ferramentas via API. A escolha depende de credenciais, disponibilidade e análise do executor de referência; esta análise não escolhe uma ferramenta.
- Preservar a validação independente: o sucesso deve depender de testes e da confirmação do PR, e não somente do texto produzido pela IA.

## Limitações observadas no lado orquestrador

Estas observações não afirmam que o executor externo tenha as mesmas limitações, pois seu código não está disponível.

- O callback aceita `mr_created` sem exigir `mr_url` e sem evidências estruturadas de testes. Ele persiste o status recebido, sem verificar a existência do MR na API GitLab. Para o Resolva, exigir URL e identificador e confirmar o PR antes de marcar sucesso.
- A mutação de disparo não consulta uma execução ativa nem implementa bloqueio transacional contra duplicatas. A interface informa a existência de execução ou MR, mas o botão não é desabilitado por esses estados. No Resolva, impedir disparos duplicados no backend.
- A branch é montada por ID da task (`prefixo/id`), sem ID da execução. Para tentativas repetidas, definir explicitamente reutilização ou branch distinta e recuperação de PR existente.
- O callback não valida a ordem de transição dos estados. Um evento atrasado pode substituir um resultado terminal. No Resolva, validar as transições e tornar atualizações repetidas idempotentes.
- A elegibilidade usa `Boolean(parsed.eligible)` em vez de validação estrita do contrato. Por exemplo, uma string `"false"` seria considerada verdadeira. No Resolva, validar a resposta estruturada antes de decidir.
- A aparência de progresso não comprova etapas internas de investigação e testes: a interface tem estados agregados e logs da pipeline. Caso o Resolva mostre etapas mais detalhadas, o executor deve publicar eventos reais correspondentes.

## Evidência e próximos dados necessários

Os testes existentes cobrem montagem do prompt, lógica de comentário, tratamento do callback e elegibilidade, entre outros pontos. Não foram executados nesta análise; as dependências locais não estão instaladas. Esses testes não demonstram a criação real de MR pelo executor externo.

Para analisar como os arquivos são realmente editados e o MR é criado, é necessário obter o repositório `error-hub-agent`, especialmente sua configuração de CI, scripts de execução, instruções do Kiro, preparação do projeto, validações e publicação Git/GitLab.

O desenho inicial do Resolva permanece como proposta. Esta análise acrescenta uma alternativa para o motor de correção e não aprova automaticamente mudanças de escopo ou de arquitetura.

## Decisão posterior à análise

O usuário confirmou o uso do Kiro sem interface, seguindo a abordagem do Error Hub. O desenho do Resolva foi atualizado para explicitar o adaptador Kiro CLI headless, as fases de execução e a separação entre correção pelo agente e validação/publicação pelo backend. A execução local continua proposta para o MVP escolar; a escolha do Kiro não exige reproduzir toda a infraestrutura GitLab do projeto de referência.
