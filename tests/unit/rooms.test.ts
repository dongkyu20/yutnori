import { describe, expect, it } from "vitest";
import type { GameMode, PublicRoomSnapshot, TeamId } from "../../shared/protocol";
import {
  RoomError,
  RoomService,
  type RoomChange,
  type RoomServiceOptions,
  type SessionResult,
} from "../../server/rooms";

type VersionedInRoomCommand = Exclude<Parameters<RoomService["dispatch"]>[1], { type: "REACT" }>;
type CommandWithoutMetadata<T> = T extends unknown ? Omit<T, "roomVersion" | "requestId"> : never;

class FakeClock {
  nowMs = 0;
  private nextId = 1;
  private tasks = new Map<number, { at: number; fn: () => void }>();
  readonly scheduledDelays: number[] = [];
  executed = 0;

  readonly options = (random: () => number = () => 0.75): RoomServiceOptions => ({
    now: () => this.nowMs,
    random,
    schedule: (fn, ms) => {
      const id = this.nextId++;
      this.scheduledDelays.push(ms);
      this.tasks.set(id, { at: this.nowMs + ms, fn });
      return id;
    },
    cancel: (id) => {
      this.tasks.delete(id as number);
    },
  });

  advance(ms: number): void {
    const target = this.nowMs + ms;
    while (true) {
      const due = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      this.tasks.delete(due[0]);
      this.nowMs = due[1].at;
      this.executed += 1;
      due[1].fn();
    }
    this.nowMs = target;
  }
}

const requestId = (() => {
  let sequence = 0;
  return () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
})();

const dispatch = (
  service: RoomService,
  playerId: string,
  snapshot: PublicRoomSnapshot,
  command: CommandWithoutMetadata<VersionedInRoomCommand>,
): PublicRoomSnapshot =>
  service.dispatch(playerId, {
    ...command,
    roomVersion: snapshot.version,
    requestId: requestId(),
  } as VersionedInRoomCommand);

function roomError(action: () => unknown): RoomError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(RoomError);
    return error as RoomError;
  }
  throw new Error("RoomError가 발생해야 합니다.");
}

function createPlayers(
  service: RoomService,
  mode: GameMode,
  nicknames: readonly string[],
): SessionResult[] {
  const sessions = [service.createRoom({ nickname: nicknames[0], mode })];
  for (const nickname of nicknames.slice(1)) {
    sessions.push(service.joinRoom({ roomCode: sessions[0].snapshot.roomCode, nickname }));
  }
  return sessions;
}

function readyIndividualGame(service: RoomService): SessionResult[] {
  const sessions = createPlayers(service, "individual", ["Host", "Guest"]);
  let snapshot = sessions.at(-1)!.snapshot;
  for (const session of sessions) {
    snapshot = dispatch(service, session.playerId, snapshot, { type: "SET_READY", ready: true });
  }
  snapshot = dispatch(service, sessions[0].playerId, snapshot, { type: "START_GAME" });
  sessions[0].snapshot = snapshot;
  return sessions;
}

describe("RoomService lobby lifecycle", () => {
  it("returns a stable code with readable Korean for a user-facing error", () => {
    const service = new RoomService(new FakeClock().options());

    const error = roomError(() =>
      service.joinRoom({ roomCode: "222222", nickname: "Guest" }),
    );

    expect(error.code).toBe("ROOM_NOT_FOUND");
    expect(error.message).toMatch(/[가-힣]/);
    expect(error.message).not.toMatch(/[?\uFFFD]/);
  });

  it("creates unique six-character unambiguous room codes", () => {
    const values = [...Array(6).fill(0), ...Array(6).fill(0.25)];
    let index = 0;
    const service = new RoomService(new FakeClock().options(() => values[index++]));

    const first = service.createRoom({ nickname: "Alpha", mode: "individual" });
    const second = service.createRoom({ nickname: "Bravo", mode: "individual" });

    expect(first.snapshot.roomCode).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
    expect(second.snapshot.roomCode).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
    expect(second.snapshot.roomCode).not.toBe(first.snapshot.roomCode);
  });

  it("normalizes nicknames and rejects a case-insensitive duplicate", () => {
    const service = new RoomService(new FakeClock().options());
    const created = service.createRoom({ nickname: "  Alpha  ", mode: "individual" });

    expect(created.snapshot.players[0].nickname).toBe("Alpha");
    expect(roomError(() =>
      service.joinRoom({ roomCode: created.snapshot.roomCode.toLowerCase(), nickname: "alpha" }),
    ).code).toBe("NICKNAME_TAKEN");
  });

  it("keeps reconnect credentials out of public snapshots", () => {
    const service = new RoomService(new FakeClock().options());
    const created = service.createRoom({ nickname: "Alpha", mode: "individual" });
    const serialized = JSON.stringify(created.snapshot);

    expect(serialized).not.toContain(created.reconnectToken);
    expect(serialized).not.toContain("reconnectToken");
    expect(serialized).not.toContain("processedRequestIds");
  });

  it.each([
    ["individual", ["Host", "Able", "Baker", "Charlie"], "Delta", 4],
    ["team", ["Host", "Able", "Baker", "Charlie", "Delta", "Echo", "Foxtrot", "Golf"], "Hotel", 8],
  ] as const)("limits %s rooms to their configured capacity", (mode, members, extra, capacity) => {
    const service = new RoomService(new FakeClock().options());
    const sessions = createPlayers(service, mode, members);

    expect(sessions.at(-1)!.snapshot.players).toHaveLength(capacity);
    expect(roomError(() =>
      service.joinRoom({ roomCode: sessions[0].snapshot.roomCode, nickname: extra }),
    ).code).toBe("ROOM_FULL");
  });

  it("requires two ready players before an individual game can start", () => {
    const service = new RoomService(new FakeClock().options());
    const [host, guest] = createPlayers(service, "individual", ["Host", "Guest"]);

    expect(roomError(() =>
      dispatch(service, host.playerId, guest.snapshot, { type: "START_GAME" }),
    ).code).toBe("PLAYERS_NOT_READY");
  });

  it("projects the authoritative waiting-room start eligibility and its blocking reason", () => {
    const service = new RoomService(new FakeClock().options());
    const [host, guest] = createPlayers(service, "individual", ["Host", "Guest"]);

    expect(guest.snapshot).toMatchObject({
      canStart: false,
      startEligibilityReason: "모든 참가자가 연결되고 준비되어야 합니다.",
    });

    const hostReady = dispatch(service, host.playerId, guest.snapshot, { type: "SET_READY", ready: true });
    const ready = dispatch(service, guest.playerId, hostReady, { type: "SET_READY", ready: true });

    expect(ready).toMatchObject({ canStart: true, startEligibilityReason: null });
  });

  it("requires exactly two ready players in every team", () => {
    const service = new RoomService(new FakeClock().options());
    const sessions = createPlayers(service, "team", [
      "Host", "Able", "Baker", "Charlie", "Delta", "Echo", "Foxtrot", "Golf",
    ]);
    let snapshot = sessions.at(-1)!.snapshot;
    const teams: TeamId[] = ["A", "A", "B", "B", "C", "C", "D", "D"];
    for (let index = 0; index < sessions.length; index += 1) {
      snapshot = dispatch(service, sessions[0].playerId, snapshot, {
        type: "ASSIGN_TEAM",
        playerId: sessions[index].playerId,
        teamId: teams[index],
      });
      snapshot = dispatch(service, sessions[index].playerId, snapshot, {
        type: "SET_READY",
        ready: true,
      });
    }

    const started = dispatch(service, sessions[0].playerId, snapshot, { type: "START_GAME" });

    expect(started.phase).toBe("playing");
    expect(started.game?.currentPlayerId).toBe(sessions[0].playerId);
  });

  it("rejects a team start until every team has two members", () => {
    const service = new RoomService(new FakeClock().options());
    const [host, guest] = createPlayers(service, "team", ["Host", "Guest"]);

    expect(roomError(() =>
      dispatch(service, host.playerId, guest.snapshot, { type: "START_GAME" }),
    ).code).toBe("INVALID_TEAM_COMPOSITION");
  });

  it("restricts team assignment to the host", () => {
    const service = new RoomService(new FakeClock().options());
    const [host, guest] = createPlayers(service, "team", ["Host", "Guest"]);
    const snapshot = guest.snapshot;

    expect(roomError(() => dispatch(service, guest.playerId, snapshot, {
      type: "ASSIGN_TEAM", playerId: host.playerId, teamId: "A",
    })).code).toBe("HOST_ONLY");
  });

  it("restricts kicking to the host", () => {
    const service = new RoomService(new FakeClock().options());
    const [host, guest] = createPlayers(service, "team", ["Host", "Guest"]);

    expect(roomError(() => dispatch(service, guest.playerId, guest.snapshot, {
      type: "KICK_PLAYER", playerId: host.playerId,
    })).code).toBe("HOST_ONLY");
  });

  it("restricts game start to the host", () => {
    const service = new RoomService(new FakeClock().options());
    const [, guest] = createPlayers(service, "team", ["Host", "Guest"]);

    expect(roomError(() =>
      dispatch(service, guest.playerId, guest.snapshot, { type: "START_GAME" }),
    ).code).toBe("HOST_ONLY");
  });

  it("reassigns the waiting-room host when the host disconnects", () => {
    const service = new RoomService(new FakeClock().options());
    const [host, guest] = createPlayers(service, "individual", ["Host", "Guest"]);

    service.disconnect(host.playerId);
    const restoredGuest = service.reconnect(guest.reconnectToken);

    expect(restoredGuest.snapshot.hostPlayerId).toBe(guest.playerId);
    expect(restoredGuest.snapshot.players.find((player) => player.id === host.playerId)?.connected).toBe(false);
  });

  it("reserves every seat after play starts and restores it with the reconnect token", () => {
    const service = new RoomService(new FakeClock().options());
    const [host, guest] = readyIndividualGame(service);

    service.disconnect(guest.playerId);
    expect(roomError(() =>
      service.joinRoom({ roomCode: host.snapshot.roomCode, nickname: "Newcomer" }),
    ).code).toBe("GAME_ALREADY_STARTED");

    const restored = service.reconnect(guest.reconnectToken);
    expect(restored.playerId).toBe(guest.playerId);
    expect(restored.snapshot.players.find((player) => player.id === guest.playerId)?.connected).toBe(true);
  });

  it("deduplicates a retried request before checking its now-stale version", () => {
    const service = new RoomService(new FakeClock().options());
    const created = service.createRoom({ nickname: "Host", mode: "individual" });
    const command = {
      type: "SET_READY" as const,
      ready: true,
      roomVersion: created.snapshot.version,
      requestId: requestId(),
    };

    const accepted = service.dispatch(created.playerId, command);
    const retried = service.dispatch(created.playerId, command);

    expect(accepted.version).toBe(created.snapshot.version + 1);
    expect(retried.version).toBe(accepted.version);
    expect(retried.players[0].ready).toBe(true);
  });

  it("rejects a new request carrying a stale room version without changing state", () => {
    const service = new RoomService(new FakeClock().options());
    const created = service.createRoom({ nickname: "Host", mode: "individual" });
    const current = dispatch(service, created.playerId, created.snapshot, { type: "SET_READY", ready: true });

    expect(roomError(() => service.dispatch(created.playerId, {
      type: "SET_READY",
      ready: false,
      roomVersion: created.snapshot.version,
      requestId: requestId(),
    })).code).toBe("STALE_VERSION");
    expect(service.reconnect(created.reconnectToken).snapshot.players[0].ready).toBe(true);
    expect(current.players[0].ready).toBe(true);
  });
});

describe("RoomService timers and cleanup", () => {
  it("automatically performs the pending action at exactly 45,000 ms", () => {
    const clock = new FakeClock();
    const service = new RoomService(clock.options(() => 0.1));
    const [host] = readyIndividualGame(service);

    expect(host.snapshot.game?.actionExpiresAt).toBe(45_000);
    expect(clock.scheduledDelays.at(-1)).toBe(45_000);
    clock.advance(44_999);
    expect(clock.executed).toBe(0);

    clock.advance(1);
    const current = service.reconnect(host.reconnectToken).snapshot;
    expect(clock.executed).toBe(1);
    expect(current.game?.turnStage).toBe("AWAITING_PIECE");
    expect(current.game?.lastThrow?.result).toBe("MO");
  });

  it("does not reset the active action deadline when a player reconnects", () => {
    const clock = new FakeClock();
    const service = new RoomService(clock.options());
    const [host] = readyIndividualGame(service);
    const scheduledBeforeReconnect = clock.scheduledDelays.length;

    clock.advance(12_345);
    service.disconnect(host.playerId);
    const reconnected = service.reconnect(host.reconnectToken);

    expect(reconnected.snapshot.game?.actionExpiresAt).toBe(45_000);
    expect(clock.scheduledDelays.length).toBe(scheduledBeforeReconnect + 1);
    expect(clock.scheduledDelays.at(-1)).toBe(0);
  });

  it("immediately completes a disconnected current player's pending actions", () => {
    const clock = new FakeClock();
    const values = [...Array(6).fill(0.2), 0.9, 0.1, 0.9, 0.9, 0];
    let index = 0;
    const service = new RoomService(clock.options(() => values[index++] ?? 0));
    const [host, guest] = readyIndividualGame(service);

    service.disconnect(host.playerId);
    clock.advance(0);
    const current = service.reconnect(host.reconnectToken).snapshot;

    expect(clock.executed).toBe(2);
    expect(current.game?.currentPlayerId).toBe(guest.playerId);
    expect(current.game?.turnStage).toBe("AWAITING_THROW");
  });

  it("converts public THROW_YUT into a server-generated internal throw", () => {
    const service = new RoomService(new FakeClock().options(() => 0.1));
    const [host] = readyIndividualGame(service);

    const thrown = dispatch(service, host.playerId, host.snapshot, { type: "THROW_YUT" });

    expect(thrown.game?.lastThrow).toEqual({
      eventId: "event-1",
      result: "MO",
      sticks: [true, true, true, true],
    });
  });

  it("deletes an empty waiting room after ten minutes", () => {
    const clock = new FakeClock();
    const service = new RoomService(clock.options());
    const created = service.createRoom({ nickname: "Host", mode: "individual" });
    service.disconnect(created.playerId);

    clock.advance(599_999);
    service.removeExpiredRooms();
    expect(service.reconnect(created.reconnectToken).playerId).toBe(created.playerId);
    service.disconnect(created.playerId);

    clock.advance(600_000);
    service.removeExpiredRooms();
    expect(roomError(() => service.reconnect(created.reconnectToken)).code).toBe("SESSION_NOT_FOUND");
  });

  it("deletes a finished room after thirty minutes", () => {
    const clock = new FakeClock();
    const service = new RoomService(clock.options(() => 0.1));
    const [host] = readyIndividualGame(service);
    let snapshot = host.snapshot;

    while (snapshot.phase === "playing") {
      if (snapshot.game?.turnStage === "AWAITING_THROW") {
        snapshot = dispatch(service, snapshot.game.currentPlayerId, snapshot, { type: "THROW_YUT" });
      } else if (snapshot.game?.turnStage === "AWAITING_PIECE") {
        snapshot = dispatch(service, snapshot.game.currentPlayerId, snapshot, {
          type: "SELECT_PIECE",
          pieceId: snapshot.game.legalPieceIds[0],
        });
      } else if (snapshot.game?.turnStage === "AWAITING_ROUTE") {
        snapshot = dispatch(service, snapshot.game.currentPlayerId, snapshot, {
          type: "SELECT_ROUTE",
          routeId: snapshot.game.legalRoutes[0].routeId,
        });
      }
    }
    expect(snapshot.phase).toBe("finished");

    clock.advance(1_799_999);
    service.removeExpiredRooms();
    expect(service.reconnect(host.reconnectToken).snapshot.phase).toBe("finished");
    clock.advance(1);
    service.removeExpiredRooms();
    expect(roomError(() => service.reconnect(host.reconnectToken)).code).toBe("SESSION_NOT_FOUND");
  });
});

describe("RoomService change subscriptions", () => {
  it("isolates a throwing listener from an accepted command and later listeners", () => {
    const reported: unknown[] = [];
    const service = new RoomService({
      ...new FakeClock().options(),
      onListenerError: (error) => reported.push(error),
    });
    const created = service.createRoom({ nickname: "Host", mode: "individual" });
    const failure = new Error("gateway listener failed");
    const delivered: RoomChange[] = [];
    service.subscribe(() => { throw failure; });
    service.subscribe((change) => delivered.push(change));

    let accepted: PublicRoomSnapshot | undefined;
    expect(() => {
      accepted = dispatch(service, created.playerId, created.snapshot, {
        type: "SET_READY",
        ready: true,
      });
    }).not.toThrow();

    expect(accepted?.players[0].ready).toBe(true);
    expect(delivered).toHaveLength(1);
    expect(delivered[0].snapshot).toEqual(accepted);
    expect(reported).toEqual([failure]);
  });

  it("isolates a throwing listener from timer delivery to later listeners", () => {
    const clock = new FakeClock();
    const reported: unknown[] = [];
    const service = new RoomService({
      ...clock.options(() => 0.1),
      onListenerError: (error) => reported.push(error),
    });
    const [host] = readyIndividualGame(service);
    const failure = new Error("timer listener failed");
    const delivered: RoomChange[] = [];
    service.subscribe(() => { throw failure; });
    service.subscribe((change) => delivered.push(change));

    expect(() => clock.advance(45_000)).not.toThrow();

    expect(delivered).toHaveLength(1);
    expect(delivered[0].roomCode).toBe(host.snapshot.roomCode);
    expect(delivered[0].snapshot.game?.lastThrow?.result).toBe("MO");
    expect(reported).toEqual([failure]);
  });

  it("emits one public snapshot for an accepted command and none for its duplicate", () => {
    const service = new RoomService(new FakeClock().options());
    const created = service.createRoom({ nickname: "Host", mode: "individual" });
    const changes: RoomChange[] = [];
    service.subscribe((change) => changes.push(change));
    const command = {
      type: "SET_READY" as const,
      ready: true,
      roomVersion: created.snapshot.version,
      requestId: requestId(),
    };

    const accepted = service.dispatch(created.playerId, command);
    service.dispatch(created.playerId, command);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({ roomCode: created.snapshot.roomCode, snapshot: accepted });
  });

  it("emits exactly one public snapshot when a player disconnects", () => {
    const service = new RoomService(new FakeClock().options());
    const [host, guest] = createPlayers(service, "individual", ["Host", "Guest"]);
    const changes: RoomChange[] = [];
    service.subscribe((change) => changes.push(change));

    service.disconnect(host.playerId);
    service.disconnect(host.playerId);

    expect(changes).toHaveLength(1);
    expect(changes[0].roomCode).toBe(host.snapshot.roomCode);
    expect(changes[0].snapshot.hostPlayerId).toBe(guest.playerId);
    expect(changes[0].snapshot.players.find((player) => player.id === host.playerId)?.connected).toBe(false);
    expect(JSON.stringify(changes[0])).not.toContain("reconnectToken");
  });

  it("emits exactly one public snapshot for a timer-driven automatic action", () => {
    const clock = new FakeClock();
    const service = new RoomService(clock.options(() => 0.1));
    const [host] = readyIndividualGame(service);
    const changes: RoomChange[] = [];
    const unsubscribe = service.subscribe((change) => changes.push(change));

    clock.advance(45_000);

    expect(changes).toHaveLength(1);
    expect(changes[0].roomCode).toBe(host.snapshot.roomCode);
    expect(changes[0].snapshot.version).toBe(host.snapshot.version + 1);
    expect(changes[0].snapshot.game?.lastThrow?.result).toBe("MO");

    unsubscribe();
    clock.advance(45_000);
    expect(changes).toHaveLength(1);
  });

  it("emits one snapshot for each create, join, disconnect, and reconnect mutation", () => {
    const service = new RoomService(new FakeClock().options());
    const changes: RoomChange[] = [];
    service.subscribe((change) => changes.push(change));

    const host = service.createRoom({ nickname: "Host", mode: "individual" });
    const guest = service.joinRoom({ roomCode: host.snapshot.roomCode, nickname: "Guest" });
    service.disconnect(guest.playerId);
    service.reconnect(guest.reconnectToken);

    expect(changes.map((change) => change.snapshot.version)).toEqual([0, 1, 2, 3]);
    expect(changes.every((change) => change.roomCode === host.snapshot.roomCode)).toBe(true);
  });
});
