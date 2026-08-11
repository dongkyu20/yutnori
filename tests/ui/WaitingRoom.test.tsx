/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InRoomCommand, PublicRoomSnapshot } from "../../shared/protocol";
import { WaitingRoom } from "../../client/components/WaitingRoom";

type WaitingSnapshot = PublicRoomSnapshot & {
  canStart: boolean;
  startEligibilityReason: string | null;
};

function createSnapshot(overrides: Partial<WaitingSnapshot> = {}): WaitingSnapshot {
  return {
    roomCode: "AB2CDE",
    version: 7,
    phase: "waiting",
    mode: "individual",
    hostPlayerId: "host",
    players: [
      { id: "host", nickname: "Host", connected: true, ready: true },
      { id: "guest", nickname: "Guest", connected: true, ready: true },
    ],
    game: null,
    canStart: true,
    startEligibilityReason: null,
    ...overrides,
  };
}

function renderWaitingRoom(snapshot = createSnapshot(), playerId = "host") {
  const commands: InRoomCommand[] = [];
  render(
    <WaitingRoom
      snapshot={snapshot}
      playerId={playerId}
      sendCommand={(command) => commands.push(command)}
    />,
  );
  return { commands };
}

describe("WaitingRoom", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders individual occupancy and each player's connected ready status", () => {
    renderWaitingRoom(createSnapshot({
      players: [
        { id: "host", nickname: "Host", connected: true, ready: true },
        { id: "guest", nickname: "Guest", connected: false, ready: false },
      ],
      canStart: false,
      startEligibilityReason: "모든 참가자가 연결되고 준비되어야 합니다.",
    }));

    expect(screen.getByText("참가 인원 2/4")).toBeInTheDocument();
    expect(screen.getByText("Host")).toBeInTheDocument();
    expect(screen.getByText("방장")).toBeInTheDocument();
    expect(screen.getByText("연결됨")).toBeInTheDocument();
    expect(screen.getByText("준비 완료")).toBeInTheDocument();
    expect(screen.getByText("연결 끊김")).toBeInTheDocument();
    expect(screen.getByText("준비 안 됨")).toBeInTheDocument();
    expect(screen.getByText("모든 참가자가 연결되고 준비되어야 합니다.")).toBeInTheDocument();
  });

  it("gives a host valid start commands with the current version and distinct request ids", async () => {
    const user = userEvent.setup();
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000002");
    const { commands } = renderWaitingRoom();

    const start = screen.getByRole("button", { name: "게임 시작" });
    expect(start).toBeEnabled();
    await user.click(start);
    await user.click(start);

    expect(commands).toEqual([
      { type: "START_GAME", roomVersion: 7, requestId: "00000000-0000-4000-8000-000000000001" },
      { type: "START_GAME", roomVersion: 7, requestId: "00000000-0000-4000-8000-000000000002" },
    ]);
  });

  it("keeps host-only controls unavailable to a member and disables invalid start", () => {
    renderWaitingRoom(createSnapshot({
      canStart: false,
      startEligibilityReason: "게임을 시작하려면 2명 이상이 필요합니다.",
    }), "guest");

    expect(screen.queryByRole("button", { name: /내보내기/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "게임 시작" })).toBeDisabled();
    expect(screen.getByText("게임을 시작하려면 2명 이상이 필요합니다.")).toBeInTheDocument();
  });

  it("shows four two-seat team cards and lets only the host assign a team", async () => {
    const user = userEvent.setup();
    const { commands } = renderWaitingRoom(createSnapshot({
      mode: "team",
      canStart: false,
      startEligibilityReason: "각 팀에 2명이 필요합니다.",
      players: [
        { id: "host", nickname: "Host", connected: true, ready: true, teamId: "A" },
        { id: "guest", nickname: "Guest", connected: true, ready: false },
      ],
    }));

    for (const teamId of ["A", "B", "C", "D"]) {
      expect(screen.getByRole("region", { name: `팀 ${teamId}` })).toHaveTextContent(teamId === "A" ? "1/2" : "0/2");
    }
    expect(screen.getByRole("region", { name: "팀 A" })).toHaveTextContent("Host");
    await user.selectOptions(screen.getByLabelText("Guest 팀 배정"), "B");
    expect(commands).toEqual([
      {
        type: "ASSIGN_TEAM",
        playerId: "guest",
        teamId: "B",
        roomVersion: 7,
        requestId: expect.any(String),
      },
    ]);
  });

  it("lets the host assign themselves to an open team", async () => {
    const user = userEvent.setup();
    const { commands } = renderWaitingRoom(createSnapshot({
      mode: "team",
      canStart: false,
      startEligibilityReason: "각 팀에 2명이 필요합니다.",
      players: [
        { id: "host", nickname: "Host", connected: true, ready: false },
        { id: "guest", nickname: "Guest", connected: true, ready: false },
      ],
    }));

    await user.selectOptions(screen.getByLabelText("Host 팀 배정"), "A");

    expect(commands[0]).toMatchObject({
      type: "ASSIGN_TEAM",
      playerId: "host",
      teamId: "A",
      roomVersion: 7,
    });
  });

  it("copies the room code and kicks only after confirmation", async () => {
    const user = userEvent.setup();
    const { commands } = renderWaitingRoom();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);

    await user.click(screen.getByRole("button", { name: "방 코드 복사" }));
    await user.click(screen.getByRole("button", { name: "Guest 내보내기" }));
    await user.click(screen.getByRole("button", { name: "Guest 내보내기" }));

    expect(writeText).toHaveBeenCalledWith("AB2CDE");
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ type: "KICK_PLAYER", playerId: "guest", roomVersion: 7 });
  });

  it("explains how to copy the code when the Clipboard API is unavailable", async () => {
    const user = userEvent.setup();
    renderWaitingRoom();
    vi.stubGlobal("navigator", {});

    await user.click(screen.getByRole("button", { name: "방 코드 복사" }));

    expect(screen.getByRole("alert")).toHaveTextContent("방 코드를 직접 복사해주세요.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
