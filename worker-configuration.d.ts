// Project-specific Cloudflare bindings. This interface merges with the
// official `@cloudflare/workers-types` declaration used by `cloudflare:workers`.
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
  }
}
