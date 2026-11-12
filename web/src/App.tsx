import { useEffect, useState, type FormEvent } from "react";
import type {
  Ticket,
  TicketContent,
  TicketDetails,
  TicketEvents,
} from "../../backend/src/domain/contracts.js";
import type {
  ImplementationQueueResult,
  PublicEnvironment,
} from "../../backend/src/domain/implementationContracts.js";
import type { TriageDetail } from "../../backend/src/domain/triageContracts.js";
import {
  createTicket,
  contestTriage,
  getImplementationEnvironment,
  getTicket,
  getTicketEvents,
  getTriage,
  listImplementationQueue,
  listTickets,
  provideTicketInformation,
  startImplementation,
  startTriage,
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
  const [queue, setQueue] = useState<ImplementationQueueResult["items"]>([]);
  const [environment, setEnvironment] = useState<PublicEnvironment | null>(null);
  const [selected, setSelected] = useState<TicketDetails | null>(null);
  const [triage, setTriage] = useState<TriageDetail | null>(null);
  const [events, setEvents] = useState<TicketEvent[]>([]);
  const [form, setForm] = useState<TicketContent>(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageSaving, setMessageSaving] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refreshTickets(selectedId?: number) {
    setLoading(true);
    try {
      const [result, implementationQueue, implementationEnvironment] = await Promise.all([
        listTickets(),
        listImplementationQueue(),
        getImplementationEnvironment(),
      ]);
      setTickets(result.items);
      setQueue(implementationQueue.items);
      setEnvironment(implementationEnvironment);
      const nextId = selectedId ?? result.items[0]?.id;
      if (nextId !== undefined) {
        const detail = await getTicket(nextId);
        const [history, currentTriage] = await Promise.all([
          getTicketEvents(nextId),
          detail.ticket.currentTriageId
            ? getTriage(detail.ticket.currentTriageId)
            : Promise.resolve(null),
        ]);
        setSelected(detail);
        setEvents(history.items);
        setTriage(currentTriage);
      } else {
        setSelected(null);
        setTriage(null);
        setEvents([]);
      }
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar os tickets.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshTickets();
  }, []);

  async function selectTicket(ticketId: number) {
    setAction(null);
    try {
      const detail = await getTicket(ticketId);
      const [history, currentTriage] = await Promise.all([
        getTicketEvents(ticketId),
        detail.ticket.currentTriageId
          ? getTriage(detail.ticket.currentTriageId)
          : Promise.resolve(null),
      ]);
      setSelected(detail);
      setEvents(history.items);
      setTriage(currentTriage);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar o ticket.");
    }
  }

  async function submitTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const ticket = await createTicket({
        ...form,
        reproductionSteps: form.reproductionSteps?.trim() || null,
      });
      setForm(emptyForm);
      setShowForm(false);
      setNotice(`${ticket.code} cadastrado.`);
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
  const canAnalyze =
    selected?.ticket.status === "aberto" || selected?.ticket.status === "aguardando_informacoes";
  const canImplement = selected?.ticket.status === "aguardando_implementacao";

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
            onClick={() => {
              setNotice(null);
              setShowForm(true);
            }}
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
          {loading ? <p className="mt-8 text-sm text-muted">Carregando...</p> : null}
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
                  <h2 className="text-lg font-semibold">Cadastrar ticket</h2>
                  <p className="mt-1 text-sm text-muted">
                    O cadastro não inicia triagem ou implementação.
                  </p>
                </div>
                <button
                  className="text-sm text-muted underline underline-offset-4"
                  onClick={() => setShowForm(false)}
                  type="button"
                >
                  Cancelar
                </button>
              </div>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-semibold">
                  Sistema-alvo
                  <input
                    className="field"
                    onChange={(event) => setForm({ ...form, targetSystemKey: event.target.value })}
                    value={form.targetSystemKey}
                  />
                </label>
                <label className="text-sm font-semibold">
                  Categoria
                  <input
                    className="field"
                    onChange={(event) => setForm({ ...form, category: event.target.value })}
                    value={form.category}
                  />
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
                {saving ? "Salvando..." : "Cadastrar ticket"}
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
                <section className="mt-8 rounded-lg bg-canvas p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="font-semibold">Resultado da triagem</h3>
                    <span className="rounded-full bg-surface px-3 py-1 text-sm font-semibold">
                      {triage.classification}
                    </span>
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
                      <p className="mt-1 text-sm leading-6 text-muted">{triage.observedBehavior}</p>
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
                </section>
              ) : null}
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
