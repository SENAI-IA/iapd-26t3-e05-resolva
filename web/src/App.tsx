import { useEffect, useState, type FormEvent } from "react";
import type {
  Ticket,
  TicketContent,
  TicketDetails,
  TicketEvents,
} from "../../backend/src/domain/contracts.js";
import type {
  ImplementationDetail,
  ImplementationEvents,
  ImplementationListResult,
  ImplementationQueueResult,
  PublicEnvironment,
} from "../../backend/src/domain/implementationContracts.js";
import type { TriageDetail } from "../../backend/src/domain/triageContracts.js";
import {
  contestTriage,
  createTicket,
  collectImplementationReport,
  getImplementation,
  getImplementationArtifact,
  getImplementationEnvironment,
  getImplementationEvents,
  getTicket,
  getTicketEvents,
  getTriage,
  listImplementationQueue,
  listImplementations,
  listTickets,
  provideTicketInformation,
  reconcileDispatch,
  reopenTicket,
  resolveTicket,
  startImplementation,
  startTriage,
  updateTicket,
} from "./api";

type TicketEvent = TicketEvents["items"][number];

const statusLabels: Record<Ticket["status"], string> = {
  aberto: "Aberto",
  em_triagem: "Em triagem",
  recusado: "Recusado",
  aguardando_informacoes: "Aguardando informações",
  aguardando_implementacao: "Aguardando implementação",
  em_andamento: "Em andamento",
  aguardando_revisao: "Aguardando revisão",
  resolvido: "Resolvido",
};

const triageStatusLabels: Record<TriageDetail["status"], string> = {
  valid: "Vigente",
  invalidated: "Desatualizada",
  superseded: "Substituída",
};

const emptyForm: TicketContent = {
  targetSystemKey: "demo",
  title: "",
  description: "",
  expectedBehavior: "",
  reproductionSteps: null,
  category: "calculo",
};

function App() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [totalTickets, setTotalTickets] = useState(0);
  const [queue, setQueue] = useState<ImplementationQueueResult["items"]>([]);
  const [executions, setExecutions] = useState<ImplementationListResult["items"]>([]);
  const [environment, setEnvironment] = useState<PublicEnvironment | null>(null);
  const [selected, setSelected] = useState<TicketDetails | null>(null);
  const [triage, setTriage] = useState<TriageDetail | null>(null);
  const [implementation, setImplementation] = useState<ImplementationDetail | null>(null);
  const [implementationEvents, setImplementationEvents] = useState<ImplementationEvents["items"]>(
    [],
  );
  const [implementationEventCursor, setImplementationEventCursor] = useState(0);
  const [validationReport, setValidationReport] = useState<string | null>(null);
  const [events, setEvents] = useState<TicketEvent[]>([]);
  const [form, setForm] = useState<TicketContent>(emptyForm);
  const [editingTicketId, setEditingTicketId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Ticket["status"] | "">("");
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageSaving, setMessageSaving] = useState(false);
  const [mergeConfirmed, setMergeConfirmed] = useState(false);
  const [testVerified, setTestVerified] = useState(false);
  const [decisionMessage, setDecisionMessage] = useState("");
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refreshTickets(selectedId?: number, requestedPage = page) {
    setLoading(true);
    try {
      const ticketQuery = {
        page: requestedPage,
        pageSize: 15,
        ...(search.trim() ? { q: search.trim() } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
      };
      const [result, implementationQueue, implementationList, implementationEnvironment] =
        await Promise.all([
          listTickets(ticketQuery),
          listImplementationQueue(),
          listImplementations(),
          getImplementationEnvironment(),
        ]);
      setTickets(result.items);
      setTotalTickets(result.total);
      setPage(requestedPage);
      setQueue(implementationQueue.items);
      setExecutions(implementationList.items);
      setEnvironment(implementationEnvironment);
      const nextId = selectedId ?? result.items[0]?.id;
      if (nextId !== undefined) {
        const detail = await getTicket(nextId);
        const [history, currentTriage, currentImplementation, currentImplementationEvents] =
          await Promise.all([
            getTicketEvents(nextId),
            detail.ticket.currentTriageId
              ? getTriage(detail.ticket.currentTriageId)
              : Promise.resolve(null),
            detail.latestExecution?.kind === "implementation"
              ? getImplementation(detail.latestExecution.id)
              : Promise.resolve(null),
            detail.latestExecution?.kind === "implementation"
              ? getImplementationEvents(detail.latestExecution.id)
              : Promise.resolve(null),
          ]);
        setSelected(detail);
        setEvents(history.items);
        setTriage(currentTriage);
        setImplementation(currentImplementation);
        setImplementationEvents(currentImplementationEvents?.items ?? []);
        setImplementationEventCursor(currentImplementationEvents?.nextSequence ?? 0);
      } else {
        setSelected(null);
        setTriage(null);
        setImplementation(null);
        setImplementationEvents([]);
        setImplementationEventCursor(0);
        setValidationReport(null);
        setEvents([]);
      }
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar os tickets.");
    } finally {
      setLoading(false);
    }
  }

  async function pollImplementationEvents() {
    if (!implementation || implementation.execution.status !== "em_andamento") return;
    try {
      const result = await getImplementationEvents(
        implementation.execution.id,
        implementationEventCursor,
      );
      if (result.items.length > 0) {
        setImplementationEvents((current) => {
          const known = new Set(current.map((event) => event.id));
          return [...current, ...result.items.filter((event) => !known.has(event.id))];
        });
      }
      setImplementationEventCursor(result.nextSequence);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível atualizar os eventos.");
    }
  }

  useEffect(() => {
    void refreshTickets();
  }, []);

  useEffect(() => {
    if (!executions.some(({ execution }) => execution.status === "em_andamento")) return;
    const timer = window.setInterval(() => {
      void refreshTickets(selected?.ticket.id);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [executions, page, search, selected?.ticket.id, statusFilter]);

  useEffect(() => {
    if (!implementation || implementation.execution.status !== "em_andamento") return;
    const timer = window.setInterval(() => {
      void pollImplementationEvents();
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [implementation, implementationEventCursor]);

  async function selectTicket(ticketId: number) {
    setAction(null);
    setValidationReport(null);
    try {
      const detail = await getTicket(ticketId);
      const [history, currentTriage, currentImplementation, currentImplementationEvents] =
        await Promise.all([
          getTicketEvents(ticketId),
          detail.ticket.currentTriageId
            ? getTriage(detail.ticket.currentTriageId)
            : Promise.resolve(null),
          detail.latestExecution?.kind === "implementation"
            ? getImplementation(detail.latestExecution.id)
            : Promise.resolve(null),
          detail.latestExecution?.kind === "implementation"
            ? getImplementationEvents(detail.latestExecution.id)
            : Promise.resolve(null),
        ]);
      setSelected(detail);
      setEvents(history.items);
      setTriage(currentTriage);
      setImplementation(currentImplementation);
      setImplementationEvents(currentImplementationEvents?.items ?? []);
      setImplementationEventCursor(currentImplementationEvents?.nextSequence ?? 0);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar o ticket.");
    }
  }

  function startNewTicket() {
    setEditingTicketId(null);
    setForm({
      ...emptyForm,
      targetSystemKey: environment?.targetSystem?.targetSystemKey ?? emptyForm.targetSystemKey,
      category: environment?.targetSystem?.categories[0]?.slug ?? emptyForm.category,
    });
    setNotice(null);
    setShowForm(true);
  }

  function editSelectedTicket() {
    if (!selected) return;
    setEditingTicketId(selected.ticket.id);
    setForm({
      targetSystemKey: selected.ticket.targetSystemKey,
      title: selected.ticket.title,
      description: selected.ticket.description,
      expectedBehavior: selected.ticket.expectedBehavior,
      reproductionSteps: selected.ticket.reproductionSteps,
      category: selected.ticket.category,
    });
    setNotice(null);
    setShowForm(true);
  }

  async function submitTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const content = {
        ...form,
        reproductionSteps: form.reproductionSteps?.trim() || null,
      };
      const ticket = editingTicketId
        ? await updateTicket({
            ...content,
            ticketId: editingTicketId,
            expectedVersion: selected?.ticket.version ?? 0,
          })
        : await createTicket(content);
      setForm(emptyForm);
      setEditingTicketId(null);
      setShowForm(false);
      setNotice(`${ticket.code} ${editingTicketId ? "atualizado" : "cadastrado"}.`);
      await refreshTickets(ticket.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível cadastrar o ticket.");
    } finally {
      setSaving(false);
    }
  }

  async function analyzeTicket() {
    if (!selected) return;
    setAction("triage");
    setError(null);
    try {
      await startTriage({
        ticketId: selected.ticket.id,
        expectedVersion: selected.ticket.version,
        requestKey: crypto.randomUUID(),
      });
      setNotice("Triagem solicitada.");
      await refreshTickets(selected.ticket.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível iniciar a triagem.");
    } finally {
      setAction(null);
    }
  }

  async function implementTicket() {
    if (!selected) return;
    setAction("implementation");
    setError(null);
    try {
      await startImplementation({
        ticketId: selected.ticket.id,
        expectedVersion: selected.ticket.version,
        requestKey: crypto.randomUUID(),
      });
      setNotice("Implementação solicitada.");
      await refreshTickets(selected.ticket.id);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Não foi possível iniciar a implementação.",
      );
    } finally {
      setAction(null);
    }
  }

  async function reconcileImplementation() {
    if (!implementation?.execution.workflowId) return;
    setAction("reconcile");
    setError(null);
    try {
      const result = await reconcileDispatch({
        executionId: implementation.execution.id,
        workflowId: implementation.execution.workflowId,
      });
      setNotice(`Workflow consultada: ${result.observedStatus}.`);
      if (selected) await refreshTickets(selected.ticket.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível reconciliar a workflow.");
    } finally {
      setAction(null);
    }
  }

  async function collectImplementationReportResult() {
    if (!implementation) return;
    setAction("collect-report");
    setError(null);
    try {
      await collectImplementationReport(implementation.execution.id);
      setNotice("Relatório da pipeline coletado.");
      if (selected) await refreshTickets(selected.ticket.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível coletar o relatório.");
    } finally {
      setAction(null);
    }
  }

  async function loadValidationReport() {
    const artifactId = implementation?.validation?.report.artifactId;
    if (!implementation || !artifactId) return;
    setAction("artifact");
    setError(null);
    try {
      const result = await getImplementationArtifact(implementation.execution.id, artifactId);
      setValidationReport(result.content);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar o relatório.");
    } finally {
      setAction(null);
    }
  }

  async function resolveSelectedTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !mergeConfirmed || !testVerified) return;
    setAction("resolve");
    setError(null);
    try {
      await resolveTicket({
        ticketId: selected.ticket.id,
        expectedVersion: selected.ticket.version,
        mergeConfirmed: true,
        testVerified: true,
        ...(decisionMessage.trim() ? { message: decisionMessage.trim() } : {}),
      });
      setNotice("Ticket resolvido.");
      setDecisionMessage("");
      setMergeConfirmed(false);
      setTestVerified(false);
      await refreshTickets(selected.ticket.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível resolver o ticket.");
    } finally {
      setAction(null);
    }
  }

  async function reopenSelectedTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !decisionMessage.trim()) return;
    setAction("reopen");
    setError(null);
    try {
      await reopenTicket({
        ticketId: selected.ticket.id,
        expectedVersion: selected.ticket.version,
        message: decisionMessage.trim(),
      });
      setNotice("Ticket reaberto.");
      setDecisionMessage("");
      await refreshTickets(selected.ticket.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível reabrir o ticket.");
    } finally {
      setAction(null);
    }
  }

  async function submitTicketMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !message.trim()) return;
    setMessageSaving(true);
    setError(null);
    try {
      const input = {
        ticketId: selected.ticket.id,
        expectedVersion: selected.ticket.version,
        message: message.trim(),
      };
      if (selected.ticket.status === "aguardando_informacoes") {
        await provideTicketInformation(input);
        setNotice("Informação registrada. O ticket voltou para análise.");
      } else if (selected.ticket.status === "recusado") {
        await contestTriage(input);
        setNotice("Contestação registrada.");
      }
      setMessage("");
      await refreshTickets(selected.ticket.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível registrar a mensagem.");
    } finally {
      setMessageSaving(false);
    }
  }

  const canProvideInformation = selected?.ticket.status === "aguardando_informacoes";
  const canContest = selected?.ticket.status === "recusado" && triage !== null;
  const canResolve = selected?.ticket.status === "aguardando_revisao";
  const canReopen = selected?.ticket.status === "resolvido";
  const canAnalyze =
    selected?.ticket.status === "aberto" || selected?.ticket.status === "aguardando_informacoes";
  const canEdit =
    selected?.ticket.status === "aberto" || selected?.ticket.status === "aguardando_informacoes";
  const canImplement =
    selected?.ticket.status === "aguardando_implementacao" && triage?.status === "valid";
  const configuredCategories = environment?.targetSystem?.categories ?? [];

  return (
    <main className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div>
            <p className="text-sm font-semibold tracking-[0.2em] text-muted uppercase">Resolva</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Operação do MVP-1</h1>
          </div>
          <button
            className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
            onClick={startNewTicket}
            type="button"
          >
            Novo ticket
          </button>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-6 py-8 lg:grid-cols-[22rem_1fr]">
        <section className="rounded-xl border border-line bg-surface p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Tickets</h2>
              <p className="mt-1 text-sm text-muted">Entrada e acompanhamento do fluxo.</p>
            </div>
            <button
              className="text-sm font-semibold text-ink underline decoration-line underline-offset-4"
              onClick={() => void refreshTickets(selected?.ticket.id)}
              type="button"
            >
              Atualizar
            </button>
          </div>
          <form
            className="mt-5 space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              void refreshTickets(undefined, 1);
            }}
          >
            <input
              className="field mt-0"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por código ou título"
              value={search}
            />
            <div className="flex gap-2">
              <select
                className="field mt-0"
                onChange={(event) => setStatusFilter(event.target.value as Ticket["status"] | "")}
                value={statusFilter}
              >
                <option value="">Todos os status</option>
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                className="rounded-lg border border-line px-3 text-sm font-semibold"
                type="submit"
              >
                Buscar
              </button>
            </div>
          </form>
          {!loading && tickets.length === 0 ? (
            <p className="mt-8 rounded-lg bg-canvas p-4 text-sm text-muted">
              Nenhum ticket cadastrado.
            </p>
          ) : null}
          <div className="mt-5 space-y-2">
            {tickets.map((ticket) => (
              <button
                className={`w-full rounded-lg border p-4 text-left transition ${selected?.ticket.id === ticket.id ? "border-ink bg-canvas" : "border-line hover:border-ink"}`}
                key={ticket.id}
                onClick={() => void selectTicket(ticket.id)}
                type="button"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-xs font-semibold text-muted">{ticket.code}</span>
                  <span className="text-xs text-muted">v{ticket.version}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm font-semibold">{ticket.title}</p>
                <p className="mt-2 text-xs text-muted">{statusLabels[ticket.status]}</p>
              </button>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between text-xs text-muted">
            <span>
              Página {page} · {totalTickets} ticket{totalTickets === 1 ? "" : "s"}
            </span>
            <div className="flex gap-2">
              <button
                className="rounded border border-line px-2 py-1 disabled:opacity-40"
                disabled={page === 1 || loading}
                onClick={() => void refreshTickets(undefined, page - 1)}
                type="button"
              >
                Anterior
              </button>
              <button
                className="rounded border border-line px-2 py-1 disabled:opacity-40"
                disabled={page * 15 >= totalTickets || loading}
                onClick={() => void refreshTickets(undefined, page + 1)}
                type="button"
              >
                Próxima
              </button>
            </div>
          </div>
          <div className="mt-8 border-t border-line pt-5">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-semibold">Fila de implementação ({queue.length})</h3>
              <span className={`text-xs ${environment?.ready ? "text-emerald-700" : "text-muted"}`}>
                {environment?.ready
                  ? `${environment.sourceCount} fontes disponíveis`
                  : "Ambiente pendente"}
              </span>
            </div>
            {queue.length === 0 ? (
              <p className="mt-3 text-sm text-muted">Nenhum ticket elegível.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {queue.map(({ ticket, eligibility }) => (
                  <button
                    className="w-full rounded-lg border border-line p-3 text-left text-sm hover:border-ink"
                    key={ticket.id}
                    onClick={() => void selectTicket(ticket.id)}
                    type="button"
                  >
                    <span className="font-semibold">{ticket.code}</span>
                    <span className="mt-1 block text-muted">
                      {eligibility.eligible ? "Pronto para iniciar" : eligibility.message}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="mt-8 border-t border-line pt-5">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-semibold">Ambiente de execução</h3>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${environment?.ready ? "bg-emerald-50 text-emerald-700" : "bg-canvas text-muted"}`}
              >
                {environment?.ready ? "Disponível" : "Pendente"}
              </span>
            </div>
            <p className="mt-2 text-sm text-muted">
              {environment?.ready
                ? `${environment.sourceCount} fonte${environment.sourceCount === 1 ? "" : "s"} autorizada${environment.sourceCount === 1 ? "" : "s"} para análise.`
                : "Configure as fontes autorizadas para habilitar as execuções."}
            </p>
            {environment?.targetSystem ? (
              <dl className="mt-4 grid gap-3 text-xs text-muted">
                <div>
                  <dt>Repositório</dt>
                  <dd className="mt-1 break-all font-semibold text-ink">
                    {environment.targetSystem.repository}
                  </dd>
                </div>
                <div>
                  <dt>Branch base</dt>
                  <dd className="mt-1 font-semibold text-ink">
                    {environment.targetSystem.baseBranch}
                  </dd>
                </div>
                <div>
                  <dt>Workflow</dt>
                  <dd className="mt-1 break-all font-semibold text-ink">
                    {environment.targetSystem.workflowRef}
                  </dd>
                </div>
              </dl>
            ) : null}
          </div>
          <div className="mt-8 border-t border-line pt-5">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-semibold">Execuções recentes ({executions.length})</h3>
              {executions.some(({ execution }) => execution.status === "em_andamento") ? (
                <span className="text-xs text-muted">Atualização automática</span>
              ) : null}
            </div>
            {executions.length === 0 ? (
              <p className="mt-3 text-sm text-muted">Nenhuma execução registrada.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {executions.map(({ execution, ticket }) => (
                  <button
                    className="w-full rounded-lg border border-line p-3 text-left text-sm hover:border-ink"
                    key={execution.id}
                    onClick={() => void selectTicket(ticket.id)}
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{ticket.code}</span>
                      <span className="text-xs text-muted">{execution.status}</span>
                    </div>
                    <span className="mt-1 block text-muted">
                      {execution.stage ?? "Etapa não informada"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="space-y-6">
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          ) : null}
          {notice ? (
            <div className="rounded-lg border border-line bg-surface px-4 py-3 text-sm text-muted">
              {notice}
            </div>
          ) : null}
          {showForm ? (
            <form
              className="rounded-xl border border-line bg-surface p-6"
              onSubmit={(event) => void submitTicket(event)}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">
                    {editingTicketId ? "Editar ticket" : "Cadastrar ticket"}
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    {editingTicketId
                      ? "Alterações relevantes invalidam a triagem atual."
                      : "O cadastro não inicia triagem ou implementação."}
                  </p>
                </div>
                <button
                  className="text-sm text-muted underline underline-offset-4"
                  onClick={() => {
                    setEditingTicketId(null);
                    setForm(emptyForm);
                    setShowForm(false);
                  }}
                  type="button"
                >
                  Cancelar
                </button>
              </div>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-semibold">
                  Sistema-alvo
                  {environment?.targetSystem ? (
                    <select
                      className="field"
                      disabled
                      onChange={(event) =>
                        setForm({ ...form, targetSystemKey: event.target.value })
                      }
                      value={form.targetSystemKey}
                    >
                      <option value={environment.targetSystem.targetSystemKey}>
                        {environment.targetSystem.displayName}
                      </option>
                    </select>
                  ) : (
                    <input className="field" disabled value="Nenhum sistema configurado" />
                  )}
                </label>
                <label className="text-sm font-semibold">
                  Categoria
                  {configuredCategories.length > 0 ? (
                    <select
                      className="field"
                      onChange={(event) => setForm({ ...form, category: event.target.value })}
                      value={form.category}
                    >
                      {configuredCategories.map((category) => (
                        <option key={category.slug} value={category.slug}>
                          {category.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input className="field" disabled value="Nenhuma categoria disponível" />
                  )}
                </label>
                <label className="text-sm font-semibold sm:col-span-2">
                  Título
                  <input
                    className="field"
                    minLength={5}
                    required
                    onChange={(event) => setForm({ ...form, title: event.target.value })}
                    value={form.title}
                  />
                </label>
                <label className="text-sm font-semibold sm:col-span-2">
                  Relato
                  <textarea
                    className="field min-h-28"
                    minLength={20}
                    required
                    onChange={(event) => setForm({ ...form, description: event.target.value })}
                    value={form.description}
                  />
                </label>
                <label className="text-sm font-semibold sm:col-span-2">
                  Comportamento esperado
                  <textarea
                    className="field min-h-24"
                    minLength={10}
                    required
                    onChange={(event) => setForm({ ...form, expectedBehavior: event.target.value })}
                    value={form.expectedBehavior}
                  />
                </label>
                <label className="text-sm font-semibold sm:col-span-2">
                  Passos de reprodução <span className="font-normal text-muted">(opcional)</span>
                  <textarea
                    className="field min-h-20"
                    onChange={(event) =>
                      setForm({ ...form, reproductionSteps: event.target.value })
                    }
                    value={form.reproductionSteps ?? ""}
                  />
                </label>
              </div>
              <button
                className="mt-6 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                disabled={saving}
                type="submit"
              >
                {saving
                  ? editingTicketId
                    ? "Salvando..."
                    : "Salvando..."
                  : editingTicketId
                    ? "Salvar alterações"
                    : "Cadastrar ticket"}
              </button>
            </form>
          ) : null}

          {selected ? (
            <article className="rounded-xl border border-line bg-surface p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-muted">
                    {selected.ticket.code} · versão {selected.ticket.version}
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                    {selected.ticket.title}
                  </h2>
                  <p className="mt-2 text-sm text-muted">
                    {selected.ticket.category} · {selected.ticket.targetSystemKey}
                  </p>
                </div>
                <span className="rounded-full bg-canvas px-3 py-1 text-sm font-semibold">
                  {statusLabels[selected.ticket.status]}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-3 text-sm text-muted">
                {selected.latestExecution ? (
                  <span className="rounded-full bg-canvas px-3 py-1">
                    Execução: {selected.latestExecution.status}
                    {selected.latestExecution.stage ? ` · ${selected.latestExecution.stage}` : ""}
                  </span>
                ) : null}
                {selected.currentDelivery ? (
                  <span className="rounded-full bg-canvas px-3 py-1">
                    PR #{selected.currentDelivery.prNumber ?? "pendente"}
                  </span>
                ) : null}
                {implementation?.execution.workflowUrl ? (
                  <a
                    className="rounded-full bg-canvas px-3 py-1 underline underline-offset-4"
                    href={implementation.execution.workflowUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Workflow da implementação
                  </a>
                ) : null}
              </div>
              <div className="mt-8 grid gap-6 md:grid-cols-2">
                <div>
                  <h3 className="text-sm font-semibold">Relato</h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted">
                    {selected.ticket.description}
                  </p>
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Comportamento esperado</h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted">
                    {selected.ticket.expectedBehavior}
                  </p>
                </div>
              </div>
              {selected.ticket.reproductionSteps ? (
                <div className="mt-6">
                  <h3 className="text-sm font-semibold">Passos de reprodução</h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted">
                    {selected.ticket.reproductionSteps}
                  </p>
                </div>
              ) : null}
              {triage ? (
                <>
                  <section className="mt-8 rounded-lg bg-canvas p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3 className="font-semibold">Resultado da triagem</h3>
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full bg-surface px-3 py-1 text-sm font-semibold">
                          {triage.classification}
                        </span>
                        <span
                          className={`rounded-full px-3 py-1 text-sm font-semibold ${triage.status === "valid" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}
                        >
                          Triagem {triageStatusLabels[triage.status]}
                        </span>
                      </div>
                    </div>
                    <div className="mt-5 grid gap-5 md:grid-cols-2">
                      <div>
                        <h4 className="text-sm font-semibold">Resumo</h4>
                        <p className="mt-1 text-sm leading-6 text-muted">{triage.summary}</p>
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold">Diagnóstico</h4>
                        <p className="mt-1 text-sm leading-6 text-muted">{triage.diagnosis}</p>
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold">Comportamento observado</h4>
                        <p className="mt-1 text-sm leading-6 text-muted">
                          {triage.observedBehavior}
                        </p>
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold">Próxima ação</h4>
                        <p className="mt-1 text-sm leading-6 text-muted">{triage.nextAction}</p>
                      </div>
                    </div>
                    {triage.questions.length > 0 ? (
                      <div className="mt-5">
                        <h4 className="text-sm font-semibold">Informações necessárias</h4>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
                          {triage.questions.map((question) => (
                            <li key={question}>{question}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {triage.uncertainties.length > 0 ? (
                      <div className="mt-5">
                        <h4 className="text-sm font-semibold">Incertezas e limitações</h4>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
                          {triage.uncertainties.map((uncertainty) => (
                            <li key={uncertainty}>{uncertainty}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {triage.changeScope || triage.regressionTestPlan ? (
                      <div className="mt-5 grid gap-5 md:grid-cols-2">
                        {triage.changeScope ? (
                          <div>
                            <h4 className="text-sm font-semibold">Escopo da mudança</h4>
                            <p className="mt-1 text-sm leading-6 text-muted">
                              {triage.changeScope}
                            </p>
                          </div>
                        ) : null}
                        {triage.regressionTestPlan ? (
                          <div>
                            <h4 className="text-sm font-semibold">Plano de regressão</h4>
                            <p className="mt-1 text-sm leading-6 text-muted">
                              {triage.regressionTestPlan}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {triage.acceptanceCriteria.length > 0 ? (
                      <div className="mt-5">
                        <h4 className="text-sm font-semibold">Critérios de aceite</h4>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
                          {triage.acceptanceCriteria.map((criterion) => (
                            <li key={criterion}>{criterion}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {triage.references.length > 0 ? (
                      <div className="mt-5">
                        <h4 className="text-sm font-semibold">Referências consultadas</h4>
                        <ul className="mt-2 space-y-1 text-sm text-muted">
                          {triage.references.map((reference) => (
                            <li key={`${reference.path}-${reference.startLine}`}>
                              {reference.path}:{reference.startLine}-{reference.endLine}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </section>
                  {canProvideInformation || canContest ? (
                    <form
                      className="mt-6 rounded-lg border border-line p-5"
                      onSubmit={(event) => void submitTicketMessage(event)}
                    >
                      <h3 className="text-sm font-semibold">
                        {canProvideInformation ? "Adicionar informação" : "Contestar triagem"}
                      </h3>
                      <textarea
                        className="field min-h-24"
                        minLength={1}
                        required
                        onChange={(event) => setMessage(event.target.value)}
                        placeholder={
                          canProvideInformation
                            ? "Informe o dado que faltou para a triagem."
                            : "Explique por que a triagem deve ser revisada."
                        }
                        value={message}
                      />
                      <button
                        className="mt-4 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        disabled={messageSaving}
                        type="submit"
                      >
                        {messageSaving ? "Enviando..." : "Registrar mensagem"}
                      </button>
                    </form>
                  ) : null}
                </>
              ) : null}
              {canResolve ? (
                <form
                  className="mt-6 rounded-lg border border-line p-5"
                  onSubmit={(event) => void resolveSelectedTicket(event)}
                >
                  <h3 className="text-sm font-semibold">Confirmar resolução</h3>
                  <label className="mt-3 flex items-start gap-2 text-sm text-muted">
                    <input
                      checked={mergeConfirmed}
                      onChange={(event) => setMergeConfirmed(event.target.checked)}
                      type="checkbox"
                    />
                    O merge da Pull Request foi confirmado.
                  </label>
                  <label className="mt-2 flex items-start gap-2 text-sm text-muted">
                    <input
                      checked={testVerified}
                      onChange={(event) => setTestVerified(event.target.checked)}
                      type="checkbox"
                    />
                    A correção foi verificada em teste.
                  </label>
                  <textarea
                    className="field min-h-20"
                    onChange={(event) => setDecisionMessage(event.target.value)}
                    placeholder="Mensagem opcional da resolução."
                    value={decisionMessage}
                  />
                  <button
                    className="mt-4 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    disabled={action !== null || !mergeConfirmed || !testVerified}
                    type="submit"
                  >
                    {action === "resolve" ? "Resolvendo..." : "Confirmar resolução"}
                  </button>
                </form>
              ) : null}
              {canReopen ? (
                <form
                  className="mt-6 rounded-lg border border-line p-5"
                  onSubmit={(event) => void reopenSelectedTicket(event)}
                >
                  <h3 className="text-sm font-semibold">Reabrir ticket</h3>
                  <textarea
                    className="field min-h-20"
                    minLength={1}
                    onChange={(event) => setDecisionMessage(event.target.value)}
                    placeholder="Explique por que o ticket deve ser reaberto."
                    required
                    value={decisionMessage}
                  />
                  <button
                    className="mt-4 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    disabled={action !== null}
                    type="submit"
                  >
                    {action === "reopen" ? "Reabrindo..." : "Reabrir ticket"}
                  </button>
                </form>
              ) : null}
              {implementation ? (
                <section className="mt-6 rounded-lg border border-line p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">Execução de implementação</h3>
                    <span className="rounded-full bg-canvas px-3 py-1 text-sm font-semibold">
                      {implementation.execution.status}
                    </span>
                  </div>
                  <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <dt className="text-muted">Etapa</dt>
                      <dd className="mt-1 font-semibold">
                        {implementation.execution.stage ?? "Não informada"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">Rodada</dt>
                      <dd className="mt-1 font-semibold">{implementation.execution.round}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Modo</dt>
                      <dd className="mt-1 font-semibold">
                        {implementation.execution.mode ?? "Não informado"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">SHA validado</dt>
                      <dd className="mt-1 break-all font-semibold">
                        {implementation.execution.validatedSha ?? "Pendente"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">SHA publicado</dt>
                      <dd className="mt-1 break-all font-semibold">
                        {implementation.execution.publishedSha ?? "Pendente"}
                      </dd>
                    </div>
                  </dl>
                  {implementation.execution.diagnosis ? (
                    <div className="mt-4 border-t border-line pt-4">
                      <h4 className="text-sm font-semibold">Diagnóstico</h4>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-muted">
                        {implementation.execution.diagnosis}
                      </p>
                    </div>
                  ) : null}
                  {implementation.execution.blockerMessage ? (
                    <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                      <strong>
                        Impedimento
                        {implementation.execution.blockerCode
                          ? ` · ${implementation.execution.blockerCode}`
                          : ""}
                      </strong>
                      <p className="mt-1">{implementation.execution.blockerMessage}</p>
                    </div>
                  ) : null}
                  {implementation.execution.outcome ? (
                    <p className="mt-4 text-sm text-muted">{implementation.execution.outcome}</p>
                  ) : null}
                  {implementation.validation ? (
                    <div className="mt-4 border-t border-line pt-4">
                      <h4 className="text-sm font-semibold">Validação</h4>
                      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                        {(["baseline", "regression", "final"] as const).map((phase) => {
                          const result = implementation.validation?.[phase];
                          return (
                            <div key={phase}>
                              <dt className="text-muted">{phase}</dt>
                              <dd className="mt-1 font-semibold">
                                {result?.status === "passed" ? "Aprovado" : "Falhou"} ·{" "}
                                {result?.passed}/{result?.total}
                              </dd>
                            </div>
                          );
                        })}
                      </dl>
                      <p className="mt-3 break-all text-xs text-muted">
                        Teste: {implementation.validation.test.path} · Relatório:{" "}
                        {implementation.validation.report.relativePath}
                      </p>
                      {implementation.validation.report.artifactId ? (
                        <>
                          <button
                            className="mt-3 rounded-lg border border-line px-3 py-2 text-sm font-semibold disabled:opacity-50"
                            disabled={action !== null}
                            onClick={() => void loadValidationReport()}
                            type="button"
                          >
                            {action === "artifact" ? "Carregando..." : "Ver relatório"}
                          </button>
                          {validationReport ? (
                            <pre className="mt-3 max-h-80 overflow-auto rounded-lg bg-ink p-4 text-xs whitespace-pre-wrap text-white">
                              {validationReport}
                            </pre>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  ) : null}
                  {implementation.delivery ? (
                    <div className="mt-4 border-t border-line pt-4 text-sm text-muted">
                      Branch{" "}
                      <strong className="text-ink">{implementation.delivery.branchName}</strong>
                      {implementation.delivery.prState
                        ? ` · PR ${implementation.delivery.prState}`
                        : " · PR pendente"}
                    </div>
                  ) : null}
                  {implementationEvents.length > 0 ? (
                    <div className="mt-4 border-t border-line pt-4">
                      <h4 className="text-sm font-semibold">Eventos da execução</h4>
                      <ol className="mt-3 space-y-3">
                        {implementationEvents.map((event) => (
                          <li className="border-l-2 border-line pl-4" key={event.id}>
                            <div className="flex flex-wrap justify-between gap-2 text-xs text-muted">
                              <span className="font-semibold">
                                #{event.sequence} · {event.type}
                              </span>
                              <time dateTime={event.createdAt}>
                                {new Date(event.createdAt).toLocaleString("pt-BR")}
                              </time>
                            </div>
                            <p className="mt-1 text-sm text-muted">{event.message}</p>
                            {event.stage ? (
                              <p className="mt-1 text-xs text-muted">Etapa: {event.stage}</p>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : null}
                </section>
              ) : null}
              <div className="mt-8 border-t border-line pt-5">
                <h3 className="text-sm font-semibold">Histórico</h3>
                <ol className="mt-3 space-y-3">
                  {events.map((event) => (
                    <li className="border-l-2 border-line pl-4" key={event.id}>
                      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted">
                        <span className="font-semibold">{event.type}</span>
                        <time dateTime={event.createdAt}>
                          {new Date(event.createdAt).toLocaleString("pt-BR")}
                        </time>
                      </div>
                      <p className="mt-1 text-sm text-muted">{event.message}</p>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="mt-8 flex flex-wrap gap-3 border-t border-line pt-5">
                {canEdit ? (
                  <button
                    className="rounded-lg border border-line px-4 py-2 text-sm font-semibold"
                    onClick={editSelectedTicket}
                    type="button"
                  >
                    Editar ticket
                  </button>
                ) : null}
                {canAnalyze ? (
                  <button
                    className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    disabled={action !== null}
                    onClick={() => void analyzeTicket()}
                    type="button"
                  >
                    {action === "triage" ? "Solicitando..." : "Analisar ticket"}
                  </button>
                ) : null}
                {canImplement ? (
                  <button
                    className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    disabled={action !== null}
                    onClick={() => void implementTicket()}
                    type="button"
                  >
                    {action === "implementation" ? "Solicitando..." : "Iniciar implementação"}
                  </button>
                ) : null}
                {implementation?.execution.workflowId ? (
                  <button
                    className="rounded-lg border border-line px-4 py-2 text-sm font-semibold disabled:opacity-50"
                    disabled={action !== null}
                    onClick={() => void reconcileImplementation()}
                    type="button"
                  >
                    {action === "reconcile" ? "Consultando..." : "Atualizar execução"}
                  </button>
                ) : null}
                {implementation?.execution.workflowId ? (
                  <button
                    className="rounded-lg border border-line px-4 py-2 text-sm font-semibold disabled:opacity-50"
                    disabled={action !== null}
                    onClick={() => void collectImplementationReportResult()}
                    type="button"
                  >
                    {action === "collect-report" ? "Coletando..." : "Coletar relatório"}
                  </button>
                ) : null}
                {selected.currentDelivery?.prUrl ? (
                  <a
                    className="self-center text-sm font-semibold text-ink underline underline-offset-4"
                    href={selected.currentDelivery.prUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Abrir Pull Request
                  </a>
                ) : null}
                {selected.latestExecution ? (
                  <p className="self-center text-sm text-muted">
                    Última execução: {selected.latestExecution.status}
                  </p>
                ) : null}
              </div>
            </article>
          ) : (
            <div className="rounded-xl border border-dashed border-line bg-surface p-10 text-center">
              <h2 className="font-semibold">Selecione um ticket</h2>
              <p className="mt-2 text-sm text-muted">
                Cadastre um ticket ou selecione um item da lista para começar.
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export { App };
