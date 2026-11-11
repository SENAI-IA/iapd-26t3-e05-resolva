import { randomUUID } from "node:crypto";
import type { AppDatabase } from "../db/index.js";
import { createTicketRepository } from "../repository/ticketRepository.js";
import { testTargetSnapshot } from "./projectConfig.js";

export const implementationEnvironment = {
  ready: true,
  sourceHashes: { "src/orders/total.ts": "a".repeat(64) },
};

export async function eligibleImplementationTicket(database: AppDatabase, classification = "bug") {
  const ticket = await createTicketRepository(database).create(
    {
      targetSystemKey: "demo",
      title: "Quantidade incorreta",
      description: "O total ignora a quantidade informada.",
      expectedBehavior: "Multiplicar preço pela quantidade.",
      reproductionSteps: null,
      category: "calculo",
    },
    testTargetSnapshot,
  );
  const executionId = randomUUID();
  const triageId = randomUUID();
  await database.pool.query(
    "INSERT INTO executions(id,ticket_id,ticket_version,kind,request_key,status,ticket_snapshot) VALUES ($1,$2,1,'triage',$3,'concluida','{}')",
    [executionId, ticket.id, randomUUID()],
  );
  await database.pool.query(
    `INSERT INTO triages(id,ticket_id,execution_id,ticket_version,ticket_snapshot,classification,summary,observed_behavior,expected_behavior,rule_interpretation,diagnosis,next_action,change_scope,acceptance_criteria,regression_test_plan,prompt_version,source_hashes)
     VALUES ($1,$2,$3,1,'{}',$4,'Resumo','Observado','Esperado','Regra','Diagnóstico','Próxima ação','Ajustar cálculo','["Quantidade correta"]','Executar regressão','v1',$5)`,
    [
      triageId,
      ticket.id,
      executionId,
      classification,
      JSON.stringify(implementationEnvironment.sourceHashes),
    ],
  );
  await database.pool.query(
    "UPDATE tickets SET current_triage_id=$1,classification=$2,status='aguardando_implementacao' WHERE id=$3",
    [triageId, classification, ticket.id],
  );
  return ticket.id;
}

export function implementationEvidence(executionId: string, deliveryId: string) {
  return {
    schemaVersion: 1 as const,
    executionId,
    deliveryId,
    workflowId: "987654",
    workflowDefinitionId: "456",
    workflowAttempt: 1,
    commitSha: "a".repeat(40),
    classification: "bug" as const,
    baseline: { status: "passed" as const, total: 2, passed: 2, failed: 0 },
    regression: { status: "assertion_failed" as const, total: 1, passed: 0, failed: 1 },
    final: { status: "passed" as const, total: 3, passed: 3, failed: 0 },
    test: {
      path: "tests/total.test.ts",
      frozenSha256: "c".repeat(64),
      finalSha256: "c".repeat(64),
    },
    report: { relativePath: "validation.json", sha256: "d".repeat(64), sizeBytes: 512 },
  };
}
