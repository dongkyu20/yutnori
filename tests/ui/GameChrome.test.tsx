/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmojiReactions } from "../../client/components/EmojiReactions";
import { EventAnnouncer } from "../../client/components/EventAnnouncer";
import { GameScreen } from "../../client/components/GameScreen";
import { Lobby, type LobbySessionApi } from "../../client/components/Lobby";
import { ResultDialog } from "../../client/components/ResultDialog";
import type { InRoomCommand, PublicRoomSnapshot } from "../../shared/protocol";

function gameSnapshot(overrides: Partial<PublicRoomSnapshot> = {}): PublicRoomSnapshot {
  return {
    roomCode: "AB2CDE",
    version: 18,
    phase: "playing",
    mode: "individual",
    hostPlayerId: "player-1",
    players: [
      { id: "player-1", nickname: "민수", connected: true, ready: true },
      { id: "player-2", nickname: "지우", connected: true, ready: true },
    ],
    canStart: false,
    startEligibilityReason: null,
    game: {
      currentPlayerId: "player-1",
      turnStage: "AWAITING_THROW",
      actionExpiresAt: null,
      pieces: [],
      pendingThrows: [],
      throwsRemaining: 0,
      legalPieceIds: [],
      legalRoutes: [],
      lastThrow: null,
      lastMove: null,
      winnerId: null,
      events: [{ id: "event-1", message: "민수님의 차례입니다.", createdAt: 1 }],
    },
    ...overrides,
  };
}

describe("finished game chrome", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("announces each appended event once by id, and stays silent about the past", () => {
    const events = Array.from({ length: 51 }, (unusedValue, index) => ({
      id: `event-${index + 1}`,
      message: `기록 ${index + 1}`,
      createdAt: index + 1,
    }));
    const { rerender } = render(<EventAnnouncer events={events} />);

    // 눈에 보이는 기록은 없앴다. 남은 것은 스크린 리더가 읽는 알림 하나뿐이다.
    expect(screen.queryByRole("list", { name: "경기 기록" })).not.toBeInTheDocument();
    const liveRegion = screen.getByRole("status", { name: "새 경기 기록" });
    expect(liveRegion).toHaveClass("sr-only");
    // 들어오자마자 지난 기록을 죽 읊지 않는다.
    expect(liveRegion).toBeEmptyDOMElement();

    const sameMessage = "지우님이 윷을 던졌습니다.";
    rerender(<EventAnnouncer events={[...events, { id: "event-52", message: sameMessage, createdAt: 52 }]} />);
    const firstAnnouncement = liveRegion.firstElementChild;
    expect(firstAnnouncement).toHaveTextContent(sameMessage);

    // 같은 문구가 다시 와도 새 사건이면 다시 읽히도록 노드를 갈아 끼운다.
    rerender(<EventAnnouncer events={[
      ...events,
      { id: "event-52", message: sameMessage, createdAt: 52 },
      { id: "event-53", message: sameMessage, createdAt: 53 },
    ]} />);
    expect(liveRegion.firstElementChild).toHaveTextContent(sameMessage);
    expect(liveRegion.firstElementChild).not.toBe(firstAnnouncement);
  });

  it("offers exactly the four protocol reactions and ignores rapid repeat sends for 800ms", async () => {
    vi.useFakeTimers();
    const onReact = vi.fn();
    render(<EmojiReactions reactions={[]} players={[]} onReact={onReact} />);

    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["👏", "🔥", "😮", "🎉"]);
    fireEvent.click(screen.getByRole("button", { name: "박수 보내기" }));
    fireEvent.click(screen.getByRole("button", { name: "불꽃 보내기" }));
    expect(onReact).toHaveBeenCalledTimes(1);
    expect(onReact).toHaveBeenCalledWith("👏");

    act(() => vi.advanceTimersByTime(800));
    fireEvent.click(screen.getByRole("button", { name: "불꽃 보내기" }));
    expect(onReact).toHaveBeenLastCalledWith("🔥");
    expect(onReact).toHaveBeenCalledTimes(2);
  });

  it("shows received reactions ephemerally and attributes them to a player", () => {
    const { rerender } = render(
      <EmojiReactions
        reactions={[{ id: 1, playerId: "player-2", emoji: "🎉" }]}
        players={gameSnapshot().players}
        onReact={() => undefined}
      />,
    );

    expect(screen.getByRole("status", { name: "실시간 반응" })).toHaveTextContent("지우 🎉");
    rerender(<EmojiReactions reactions={[]} players={gameSnapshot().players} onReact={() => undefined} />);
    expect(screen.getByRole("status", { name: "실시간 반응" })).toBeEmptyDOMElement();
  });

  it("moves focus into the winner dialog, traps keyboard focus, and offers both endings", async () => {
    const user = userEvent.setup();
    const onPlayAgain = vi.fn();
    const onReturnToLobby = vi.fn();
    render(
      <ResultDialog winnerName="민수" onPlayAgain={onPlayAgain} onReturnToLobby={onReturnToLobby} />,
    );

    const dialog = screen.getByRole("dialog", { name: "경기 결과" });
    const playAgain = screen.getByRole("button", { name: "같은 사람들과 다시 하기" });
    const returnButton = screen.getByRole("button", { name: "로비로 돌아가기" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // 한 판 더가 기본 행동이라 먼저 초점을 받는다.
    expect(playAgain).toHaveFocus();
    await user.tab();
    expect(returnButton).toHaveFocus();
    await user.tab();
    expect(playAgain).toHaveFocus();
    await user.tab({ shift: true });
    expect(returnButton).toHaveFocus();

    await user.click(playAgain);
    expect(onPlayAgain).toHaveBeenCalledTimes(1);
    await user.click(returnButton);
    expect(onReturnToLobby).toHaveBeenCalledTimes(1);
  });

  it("asks the server for a rematch with the current room version", async () => {
    const user = userEvent.setup();
    const sendCommand = vi.fn();
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000009");
    const finished = gameSnapshot();
    const snapshot: PublicRoomSnapshot = {
      ...finished,
      phase: "finished",
      game: { ...finished.game!, turnStage: "COMPLETE", winnerId: "player-1" },
    };
    render(
      <GameScreen
        snapshot={snapshot}
        playerId="player-2"
        sendCommand={sendCommand}
        leaveRoom={() => undefined}
      />,
    );

    expect(screen.getByRole("dialog", { name: "경기 결과" })).toHaveTextContent("민수 승리!");
    await user.click(screen.getByRole("button", { name: "같은 사람들과 다시 하기" }));

    // 방장이 아니어도 부를 수 있고, 서버는 버전으로 뒤늦은 요청을 걸러낸다.
    expect(sendCommand).toHaveBeenCalledWith({
      type: "PLAY_AGAIN",
      roomVersion: 18,
      requestId: "00000000-0000-4000-8000-000000000009",
    });
  });

  it("keeps showing the saved winner name after the winner leaves the finished room", () => {
    const finished = gameSnapshot();
    const snapshot: PublicRoomSnapshot = {
      ...finished,
      phase: "finished",
      players: finished.players.filter((player) => player.id !== "player-1"),
      game: {
        ...finished.game!,
        turnStage: "COMPLETE",
        winnerId: "player-1",
        winnerName: "민수",
      },
    };

    render(
      <GameScreen
        snapshot={snapshot}
        playerId="player-2"
        sendCommand={() => undefined}
        leaveRoom={() => undefined}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "경기 결과" });
    expect(dialog).toHaveTextContent("민수 승리!");
    expect(dialog).not.toHaveTextContent("player-1");
  });

  it("moves focus to the real lobby after the result action replaces the game screen", async () => {
    const user = userEvent.setup();
    const lobbySession: LobbySessionApi = {
      connectionState: "connected",
      createRoom: () => undefined,
      joinRoom: () => undefined,
    };
    function ResultToLobbyHarness() {
      const [inGame, setInGame] = useState(true);
      return inGame
        ? (
          <ResultDialog
            winnerName="민수"
            onPlayAgain={() => undefined}
            onReturnToLobby={() => setInGame(false)}
          />
        )
        : <Lobby session={lobbySession} />;
    }
    render(<ResultToLobbyHarness />);
    const returnButton = screen.getByRole("button", { name: "로비로 돌아가기" });

    await user.click(returnButton);

    expect(returnButton.isConnected).toBe(false);
    expect(screen.getByRole("heading", { name: "같이 던지고, 함께 웃는 한판" })).toHaveFocus();
  });

  it.each([
    ["offline", "연결이 끊겼습니다. 연결 상태를 확인해 주세요."],
    ["reconnecting", "게임에 다시 연결하는 중입니다."],
  ] as const)("shows %s connection state text", (connectionState, expected) => {
    render(
      <GameScreen
        snapshot={gameSnapshot()}
        playerId="player-1"
        connectionState={connectionState}
        reactions={[]}
        sendCommand={() => undefined}
        leaveRoom={() => undefined}
      />,
    );

    expect(screen.getByRole("status", { name: "연결 상태" })).toHaveTextContent(expected);
  });

  it("lists every player in one strip with whose turn it is and how many pieces wait", () => {
    const base = gameSnapshot();
    const snapshot = gameSnapshot({
      game: {
        ...base.game!,
        pieces: [
          { id: "p1-a", ownerId: "player-1", status: "HOME", stackSize: 1 },
          { id: "p1-b", ownerId: "player-1", status: "FINISHED", stackSize: 1 },
          { id: "p2-a", ownerId: "player-2", status: "HOME", stackSize: 1 },
        ],
      },
    });
    render(<GameScreen snapshot={snapshot} playerId="player-2" sendCommand={() => undefined} />);

    const strip = screen.getByRole("list", { name: "참가자" });
    expect(strip.querySelector(".game-player[aria-current='true'] strong")).toHaveTextContent("민수");
    expect(strip.querySelector("[data-player-id='player-1']")).toHaveTextContent("대기 1 · 완주 1");
    expect(strip.querySelector("[data-player-id='player-2']")).toHaveTextContent("나");
    // 눈에는 끊긴 사람만 표시하지만, 스크린 리더와 재접속 확인은 "연결됨"을 읽는다.
    expect(strip.querySelector("[data-player-id='player-1']")).toHaveTextContent("연결됨");
    expect(screen.queryByRole("button", { name: /참가자 패널/ })).not.toBeInTheDocument();
  });

  it("keeps the connection line quiet while connected", () => {
    render(<GameScreen snapshot={gameSnapshot()} playerId="player-1" sendCommand={() => undefined} />);
    const status = screen.getByRole("status", { name: "연결 상태" });
    expect(status).toHaveClass("connection-status--connected");
    expect(status).toHaveTextContent("서버와 연결되었습니다.");
  });

  it("copies an invite link from the game bar", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<GameScreen snapshot={gameSnapshot()} playerId="player-1" sendCommand={() => undefined} />);

    const invite = screen.getByRole("button", { name: "초대 링크 복사" });
    await user.click(invite);

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}${window.location.pathname}?room=AB2CDE`);
    expect(invite).toHaveTextContent("복사됨");
    expect(screen.getByText("초대 링크가 복사되었습니다.")).toHaveAttribute("role", "status");
    vi.unstubAllGlobals();
  });

  it("asks before leaving a game in progress and stays put when the answer is no", async () => {
    const user = userEvent.setup();
    const leaveRoom = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <GameScreen
        snapshot={gameSnapshot()}
        playerId="player-1"
        connectionState="connected"
        reactions={[]}
        sendCommand={() => undefined}
        leaveRoom={leaveRoom}
      />,
    );

    await user.click(screen.getByRole("button", { name: "방 나가기" }));
    expect(leaveRoom).not.toHaveBeenCalled();

    vi.mocked(window.confirm).mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "방 나가기" }));
    expect(leaveRoom).toHaveBeenCalledTimes(1);
  });

  it("returns from a finished game by leaving only the current room session", async () => {
    const user = userEvent.setup();
    const commands: InRoomCommand[] = [];
    const leaveRoom = vi.fn();
    const finished = gameSnapshot({
      phase: "finished",
      game: { ...gameSnapshot().game!, winnerId: "player-2", turnStage: "COMPLETE" },
    });
    render(
      <GameScreen
        snapshot={finished}
        playerId="player-1"
        connectionState="connected"
        reactions={[]}
        sendCommand={(command) => commands.push(command)}
        leaveRoom={leaveRoom}
      />,
    );

    expect(screen.getByRole("dialog", { name: "경기 결과" })).toHaveTextContent("지우");
    await user.click(screen.getByRole("button", { name: "로비로 돌아가기" }));
    expect(leaveRoom).toHaveBeenCalledTimes(1);
    expect(commands).toEqual([]);
  });
});

describe("my turn signal", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("pops a banner when the turn reaches me, then lets it go while the glow stays", () => {
    vi.useFakeTimers();
    const theirs = gameSnapshot({ game: { ...gameSnapshot().game!, currentPlayerId: "player-1" } });
    const { container, rerender } = render(
      <GameScreen snapshot={theirs} playerId="player-2" sendCommand={() => undefined} />,
    );
    expect(screen.queryByTestId("turn-banner")).not.toBeInTheDocument();
    expect(container.querySelector(".game-screen")).not.toHaveClass("game-screen--my-turn");

    const mine = gameSnapshot({ version: 19, game: { ...theirs.game!, currentPlayerId: "player-2" } });
    rerender(<GameScreen snapshot={mine} playerId="player-2" sendCommand={() => undefined} />);
    expect(screen.getByTestId("turn-banner")).toHaveTextContent("내 차례!");
    expect(container.querySelector(".game-screen")).toHaveClass("game-screen--my-turn");

    act(() => { vi.advanceTimersByTime(2500); });
    expect(screen.queryByTestId("turn-banner")).not.toBeInTheDocument();
    expect(container.querySelector(".game-screen")).toHaveClass("game-screen--my-turn");

    // 한 번 더 던지느라 차례가 이어질 때는 다시 띄우지 않는다.
    rerender(<GameScreen snapshot={{ ...mine, version: 20 }} playerId="player-2" sendCommand={() => undefined} />);
    expect(screen.queryByTestId("turn-banner")).not.toBeInTheDocument();
  });
});
