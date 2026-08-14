/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicGameState, PublicRoomSnapshot } from "../../shared/protocol";
import { YutBoard } from "../../client/components/YutBoard";
import { BoardStage } from "../../client/components/BoardStage";
import { sideSlots } from "../../client/sideColor";

const players: PublicRoomSnapshot["players"] = [
  { id: "player-a", nickname: "민수", connected: true, ready: true },
];

const pieces: PublicGameState["pieces"] = [
  { id: "a-1", ownerId: "player-a", status: "BOARD", nodeId: "O3", stackSize: 1 },
];

function game(): PublicGameState {
  return {
    currentPlayerId: "player-a",
    turnStage: "AWAITING_THROW",
    actionExpiresAt: null,
    pieces,
    pendingThrows: [],
    throwsRemaining: 1,
    legalPieceIds: [],
    legalRoutes: [],
    lastThrow: null,
    lastMove: null,
    winnerId: null,
    events: [],
  };
}

describe("BoardStage", () => {
  afterEach(cleanup);

  /** 무대는 처음부터 자취와 연출 알림을 받는다. Task 8이 그 값을 쓰기 시작한다. */
  const stageProps = {
    pieces,
    slots: sideSlots(pieces),
    lastMove: null,
    onActive: () => undefined,
    onAnimating: () => undefined,
  };

  it("hides the canvas from assistive technology", () => {
    const { container } = render(<BoardStage {...stageProps} />);
    const canvas = container.querySelector("canvas");

    expect(canvas).not.toBeNull();
    expect(canvas).toHaveAttribute("aria-hidden", "true");
  });

  it("stays on the 2D board when WebGL is unavailable", () => {
    const onActive = vi.fn();
    render(<BoardStage {...stageProps} onActive={onActive} />);

    // jsdom에는 WebGL이 없다. 무대가 서지 못하면 3D를 켜지 않아야 한다.
    expect(onActive).not.toHaveBeenCalledWith(true);
  });

  it("keeps every board control and label while the stage is mounted", () => {
    render(
      <YutBoard
        game={game()}
        players={players}
        playerId="player-a"
        legalPieceIds={[]}
        onSelectPiece={() => undefined}
        onSelectRoute={() => undefined}
      />,
    );

    // 조작과 라벨은 DOM에 그대로 남는다. 3D는 보이는 것만 맡는다.
    expect(screen.getByRole("button", { name: "민수 말 1개 바깥 지점 3" })).toBeInTheDocument();
    expect(screen.getAllByTestId(/^board-node-/)).toHaveLength(29);
    expect(screen.getByTestId("board-node-O0")).toHaveClass("yut-board__node--start");
    expect(screen.getByLabelText(/윷판 경로/)).not.toHaveClass("yut-board__track--3d");
  });
});
