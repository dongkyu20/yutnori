import { describe, expect, it } from "vitest";
import { getMoveOptions } from "../../server/game/board";
import {
  getLegalMoveOptions,
  getLegalPieceIds,
  movePieces,
} from "../../server/game/pieces";
import type { Piece } from "../../server/game/types";

const piece = (value: Partial<Piece> & Pick<Piece, "id" | "ownerId">): Piece => ({
  status: "HOME",
  ...value,
});

describe("piece rules", () => {
  it("starts a home piece on the outer route without mutating the input", () => {
    const pieces = [piece({ id: "A-1", ownerId: "A1" })];
    const option = getMoveOptions({ nodeId: "O0", routeId: "OUTER" }, 1)[0];

    const resolution = movePieces(pieces, { pieceId: "A-1", option });

    expect(pieces[0]).toEqual({ id: "A-1", ownerId: "A1", status: "HOME" });
    expect(resolution.pieces[0]).toEqual({
      id: "A-1",
      ownerId: "A1",
      status: "BOARD",
      position: { nodeId: "O1", routeId: "OUTER" },
      stackId: "A-1",
    });
    expect(resolution.movedPieceIds).toEqual(["A-1"]);
  });

  it("merges friendly pieces into the destination stack", () => {
    const pieces = [
      piece({
        id: "A-1",
        ownerId: "A1",
        status: "BOARD",
        position: { nodeId: "O1", routeId: "OUTER" },
        stackId: "A-1",
      }),
      piece({
        id: "A-2",
        ownerId: "A1",
        status: "BOARD",
        position: { nodeId: "O2", routeId: "OUTER" },
        stackId: "A-2",
      }),
    ];

    const resolution = movePieces(pieces, {
      pieceId: "A-1",
      option: getMoveOptions({ nodeId: "O1", routeId: "OUTER" }, 1)[0],
    });

    expect(resolution.pieces).toMatchObject([
      { id: "A-1", position: { nodeId: "O2" }, stackId: "A-2" },
      { id: "A-2", position: { nodeId: "O2" }, stackId: "A-2" },
    ]);
  });

  it("stacks pieces owned by different members of the same team", () => {
    const pieces = [
      piece({
        id: "A-1",
        ownerId: "A1",
        teamId: "A",
        status: "BOARD",
        position: { nodeId: "O1", routeId: "OUTER" },
        stackId: "A-1",
      }),
      piece({
        id: "A-2",
        ownerId: "A2",
        teamId: "A",
        status: "BOARD",
        position: { nodeId: "O2", routeId: "OUTER" },
        stackId: "A-2",
      }),
    ];

    const resolution = movePieces(pieces, {
      pieceId: "A-1",
      option: getMoveOptions({ nodeId: "O1", routeId: "OUTER" }, 1)[0],
    });

    expect(resolution.capturedPieceIds).toEqual([]);
    expect(resolution.pieces.map(({ stackId }) => stackId)).toEqual(["A-2", "A-2"]);
  });

  it("uses the arriving route when opposite-route friendly stacks merge at center", () => {
    const pieces = [
      piece({
        id: "A-1",
        ownerId: "A1",
        status: "BOARD",
        position: { nodeId: "D1_2", routeId: "CENTER_A" },
        stackId: "A-1",
      }),
      piece({
        id: "A-2",
        ownerId: "A1",
        status: "BOARD",
        position: { nodeId: "CENTER", routeId: "CENTER_B" },
        stackId: "A-2",
      }),
    ];

    const resolution = movePieces(pieces, {
      pieceId: "A-1",
      option: getMoveOptions({ nodeId: "D1_2", routeId: "CENTER_A" }, 1)[0],
    });

    expect(resolution.pieces.map(({ position }) => position?.routeId)).toEqual([
      "CENTER_A",
      "CENTER_A",
    ]);
  });

  it("captures an entire opposing stack and returns it home", () => {
    const pieces = [
      piece({
        id: "A-1",
        ownerId: "A1",
        status: "BOARD",
        position: { nodeId: "O1", routeId: "OUTER" },
        stackId: "A-1",
      }),
      piece({
        id: "B-1",
        ownerId: "B1",
        status: "BOARD",
        position: { nodeId: "O2", routeId: "OUTER" },
        stackId: "B-stack",
      }),
      piece({
        id: "B-2",
        ownerId: "B1",
        status: "BOARD",
        position: { nodeId: "O2", routeId: "OUTER" },
        stackId: "B-stack",
      }),
    ];

    const resolution = movePieces(pieces, {
      pieceId: "A-1",
      option: getMoveOptions({ nodeId: "O1", routeId: "OUTER" }, 1)[0],
    });

    expect(resolution).toMatchObject({
      capturedPieceIds: ["B-1", "B-2"],
      bonusThrowsEarned: 1,
    });
    expect(resolution.pieces.slice(1)).toEqual([
      { id: "B-1", ownerId: "B1", status: "HOME" },
      { id: "B-2", ownerId: "B1", status: "HOME" },
    ]);
  });

  it("finishes every piece in the selected stack", () => {
    const pieces = [
      piece({
        id: "A-1",
        ownerId: "A1",
        status: "BOARD",
        position: { nodeId: "O19", routeId: "OUTER" },
        stackId: "A-stack",
      }),
      piece({
        id: "A-2",
        ownerId: "A1",
        status: "BOARD",
        position: { nodeId: "O19", routeId: "OUTER" },
        stackId: "A-stack",
      }),
    ];

    const resolution = movePieces(pieces, {
      pieceId: "A-1",
      option: getMoveOptions({ nodeId: "O19", routeId: "OUTER" }, 2)[0],
    });

    expect(resolution.movedPieceIds).toEqual(["A-1", "A-2"]);
    expect(resolution.pieces).toEqual([
      { id: "A-1", ownerId: "A1", status: "FINISHED" },
      { id: "A-2", ownerId: "A1", status: "FINISHED" },
    ]);
  });

  it("treats the two names of the finish corner as one square", () => {
    // 빽도로 되돌아온 자리와 한 바퀴 돌아 선 도착점은 이름만 둘일 뿐 판에서는 같은 모서리다.
    // 따로 세면 같은 자리에 선 두 말이 서로를 못 보고 지나친다.
    const pieces = [
      piece({ id: "A-1", ownerId: "A1", status: "BOARD", position: { nodeId: "O1", routeId: "OUTER" } }),
      piece({ id: "B-1", ownerId: "B1", status: "BOARD", position: { nodeId: "GOAL", routeId: "OUTER" } }),
    ];

    const resolution = movePieces(pieces, {
      pieceId: "A-1",
      option: getMoveOptions({ nodeId: "O1", routeId: "OUTER" }, -1)[0],
    });

    expect(resolution.capturedPieceIds).toEqual(["B-1"]);
    expect(resolution.pieces.find((entry) => entry.id === "B-1")).toEqual({
      id: "B-1", ownerId: "B1", status: "HOME",
    });
  });

  it("stacks onto a friend already standing on the finish corner", () => {
    const pieces = [
      piece({ id: "A-1", ownerId: "A1", status: "BOARD", position: { nodeId: "O19", routeId: "OUTER" } }),
      piece({ id: "A-2", ownerId: "A1", status: "BOARD", position: { nodeId: "RETURN", routeId: "OUTER" }, stackId: "A-2" }),
    ];

    const resolution = movePieces(pieces, {
      pieceId: "A-1",
      option: getMoveOptions({ nodeId: "O19", routeId: "OUTER" }, 1)[0],
    });

    expect(resolution.capturedPieceIds).toEqual([]);
    // 업힌 두 말은 한 이름의 칸에 모여 함께 움직인다.
    const stacked = resolution.pieces.filter((entry) => entry.stackId === "A-2");
    expect(stacked.map((entry) => entry.id)).toEqual(["A-1", "A-2"]);
    expect(new Set(stacked.map((entry) => entry.position?.nodeId))).toEqual(new Set(["GOAL"]));
  });

  it("rejects back-do when all owned pieces are home", () => {
    const pieces = [
      piece({ id: "A-1", ownerId: "A1" }),
      piece({ id: "A-2", ownerId: "A1" }),
      piece({ id: "B-1", ownerId: "B1" }),
    ];

    expect(getLegalPieceIds(pieces, { ownerId: "A1" }, -1)).toEqual([]);
  });

  it("takes the shortcut for a piece stopped on a junction", () => {
    const junctionPiece = piece({
      id: "A-1",
      ownerId: "A1",
      status: "BOARD",
      position: { nodeId: "O5", routeId: "OUTER" },
      stackId: "A-1",
    });

    expect(getLegalMoveOptions(junctionPiece, 2)).toEqual([
      { routeId: "CENTER_A", nodeId: "D1_2", finished: false, traversed: ["D1_1", "D1_2"] },
    ]);
  });
});
