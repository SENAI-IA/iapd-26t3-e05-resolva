import { useEffect, useState, type FormEvent } from "react";
import type {
  Ticket,
  TicketContent,
  TicketDetails,
  TicketEvents,
} from "../../backend/src/domain/contracts.js";
import {
  createTicket,
  getTicket,
  getTicketEvents,
  listTickets,
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
  const [selected, setSelected] = useState<TicketDetails | null>(null);
  const [events, setEvents] = useState<TicketEvent[]>([]);
  const [form, setForm] = useState<TicketContent>(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refreshTickets(selectedId?: number) {
    setLoading(true);
    try {
      const result = await listTickets();
      setTickets(result.items);
      const nextId = selectedId ?? result.items[0]?.id;
      if (nextId !== undefined) {
        const [detail, history] = await Promise.all([getTicket(nextId), getTicketEvents(nextId)]);
        setSelected(detail);
        setEvents(history.items);
      } else {
        setSelected(null);
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
      const [detail, history] = await Promise.all([getTicket(ticketId), getTicketEvents(ticketId)]);
      setSelected(detail);
      setEvents(history.items);
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
