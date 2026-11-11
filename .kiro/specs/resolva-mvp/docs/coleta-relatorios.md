# Coleta de relatórios da pipeline — plano e evidências

## Escopo

Continuar as tarefas 12–14 e 39 do [plano](../tasks.md): coletar um relatório
estruturado do run autorizado, validar testes/identidade e persistir evidência
sanitizada antes da conclusão. Manter o checkpoint, a tentativa e a confirmação
de PR/SHA já existentes; não executar workflow nem IA durante a coleta.

## Contratos e decisões

- `implementations.collectReport({ executionId })` aceita somente a identidade
  local. O backend determina repositório, run, tentativa, entrega e configuração
  pelos registros persistidos; não recebe relatório ou URL do navegador.
- Exigir checkpoint e run vinculado, concluído com sucesso e com correlação
  válida. Artefato único `resolva-report-<executionId>-<tentativa>`, não expirado,
  associado ao run e com digest SHA-256 autenticado pelo GitHub.
- Baixar ZIP pelo `gh` com ambiente mínimo e buffer até 256 KiB. Ler exatamente
  `report.json` (1–64 KiB) em memória, sem extrair caminhos no disco. Usar `yauzl`
  com limites/CRC e validação de entradas; `yazl` é dependência apenas dos testes.
  Essa opção evita um parser ZIP próprio e a extração sem limites por subprocesso.
- O envelope v1 contém identidades, classificação, configuração, branch/SHA/PR,
  manifesto de linhas, relatório final Kiro, hash do teste congelado e os três
  relatórios Vitest com resultado do processo (baseline, regressão e final).
- Conferir contagens e asserções executadas, nenhuma falha de runner/timeout,
  falha identificada no teste novo para bug, comportamento novo aprovado para
  melhoria, validação final completa e hash do teste preservado.
- Sanitizar textos conhecidos e descartar campos desconhecidos dos relatórios
  Vitest. Não alterar silenciosamente identidade/hash/caminho que contenha um
  segredo configurado: recusar o relatório nesse caso.
- Gravar cópia normalizada/sanitizada em arquivo regular privado e identificado
  por conteúdo. Só depois aprovar evidência e metadados no banco, revalidando o
  contexto sob lock. Falha do banco pode deixar arquivo órfão, sem aprovação;
  não fazer limpeza automática de evidências.
- Repetição usa a aprovação/proposta existente ou a cópia local aprovada após
  resposta perdida. A conclusão continua passando pela confirmação remota comum.
- Leitura segura do ZIP/GitHub e parser/orquestração são domínios independentes,
  desenvolvidos em paralelo conforme a habilidade de delegação. Revisão final
  e suíte completa verificam a integração.

## Execução

- [x] Testar e implementar proveniência, download binário e leitura limitada do ZIP.
- [x] Reproduzir falhas do adaptador Vitest e validar envelope/testes/relatório Kiro.
- [x] Testar e implementar persistência segura da cópia sanitizada e reuso local.
- [x] Testar e implementar coleta por API, contexto transacional e conclusão.
- [x] Atualizar rastreabilidade, revisar e executar verificações locais.

## Foco de revisão

Artefato de outra tentativa/run; duplicidade, expiração e digest divergente;
ZIP com expansão excessiva/symlink/caminho extra; relatório verde sem asserções;
erro de runner/timeout confundido com reprodução; alteração de contexto durante
download; segredo em diagnóstico/saída; queda entre arquivo, aprovação e proposta.

## Limites

Esta entrega implementa o consumidor do contrato e usa respostas GitHub falsas
nos testes. A workflow produtora e as fases reais do Kiro continuam pendentes;
o backend não transforma texto livre do agente em prova de execução de testes.
O produtor deve ser a workflow controlada, que executa os comandos e gera o
envelope. O ambiente padrão continua bloqueado até essa integração e seu ensaio.

## Evidências

A suíte unitária passou com Node 22.23.1: 417 testes em 24 arquivos, incluindo
limites do ZIP, digest e tamanho autenticados, erros de transporte, parser dos
três relatórios Vitest, sanitização, armazenamento privado e reuso concorrente.
A suíte de integração PostgreSQL passou com 149 testes em nove arquivos. O fluxo
novo cobre coleta HTTP, relatório ausente ou inválido, workflow ainda em execução,
contexto alterado durante o download, reuso de cópia local após falha da proposta,
arquivo aprovado alterado e concorrência sem duplicar artefatos.

Também passaram o typecheck do backend, o lint do backend e `git diff --check`.
A verificação de formatação global ainda precisa ser executada com o Node/pnpm do
projeto antes do commit. Nenhum workflow, Pull Request ou banco de produção foi
alterado pelos testes.
