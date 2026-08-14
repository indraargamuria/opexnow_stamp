export type ErrorStage = "auth" | "tenant" | "template" | "anchor" | "peruri_auth" | "peruri_api" | "signing" | "storage" | "input";

export class AppError extends Error {
  status: number;
  code: string;
  stage: ErrorStage | null;
  details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    stage: ErrorStage | null = null,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.stage = stage;
    this.details = details;
  }

  static badRequest(msg: string, details?: Record<string, unknown>): AppError {
    return new AppError(400, "bad_request", msg, "input", details);
  }

  static unauthorized(msg = "Missing or invalid credentials"): AppError {
    return new AppError(401, "unauthorized", msg, "auth");
  }

  static forbidden(msg = "Access denied"): AppError {
    return new AppError(403, "forbidden", msg, "auth");
  }

  static notFound(msg = "Not found"): AppError {
    return new AppError(404, "not_found", msg, null);
  }

  static tooMany(msg: string, retryAfter?: string, details?: Record<string, unknown>): AppError {
    return new AppError(429, "quota_exceeded", msg, null, { ...details, retry_after: retryAfter });
  }

  static conflict(msg: string): AppError {
    return new AppError(409, "conflict", msg, null);
  }
}
