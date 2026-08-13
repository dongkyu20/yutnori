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
    pendingThrows: [{ id: "event-1", result: "GAE", legalPieceIds: ["A-1", "A-3"] }],
    throwsRemaining: 0,
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
        legalPieceIds={["A-1", "A-3"]}
        onSelectPiece={() => undefined}
        onSelectRoute={() => undefined}
      />,
    );

    expect(screen.getAllByTestId(/^board-node-O\d+$/)).toHaveLength(20);
    expect(screen.getAllByTestId(/^board-node-(?:D\d_\d|CENTER)$/)).toHaveLength(9);
  });

  it("draws the CENTER_B shortcut through D4 and terminates it at the start corner", () => {
    render(
      <YutBoard
        game={createGame()}
        players={players}
        playerId="player-a"
        legalPieceIds={["A-1", "A-3"]}
        onSelectPiece={() => undefined}
        onSelectRoute={() => undefined}
      />,
    );

    const centerBPath = screen.getAllByTestId(/^board-segment-center-b-/);
    expect(centerBPath.map((segment) => [
      segment.getAttribute("data-from"),
      segment.getAttribute("data-to"),
    ])).toEqual([
      ["O10", "D3_1"],
      ["D3_1", "D3_2"],
      ["D3_2", "CENTER"],
      ["CENTER", "D4_2"],
      ["D4_2", "D4_1"],
      ["D4_1", "O0"],
    ]);
    // 두 지름길은 방에서 교차하는 대각선이므로 D4는 O10과 O0을 잇는 선 위에 있어야 한다.
    expect(screen.getByTestId("board-node-D4_1")).toHaveAttribute("data-node-y", "75");
    expect(screen.getByTestId("board-node-D4_1")).toHaveAttribute("data-node-x", "75");
    expect(screen.queryByTestId("board-segment-center-b-D4_1-O15")).not.toBeInTheDocument();
  });

  it("groups a stack with team text and enables only server-provided legal pieces", async () => {
    const user = userEvent.setup();
    const onSelectPiece = vi.fn();
    render(
      <YutBoard
        game={createGame()}
        players={players}
        playerId="player-a"
        legalPieceIds={["A-1", "A-3"]}
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

  it("marks the start and the shortcut gates, and leaves plain nodes alone", () => {
    render(
      <YutBoard
        game={createGame()}
        players={players}
        playerId="player-a"
        legalPieceIds={[]}
        onSelectPiece={() => undefined}
        onSelectRoute={() => undefined}
      />,
    );

    const start = screen.getByTestId("board-node-O0");
    expect(start).toHaveClass("yut-board__node--start");
    expect(start).toHaveAttribute("data-node-role", "출발점");
    expect(start).toHaveAccessibleName("바깥 지점 0, 출발점");
    // 진행 방향 살촉은 첫 걸음 쪽인 위(-90도)를 가리킨다.
    expect(start.getAttribute("style")).toContain("--start-angle: -90deg");

    ["board-node-O5", "board-node-O10"].forEach((testId) => {
      const gate = screen.getByTestId(testId);
      expect(gate).toHaveClass("yut-board__node--gate");
      expect(gate).toHaveAttribute("data-node-role", "지름길 길목");
    });
    // 지름길이 뻗는 방향을 판 좌표에서 계산해 살촉 각도로 넘긴다.
    expect(screen.getByTestId("board-node-O5").getAttribute("style")).toContain("--gate-angle: 135deg");
    expect(screen.getByTestId("board-node-O10").getAttribute("style")).toContain("--gate-angle: 45deg");

    const center = screen.getByTestId("board-node-CENTER");
    expect(center).toHaveClass("yut-board__node--gate", "yut-board__node--center");
    expect(center).toHaveAccessibleName("가운데 지점, 지름길 길목");
    expect(center.getAttribute("style")).toContain("--gate-angle: 45deg");

    const plain = screen.getByTestId("board-node-O3");
    expect(plain).toHaveClass("yut-board__node");
    expect(plain).not.toHaveAttribute("data-node-role");
    expect(plain).toHaveAccessibleName("바깥 지점 3");
    // 강조는 글자가 아니라 기호로만 한다. 칸 안에는 아무 글자도 넣지 않는다.
    [start, center, screen.getByTestId("board-node-O5"), screen.getByTestId("board-node-O10")]
      .forEach((node) => { expect(node).toBeEmptyDOMElement(); });
  });

  it("runs the track counter-clockwise from the bottom-right start", () => {
    render(
      <YutBoard
        game={createGame()}
        players={players}
        playerId="player-a"
        legalPieceIds={[]}
        onSelectPiece={() => undefined}
        onSelectRoute={() => undefined}
      />,
    );

    const at = (nodeId: string) => {
      const node = screen.getByTestId(`board-node-${nodeId}`);
      return [Number(node.getAttribute("data-node-x")), Number(node.getAttribute("data-node-y"))];
    };

    // 시작점은 오른쪽 아래 모서리, 네 모서리는 반시계 순서로 놓인다.
    expect(at("O0")).toEqual([92, 92]);
    expect(at("O5")).toEqual([92, 8]);
    expect(at("O10")).toEqual([8, 8]);
    expect(at("O15")).toEqual([8, 92]);

    // 첫 다섯 걸음은 오른쪽 변을 따라 위로 오른다. 시계 방향이면 y가 커진다.
    const rightEdge = ["O0", "O1", "O2", "O3", "O4", "O5"].map((nodeId) => at(nodeId));
    rightEdge.forEach(([x], index) => {
      expect(x).toBe(92);
      if (index > 0) expect(rightEdge[index][1]).toBeLessThan(rightEdge[index - 1][1]);
    });
    // 이어지는 위쪽 변은 왼쪽으로 지난다.
    const topEdge = ["O5", "O6", "O7", "O8", "O9", "O10"].map((nodeId) => at(nodeId));
    topEdge.forEach(([, y], index) => {
      expect(y).toBe(8);
      if (index > 0) expect(topEdge[index][0]).toBeLessThan(topEdge[index - 1][0]);
    });

    // 두 지름길은 방에서 교차하고, 참으로 가는 길은 시작점 모서리로 내려온다.
    expect(at("D1_2")).toEqual([58, 42]);
    expect(at("D3_2")).toEqual([42, 42]);
    expect(at("CENTER")).toEqual([50, 50]);
    expect(at("D4_1")).toEqual([75, 75]);
  });

  it("gives each individual player its own piece colour", () => {
    const individualPlayers: PublicRoomSnapshot["players"] = [
      { id: "player-a", nickname: "민수", connected: true, ready: true },
      { id: "player-b", nickname: "지수", connected: true, ready: true },
      { id: "player-c", nickname: "하늘", connected: true, ready: true },
    ];
    render(
      <YutBoard
        game={createGame({
          pieces: [
            { id: "a-1", ownerId: "player-a", status: "BOARD", nodeId: "O3", stackSize: 1 },
            { id: "b-1", ownerId: "player-b", status: "BOARD", nodeId: "O7", stackSize: 1 },
            { id: "c-1", ownerId: "player-c", status: "HOME", stackSize: 1 },
            { id: "a-2", ownerId: "player-a", status: "HOME", stackSize: 1 },
          ],
          legalPieceIds: [],
        })}
        players={individualPlayers}
        playerId="player-a"
        legalPieceIds={[]}
        onSelectPiece={() => undefined}
        onSelectRoute={() => undefined}
      />,
    );

    const slotOf = (name: string) => screen
      .getByRole("button", { name })
      .getAttribute("data-side-slot");
    expect(slotOf("민수 말 1개 바깥 지점 3")).toBe("0");
    expect(slotOf("지수 말 1개 바깥 지점 7")).toBe("1");
    expect(slotOf("하늘 말 1개 출발 대기")).toBe("2");
    // 같은 참가자의 다른 말은 어디에 있든 같은 색이다.
    expect(slotOf("민수 말 1개 출발 대기")).toBe("0");

    const colours = screen.getAllByRole("button", { name: /말 \d개/ })
      .map((piece) => piece.className.match(/yut-piece--side-\d/)?.[0]);
    expect(colours).toEqual([
      "yut-piece--side-0", "yut-piece--side-1", "yut-piece--side-2", "yut-piece--side-0",
    ]);
  });

  it("keeps each team on its own piece colour", () => {
    render(
      <YutBoard
        game={createGame()}
        players={players}
        playerId="player-a"
        legalPieceIds={["A-1", "A-3"]}
        onSelectPiece={() => undefined}
        onSelectRoute={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "A팀 말 2개 가운데 지점" }))
      .toHaveClass("yut-piece--side-0");
    expect(screen.getByRole("button", { name: "A팀 말 1개 출발 대기" }))
      .toHaveClass("yut-piece--side-0");
    expect(screen.getByRole("button", { name: "B팀 말 1개 바깥 지점 10" }))
      .toHaveClass("yut-piece--side-1");
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
        legalPieceIds={["A-1", "A-3"]}
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

  it("matches the participant list colour to the pieces on the board", () => {
    const snapshot: PublicRoomSnapshot = {
      roomCode: "AB2CDE",
      version: 12,
      phase: "playing",
      mode: "individual",
      hostPlayerId: "player-a",
      players: [
        { id: "player-a", nickname: "민수", connected: true, ready: true },
        { id: "player-b", nickname: "지수", connected: true, ready: true },
      ],
      canStart: false,
      startEligibilityReason: null,
      game: createGame({
        pieces: [
          { id: "a-1", ownerId: "player-a", status: "BOARD", nodeId: "O3", stackSize: 1 },
          { id: "b-1", ownerId: "player-b", status: "BOARD", nodeId: "O7", stackSize: 1 },
        ],
        legalPieceIds: [],
        pendingThrows: [],
      }),
    };
    render(<GameScreen snapshot={snapshot} playerId="player-a" sendCommand={() => undefined} />);

    const rowOf = (playerId: string) => document.querySelector(`[data-player-id="${playerId}"]`);
    expect(rowOf("player-a")).toHaveClass("game-player--side-0");
    expect(rowOf("player-b")).toHaveClass("game-player--side-1");
    // 색 이름을 글로도 적어 색만으로 편을 가리지 않는다.
    expect(rowOf("player-a")).toHaveTextContent("주홍 말");
    expect(rowOf("player-b")).toHaveTextContent("청록 말");

    const pieceSlot = (name: string) => screen
      .getByRole("button", { name })
      .getAttribute("data-side-slot");
    expect(pieceSlot("민수 말 1개 바깥 지점 3")).toBe("0");
    expect(pieceSlot("지수 말 1개 바깥 지점 7")).toBe("1");
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
      throwId: "event-1",
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
