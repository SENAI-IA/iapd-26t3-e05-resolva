# PRD — Resolva

**Produto:** do ticket ao Pull Request com IA. **Versão:** 1.0 proposta, 06/11/2026.
**Estado:** MVP em planejamento para validação de produto; implementação ainda não executada.
**Base consultada:** `main`, commit `1c645e26ce67c634a3c255c434fefaec67160f63`.

## 1. Problema e hipótese de valor

O Resolva recebe solicitações técnicas que podem representar defeitos, mudanças de regra ou interpretações incorretas. Antes de alterar código, a plataforma confronta o relato com comportamento esperado, regras de negócio, documentação, código e evidências disponíveis. Uma triagem persistida explica a conclusão e encaminha o ticket para recusa, esclarecimento ou implementação manual.

Na implementação, o backend dispara uma pipeline CI para o sistema-alvo configurado no ticket. A pipeline executa o Kiro CLI em modo headless, altera uma cópia controlada do repositório, roda os testes e abre uma Merge Request. O backend acompanha o resultado e vincula a MR ao ticket.

**Hipótese de valor:** para equipes de engenharia que tratam defeitos pequenos em módulos conhecidos, o fluxo pode reduzir o tempo até a primeira correção revisável sem sacrificar evidências, controle de escopo ou aprovação humana.

**Hipótese comercial:** uma operação local ou privada, com integração controlada ao GitLab CI, pode atender equipes que precisam aumentar a capacidade de manutenção sem entregar autonomia irrestrita a um agente.

## 2. Público e responsabilidades

| Pessoa | Necessidade | Responsabilidade |
| --- | --- | --- |
| Operador de engenharia | Relatar um problema e acompanhar o resultado | Cadastrar tickets, complementar informações e iniciar tentativas |
| Desenvolvedor/revisor | Conferir uma correção sustentada por evidências | Revisar diff, testes e regras; aprovar ou solicitar ajustes |
| Líder de engenharia | Controlar risco, custo e capacidade operacional | Definir políticas, limites, integrações e critérios de adoção |
| Administrador da plataforma | Manter o ambiente e as integrações | Cadastrar e versionar perfis de sistema-alvo, comandos, credenciais e permissões |

Cada ticket seleciona um perfil de sistema-alvo ativo. O perfil define o repositório, branch, caminhos, comandos e modelo permitidos; o operador do ticket não fornece esses valores em texto livre.

O produto pode operar sem login no MVP local. Em uma implantação compartilhada, autenticação, autorização, auditoria por usuário e gestão de múltiplos operadores são evoluções necessárias.

## 3. Objetivos de produto

1. Cadastrar tickets e preservar relato, histórico, versões e conclusões após reinício.
2. Analisar cada ticket antes de qualquer alteração e classificar a solicitação com evidências verificáveis.
3. Explicar a triagem no próprio ticket e encaminhar recusas, dúvidas, bugs e melhorias corretamente.
4. Manter bugs e melhorias em fila persistida, com início de implementação exclusivamente manual.
5. Comprovar bugs com teste novo falhando antes da correção e validar melhorias por escopo, critérios e testes do comportamento novo.
6. Criar ou atualizar somente a Merge Request associada ao commit validado no repositório do sistema configurado no ticket e confirmar sua identidade antes de concluir.
7. Preservar contestação, complementação, reavaliação, histórico e controle de versão sem inventar resultados.

## 4. Escopo e prioridades

P0 e P1 fazem parte do MVP completo R01–R37. A prioridade estabelece sequência, não dispensa requisitos. Qualquer redução exige alteração explícita de requisitos, design e tarefas.

| Prioridade | Capacidade | Evidência de entrega |
| --- | --- | --- |
| P0 | Triagem fundamentada | Classificação, mensagem persistida, fontes e próxima ação |
| P0 | Fila manual de implementação | Bugs e melhorias elegíveis aguardam decisão explícita |
| P0 | Elegibilidade e validade | Versão do ticket, triagem, critérios e configuração conferidos |
| P0 | Configuração do sistema-alvo | Um sistema GitLab, branch base, pipeline e limites definidos no arquivo de configuração |
| P0 | Kiro CLI headless via pipeline | Correção executada fora do processo web, com resultado acompanhado |
| P0 | Merge Request vinculada ao ticket | MR, branch, commit e SHA associados à execução |
| P0 | Validação determinística | Baseline, reprodução ou critérios de melhoria e suíte validada |
| P0 | GitLab CI | Pipeline, branch, commit e MR reais; SHA confirmado; sem duplicação |
| P0 | Acompanhamento visual | Classificação, fila, eventos, testes e impedimentos recuperáveis |
| P0 | Recuperação e proteção | Encerrar processos, preservar testes e bloquear publicação insegura |
| P1 | Contestação e nova triagem | Conclusões anteriores preservadas e nova versão analisada |
| P1 | Complementar e repetir | Nova tentativa explícita com novo snapshot, sem apagar histórico |
| P1 | Ajustes de revisão | Atualizar mesmo PR enquanto aberto e sem conflito remoto |
| P1 | Resolução/reabertura | Confirmar merge/verificação e preservar entregas anteriores |

### Fora do MVP

- Ajustar a correção de dados de negócio, consultar o banco do sistema-alvo ou executar scripts SQL de reparação.
- Merge, deploy, escrita em produção, processamento agendado ou início automático ao cadastrar ticket.
- Repositórios, comandos, caminhos ou modelos arbitrários informados no ticket; somente perfis previamente configurados podem ser selecionados.
- Execução distribuída e serviço público hospedado.
- Login corporativo, importação de tickets, webhooks e leitura automática de comentários de revisão.
- Suporte universal a linguagens/runners. O primeiro alvo usa TypeScript/Vitest JSON; Java/JUnit exige outro adaptador e especificação.

O PostgreSQL do Resolva guarda tickets e evidências do próprio produto. A ideia futura de reparação de dados permanece uma evolução separada; não está autorizada no executor deste MVP.

## 5. Premissas, fatos e propostas

| Item | Situação | Efeito |
| --- | --- | --- |
| Stack, Kiro CLI headless e uma execução local | Definidos nos steerings atuais | Preservados |
| Configuração do sistema-alvo | Decisão desta revisão | Uma configuração GitLab/CI por instalação; ticket seleciona a chave validada |
| Pipeline, conta/modelo Kiro e GitLab | Pendentes | Fluxo real condicionado ao ensaio de compatibilidade |
| Host Linux | Proposta operacional para controlar descendentes | Outras plataformas exigem validação adicional |
| Perfis separados do Resolva | Exigidos no design atual | Executor trabalha em cópia controlada do repositório do perfil e nunca modifica o próprio Resolva |
| Capacidade de operação | Ainda não medida | Confirmar competências, disponibilidade e modelo de suporte |

## 6. Jornadas e regras de negócio

### 6.1 Triagem do ticket

O operador informa a chave do sistema-alvo configurado, título, relato, comportamento esperado, categoria e passos quando disponíveis. O backend valida a configuração e cria o ticket `aberto`, versão 1, com código `RES-<id>` e snapshot da configuração. A ação `Analisar ticket` reserva uma execução de triagem, captura o snapshot e muda o ticket para `em_triagem` na mesma transação.

A triagem consulta o relato, comportamento esperado, regras de negócio, documentação e código dentro dos caminhos autorizados pela configuração selecionada. Ela é executada pelo Kiro CLI em modo headless dentro da pipeline, não edita código durante a triagem, não cria branch ou MR e não inicia implementação.

Toda conclusão persiste no próprio ticket: classificação, justificativa, comportamento observado, comportamento esperado pelas regras, fontes consultadas, evidências verificáveis, incertezas e próxima ação. `falso_positivo` e `entendimento_incorreto` recusam a implementação. `bug` e `melhoria` entram em `aguardando_implementacao`. `inconclusivo` aguarda informação ou revisão.

### 6.2 Fila e implementação manual

A fila é persistida e mostra bugs e melhorias com triagem válida, escopo, critérios e sistema-alvo configurado. Ela não é consumida por worker. O usuário escolhe `Iniciar implementação`; o backend confere classificação, versão do ticket, validade da triagem, configuração, critérios e exclusividade global. Cadastro, análise, complementação ou classificação nunca iniciam implementação automaticamente.

O backend dispara a pipeline CI com o snapshot do ticket e da configuração. A pipeline executa o Kiro CLI headless, prepara o sistema, roda os testes e abre uma Merge Request. Para `bug`, exige teste novo falhando antes da correção. Para `melhoria`, valida o comportamento novo sem fabricar uma falha no comportamento anterior.

### 6.3 Informação, contestação e falhas

Perguntas concretas encerram a triagem como `inconclusivo` e deixam o ticket `aguardando_informacoes`. Complementar registra resposta, invalida a triagem anterior e retorna a `aberto`; não inicia IA automaticamente. Contestação de recusa registra mensagem, preserva a conclusão anterior, incrementa a versão e permite nova triagem.

Erro técnico finaliza a execução como `falhou`; queda do servidor vira `interrompida` após recuperação segura. O ticket volta a `aberto` quando o impedimento não exige informação. Histórico, snapshots, fontes e mensagens permanecem íntegros.

### 6.4 Revisão, fechamento e reabertura

Após PR confirmado, o ticket fica `aguardando_revisao`. O operador pode pedir ajuste de comportamento ou refinamento; mudança de regra ou escopo exige nova triagem. PR aberto e branch conhecida são reutilizados quando a entrega continua válida. Mudança remota não reconhecida ou PR fechado bloqueiam atualização.

Resolver exige confirmação humana de merge e verificação em teste. Reabrir exige justificativa e nova triagem. Depois de merge, nova entrega parte da branch base e usa outra branch/PR, preservando a anterior.

### 6.5 Estados públicos

| Entidade | Valores |
| --- | --- |
| Ticket | `aberto`, `em_triagem`, `recusado`, `aguardando_informacoes`, `aguardando_implementacao`, `em_andamento`, `aguardando_revisao`, `resolvido` |
| Classificação | `falso_positivo`, `entendimento_incorreto`, `bug`, `melhoria`, `inconclusivo` |
| Execução | `em_andamento`, `bloqueada`, `falhou`, `concluida`, `interrompida` |
| Etapa de triagem | `preparando_contexto`, `analisando_ticket`, `consolidando_triagem` |
| Etapa de implementação | `preparando_ambiente`, `reproduzindo_problema`, `implementando_correcao`, `validando`, `publicando_pr` |

## 7. Requisitos e qualidade

Os comportamentos normativos permanecem em [requirements.md](requirements.md), R01–R37. O [design](design.md) detalha triagem, perfis de sistema-alvo, elegibilidade, contratos e limites; o [plano](tasks.md) define as tarefas do MVP; a [matriz](docs/rastreabilidade.md) liga requisito, tarefa, cenário e evidência.

Regras permanentes ficam nos dois steerings. O PRD explica problema, objetivos, prioridades e hipóteses; não cria uma segunda fonte concorrente para os mesmos requisitos. Conflitos devem ser corrigidos de forma explícita nos arquivos canônicos.

- TypeScript estrito sem `any`, Zod nas fronteiras, tRPC tipado e Drizzle/repositories no banco.
- Bind em `127.0.0.1`, Host/Origin locais validados e ausência de CORS aberto. Sem login não implica exposição à rede.
- Um backend/uma execução global; atualização de estado a cada 3 s e eventos a cada 5 s, com cursor e consulta final.
- Defaults propostos: timeout global 1.800 s, comando/chamada Kiro 300 s, até 20 arquivos/1.000 linhas. São limites, não SLA nem teto monetário.
- Credenciais fora de browser, snapshots e evidências; somente credencial necessária no processo correspondente. A autenticação Kiro permanece no mecanismo próprio do CLI/ambiente mínimo, sem entrar no prompt.
- Travas, supervisão de processos, proteção dos testes, reconciliação e SHA validado fazem parte da correção funcional.
- Teclado, rótulos, foco, estados vazios e erros de rede; conferir 1366×768 e 390×844.

## 8. Métricas e aceitação

| Métrica | Medição | Meta proposta |
| --- | --- | --- |
| Triagem fundamentada | Classificação correta com fontes e mensagem persistida | Casos de recusa, dúvida, bug e melhoria sem implementação automática |
| Fila manual | Bug/melhoria elegível aguardando início explícito | Nenhum worker consome a fila; início duplicado é idempotente |
| Validade | Alteração do ticket invalida triagem anterior | Implementação recusada até nova triagem |
| Comunicação | Usuário entende motivo e próxima ação | Mensagem respeitosa com fatos, regra, fontes e limitações |
| Correção verificável | Vermelho/verde + SHA + PR consultado | Ao menos um caso real completo |
| Tempo e consumo | Horários/fases/uso informado pelo provedor | Medir antes de prometer produtividade ou custo |

Caso principal: dois itens de 1.000 centavos e um de 500 devem totalizar `2500`; código defeituoso retorna `1500`. Baseline passa porque não cobre quantidade maior que um. Comparar apenas dois testes verdes não comprova reprodução.

## 9. Arquitetura e alternativas

Manter painel próprio, backend modular/executor em segundo plano e Kiro existente. Uma solução somente CLI reduz interface, mas muda a jornada visual definida; é opção de redução de escopo se a estratégia de produto exigir. Construir um agente próprio aumenta integração e não se justifica neste MVP. Fakes atendem aos testes automatizados; o aceite final exige integração real.

Sem Redis, fila externa ou microserviços: uma instância local ou privada atende à primeira versão. Uma oferta compartilhada exigirá isolamento por projeto, autenticação, autorização, observabilidade e operação multi-tenant.

## 10. Próximas decisões de produto

Primeiro marco: ensaio curto de headless/permissões/autenticação/testes/PR. Depois: fundação e tickets; infraestrutura do executor; adaptadores; orquestração; interface; piloto controlado e validação comercial. A [divisão do trabalho](docs/divisao-trabalho.md) define esforço, dependências e responsáveis propostos.

Estimativa inicial: **320 pessoas-hora + 75 de reserva = 395**, com premissas detalhadas na [viabilidade](docs/viabilidade.md). Não é compromisso de prazo. Confirmar capacidade, orçamento, configuração, modelo e critérios de sucesso antes de comprometer uma entrega.

**Definição de pronto do produto:** R01–R37 verificados, configuração do sistema-alvo selecionada no ticket, triagem e fila manual comprovadas, testes relevantes aprovados, fluxo real Kiro CLI headless/GitLab CI registrado, Merge Request vinculada e revisão humana. Documentação concluída não significa produto executável concluído.

**Confiança: média.** Há suporte documental para a arquitetura e integração; faltam ensaio autenticado, capacidade operacional, métricas de produtividade, custo de operação e validação de mercado.
