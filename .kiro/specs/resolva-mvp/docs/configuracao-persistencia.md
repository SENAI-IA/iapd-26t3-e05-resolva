# Configuração e persistência — segunda entrega

Continuação autorizada do desenvolvimento nas tarefas 2 e 4. Referências:
`../design.md`, seções de configuração, persistência e contrato de triagem v2.

## Plano

- [x] Configuração: testes primeiro de defaults/limites, formato do repositório,
      comandos estruturados, campos desconhecidos, caminhos e symlinks externos;
      implementar `parseTargetSystemConfig(value: unknown): TargetSystemConfig` e
      `loadTargetSystemConfig(path: string): TargetSystemConfig` em `backend/src/config/project.ts`.
- [x] Ambiente: `readEnvironment(source: NodeJS.ProcessEnv): Environment` explícito,
      sem leitura no import; valores secretos e erros de validação não são logs nem
      configuração pública. Ausência de configuração de IA não impede HTTP local.
- [x] Banco: testes em PostgreSQL Testcontainers descartável; implementar schema,
      conexão explícita `createDatabase(url: string)` e migração Drizzle versionada.
      Verificar FKs, unicidades, rollback, índice de execução ativa, triagem e reconexão.
- [x] Scripts `db:generate`, `db:migrate`, `test:integration`; documentação,
      verificações completas e revisão independente antes do commit local.

## Contratos e decisões

- O baseline implementado inclui **sete tabelas**, incluindo `triages`, e agora persiste no ticket a chave, a versão e o snapshot com hash da configuração selecionada. A configuração continua em arquivo validado; não haverá tabela de catálogo nem tabela ou worker separado para a fila.
- A criação e a edição validam a configuração disponível antes da transação. A validação de divergência no início da implementação pertence às tarefas 8 e 38.
- Raízes do sistema-alvo, workspaces e artefatos são relativas à configuração e ficam sob seu diretório. O alvo deve existir; raízes de runtime podem ser criadas futuramente, fora do alvo e sem sobreposição. Não são criadas pelo parser. Checagens reais de symlinks ocorrem ao carregar a configuração; o executor deverá revalidar caminhos imediatamente antes dos efeitos.
- `allowedPaths`, `testPaths` e `documentationPaths` são diretórios, sem globs.
  `testPaths` deve estar contido em `allowedPaths` por componentes de caminho.
  Comandos são objetos do operador, nunca strings de shell ou texto de tickets.
  Argumentos de teste recebem `{reportPath}` gerado pelo backend, não um caminho
  arbitrário de relatório vindo do ticket.
- Os timeouts específicos mantêm default 300 s mesmo quando o timeout global
  configurado for menor. O executor futuro deverá usar o menor valor entre o
  timeout específico e o tempo global restante; não rejeitamos valores globais
  válidos de 60–299 s por causa desses defaults.
- A base Git recebe validação sintática aqui; existência real na origem será
  verificada pelo adaptador Git. Nenhuma chamada externa ou IA ocorre no parser.
- Migrações são explícitas; importar schema/conexão não conecta nem migra. Os testes
  não leem `DATABASE_URL` do operador e não alteram o volume da demonstração.
- Esta entrega prepara a persistência; rotas de tickets e repositories são a
  próxima etapa, sem alegar cadastro persistente disponível agora.

## Evidências

- `pnpm --filter backend test`: validadores inicialmente falharam contra funções
  sem validação; a implementação passou os testes de ambiente e configuração,
  junto dos testes existentes da API. Casos adicionais de escrita em diretórios
  sensíveis e `cwd` apontando para arquivo também seguiram vermelho → verde.
- `pnpm test:integration`: oito testes passaram em PostgreSQL 17 Testcontainers;
  antes da implementação, os oito falharam pela ausência das tabelas. Verificados
  migração idempotente, persistência após reconexão, FKs, rollback, enum de estados,
  versão positiva, sequência única e exclusividade sob concorrência real.
- `pnpm db:generate`: não há diferenças entre schema e migração gerada.
- CLI `pnpm db:migrate` aplicado duas vezes em outro banco descartável: sucesso,
  sete tabelas e erro público sem senha ao apontar para uma porta indisponível.
- `pnpm check`: tipos, lint sem avisos, formatação, testes unitários e builds
  passaram. As integrações são explícitas e exigem Docker; o pacote web permanece
  sem testes de comportamento porque contém apenas a entrada estática.
- Revisão independente identificou três problemas: symlink para a raiz, relação
  `testPaths`/`allowedPaths` perdida após resolver symlinks e rejeição de timeout
  global menor que os defaults específicos. Quatro casos de regressão falharam
  antes da correção e passaram depois; suíte final com 66 testes unitários e
  oito testes de integração. Nenhum achado importante ficou pendente.

Nenhuma configuração do projeto-alvo foi ativada; nenhum comando de alvo,
modelo de IA ou efeito externo do produto foi executado.
