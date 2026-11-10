export type DomainErrorCode = "BAD_REQUEST" | "NOT_FOUND" | "CONFLICT" | "PRECONDITION_FAILED";

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
    public readonly activeExecutionId?: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
