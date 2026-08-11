/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicGameState, PublicRoomSnapshot } from "../../shared/protocol";
import { YutBoard } from "../../client/components/YutBoard";
import { GameScreen } from "../../client/components/GameScreen";

const players: PublicRoomSnapshot["players"] = [
  { id: "player-a", nickname: "민수", connected: true, ready: true, teamId: "A" },
  { id: "player-b", nickname: "지수", connected: true, ready: true, teamId: "B" },
];

function createGame(overrides: Partial<PublicGameState> = {}): PublicGameState {
  return {
    currentPlayerId: "player-a",
    turnStage: "AWAITING_PIECE",
    actionExpiresAt: null,
    pieces: [
      { id: "A-1", ownerId: "A", teamId: "A", status: "BOARD", nodeId: "CENTER", stackSize: 2 },
      { id: "A-2", ownerId: "A", teamId: "A", status: "BOARD", nodeId: "CENTER", stackSize: 2 },
      { id: "A-3", ownerId: "A", teamId: "A", status: "HOME", stackSize: 1 },
      { id: "B-1", ownerId: "B", teamId: "B", status: "BOARD", nodeId: "O10", stackSize: 1 },
    ],
    legalPieceIds: ["A-1", "A-3"],
    legalRoutes: [],
    lastThrow: {
      eventId: "event-1",
      result: "GAE",
      sticks: [true, true, false, false],
    },
    winnerId: null,
    events: [{ id: "event-1", message: "민수가 개를 던졌습니다.", createdAt: 1 }],
    ...overrides,
  };
}

describe("YutBoard", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders all 20 outer nodes and the nine shortcut nodes", () => {
    render(
      <YutBoard
        game={createGame()}
        players={players}
        playerId="player-a"
        onSelectPiece={() => undefined}
        onSelectRoute={() => undefined}
      />,
    );

    expect(screen.getAllByTestId(/^board-node-O\d+$/)).toHaveLength(20);
    expect(screen.getAllByTestId(/^board-node-(?:D\d_\d|CENTER)$/)).toHaveLength(9);
  });

  it("groups a stack with team text and enables only server-provided legal pieces", async () => {
    const user = userEvent.setup();
    const onSelectPiece = vi.fn();
    render(
      <YutBoard
        game={createGame()}
        players={players}
        playerId="player-a"
        onSelectPiece={onSelectPiece}
        onSelectRoute={() => undefined}
      />,
    );

    const stack = screen.getByRole("button", { name: "A팀 말 2개 가운데 지점" });
    const homePiece = screen.getByRole("button", { name: "A팀 말 1개 출발 대기" });
    const opponent = screen.getByRole("button", { name: "B팀 말 1개 바깥 지점 10" });

    expect(stack).toHaveTextContent("A ×2");
    expect(stack).toBeEnabled();
    expect(homePiece).toBeEnabled();
    expect(opponent).toBeDisabled();

    stack.focus();
    await user.keyboard("{Enter}");
    homePiece.focus();
    await user.keyboard(" ");
    expect(onSelectPiece).toHaveBeenNthCalledWith(1, "A-1");
    expect(onSelectPiece).toHaveBeenNthCalledWith(2, "A-3");
  });

  it("exposes only server-provided legal routes as keyboard-operable buttons", async () => {
    const user = userEvent.setup();
    const onSelectRoute = vi.fn();
    render(
      <YutBoard
        game={createGame({
          turnStage: "AWAITING_ROUTE",
          legalPieceIds: [],
          legalRoutes: [
            { routeId: "OUTER", destinationNodeId: "O7" },
            { routeId: "CENTER_A", destinationNodeId: "D1_2" },
          ],
        })}
        players={players}
        playerId="player-a"
        onSelectPiece={() => undefined}
        onSelectRoute={onSelectRoute}
      />,
    );

    const outerRoute = screen.getByRole("button", { name: "바깥길 선택: 바깥 지점 7 도착" });
    const centerRoute = screen.getByRole("button", { name: "가운데길 선택: 대각선 지점 1-2 도착" });
    expect(screen.getAllByRole("button", { name: /길 선택:/ })).toHaveLength(2);

    outerRoute.focus();
    await user.keyboard(" ");
    centerRoute.focus();
    await user.keyboard("{Enter}");
    expect(onSelectRoute).toHaveBeenNthCalledWith(1, "OUTER");
    expect(onSelectRoute).toHaveBeenNthCalledWith(2, "CENTER_A");
  });

  it("sends legal piece and route intent with the current room version and fresh UUIDs", async () => {
    const user = userEvent.setup();
    const sendCommand = vi.fn();
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000002");
    const snapshot: PublicRoomSnapshot = {
      roomCode: "AB2CDE",
      version: 12,
      phase: "playing",
      mode: "team",
      hostPlayerId: "player-a",
      players,
      canStart: false,
      startEligibilityReason: null,
      game: createGame(),
    };
    const { rerender } = render(
      <GameScreen snapshot={snapshot} playerId="player-a" sendCommand={sendCommand} />,
    );

    await user.click(screen.getByRole("button", { name: "A팀 말 2개 가운데 지점" }));
    const routeSnapshot = {
      ...snapshot,
      version: 13,
      game: createGame({
        turnStage: "AWAITING_ROUTE",
        legalPieceIds: [],
        legalRoutes: [{ routeId: "CENTER_A", destinationNodeId: "D1_2" }],
      }),
    };
    rerender(<GameScreen snapshot={routeSnapshot} playerId="player-a" sendCommand={sendCommand} />);
    await user.click(screen.getByRole("button", { name: "가운데길 선택: 대각선 지점 1-2 도착" }));

    expect(sendCommand).toHaveBeenNthCalledWith(1, {
      type: "SELECT_PIECE",
      pieceId: "A-1",
      roomVersion: 12,
      requestId: "00000000-0000-4000-8000-000000000001",
    });
    expect(sendCommand).toHaveBeenNthCalledWith(2, {
      type: "SELECT_ROUTE",
      routeId: "CENTER_A",
      roomVersion: 13,
      requestId: "00000000-0000-4000-8000-000000000002",
    });
  });
});
