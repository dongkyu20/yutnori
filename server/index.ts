import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import { createGateway, type GatewayRateLimitOptions } from "./gateway";
import { RoomService } from "./rooms";

const DEFAULT_PORT = 3001;
const DEFAULT_PUBLIC_ORIGIN = "http://localhost:3000";
const DEFAULT_CLEANUP_INTERVAL_MS = 60_000;
const PRODUCTION_ACTION_TIMEOUT_MS = 45_000;
const TEST_ACTION_TIMEOUT_MS = 1_000;

interface ServerEnvironment {
  NODE_ENV?: string;
  YUT_RANDOM_SEED?: string;
}

interface ServerRoomOptions {
  actionTimeoutMs: number;
  random: () => number;
}

export interface BuildServerOptions {
  cleanupIntervalMs?: number;
  gatewayRateLimit?: Partial<GatewayRateLimitOptions>;
  publicOrigin?: string;
  roomService?: RoomService;
  /** 연결 끊김·재접속·자동 행동을 남길 곳. 주지 않으면 남기지 않는다. */
  log?: ServerLog;
}

interface ShutdownServer {
  close: () => Promise<unknown>;
}

interface SignalRegistrar {
  once: (signal: "SIGINT" | "SIGTERM", listener: () => void) => unknown;
}

export interface StartServerOptions {
  port?: number;
  publicOrigin?: string;
  server?: FastifyInstance;
  signals?: SignalRegistrar;
}

export function registerGracefulShutdown(
  server: ShutdownServer,
  signals: SignalRegistrar = process,
): void {
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    void server.close().catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  };
  signals.once("SIGINT", close);
  signals.once("SIGTERM", close);
}

function seededRandom(seed: string): () => number {
  let state = 2_166_136_261;
  for (const character of seed) {
    state ^= character.codePointAt(0) ?? 0;
    state = Math.imul(state, 16_777_619);
  }

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function resolveServerRoomOptions(
  environment: ServerEnvironment = process.env,
  productionRandom: () => number = Math.random,
): ServerRoomOptions {
  const testMode = environment.NODE_ENV === "test";
  return {
    actionTimeoutMs: testMode ? TEST_ACTION_TIMEOUT_MS : PRODUCTION_ACTION_TIMEOUT_MS,
    random: testMode && environment.YUT_RANDOM_SEED
      ? seededRandom(environment.YUT_RANDOM_SEED)
      : productionRandom,
  };
}

export type ServerLog = (event: string, details: Record<string, unknown>) => void;

/** 한 줄짜리 JSON으로 남긴다. 시각이 붙어 있어 "그때 무슨 일이 있었나"를 나중에 찾을 수 있다. */
export const consoleServerLog: ServerLog = (event, details) => {
  console.info(JSON.stringify({ at: new Date().toISOString(), event, ...details }));
};

function createServerRoomService(log?: ServerLog): RoomService {
  return new RoomService({
    ...resolveServerRoomOptions(),
    ...(log ? { log } : {}),
    schedule: (fn, ms) => {
      const timer = setTimeout(fn, ms);
      timer.unref();
      return timer;
    },
    cancel: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  });
}

export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const server = Fastify();
  const roomService = options.roomService ?? createServerRoomService(options.log);
  const gateway = createGateway(server.server, {
    publicOrigin: options.publicOrigin ?? DEFAULT_PUBLIC_ORIGIN,
    roomService,
    rateLimit: options.gatewayRateLimit,
    ...(options.log ? { log: options.log } : {}),
  });
  const cleanupTimer = setInterval(
    () => roomService.removeExpiredRooms(),
    options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS,
  );
  cleanupTimer.unref();

  server.get("/health", async () => ({ status: "ok" }));
  server.addHook("preClose", async () => {
    clearInterval(cleanupTimer);
    await gateway.close();
  });

  return server;
}

export async function startServer(options: StartServerOptions = {}): Promise<FastifyInstance> {
  const port = options.port ?? Number(process.env.PORT ?? DEFAULT_PORT);
  // 실제로 띄우는 서버만 진단 로그를 터미널에 남긴다. 테스트가 만드는 서버는 조용하다.
  const server = options.server ?? buildServer({
    publicOrigin: options.publicOrigin ?? process.env.PUBLIC_ORIGIN,
    log: consoleServerLog,
  });
  await server.listen({ host: "0.0.0.0", port });
  registerGracefulShutdown(server, options.signals);
  return server;
}

const entrypoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false;

if (entrypoint) {
  startServer().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
