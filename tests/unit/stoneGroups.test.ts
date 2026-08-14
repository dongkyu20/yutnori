import { describe, expect, it } from "vitest";
import type { PublicGameState } from "../../shared/protocol";
import { sideSlots } from "../../client/sideColor";
import { boardGroups, stoneGroups } from "../../client/three/stoneGroups";

type Piece = PublicGameState["pieces"][number];

function piece(overrides: Partial<Piece> & { id: string }): Piece {
  return { ownerId: "player-a", status: "BOARD", stackSize: 1, ...overrides };
}

/** 서버는 업힌 묶음의 모든 말에 묶음 전체의 크기를 적어 보낸다. */
function stack(nodeId: string, ownerId: string, count: number): Piece[] {
  return Array.from({ length: count }, (_, index) =>
    piece({ id: `${ownerId}-${nodeId}-${index}`, ownerId, nodeId, stackSize: count }));
}

describe("3D 말 덩이 묶기", () => {
  it("draws a stack exactly as thick as the pieces standing in it", () => {
    const pieces = stack("O3", "player-a", 2);

    const groups = boardGroups(pieces, sideSlots(pieces));

    expect(groups).toHaveLength(1);
    // stackSize는 이미 묶음 전체의 크기다. 말 수를 다시 더하면 두 개짜리가 세 개로 두꺼워진다.
    expect(groups[0].stackSize).toBe(2);
    expect(groups[0].pieceIds).toHaveLength(2);
  });

  it("draws a four-piece stack as four", () => {
    const pieces = stack("D2_1", "player-b", 4);

    const groups = boardGroups(pieces, sideSlots(pieces));

    expect(groups[0].stackSize).toBe(4);
    expect(groups[0].pieceIds).toHaveLength(4);
  });

  it("counts the pieces when the server no longer calls them a stack", () => {
    // 잡히거나 참으로 난 말은 묶음이 풀려 각자 stackSize가 1이 된다.
    // 그래도 함께 움직인 말이 둘이면 유령은 두 개 두께여야 한다.
    const captured = [
      piece({ id: "b-1", ownerId: "player-b", status: "HOME" }),
      piece({ id: "b-2", ownerId: "player-b", status: "HOME" }),
    ];

    const groups = stoneGroups(captured, sideSlots(captured), () => true, () => "O5");

    expect(groups).toHaveLength(1);
    expect(groups[0].nodeId).toBe("O5");
    expect(groups[0].stackSize).toBe(2);
    expect(groups[0].pieceIds).toEqual(["b-1", "b-2"]);
  });

  it("keeps two sides on the same node apart", () => {
    const pieces = [
      piece({ id: "a-1", ownerId: "player-a", nodeId: "O5" }),
      piece({ id: "b-1", ownerId: "player-b", nodeId: "O5" }),
    ];

    const groups = boardGroups(pieces, sideSlots(pieces));

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.stackSize)).toEqual([1, 1]);
    // 색이 다르므로 한 덩이로 합치면 안 된다.
    expect(new Set(groups.map((group) => group.slot)).size).toBe(2);
    expect(new Set(groups.map((group) => group.key)).size).toBe(2);
  });

  it("groups a team by the team, not by whose piece it is", () => {
    const pieces = [
      piece({ id: "a-1", ownerId: "player-a", teamId: "A", nodeId: "O7", stackSize: 2 }),
      piece({ id: "b-1", ownerId: "player-b", teamId: "A", nodeId: "O7", stackSize: 2 }),
    ];

    const groups = boardGroups(pieces, sideSlots(pieces));

    expect(groups).toHaveLength(1);
    expect(groups[0].stackSize).toBe(2);
  });

  it("puts nothing on the board that is not standing on it", () => {
    const pieces = [
      piece({ id: "a-1", status: "HOME" }),
      piece({ id: "a-2", status: "FINISHED" }),
      // 판 위라고 하면서 칸이 없는 말은 그릴 자리가 없다.
      piece({ id: "a-3", status: "BOARD" }),
      piece({ id: "a-4", status: "BOARD", nodeId: "O1" }),
    ];

    const groups = boardGroups(pieces, sideSlots(pieces));

    expect(groups.map((group) => group.pieceIds)).toEqual([["a-4"]]);
    expect(groups[0].key).toBe("O1:player-a");
  });
});
