export type ErrorCode = "auth" | "rate" | "network" | "timeout" | "cancelled" |
  "server" | "response" | "missing" | "ambiguous" | "credentials";

export class ADSError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message);
    this.name = "ADSError";
  }
}

// Never expose raw transport, credential-store, or response errors: they may
// contain request headers, reflected secrets, or server-controlled markup.
export function safeReason(error: unknown): string {
  return error instanceof ADSError ? error.message : "An unexpected error occurred. Please try again.";
}

export function stopsRequests(error: unknown): boolean {
  return error instanceof ADSError && ["auth", "rate", "network", "timeout", "cancelled", "server"].includes(error.code);
}
