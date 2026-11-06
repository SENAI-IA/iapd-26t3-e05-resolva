# Viabilidade do Resolva

Data: 06/11/2026. Avaliação documental da `main` em `1c645e26ce67c634a3c255c434fefaec67160f63`, relida após a atualização do produto. [PRD](../PRD.md).

## Parecer

**Viável como produto B2B de engenharia de software, com condições.** O escopo inicial atende equipes que precisam acelerar a correção de defeitos pequenos em módulos conhecidos, mantendo teste de regressão, controle de escopo, rastreabilidade e aprovação humana. A principal dificuldade técnica é coordenar processos, permissões, evidências e publicação de forma recuperável.

Ainda não estão comprovados funcionamento de ponta a ponta, ganho de produtividade, qualidade média das correções, prazo, custo operacional ou disposição de pagamento. O piloto deve produzir essas evidências antes de uma oferta comercial ampla.

## 1. Evidências atuais

| Fato verificável | Fonte | Limite |
| --- | --- | --- |
| Aplicação ainda não implementada | README e árvore da versão atual | Sem build/testes funcionais para executar |
| Uma spec canônica com requisitos, design e 31 tarefas | `.kiro/specs/resolva-mvp/` | Planejamento não equivale a funcionalidades prontas |
| Regras/arquitetura ativas com `inclusion: always` | `.kiro/steering/` | Aplicabilidade ao executor do alvo ainda precisa de ensaio |
| Capacidade operacional disponível | Ainda não medida | Não informa prazo, cobertura de suporte ou custo de operação |
| Kiro documenta headless, motor e permissões | Fontes oficiais consultadas nesta análise | Não prova conta, modelo ou perfil de produção |

A base examinada concentra a documentação ativa em `.kiro/`. Requisitos comerciais, métricas de mercado e custos reais ainda precisam ser validados com usuários e uma operação controlada.

## 2. Dimensões de viabilidade

| Dimensão | Avaliação | Condição |
| --- | --- | --- |
| Problema de negócio | Favorável | Defeitos pequenos e repetitivos geram demanda recorrente por triagem e correção |
| Produto | Favorável com escopo controlado | Caso real verificável, revisão humana e tratamento explícito de impedimentos |
| Tecnologia | Favorável com risco moderado/alto de integração | Ensaio de Kiro/GitHub antes da expansão do produto |
| Operação | Favorável em ambiente local ou privado | Um projeto-alvo confiável, isolamento e ausência de dados de produção |
| Prazo | Indeterminado | Confirmar capacidade e medir o primeiro marco |
| Financeiro | Não quantificado | Medir consumo de IA, infraestrutura, suporte e retrabalho |
| Mercado | Não validado | Entrevistar equipes, testar disposição de pagamento e medir retenção |
| Segurança e conformidade | Condicionadas | Autenticação, autorização, isolamento e auditoria antes de uso compartilhado |

## 3. Enquadramento de mercado e modelo operacional

O Resolva atende inicialmente equipes de engenharia que mantêm aplicações em repositórios Git e precisam reduzir o tempo gasto entre triagem, reprodução e abertura de um Pull Request. O comprador potencial é o líder de engenharia ou responsável por produtividade; o usuário diário é o desenvolvedor que acompanha e revisa a execução.

A proposta comercial depende de quatro provas: redução mensurável do tempo de correção, qualidade das mudanças comparável ao fluxo humano, custo previsível de IA e operação segura em ambientes controlados. O primeiro piloto deve medir essas dimensões com um projeto-alvo separado, sem confundir documentação de intenção com resultado de produto.

O MVP começa como operação local ou privada para um projeto confiável. Uma versão compartilhada exigirá autenticação, autorização por projeto, isolamento de workspaces, auditoria, limites de consumo, retenção de evidências e suporte operacional. Integrações com outros provedores de IA, GitLab e Azure DevOps podem ampliar o mercado depois da validação do fluxo principal.

A receita pode ser validada por uma combinação de assinatura por workspace, cobrança por execução ou contrato privado com suporte. A escolha depende de entrevistas com clientes, custo real por execução e frequência de uso; nenhum modelo de preço está definido nesta fase.

## 4. Alternativas

| Abordagem | Vantagem | Custo/limite | Recomendação |
| --- | --- | --- | --- |
| Painel local + backend + Kiro + GitHub | Atende a jornada definida | Integração de processos e estados | Manter |
| CLI + relatório + PR | Menos interface e esforço | Muda o objetivo visual | Redução de escopo possível, mediante decisão |
| Agente próprio por API | Controle fino das ferramentas | Aumenta implementação e avaliação | Adiar |

Manter TypeScript já escolhido. Um alvo Java/JUnit pode ser evolução, mas a compatibilidade não está incluída no primeiro adaptador Vitest JSON. Não inferir suporte a um sistema como SGN3 a partir de um piloto pequeno.

## 5. Ensaio inicial de compatibilidade — 16 pessoas-hora

Trabalho futuro, sem aplicação completa. Lucas/Sergio são donos propostos.

1. Configurar alvo de teste separado, com baseline verde, regra escrita e bug de quantidade.
2. Registrar CLI, `chat --help`, motor, modelo e modo de autenticação; não registrar valor de credencial.
3. Confirmar execução headless, relatório JSON do Resolva e eventos públicos capturáveis.
4. Provar permissão por fase e negação de shell, web, MCP, subagentes e escrita externa; examinar configurações globais/workspace/hooks herdadas.
5. Executar pelo supervisor/script do ensaio o teste novo e observar asserção falhando; corrigir e validar.
6. Com acesso autorizado, publicar um PR no alvo de validação e conferir SHA/identidade por consulta. Não fazer merge automaticamente.
7. Registrar duração e uso/custo somente quando a fonte permitir; produzir parecer prosseguir/replanejar.

**Prosseguir:** capacidades controladas, relatório interpretável, testes vermelho/verde, publicação autenticada e sinais de valor para o cliente comprovados. **Replanejar:** incompatibilidade, falta de orçamento, permissões insuficientes ou custo operacional incompatível. Fakes não substituem o ensaio real. Nenhuma chamada paga foi feita nesta avaliação documental.

## 6. Estimativa por pacote

Pacotes são agrupamentos das 31 tarefas existentes, não novas specs concorrentes.

| Pacote | Pessoas-hora de referência |
| --- | ---: |
| P00 — compatibilidade e prova de fluxo | 16 |
| P01 — fundação e contratos | 24 |
| P02 — tickets, triagem e API | 48 |
| P03 — executor, validação, recuperação e orquestração | 56 |
| P04 — Kiro, contexto e relatórios | 40 |
| P05 — GitHub e reconciliação | 32 |
| P06 — interface, fila e operação | 48 |
| P07 — QA, piloto e operação | 36 |
| **Subtotal** | **300** |
| Reserva de integração/retrabalho de 25% | 75 |
| **Total de planejamento** | **375** |

Estimativa de engenharia por decomposição; não há velocidade medida da equipe. Inclui triagem, testes, revisão e operação inicial; não representa horas já realizadas. Dependências impedem dividir simplesmente por cinco.

Hipótese de cinco pessoas × dez horas/semana × 75% de capacidade efetiva: 37,5 pessoas-hora/semana; `375 / 37,5 = 10 semanas`. Com seis horas por pessoa: cerca de 16,7 semanas. Se forem quatro semanas a dez horas por pessoa, a capacidade efetiva seria 150 horas, insuficiente para essa estimativa completa.

Reestimar no primeiro marco. Se faltar tempo, reduzir escopo explicitamente; não remover proteção de testes, supervisão ou conferência de SHA enquanto mantiver publicação automática.

## 7. Custo da IA

Conta, modelo e contrato não foram disponibilizados. Não atribuir preço/gratuidade. Uma execução inicial percorre análise + reprodução + uma a três correções: três a cinco chamadas de fase quando chega ao fim. Cada fase pode incluir várias interações internas; fase não equivale a uma requisição faturada.

Medir consumo no provedor durante o ensaio. Orçamento deve considerar consumo observado, novas tentativas e margem aprovada pelo responsável pelo produto. Registrar `executionId`, modelo, fases/rodadas e duração; custo desconhecido permanece desconhecido. Timeouts e limite de rodadas não garantem teto monetário.

Testes automatizados usam integrações falsas ou recursos descartáveis, sem modelo pago ou PR real. O ensaio autenticado é manual e separado.

## 8. Riscos e tratamento

| Risco | Impacto | Tratamento/evidência | Dono proposto |
| --- | --- | --- | --- |
| Perfil headless não restringe capacidades | Alto | Ensaio real, versão registrada e permissões verificadas | Lucas/Sergio |
| Modelo inventa diagnóstico | Alto | Referências verificáveis, regra escrita e asserção de reprodução | Lucas |
| Testes enfraquecidos para passar | Alto | Manifesto/hashes e teste congelado | Sergio |
| Resposta perdida/PR duplicado | Alto | Checkpoints e reconciliação antes da IA/publicação | Amadeu |
| Processos vivos após queda | Alto | Supervisor Linux e morte forçada do pai em teste | Sergio |
| Segredo em saída ou contexto | Alto | Ambiente mínimo, filtragem e token fictício nos testes | Lucas/Amadeu |
| Gargalo de integração | Médio/alto | Contratos cedo, pares e PRs pequenos | Equipe |
| Credenciais/rede falham no piloto | Alto | Ensaiar antes e preservar evidências reais identificadas | Equipe |
| Custo de IA acima do valor gerado | Alto | Medir consumo por execução e definir limites antes da oferta | Produto/Engenharia |
| Segurança insuficiente para uso compartilhado | Alto | Exigir autenticação, isolamento e auditoria antes da expansão | Plataforma |
| Hipótese de mercado não confirmada | Alto | Entrevistar clientes e medir uso recorrente/disposição de pagamento | Produto |

## 9. Fontes e confiança

- Commit base consultado: `1c645e26ce67c634a3c255c434fefaec67160f63`.
- [Kiro headless](https://kiro.dev/docs/cli/headless/), [permissões](https://kiro.dev/docs/permissions/) e [seleção de motor](https://kiro.dev/docs/cli/agent-harness/), consultados em 06/11/2026.

**Confiança: média.** Alta na descrição dos arquivos; média na viabilidade técnica; baixa para prazo/custo sem conta, ensaio e disponibilidade confirmados.
