import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("deployment packaging", () => {
  it("builds a Node 22 backend artifact without global build tools", () => {
    const packageJson = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["build:server"]).toContain("node_modules/esbuild/bin/esbuild");
    expect(packageJson.scripts["start:server"]).toBe("node dist/server/index.js");
    expect(packageJson.scripts["smoke:server"]).toContain("production-server.mjs");
  });

  it("uses a production-only, non-root Docker runtime with health checks", () => {
    const dockerfile = read("Dockerfile");

    expect(dockerfile).toContain("FROM node:22-bookworm-slim AS backend-build");
    expect(dockerfile).toContain("npm ci --omit=dev");
    expect(dockerfile).toContain("./dist/server/index.js");
    expect(dockerfile).toContain("USER node");
    expect(dockerfile).toContain("EXPOSE 3001");
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toContain("process.env.PORT||3001");
    expect(dockerfile).toContain("CMD [\"node\", \"dist/server/index.js\"]");
  });

  it("documents safe environment defaults and production constraints", () => {
    const environment = read(".env.example");
    const readme = read("README.md");

    expect(environment).toContain("NEXT_PUBLIC_GAME_SERVER_URL=http://localhost:3001");
    expect(environment).toContain("PUBLIC_ORIGIN=http://localhost:3000");
    expect(readme).toContain("A1 → B1 → C1 → D1 → A2 → B2 → C2 → D2");
    expect(readme).toContain("45초");
    expect(readme).toContain("재시작하면 모든 방과 진행 중인 게임이 사라집니다");
    expect(readme).toContain("HTTPS/WSS");
  });

  it("ships the inspected 1200 by 630 social preview", () => {
    const png = readFileSync(resolve(root, "public/og.png"));
    const layout = read("app/layout.tsx");

    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
    expect(layout).toContain('const title = "한판윷 — 실시간 온라인 윷놀이"');
    expect(layout).toContain('alt: "한판윷 — 실시간 온라인 윷놀이"');
    expect(layout).toContain('url: "/og.png"');
    expect(layout).toContain("openGraph:");
    expect(layout).toContain("twitter:");
  });
});
