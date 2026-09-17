// Location-attestation evidence for SLAMS sign-ins.
//
// A student's GPS reading is, by definition, client-supplied — any geofence
// check is only as strong as the client that reports the coordinates. To make
// the claim tamper-EVIDENT (not just tamper-guessed), every accepted sign-in
// is bound into an HMAC-SHA256 digest under the server's session secret:
//
//   evidence = HMAC(secret, studentId|code|latitude|longitude|clientTime|deviceId)
//
// The digest is stored server-side on the attendance record. It cannot be
// forged without the secret, and it ties the exact location claim that passed
// the geofence to that student, that code, and that device at that moment —
// so a repudiated "I wasn't there" claim can be answered with the signed
// evidence later (see verifyLocationEvidence).
//
// We intentionally bind the *claim* (what the client submitted), not the
// derived distance: the server stays the authority on whether the claim is
// inside the fence, and the digest proves the claim was never edited after
// acceptance.

const enc = new TextEncoder();

const hmacKey = Symbol.for("slams.evidence.hmac-key");

async function importKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  const cache = (globalThis as Record<PropertyKey, unknown>)[hmacKey] as
    Map<string, CryptoKey> | undefined;
  const id = bytesToHex(keyBytes.slice(0, 8));
  if (cache?.has(id)) return cache.get(id)!;
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const map = cache ?? new Map<string, CryptoKey>();
  map.set(id, key);
  (globalThis as Record<PropertyKey, unknown>)[hmacKey] = map;
  return key;
}

function bytesToHex(bytes: Uint8Array | ArrayBuffer): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = "";
  for (let i = 0; i < u8.length; i++) out += u8[i].toString(16).padStart(2, "0");
  return out;
}

export interface EvidenceClaim {
  studentId: string;
  code: string;
  latitude?: number;
  longitude?: number;
  clientTime: number;
  deviceId?: string;
}

function claimString(c: EvidenceClaim): string {
  const fmt = (n?: number) => (n === undefined ? "" : String(Math.round(n * 1e6)));
  return [
    c.studentId,
    c.code,
    fmt(c.latitude),
    fmt(c.longitude),
    String(c.clientTime),
    c.deviceId ?? "",
  ].join("|");
}

/** Compute the attestation digest for an accepted sign-in claim. */
export async function buildLocationEvidence(
  secret: Uint8Array,
  claim: EvidenceClaim,
): Promise<string> {
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(claimString(claim)));
  return bytesToHex(sig);
}

/** Verify a stored evidence digest against a candidate claim (public for
 *  integrity audits; the admin-facing surface can reach it via the worker). */
export async function verifyLocationEvidence(
  secret: Uint8Array,
  claim: EvidenceClaim,
  evidenceHex: string,
): Promise<boolean> {
  const expected = await buildLocationEvidence(secret, claim);
  if (expected.length !== evidenceHex.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ evidenceHex.charCodeAt(i);
  }
  return diff === 0;
}
