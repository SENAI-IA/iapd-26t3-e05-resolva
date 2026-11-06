# Skills, guardrails e evidências de produto — planejamento

Este arquivo planeja uso futuro; não instala nem implementa skills. Os steerings atuais continuam como regras/arquitetura permanentes e `resolva-mvp` continua a única spec do produto.

## Papéis distintos

| Artefato | Responsabilidade no Resolva |
| --- | --- |
| PRD | Problema, público, objetivos, prioridades, hipóteses e limites |
| Steering | Regras permanentes e arquitetura que orientam desenvolvimento |
| Spec | Requisitos verificáveis, design e tarefas deste MVP |
| Skill | Procedimento reutilizável acionado em situação específica, se implementado e avaliado |
| Adaptador/backend | Controle executável de permissões, testes, estado e publicação |

Uma instrução em prompt/skill não substitui validação de caminhos, proteção de testes ou permissões de processo. Os guardrails determinísticos pertencem ao backend.

## Candidatas a reutilizar ou desenvolver

| Candidata | Acionamento pretendido | Responsável proposto | Evidência/limite |
| --- | --- | --- | --- |
| Revisão de correção funcional | Revisar lógica de domínio, transições e idempotência | Felipe/Sergio | Casos de conflito, estados e edge cases; não presumir disponibilidade na máquina de todos |
| Revisão de segurança | Conferir segredos, caminhos, subprocessos e fronteiras | Lucas/Amadeu | Casos positivos/negativos de acesso; não substitui isolamento do sistema |
| Triagem de ticket | Todo ticket antes da implementação | Lucas | Cinco classificações, fontes verificáveis, perguntas e recusa sem alteração; não substitui decisão humana |
| Verificação de entrega ticket–PR | Antes de declarar implementação validada | Amadeu | Ticket/triagem/execução/teste/SHA/PR coerentes; bloqueio com triagem desatualizada |

Acionamentos são propostas de escopo, sem frontmatter instalado ou promessa de capacidades nativas. Antes de criar uma skill, definir entradas, saídas, limites, exemplos e casos próximos em que ela não deve disparar; validar com a ferramenta/versão escolhida.

## Evals sugeridos

- Falso positivo comprovado: classifica e recusa com fontes, sem editar código.
- Entendimento incorreto: explica a regra vigente e registra a orientação no ticket.
- Bug confirmado: encaminha à fila, sem iniciar implementação.
- Melhoria válida: exige escopo e critérios de aceite, sem fabricar defeito.
- Relato inconclusivo: faz perguntas concretas e não recusa.
- Documentação contraditória: registra fontes conflitantes e solicita esclarecimento.
- Contestação: preserva a decisão anterior e cria nova intenção de triagem.
- Triagem desatualizada: bloqueia implementação após mudança relevante no ticket ou nas fontes.
- Tentativa de edição no perfil de triagem: falha e não cria branch, commit ou PR.
- Pedido apenas de explicação: não inicia triagem nem implementação sem ação explícita.

Registrar resultados observáveis e limitações, sem raciocínio interno do modelo. Em um piloto, distinguir a contribuição semântica do Kiro da decisão determinística do backend e medir qualidade, tempo, custo e necessidade de intervenção humana.
