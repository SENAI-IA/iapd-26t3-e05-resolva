ALTER TABLE "executions" ADD COLUMN "workflow_id" text;--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "workflow_url" text;--> statement-breakpoint
WITH identities AS (
  SELECT DISTINCT ON (execution_id)
    execution_id, payload->>'workflowId' AS workflow_id, payload->>'workflowUrl' AS workflow_url
  FROM execution_events
  WHERE type = 'pipeline_callback'
    AND jsonb_typeof(payload->'workflowId') = 'string'
    AND jsonb_typeof(payload->'workflowUrl') = 'string'
  ORDER BY execution_id, sequence
)
UPDATE executions AS execution
SET workflow_id = identities.workflow_id, workflow_url = identities.workflow_url
FROM identities
WHERE execution.id = identities.execution_id AND execution.kind = 'implementation';--> statement-breakpoint
WITH conflicts AS (
  SELECT execution_id
  FROM execution_events
  WHERE type = 'pipeline_callback'
  GROUP BY execution_id
  HAVING count(DISTINCT jsonb_build_array(payload->'workflowId', payload->'workflowUrl')) > 1
)
UPDATE executions AS execution
SET blocker_code = 'WORKFLOW_IDENTITY_CONFLICT',
    blocker_message = 'O histórico contém workflows divergentes. Reconcilie a execução antes de receber novos callbacks.'
FROM conflicts
WHERE execution.id = conflicts.execution_id
  AND execution.kind = 'implementation' AND execution.status = 'em_andamento';
