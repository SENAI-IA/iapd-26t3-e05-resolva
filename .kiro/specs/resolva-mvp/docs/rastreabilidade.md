# Rastreabilidade — requisitos, tarefas e evidências

Fonte normativa: [R01–R32/Q01–Q08](../requirements.md). Implementação: [tarefas 1–37](../tasks.md). Status inicial de todos os itens: **planejado/não executado**. Os testes citados são arquivos a criar, não testes que passaram nesta avaliação.

| Requisito | Tarefas | Evidência de aceitação a produzir |
| --- | --- | --- |
| R01 | 3–7, 21, 26, 30–31 | `schema.integration.test.ts`; criar/consultar e reiniciar app/Compose mantendo volume |
| R02 | 5, 7, 21, 26 | `domain/ticket.test.ts`, `trpc/tickets.test.ts`; limites exatos/categoria/trim; nenhum dado parcial |
| R03 | 7, 21, 26 | `ticketRepository.integration.test.ts`; busca literal `%`/`_`/barra e paginação estável em conjunto fixo |
| R04 | 4–7, 21, 26 | Duas atualizações versão 1: um sucesso/um conflito; mais recente preservada |
| R05 | 4, 6, 8, 15, 23, 27, 33–35 | `executionRepository.integration.test.ts`; triagem reserva snapshot/version/evento juntos ou rollback e não cria workspace mutável |
| R06 | 6, 8, 10, 27, 34 | Índice parcial real; triagens e implementações concorrentes produzem só uma execução ativa |
| R07 | 6, 8, 23, 27, 34 | Replay de `requestKey` por intenção recupera o mesmo ID sem repetir triagem, implementação ou efeitos externos |
| R08 | 2, 8–9, 14, 23–24 | Ambiente incompleto bloqueia implementação; cadastro, consulta e triagem sem dependência ausente continuam disponíveis |
| R09 | 13, 15, 28, 31, 35 | Falha de verificação na triagem gera `inconclusivo`; baseline inválido na implementação bloqueia antes da edição |
| R10 | 5–7, 14–15, 22–23, 35 | Perguntas reais encerram triagem como `inconclusivo`, deixam `aguardando_informacoes` e não criam alteração ou PR |
| R11 | 5–7, 22, 26, 33 | Complementação registra resposta, invalida triagem, volta a `aberto` e não cria execução |
| R12 | 13–15, 25, 28, 35 | Bug comprova asserção nova falhando; melhoria comprova escopo, critérios e teste do comportamento novo sem falha artificial |
| R13 | 2, 11, 13, 15–16, 28, 31 | Manifesto/hash dos testes; alteração proibida, configuração ou diff excessivo bloqueia |
| R14 | 13–15, 23, 28 | Terceira correção falha e encerra; quarta chamada de fix nunca ocorre |
| R15 | 16–18, 23, 25, 29, 31 | Commit limpo validado = publicado = head do PR; consulta real confirma identidade |
| R16 | 6, 18–19, 27, 29 | Resposta perdida após push/criação: recuperar entrega/PR sem duplicar ou chamar IA |
| R17 | 7, 18–19, 22, 29, 34 | Ajuste behavior/refinement preserva histórico; mudança de regra ou escopo exige nova triagem antes de implementar |
| R18 | 6, 16–19, 27, 29 | Bare Git temporário com avanço remoto: conflito sem force push |
| R19 | 5–7, 22, 26 | Exemplo escrito no requirements: duas confirmações e estado aguardando revisão |
| R20 | 5–7, 19, 22, 26 | Justificativa obrigatória; nova entrega depois de merge; histórico preservado |
| R21 | 4, 6, 8–9, 12, 14, 20, 22–23, 36 | Cursor/sequence recupera triagem, mensagens, classificação, fila e implementação sem duplicar eventos |
| R22 | 10–12, 27–28 | Linux: timeout e morte forçada do pai encerram filho/neto antes de liberar execução |
| R23 | 3–4, 6, 8, 10–11, 23, 27, 33 | Travas/limpeza antes do recovery; triagem ou implementação interrompida libera ticket sem repetir comando/IA |
| R24 | 2, 4, 9, 12, 14, 16–17, 24, 27, 31 | Token fictício ausente de logs, snapshots, banco, eventos, artefatos públicos e API |
| R25 | Todas as frentes pertinentes | Nenhum endpoint/adaptador oferece merge/deploy/escrita em dados de negócio |
| Q01 | 1, 9, 20, 31 | `server.test.ts`; Host externo, Origin externo/nulo recusados; bind local |
| Q02 | 1, 4, 20, 31 | Importação de tipos sem conexão; build frontend sem módulos/segredos do servidor |
| Q03 | 26–29, 31 | Suíte sem conta Kiro/GitHub, com Testcontainers/bare Git e adaptadores falsos |
| Q04 | 20–24, 30–31 | Teclado, foco, erros e layouts 1366×768/390×844 |
| Q05 | 12, 14, 25, 29–30 | Referência local/linhas/hash e versão de prompt ligadas ao diagnóstico |
| Q06 | Gate 0, 25, 30–31 | Registro de ensaio com modelo/versão, teste e PR real; mocks identificados |

## Cenários finais

| Cenário | Tipo de verificação | Resultado esperado |
| --- | --- | --- |
| A — total por quantidade | Manual Kiro/GitHub real | `1500` antes, `2500` depois; teste vermelho/verde; SHA e PR confirmados |
| B — informação insuficiente | Manual Kiro + teste de contrato | Perguntas objetivas, sem PR; complementar e iniciar nova tentativa preserva a anterior |
| C — baseline quebrado | Integração local descartável | Bloqueio antes da IA, com motivo real |
| D — ajuste de revisão | Contrato/fake e ensaio manual no PR de teste | Mesmo PR/branch; behavior reproduz de novo, refinement conserva teste anterior |
| E — publicação parcial | Fault injection com Git local/gh falso | Checkpoint e consulta recuperam um PR; sem criação duplicada |
| F — reinício e morte do pai | Linux/PostgreSQL descartáveis; persistência também manual | Sem descendente vivo/trabalho concorrente; histórico recuperado; retry explícito |
| G — conflito remoto | Bare Git temporário | Nenhum force push/sobrescrita; exige análise humana |
| H — segredo fictício | Testes automatizados | Valor não persiste nem aparece em respostas; nenhum segredo real usado |

A duração do ensaio real não é SLA. Para apresentação, usar execução previamente gravada somente se identificada como evidência de ensaio real; não chamar animação/mock de integração autenticada. Não prometer repetir com IA o mesmo bug já corrigido na base: preparar outro alvo/branch de fixture de forma explícita e manual para cada ensaio.

## Registro de resultado

Na implementação, gerar um relatório com uma linha por requisito/cenário: ID, commit do Resolva, commit do alvo, ambiente/versões/modelo, comando/ação, início/fim, resultado observado, artefato filtrado/hash, responsável e limitação. Estados: `planejado`, `aprovado`, `falhou`, `bloqueado`, `não executado`.

Testes com fakes não comprovam autenticação/disponibilidade externa. Registrar o PR real com URL/SHA e o vínculo à execução. Não preencher aprovado sem executar a verificação. A revisão documental deste pacote valida referências/cobertura de planejamento, não o comportamento do produto.

## Requisitos de triagem e fila

| Requisito | Tarefas | Evidência de aceitação a produzir |
| --- | --- | --- |
| R26 | 5, 7, 14–15, 26, 32–35 | Cinco relatórios de classificação válidos e mensagem persistida com fontes |
| R27 | 5, 7, 14–15, 22, 26, 35 | Recusa fundamentada para falso positivo/entendimento incorreto; nenhuma implementação |
| R28 | 6, 8, 15, 20–23, 28, 32–36 | Bug e melhoria aparecem na fila; nenhum worker ou ação indireta inicia execução |
| R29 | 5, 8–9, 15, 22–23, 26, 34–36 | Backend recusa triagem inválida, critérios ausentes, configuração incompleta ou execução ativa |
| R30 | 6, 8, 15–16, 23, 30, 34–35 | Início manual registra decisão e vincula snapshot da triagem à implementação |
| R31 | 7, 11, 22, 23, 26, 31–37 | Contestação e nova triagem preservam mensagens, fontes, versões e conclusões anteriores |
| R32 | 4–8, 13–15, 21–23, 26–28, 32–37 | Alteração relevante invalida `triageVersion`; início manual exige nova análise |

## Cenários de triagem e elegibilidade

| ID | Cenário | Verificação | Resultado esperado |
| --- | --- | --- | --- |
| T01 | Falso positivo comprovado | Relato, regra, código e evidência mostram que o comportamento alegado não ocorre nas condições informadas | Classificação `falso_positivo`, recusa fundamentada no ticket, sem fila ou implementação |
| T02 | Entendimento incorreto | Comportamento observado está de acordo com uma regra vigente interpretada incorretamente | Classificação `entendimento_incorreto`, explicação da regra, recusa respeitosa e orientação quando aplicável |
| T03 | Bug confirmado | Evidências demonstram divergência entre comportamento atual e regra/esperado vigente | Classificação `bug`, mensagem com proposta de correção, fila persistida, sem implementação automática |
| T04 | Melhoria válida | Solicitação propõe comportamento novo ou mudança de regra sem defeito comprovado | Classificação `melhoria`, escopo e critérios de aceite persistidos, fila persistida |
| T05 | Problema não reproduzido sem evidência suficiente | Verificação não reproduz o problema, mas faltam dados, contexto ou cobertura para concluir | Classificação `inconclusivo`, perguntas ou revisão humana, sem recusa |
| T06 | Documentação contraditória | Regra documentada, código e relato apresentam versões incompatíveis | Classificação `inconclusivo`, fontes e contradição registradas, esclarecimento solicitado |
| T07 | Contestação de recusa | Usuário contesta uma recusa com mensagem ou evidência adicional | Conclusão anterior preservada, nova versão/triagem criada, histórico completo |
| T08 | Ticket alterado após triagem | Relato, esperado, regra ou fonte relevante muda depois da conclusão | Triagem anterior invalidada, implementação recusada até nova triagem |
| T09 | Início manual duplicado | Duas requisições de implementação usam a mesma intenção ou chegam simultaneamente | Uma implementação, mesmo ID por `requestKey`, sem segunda chamada de IA ou PR |
| T10 | Implementação inelegível | Ticket recusado, inconclusivo, desatualizado, sem critérios, ambiente incompleto ou execução ativa | Backend recusa início com erro público e próxima ação; nenhum workspace mutável ou PR |

Cada cenário deve registrar ticket, versão, triagem, execução, classificação, fontes, mensagem, próxima ação e resultado observado. A ausência de implementação nesta fase mantém todos os cenários como **planejados/não executados**.

## Impactos por camada

- **Domínio:** classificações, estados, validade por versão, elegibilidade e transições separadas.
- **Persistência:** tabela de triagens, mensagens imutáveis, snapshots, hashes e fila derivada de tickets elegíveis.
- **API:** procedures distintas para analisar, contestar, complementar, listar fila e iniciar implementação.
- **Kiro:** prompt de triagem somente leitura e relatório estruturado; prompt de implementação recebe triagem válida.
- **Interface:** ações `Analisar ticket` e `Iniciar implementação` separadas, fila, contestação e indicador de triagem desatualizada.
- **Testes:** domínio, repository, contratos, executor, API e interface cobrem recusa, dúvida, bug, melhoria, invalidação, idempotência e inelegibilidade.
