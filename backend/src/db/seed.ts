import { inArray } from "drizzle-orm";
import { createTargetSystemSnapshot, type TargetSystemConfig } from "../config/project.js";
import type { TicketContent } from "../domain/contracts.js";
import type { AppDatabase } from "./index.js";
import { ticketEvents, tickets } from "./schema.js";

export const exampleTickets: readonly TicketContent[] = [
  {
    targetSystemKey: "demo",
    title: "Tarefa com título repetido não alterna pelo ID",
    description:
      "Ao marcar uma tarefa como concluída, outras tarefas com o mesmo título também mudam de estado.",
    expectedBehavior:
      "Somente a tarefa identificada pelo ID selecionado deve alternar entre pendente e concluída.",
    reproductionSteps:
      "1. Crie duas tarefas com o mesmo título. 2. Selecione uma delas. 3. Marque-a como concluída. 4. Observe a outra tarefa.",
    category: "regra_negocio",
  },
  {
    targetSystemKey: "demo",
    title: "Permitir filtrar tarefas por estado",
    description:
      "A lista de tarefas não oferece uma forma de exibir apenas itens pendentes ou concluídos.",
    expectedBehavior:
      "A lista deve permitir visualizar todas as tarefas, somente pendentes ou somente concluídas, preservando a ordem original.",
    reproductionSteps:
      "1. Abra a lista com tarefas pendentes e concluídas. 2. Procure um filtro por estado. 3. Tente exibir apenas as tarefas concluídas.",
    category: "regra_negocio",
  },
  {
    targetSystemKey: "demo",
    title: "Rejeitar tarefas sem título no cadastro",
    description:
      "O cadastro precisa impedir o envio de uma tarefa sem título para evitar itens impossíveis de identificar na lista.",
    expectedBehavior:
      "O formulário deve exigir um título não vazio e informar o problema sem criar a tarefa.",
    reproductionSteps:
      "1. Abra o formulário de nova tarefa. 2. Deixe o título vazio. 3. Envie o formulário.",
    category: "validacao_entrada",
  },
];

const exampleTitles = exampleTickets.map(({ title }) => title);

export async function seedExampleTickets(
  database: AppDatabase,
  targetConfig: TargetSystemConfig,
): Promise<number> {
  const targetSnapshot = createTargetSystemSnapshot(targetConfig);
  const seedTickets = exampleTickets.map((ticket) => ({
    ...ticket,
    targetSystemKey: targetConfig.targetSystemKey,
  }));

  return database.db.transaction(async (tx) => {
    const existing = await tx
      .select({ title: tickets.title })
      .from(tickets)
      .where(inArray(tickets.title, exampleTitles));
    const existingTitles = new Set(existing.map(({ title }) => title));
    let insertedCount = 0;

    for (const content of seedTickets) {
      if (existingTitles.has(content.title)) continue;
      const [ticket] = await tx
        .insert(tickets)
        .values({
          ...content,
          targetConfigVersion: targetSnapshot.version,
          targetConfigSnapshot: targetSnapshot,
        })
        .returning({ id: tickets.id });
      if (!ticket) throw new Error("Não foi possível criar o ticket de exemplo.");
      await tx.insert(ticketEvents).values({
        ticketId: ticket.id,
        type: "created",
        toStatus: "aberto",
        message: "Ticket de exemplo cadastrado.",
        payload: { version: 1, seed: "demo" },
      });
      insertedCount += 1;
    }

    return insertedCount;
  });
}
