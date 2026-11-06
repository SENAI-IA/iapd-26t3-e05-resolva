# Regras do projeto escolar

## IA para DEVs [SD] — Bloco 2: Projeto Avaliativo

Este documento consolida as regras, os requisitos, o formato de entrega e os critérios de avaliação do projeto avaliativo.

## 1. Objetivo

A squad deverá desenvolver uma solução de automação com IA capaz de realizar uma auditoria inicial de segurança em artefatos de software.

A aplicação deverá:

- receber arquivos e trechos de código;
- acionar tools auxiliares e integrações externas ao LLM;
- consultar uma base de conhecimento por RAG ou mecanismo equivalente;
- classificar achados por categoria e severidade;
- recomendar ações para cada achado;
- gerar evidências, relatórios e logs da análise;
- manter rastreabilidade dos prompts, tools, documentos recuperados e decisões do agente.

A solução tem finalidade didática. Ela não substitui uma revisão humana especializada nem pretende ser uma ferramenta profissional completa de segurança.

O agente deve tomar decisões em mais de uma etapa, adaptar a análise ao contexto encontrado, justificar recomendações e produzir saídas estruturadas.

## 2. Entrega

O código deve ser versionado em um repositório privado no GitHub. O planejamento e a organização do trabalho devem ser realizados no Trello.

Os links do GitHub e do Trello devem ser enviados na tarefa **Bloco 2 - Projeto Avaliativo**, disponível na semana 06 do AVA, até **22/05/2026 às 22h**.

O repositório privado deve adicionar as seguintes pessoas:

- Luiz Carlos Silva Araujo — `luizcs-araujo`;
- Operação LAB365 — `lab365-operacao`.

Não serão aceitos projetos enviados após o prazo nem alterações realizadas depois da entrega.

A data final será considerada como a data da última atualização no repositório do projeto no GitHub. Depois da entrega, não modificar o código até receber a nota.

Todos os integrantes da squad devem enviar os links no AVA para formalizar a entrega.

### 2.1. Formato da entrega

O projeto pode ser entregue individualmente ou em squad de até quatro pessoas.

A nota final será composta por:

- **50%: avaliação da squad**, considerando solução, funcionamento, arquitetura, tools, RAG, documentação, relatório, apresentação e coerência geral;
- **50%: avaliação individual**, considerando participação no Trello e GitHub, branches, commits, pull requests, cards atribuídos, evidências de contribuição e documentação sob responsabilidade do aluno.

Todos os integrantes recebem a mesma nota coletiva. A nota individual pode variar conforme as evidências de participação registradas.

### 2.2. Squad do projeto

- **Nome:** IA para Devs
- **Responsável:** Pedro Mota
- **Membros:** Gustavo Heidemann, Ismael Lunkes, Leandro Gerolim e Pedro Mota

## 3. Requisitos da aplicação

### 3.1. Categorias de risco

A aplicação deve trabalhar com pelo menos três categorias entre as seguintes:

- credenciais, tokens ou segredos expostos;
- entrada de usuário sem validação;
- query dinâmica ou risco de SQL injection;
- configuração insegura;
- dependências suspeitas ou desatualizadas;
- ação sensível sem autorização.

### 3.2. Requisitos funcionais

A solução deve:

1. receber arquivos e trechos de código;
2. executar pelo menos duas tools ou integrações externas ao LLM;
3. possuir pelo menos dois pontos reais de decisão condicional;
4. consultar uma base de conhecimento usando RAG ou mecanismo equivalente;
5. classificar achados por categoria de risco;
6. classificar severidade e confiança, ou critérios equivalentes documentados;
7. decidir uma recomendação ou ação simulada para cada achado;
8. gerar saída estruturada e validável;
9. gerar relatório legível, preferencialmente em Markdown;
10. gerar logs ou rastros da execução do agente;
11. manter evidências dos prompts utilizados;
12. documentar o design das tools orientado a objetivos;
13. demonstrar pelo menos dois cenários diferentes de análise.

### 3.3. Requisitos técnicos

O projeto deve:

- estar em um repositório privado no GitHub;
- possuir `README.md` com instalação, configuração, execução e demonstração;
- possuir `.env.example` sem chaves reais;
- conter entradas, arquivos ou dados de exemplo;
- conter exemplos de saídas, relatórios ou logs;
- documentar o planejamento do projeto;
- documentar a arquitetura e as decisões técnicas;
- documentar o design das tools;
- possuir uma base de conhecimento usada pelo RAG;
- manter os prompts em uma pasta de documentação;
- usar branches conforme o fluxo definido neste documento;
- registrar e acompanhar tarefas no Trello.

As decisões de arquitetura ficam a critério da squad. A solução deve justificar as decisões e demonstrar responsabilidades claras entre os componentes.

## 4. Roteiro da aplicação

### 4.1. Formato do sistema

São formatos aceitáveis:

- aplicação de linha de comando;
- API local, como FastAPI;
- interface simples, como Streamlit;
- aplicação web simples;
- notebook executável acompanhado de instruções claras;
- composição local com scripts, serviços ou integrações mockadas.

O sistema deve aceitar pelo menos uma forma de entrada, como:

- caminho de arquivo ou pasta;
- lista de arquivos;
- texto livre com contexto;
- formulário em uma interface simples;
- requisição para uma API local.

A saída deve permitir identificar:

- artefatos analisados;
- achados identificados;
- categoria, severidade e confiança atribuídas;
- evidências da análise;
- referências de RAG utilizadas;
- recomendação ou ação simulada;
- limitações e incertezas restantes.

Além da saída estruturada, deve existir um relatório legível para uma equipe de desenvolvimento, com resumo da auditoria, explicação dos achados, recomendações e limitações.

Não há estrutura de pastas obrigatória. O repositório deve deixar claros os papéis de entrada, agente ou orquestrador, tools, base de conhecimento, outputs, logs, prompts e documentação.

### 4.2. Documentação no README.md

O `README.md` deve documentar:

- nome e objetivo do software;
- problema que a solução resolve;
- técnicas e tecnologias utilizadas;
- arquitetura, componentes e fluxo principal;
- instalação, configuração e execução;
- exemplos de entradas e saídas;
- cenários de demonstração;
- organização da squad;
- divisão de responsabilidades;
- principais contribuições individuais;
- organização do desenvolvimento;
- link do Trello;
- melhorias futuras e limitações.

Diagramas e imagens podem ser incluídos quando ajudarem a explicar a solução.

### 4.3. Uso do Trello

Criar um quadro público no Trello utilizando Kanban com as colunas:

- `backlog`;
- `todo`;
- `doing`;
- `blocked`;
- `review`;
- `done`.

As tarefas extraídas deste documento devem ser organizadas em cards. Cada integrante deve possuir cards atribuídos ao próprio nome, com:

- descrição clara;
- objetivo;
- escopo;
- critérios de conclusão;
- relação com branch, commit ou funcionalidade, quando aplicável.

Os cards devem ser movimentados conforme o andamento real. A squad pode relacionar cards às branches, por exemplo `feature/create-security-scanner`.

O link do quadro deve estar no `README.md` e ser enviado no AVA. Não utilizar o quadro de exercícios para tarefas do projeto.

### 4.4. Uso do GitHub

O projeto deve seguir estas práticas:

- usar commits sucintos, diretos e com poucos arquivos alterados;
- preferir mensagens no imperativo, como `implementa X` ou `corrige Y`;
- criar a branch `develop` para concentrar os merges durante o desenvolvimento;
- criar feature branches a partir de `develop` para cada tarefa;
- não excluir branches após a conclusão dos pull requests;
- manter o código final mergeado na branch `main`.

As contribuições individuais devem ser rastreáveis por branches, commits e pull requests relacionados às tarefas de cada integrante.

A relação entre cards do Trello, branches, commits e pull requests deve ser coerente e permitir identificar a contribuição técnica de cada aluno.

### 4.5. Apresentação

A apresentação ocorrerá em **25/05/2026, das 19h às 20h30**.

Cada squad terá dez minutos, em formato de pitch. Todos os integrantes devem participar. Caso alguém não possa estar presente, poderá gravar sua fala para apresentação pelos colegas.

A apresentação deve abordar:

- objetivo do sistema;
- problema resolvido;
- funcionamento da aplicação;
- entradas aceitas;
- tools e integrações utilizadas;
- uso da base de conhecimento e do RAG;
- decisões condicionais no fluxo do agente;
- classificação por categoria, severidade e confiança;
- saídas, relatórios, logs e evidências;
- organização das tarefas no Trello;
- branches criadas e seus objetivos;
- divisão de responsabilidades;
- limitações e melhorias possíveis.

## 5. Critérios de avaliação

A avaliação varia de 0 a 10 e representa 60% da avaliação do módulo.

Projetos com plágio de soluções da internet ou de outros colegas receberão nota zero. É permitido utilizar referências, mas não copiar soluções.

### 5.1. Avaliação da squad

A avaliação coletiva considera:

- apresentação da solução no dia definido;
- execução de uma auditoria inicial com IA;
- cobertura de pelo menos três categorias de risco;
- uso relevante de pelo menos duas tools;
- design das tools com objetivos, entradas, saídas, limitações e relação com as decisões;
- pelo menos dois pontos reais de decisão condicional;
- uso de RAG com influência na classificação, severidade ou recomendação;
- achados estruturados com categoria, severidade, confiança, evidências e recomendações;
- relatório legível e validável;
- guardrails, prompts, logs, outputs e decisões rastreáveis.

A solução deve funcionar com entradas reais de arquivos, trechos, diffs ou solicitações documentadas. Dados fixos no código, sem processamento efetivo, não atendem ao requisito.

### 5.2. Avaliação individual

A avaliação individual considera:

- participação em cards relevantes do Trello;
- descrições claras nos cards;
- atualização coerente do fluxo Kanban;
- contribuição relevante para o projeto;
- participação proporcional à dinâmica da squad;
- commits, branches e pull requests rastreáveis;
- uso correto do fluxo de branches;
- mensagens de commit claras e incrementais;
- contribuição técnica integrada à solução final;
- cuidado com organização, documentação e ausência de segredos.

A contribuição pode envolver funcionalidades, tools, RAG, arquitetura, logs, testes, documentação ou apresentação.

## 6. Plano de projeto

Durante o projeto, a squad deve praticar:

- planejamento e acompanhamento de tarefas com Trello;
- versionamento com Git e GitHub;
- uso de branches e commits claros;
- desenvolvimento de agente de IA com tools;
- design de tools orientado a objetivos;
- uso de RAG como base de conhecimento externa;
- separação entre lógica determinística e decisão semântica;
- classificação de riscos e geração de recomendações;
- saída estruturada e relatório técnico;
- logs para simular observabilidade;
- documentação de prompts, decisões e arquitetura;
- apresentação do funcionamento e das decisões técnicas.

O resultado esperado é uma aplicação demonstrável, documentada e rastreável, que mostre como integrar IA, ferramentas, conhecimento externo, documentação e critérios técnicos de avaliação.

## 7. Checklist de entrega

- [ ] Repositório privado criado no GitHub.
- [ ] `luizcs-araujo` adicionado ao repositório.
- [ ] `lab365-operacao` adicionado ao repositório.
- [ ] Trello público criado com as colunas exigidas.
- [ ] Cards atribuídos a todos os integrantes.
- [ ] `README.md` completo.
- [ ] `.env.example` sem credenciais reais.
- [ ] Pelo menos três categorias de risco implementadas.
- [ ] Pelo menos duas tools integradas.
- [ ] Pelo menos dois pontos de decisão condicional demonstrados.
- [ ] Base de conhecimento e RAG documentados.
- [ ] Prompts salvos e documentados.
- [ ] Saídas estruturadas e relatórios de exemplo disponíveis.
- [ ] Logs e evidências de execução disponíveis.
- [ ] Dois cenários de análise demonstráveis.
- [ ] Branch `develop` criada.
- [ ] Feature branches e pull requests registrados.
- [ ] Código final mergeado em `main`.
- [ ] Links do GitHub e Trello enviados por todos os integrantes no AVA até 22/05/2026 às 22h.
- [ ] Apresentação preparada para 25/05/2026.
