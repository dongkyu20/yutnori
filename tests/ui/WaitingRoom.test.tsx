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

  it("shows why the server refused a command, and nothing when it refused none", () => {
    // 거절 사유를 서버만 알고 화면은 조용하면, 색을 고른 사람은 눌러도 아무 일도
    // 일어나지 않는 것으로 본다. 무엇을 다시 해야 하는지 알 길이 없다.
    const { rerender } = render(
      <WaitingRoom snapshot={createSnapshot()} playerId="host" sendCommand={() => {}} />,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    rerender(
      <WaitingRoom
        snapshot={createSnapshot()}
        playerId="host"
        error={{ code: "COLOR_TAKEN", message: "이미 다른 참가자가 고른 색입니다.", recoverable: true }}
        sendCommand={() => {}}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("이미 다른 참가자가 고른 색입니다.");
    expect(alert).toHaveAttribute("data-error-code", "COLOR_TAKEN");
  });

  it("offers a way out of the waiting room", async () => {
    const user = userEvent.setup();
    const leaveRoom = vi.fn();
    render(
      <WaitingRoom
        snapshot={createSnapshot()}
        playerId="host"
        sendCommand={() => {}}
        leaveRoom={leaveRoom}
      />,
    );

    // 대기실에서는 되돌리기 쉬우므로 묻지 않고 바로 내보낸다.
    await user.click(screen.getByRole("button", { name: "방 나가기" }));
    expect(leaveRoom).toHaveBeenCalledTimes(1);
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

  it("keeps host-only controls absent for a member while showing invalid-start feedback", () => {
    renderWaitingRoom(createSnapshot({
      canStart: false,
      startEligibilityReason: "게임을 시작하려면 2명 이상이 필요합니다.",
    }), "guest");

    expect(screen.queryByRole("button", { name: /내보내기/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "게임 시작" })).not.toBeInTheDocument();
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

  it("lets a player take a free colour and blocks the one another player holds", async () => {
    const user = userEvent.setup();
    const { commands } = renderWaitingRoom(createSnapshot({
      players: [
        { id: "host", nickname: "Host", connected: true, ready: true },
        { id: "guest", nickname: "Guest", connected: true, ready: true, colorSlot: 1 },
      ],
    }));

    // 남이 선점한 색은 누를 수 없고, 누가 쓰는지 이름으로 알려 준다.
    const taken = screen.getByRole("button", { name: "청록, Guest이(가) 쓰는 색" });
    expect(taken).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "치자 고르기" }));

    expect(commands).toEqual([
      { type: "CHOOSE_COLOR", slot: 2, roomVersion: 7, requestId: expect.any(String) },
    ]);
  });

  it("marks the colour a player already holds and offers no picker for anyone else", () => {
    renderWaitingRoom(createSnapshot({
      players: [
        { id: "host", nickname: "Host", connected: true, ready: true, colorSlot: 3 },
        { id: "guest", nickname: "Guest", connected: true, ready: true },
      ],
    }));

    expect(screen.getByRole("button", { name: "먹 고르기" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "주홍 고르기" })).toHaveAttribute("aria-pressed", "false");
    // 고르개는 자기 것만 나온다. 남의 색을 대신 정해 줄 수는 없다.
    expect(screen.getAllByRole("group")).toHaveLength(1);
  });

  it("gives the colour picker to the first member of a team, not the others", () => {
    renderWaitingRoom(
      createSnapshot({
        mode: "team",
        players: [
          { id: "host", nickname: "Host", connected: true, ready: true, teamId: "A" },
          { id: "mate", nickname: "Mate", connected: true, ready: true, teamId: "A" },
        ],
      }),
      "mate",
    );

    // A팀에 먼저 들어온 사람이 팀 색을 정한다. 나중 사람에게는 고르개가 없다.
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  it("explains how to copy the code when the Clipboard API is unavailable", async () => {
    const user = userEvent.setup();
    renderWaitingRoom();
    vi.stubGlobal("navigator", {});

    await user.click(screen.getByRole("button", { name: "방 코드 복사" }));

    expect(screen.getByRole("alert")).toHaveTextContent("방 코드를 직접 복사해주세요.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("copies an invite link that opens this room", async () => {
    const user = userEvent.setup();
    renderWaitingRoom();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await user.click(screen.getByRole("button", { name: "초대 링크 복사" }));

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}${window.location.pathname}?room=AB2CDE`);
    expect(screen.getByRole("status")).toHaveTextContent("초대 링크가 복사되었습니다");
  });

  it("tells a member who is not the host that the host starts the game", () => {
    renderWaitingRoom(createSnapshot(), "guest");
    expect(screen.getByText("방장이 게임을 시작하기를 기다리는 중입니다.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "게임 시작" })).not.toBeInTheDocument();
  });
});
