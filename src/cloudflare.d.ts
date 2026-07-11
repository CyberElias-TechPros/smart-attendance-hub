// Ambient declaration for the Cloudflare Workers built-in module.
// Provides typing for `import { env } from "cloudflare:workers"` without
// pulling the entire @cloudflare/workers-types global surface into the app.
declare module "cloudflare:workers" {
  // The Worker's environment bindings (D1, KV, secrets, vars, …).
  export const env: Record<string, any>;
}
