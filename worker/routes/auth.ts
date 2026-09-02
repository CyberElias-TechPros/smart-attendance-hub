import {
  changePasswordSchema,
  loginSchema,
  updateProfileSchema,
} from "../../shared/schemas";
import { audit } from "../lib/audit";
import {
  buildClearCookies,
  buildCsrfCookie,
  buildSessionCookie,
  requireCsrf,
  requireUser,
  SESSION_TTL_SECONDS,
  type RequestContext,
} from "../lib/context";
import {
  hashPassword,
  needsRehash,
  randomId,
  signToken,
  verifyPassword,
  type SessionClaims,
} from "../lib/crypto";
import { ApiError } from "../lib/errors";
import { enforceRateLimit, json, readJson } from "../lib/http";
import { Repo } from "../lib/repo";

const MAX_FAILED_LOGINS = 8;
const LOCKOUT_MS = 15 * 60 * 1000;

function isSecureContext(c: RequestContext): boolean {
  return c.url.protocol === "https:";
}

async function issueSession(
  c: RequestContext,
  user: { id: string; role: SessionClaims["role"]; name: string; tokenVersion: number },
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const csrf = randomId(16);
  const claims: SessionClaims = {
    sub: user.id,
    role: user.role,
    name: user.name,
    tv: user.tokenVersion,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
    jti: csrf,
  };
  const token = await signToken(claims, c.env.SESSION_SECRET);
  const secure = isSecureContext(c);
  c.responseHeaders.append("set-cookie", buildSessionCookie(token, secure));
  c.responseHeaders.append("set-cookie", buildCsrfCookie(csrf, secure));
}

export async function handleLogin(c: RequestContext): Promise<Response> {
  // Two-dimensional throttling: per-IP stops broad scanning, per-email stops
  // targeted credential stuffing from a rotating IP pool.
  await enforceRateLimit(c, { key: "login-ip", limit: 20, windowSeconds: 300 }, c.clientIp);

  const body = await readJson(c.request, loginSchema);
  await enforceRateLimit(c, { key: "login-email", limit: 10, windowSeconds: 300 }, body.email);

  const repo = new Repo(c.env.DB);
  const user = await repo.getAuthUser(body.email);

  // Uniform failure message and comparable work regardless of whether the
  // account exists, so the endpoint cannot be used to enumerate users.
  const invalid = ApiError.validation("Incorrect email or password.");

  if (!user) {
    await hashPassword(body.password);
    c.log("login_failed", { reason: "unknown_user" });
    throw invalid;
  }

  if (user.locked_until && user.locked_until > Date.now()) {
    const minutes = Math.ceil((user.locked_until - Date.now()) / 60000);
    throw new ApiError(
      "LOCKED",
      `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    );
  }

  const ok = await verifyPassword(body.password, user.password_hash);
  if (!ok) {
    const failed = user.failed_logins + 1;
    const lockUntil = failed >= MAX_FAILED_LOGINS ? Date.now() + LOCKOUT_MS : null;
    await repo.recordLoginFailure(user.id, failed, lockUntil);
    audit(c, {
      action: "auth.login_failed",
      resource: "user",
      resourceId: user.id,
      actorId: user.id,
      actorRole: user.role,
      metadata: { attempts: failed, locked: lockUntil != null },
    });
    throw invalid;
  }

  // Transparently upgrade legacy/weak password hashes on successful login.
  const rehashed = needsRehash(user.password_hash)
    ? await hashPassword(body.password)
    : undefined;
  await repo.recordLoginSuccess(user.id, rehashed);

  await issueSession(c, {
    id: user.id,
    role: user.role,
    name: user.name,
    tokenVersion: user.token_version,
  });
  audit(c, {
    action: "auth.login",
    resource: "user",
    resourceId: user.id,
    actorId: user.id,
    actorRole: user.role,
  });

  const profile = await repo.getUser(user.id);
  return json({ user: profile });
}

export async function handleLogout(c: RequestContext): Promise<Response> {
  requireCsrf(c);
  if (c.claims) {
    audit(c, { action: "auth.logout", resource: "user", resourceId: c.claims.sub });
  }
  for (const cookie of buildClearCookies(isSecureContext(c))) {
    c.responseHeaders.append("set-cookie", cookie);
  }
  return json({ ok: true });
}

export async function handleMe(c: RequestContext): Promise<Response> {
  if (!c.claims) return json({ user: null });
  const repo = new Repo(c.env.DB);
  const user = await repo.getUser(c.claims.sub);
  if (!user) {
    for (const cookie of buildClearCookies(isSecureContext(c))) {
      c.responseHeaders.append("set-cookie", cookie);
    }
    return json({ user: null });
  }
  return json({ user });
}

export async function handleChangePassword(c: RequestContext): Promise<Response> {
  requireCsrf(c);
  const claims = await requireUser(c);
  await enforceRateLimit(c, { key: "password", limit: 5, windowSeconds: 900 }, claims.sub);
  const body = await readJson(c.request, changePasswordSchema);

  const repo = new Repo(c.env.DB);
  const hash = await repo.getPasswordHash(claims.sub);
  if (!hash) throw ApiError.notFound("Account not found.");
  if (!(await verifyPassword(body.currentPassword, hash))) {
    throw ApiError.validation("Your current password is incorrect.", {
      currentPassword: "Incorrect password",
    });
  }
  if (await verifyPassword(body.newPassword, hash)) {
    throw ApiError.validation("Choose a password you haven't used before.", {
      newPassword: "This is your current password",
    });
  }

  await repo.setPassword(claims.sub, await hashPassword(body.newPassword));
  audit(c, { action: "auth.password_changed", resource: "user", resourceId: claims.sub });

  // token_version changed, so re-issue this device's session rather than
  // logging the user out of the tab they just used.
  const user = await repo.getUser(claims.sub);
  const fresh = await c.env.DB.prepare("SELECT token_version FROM users WHERE id = ?")
    .bind(claims.sub)
    .first<{ token_version: number }>();
  if (user && fresh) {
    await issueSession(c, {
      id: user.id,
      role: user.role,
      name: user.name,
      tokenVersion: fresh.token_version,
    });
  }
  return json({ ok: true });
}

export async function handleUpdateProfile(c: RequestContext): Promise<Response> {
  requireCsrf(c);
  const claims = await requireUser(c);
  const body = await readJson(c.request, updateProfileSchema);
  const repo = new Repo(c.env.DB);
  await repo.updateOwnProfile(claims.sub, body);
  audit(c, {
    action: "user.profile_updated",
    resource: "user",
    resourceId: claims.sub,
    metadata: { name: body.name },
  });
  return json({ user: await repo.getUser(claims.sub) });
}
