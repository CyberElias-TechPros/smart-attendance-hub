import { describe, expect, it } from "vitest";
import {
  dummyVerify,
  extractBearerToken,
  hashPassword,
  signSession,
  verifyPassword,
  verifySession,
} from "../src/auth";

const ENV = { SLAMS_JWT_SECRET: "unit-test-secret-0123456789" };

describe("password hashing", () => {
  it("round-trips a password", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash.startsWith("pbkdf2$")).toBe(true);
    await expect(verifyPassword("correct horse battery", hash)).resolves.toBe(true);
  });

  it("rejects wrong passwords", async () => {
    const hash = await hashPassword("password123");
    await expect(verifyPassword("password124", hash)).resolves.toBe(false);
    await expect(verifyPassword("", hash)).resolves.toBe(false);
  });

  it("rejects malformed stored hashes", async () => {
    await expect(verifyPassword("anything", "not-a-hash")).resolves.toBe(false);
    await expect(verifyPassword("anything", "pbkdf2$abc$xyz$zzz")).resolves.toBe(false);
  });

  it("uses a random salt (two hashes of the same password differ)", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
    await expect(verifyPassword("same-password", a)).resolves.toBe(true);
    await expect(verifyPassword("same-password", b)).resolves.toBe(true);
  });

  it("dummyVerify completes without throwing", async () => {
    await dummyVerify("whatever");
  });
});

describe("session tokens", () => {
  it("signs and verifies a session", async () => {
    const token = await signSession({ sub: "user-1", role: "student", name: "Ada Obi" }, ENV);
    const payload = await verifySession(token, ENV);
    expect(payload).toEqual({ sub: "user-1", role: "student", name: "Ada Obi", v: 1 });
  });

  it("carries the auth version for server-side revocation", async () => {
    const token = await signSession({ sub: "user-1", role: "admin", name: "Admin", v: 7 }, ENV);
    expect((await verifySession(token, ENV))?.v).toBe(7);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signSession(
      { sub: "user-1", role: "admin", name: "Admin" },
      {
        SLAMS_JWT_SECRET: "a-different-secret-9876543210",
      },
    );
    await expect(verifySession(token, ENV)).resolves.toBeNull();
  });

  it("rejects tampered tokens", async () => {
    const token = await signSession({ sub: "user-1", role: "student", name: "Ada" }, ENV);
    const [h, p, s] = token.split(".");
    const tampered = `${h}.${p}x.${s}`;
    await expect(verifySession(tampered, ENV)).resolves.toBeNull();
  });

  it("rejects malformed tokens", async () => {
    await expect(verifySession("garbage", ENV)).resolves.toBeNull();
    await expect(verifySession("", ENV)).resolves.toBeNull();
  });
});

describe("bearer token extraction", () => {
  it("extracts the token", () => {
    const req = new Request("https://api.test/x", {
      headers: { authorization: "Bearer abc.def.ghi" },
    });
    expect(extractBearerToken(req)).toBe("abc.def.ghi");
  });
  it("returns null when absent or malformed", () => {
    expect(extractBearerToken(new Request("https://api.test/x"))).toBeNull();
    const req = new Request("https://api.test/x", { headers: { authorization: "Token abc" } });
    expect(extractBearerToken(req)).toBeNull();
  });
});
