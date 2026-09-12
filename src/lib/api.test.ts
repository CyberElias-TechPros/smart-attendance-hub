import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, auth, handleUnauthorized, users } from "./api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("api client", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    handleUnauthorized(() => {});
    vi.restoreAllMocks();
  });

  it("returns parsed JSON on success (response body consumed exactly once)", async () => {
    // Regression test: the client used to call res.json() twice, so EVERY
    // successful request threw "body already used" at runtime.
    const payload = { token: "tok", user: { id: "u1", role: "student", name: "Ada" } };
    globalThis.fetch = vi.fn(async () => jsonResponse(payload, 200)) as unknown as typeof fetch;

    const user = await auth.login("ada@slams.edu", "password123");

    expect(user).toEqual(payload.user);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("surfaces server error code, status and message", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(
        { error: { code: "invalid_credentials", message: "Invalid email or password" } },
        401,
      ),
    ) as unknown as typeof fetch;

    const err = await auth.login("ada@slams.edu", "wrong").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect((err as ApiError).code).toBe("invalid_credentials");
    expect((err as ApiError).message).toBe("Invalid email or password");
  });

  it("maps network failures to a friendly error", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    const err = await auth.login("ada@slams.edu", "password123").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
    expect((err as ApiError).code).toBe("network");
  });

  it("fires the unauthorized hook on 401 outside the login endpoint", async () => {
    const on401 = vi.fn();
    handleUnauthorized(on401);
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ error: { code: "unauthenticated", message: "x" } }, 401),
    ) as unknown as typeof fetch;

    await expect(users.list()).rejects.toBeInstanceOf(ApiError);
    expect(on401).toHaveBeenCalledTimes(1);
  });

  it("does not fire the unauthorized hook for failed logins", async () => {
    const on401 = vi.fn();
    handleUnauthorized(on401);
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ error: { code: "invalid_credentials", message: "x" } }, 401),
    ) as unknown as typeof fetch;

    await expect(auth.login("a@b.co", "bad")).rejects.toBeInstanceOf(ApiError);
    expect(on401).not.toHaveBeenCalled();
  });
});
