import { z } from "zod";

import type { ApiErrorBody, ErrorCode } from "../../shared/schemas";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  LOCKED: 423,
  UPSTREAM_ERROR: 502,
  INTERNAL_ERROR: 500,
};

/**
 * The only error type the API deliberately surfaces to clients. Anything else
 * that escapes a handler is logged with its stack and reported as a generic
 * INTERNAL_ERROR so we never leak internals to end users.
 */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get status(): number {
    return STATUS_BY_CODE[this.code];
  }

  static unauthenticated(message = "You need to sign in to continue.") {
    return new ApiError("UNAUTHENTICATED", message);
  }
  static forbidden(message = "You don't have permission to do that.") {
    return new ApiError("FORBIDDEN", message);
  }
  static notFound(message = "That item no longer exists.") {
    return new ApiError("NOT_FOUND", message);
  }
  static conflict(message: string, fields?: Record<string, string>) {
    return new ApiError("CONFLICT", message, fields);
  }
  static validation(message: string, fields?: Record<string, string>) {
    return new ApiError("VALIDATION_ERROR", message, fields);
  }
  static rateLimited(message = "Too many attempts. Please wait and try again.") {
    return new ApiError("RATE_LIMITED", message);
  }
}

/** Flattens a Zod error into a field -> message map for form display. */
export function fieldsFromZod(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

export function toErrorBody(
  error: unknown,
  requestId: string,
): {
  status: number;
  body: ApiErrorBody;
} {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      body: {
        error: { code: error.code, message: error.message, fields: error.fields, requestId },
      },
    };
  }
  if (error instanceof z.ZodError) {
    const fields = fieldsFromZod(error);
    return {
      status: 400,
      body: {
        error: {
          code: "VALIDATION_ERROR",
          message: "Please correct the highlighted fields.",
          fields,
          requestId,
        },
      },
    };
  }
  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: "Something went wrong on our side. Please try again.",
        requestId,
      },
    },
  };
}

/** Maps low-level D1 constraint failures onto meaningful API errors. */
export function mapDbError(error: unknown, context: Record<string, string>): never {
  const message = error instanceof Error ? error.message : String(error);
  if (/UNIQUE constraint failed/i.test(message)) {
    for (const [needle, apiMessage] of Object.entries(context)) {
      if (message.includes(needle)) throw ApiError.conflict(apiMessage);
    }
    throw ApiError.conflict("That value is already in use.");
  }
  throw error;
}
