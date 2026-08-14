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

  it("provides independent participant and event panel toggles for the mobile flow", async () => {
    const user = userEvent.setup();
    render(
      <GameScreen
        snapshot={gameSnapshot()}
        playerId="player-1"
        connectionState="connected"
        reactions={[]}
        sendCommand={() => undefined}
        leaveRoom={() => undefined}
      />,
    );

    const playersToggle = screen.getByRole("button", { name: "참가자 패널 접기" });
    const playersPanel = screen.getByRole("region", { name: "참가자" });
    expect(playersToggle).toHaveAttribute("aria-expanded", "true");
    // 경기 기록 패널은 없앴으므로 접을 것도 없다.
    expect(screen.queryByRole("button", { name: /경기 기록 패널/ })).not.toBeInTheDocument();

    await user.click(playersToggle);
    expect(playersToggle).toHaveAccessibleName("참가자 패널 펼치기");
    expect(playersToggle).toHaveAttribute("aria-expanded", "false");
    expect(playersPanel).not.toHaveAttribute("hidden");
    expect(playersPanel).toHaveClass("game-panel--collapsed");
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
