# Compatibilidade do Kiro na triagem

## Evidência local

- `kiro-cli --version` retornou `3.1.0`. O `chat --help` local lista as opções
  `--v3`, `--no-interactive`, `--output-format stream-json`, `--agent`,
  `--model` e `--trust-workspace`.
- `kiro-cli agent validate --path <perfil-gerado>` com um HOME temporário
  exigiu login. O checkout estava sem `.env` e `resolva.config.json`, e
  `KIRO_API_KEY` não estava exportada. A validação autenticada e as permissões
  efetivas continuam pendentes.
- A execução automatizada usa um processo simulado. Ela percorre reserva HTTP,
  montagem do contexto, relatório, validação e persistência no PostgreSQL.

## Contrato do adaptador

`runKiroTriage` recebe o snapshot da reserva, fontes selecionadas, modelo,
credencial e um supervisor injetado. Prepara um diretório temporário com HOME
próprio. Salva as fontes com nomes numerados em `context/` para evitar que
nomes como `AGENTS.md` acionem a descoberta de instruções. O manifesto
preserva os caminhos originais para referências e hashes. O seletor do
projeto-alvo deve fornecer os textos após autorizar caminhos e conteúdo.
O lote aceita até 100 fontes e 512 KiB somando texto e prompt.

O perfil gerado nega leitura fora das cópias e escrita fora do relatório.
Regras explícitas negam shell, MCP, web e subagentes. O adaptador usa
argumentos separados e envia o prompt por stdin, com marcadores de referência
`@` escapados no JSON. O supervisor deve aplicar o timeout, limitar a saída
total a 10 MiB e aguardar o encerramento do grupo antes de devolver o código
de saída. O ensaio autenticado deve confirmar a política efetiva.
[Modo headless](https://kiro.dev/docs/cli/headless/).
[Configuração de agentes](https://kiro.dev/docs/custom-agents/configuration-reference/).
[Permissões](https://kiro.dev/docs/cli/chat/permissions/).
[Referências a arquivos](https://kiro.dev/docs/cli/chat/file-references/).

A conclusão exige código de saída zero e arquivo regular de até 64 KiB. O
backend confere versão, execução, ticket, fase, classificação, hashes e
referências antes de entregar o resultado ao serviço. O relatório só pode
declarar verificação indisponível ou não executada nessa fase. Fontes externas,
referências além do fim de um arquivo e ocorrências de credenciais conhecidas
invalidam o resultado.

## Pendências do ensaio

Preparar alvo e conta de teste, validar o perfil autenticado e comprovar
permissões efetivas para leitura das cópias e escrita do relatório. Exercitar
tentativas de acesso fora do manifesto, shell, Git, MCP, web, subagentes e
herança de configurações. Capturar eventos públicos do CLI e validar o formato
real antes de persistir eventos. O supervisor e o seletor de fontes precisam
estar ligados à API para habilitar novos inícios. Os itens do Gate 0 continuam
abertos.
