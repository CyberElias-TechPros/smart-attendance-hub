// Privacy-preserving forensic fingerprints + the append-only violation log.
//
// Proxy-sign-in rings are detected by *patterns* (same user → many crowd
// cities/colos; one IP → many students in the same minute; the same browser
// fingerprint on different "devices"). That never requires storing the raw IP
// or raw user-agent: we hash them once (SHA-256, keyed with the session
// secret) so the log is joinable but not reversible. Raw values are dropped.

const enc = new TextEncoder();

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = "";
  for (let i = 0; i < u8.length; i++) out += u8[i].toString(16).padStart(2, "0");
  return out;
}

async function digest(secret: Uint8Array, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    secret as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return toHex(sig).slice(0, 16); // 64-bit block pointer is plenty for pattern joins
}

export async function hashedPointer(secret: Uint8Array, value: string): Promise<string> {
  return digest(secret, value);
}

/** Distinct values count for a session (e.g. number of IP pointers present). */
export function countDistinct<T>(values: Array<T | undefined>): number {
  return new Set(values.filter((v) => v !== undefined && v !== null)).size;
}
