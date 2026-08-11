import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { io } from "socket.io-client";

const root = resolve(import.meta.dirname, "../..");
const artifact = resolve(root, "build/backend/index.js");

async function availablePort() {
  const probe = createServer();
  await new Promise((resolveListen, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolveListen);
  });
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a smoke-test port");
  await new Promise((resolveClose) => probe.close(resolveClose));
  return address.port;
}

async function waitForHealth(url, child, output) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited before health check:\n${output()}`);
    try {
      const response = await fetch(`${url}/health`);
      if (response.status === 200 && (await response.json()).status === "ok") return;
    } catch {
      // The server may still be binding the port.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Timed out waiting for production health check:\n${output()}`);
}

function connect(url, origin) {
  const socket = io(url, {
    transports: ["websocket"],
    extraHeaders: { Origin: origin },
    reconnection: false,
  });
  return new Promise((resolveConnect, reject) => {
    const timeout = setTimeout(() => reject(new Error("Socket.IO connection timed out")), 5_000);
    socket.once("connect", () => {
      clearTimeout(timeout);
      resolveConnect(socket);
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function enterRoom(socket, command) {
  return new Promise((resolveEntry, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${command.type} timed out`)), 5_000);
    let session;
    let snapshot;
    const finish = () => {
      if (!session || !snapshot) return;
      clearTimeout(timeout);
      socket.off("server_error", onError);
      resolveEntry({ session, snapshot });
    };
    const onError = (error) => {
      clearTimeout(timeout);
      reject(new Error(`${error.code}: ${error.message}`));
    };
    socket.once("session", (value) => {
      session = value;
      finish();
    });
    socket.once("snapshot", (value) => {
      snapshot = value;
      finish();
    });
    socket.once("server_error", onError);
    socket.emit("command", command);
  });
}

const port = await availablePort();
const url = `http://127.0.0.1:${port}`;
const publicOrigin = "http://localhost:3000";
const child = spawn(process.execPath, [artifact], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    PUBLIC_ORIGIN: publicOrigin,
    YUT_RANDOM_SEED: "must-be-ignored-outside-test",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => { stdout += chunk; });
child.stderr.on("data", (chunk) => { stderr += chunk; });
const output = () => `${stdout}\n${stderr}`.trim();
const sockets = [];
let exit;

try {
  await waitForHealth(url, child, output);
  const host = await connect(url, publicOrigin);
  sockets.push(host);
  const created = await enterRoom(host, {
    type: "CREATE_ROOM",
    nickname: "Host",
    mode: "individual",
  });
  if (created.snapshot.players.length !== 1) throw new Error("Host room snapshot was not created");

  const guest = await connect(url, publicOrigin);
  sockets.push(guest);
  const joined = await enterRoom(guest, {
    type: "JOIN_ROOM",
    nickname: "Guest",
    roomCode: created.snapshot.roomCode,
  });
  if (joined.snapshot.roomCode !== created.snapshot.roomCode || joined.snapshot.players.length !== 2) {
    throw new Error("Guest did not join the authoritative room");
  }
  console.log(`Production smoke passed: ${created.snapshot.roomCode}, ${joined.snapshot.players.length} clients`);
} finally {
  for (const socket of sockets) socket.disconnect();
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    exit = await new Promise((resolveExit) => {
      child.once("exit", (code, signal) => resolveExit({ code, signal }));
    });
  } else {
    exit = { code: child.exitCode, signal: child.signalCode };
  }
}

const cleanExit = exit.code === 0 || (exit.code === null && exit.signal === "SIGTERM");
if (!cleanExit) {
  throw new Error(`Production server did not shut down cleanly (${exit.code}/${exit.signal}):\n${output()}`);
}
