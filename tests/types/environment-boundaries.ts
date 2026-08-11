// The browser/server project must not inherit Cloudflare Worker globals.
// @ts-expect-error D1Database belongs exclusively to tsconfig.worker.json.
export type RootEnvironmentMustNotSeeD1 = D1Database;
