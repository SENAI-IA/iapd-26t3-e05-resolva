export class GithubCliError extends Error {
  constructor(
    public readonly reason: "unavailable" | "timeout" | "failed" | "invalid_response",
    message: string,
  ) {
    super(message);
    this.name = "GithubCliError";
  }
}
