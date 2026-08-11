import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import { createGateway } from "./gateway";
import { RoomService } from "./rooms";

const DEFAULT_PORT = 3001;
const DEFAULT_PUBLIC_ORIGIN = "http://localhost:3000";
const DEFAULT_CLEANUP_INTERVAL_MS = 60_000;

export interface BuildServerOptions {
  cleanupIntervalMs?: number;
  publicOrigin?: string;
  roomService?: RoomService;
}

function createServerRoomService(): RoomService {
  return new RoomService({
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
  const roomService = options.roomService ?? createServerRoomService();
  const gateway = createGateway(server.server, {
    publicOrigin: options.publicOrigin ?? DEFAULT_PUBLIC_ORIGIN,
    roomService,
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

async function start(): Promise<void> {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  const server = buildServer({ publicOrigin: process.env.PUBLIC_ORIGIN });
  await server.listen({ host: "0.0.0.0", port });
}

const entrypoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false;

if (entrypoint) {
  start().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
