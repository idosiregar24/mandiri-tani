// Domain error with a stable machine code and a Bahasa Indonesia message
// (backend-standards §3). Thrown by services, mapped to JSON by errorHandler.
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 422,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}
