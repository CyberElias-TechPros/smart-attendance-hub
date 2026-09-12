// Small HTTP helpers for the SLAMS API worker.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export function jsonOk(data: unknown, init: ResponseInit = {}): Response {
  return Response.json(data, init);
}

/** Read and parse a JSON body with a hard size limit. Throws ApiError(413/400). */
export async function readJsonBody(request: Request, maxBytes = 256 * 1024): Promise<unknown> {
  const len = Number(request.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new ApiError(413, "payload_too_large", "Request body too large");
  const text = await request.text();
  if (text.length > maxBytes)
    throw new ApiError(413, "payload_too_large", "Request body too large");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json", "Request body must be valid JSON");
  }
}

/** Minimal query-string helper for our string-only params. */
export function queryValue(url: URL, name: string): string | null {
  return url.searchParams.get(name);
}

export function getPathname(request: Request): string {
  return new URL(request.url).pathname;
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}
