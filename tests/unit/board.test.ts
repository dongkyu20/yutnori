import { describe, expect, it } from "vitest";
import { getMoveOptions } from "../../server/game/board";
import type { PiecePosition } from "../../server/game/types";

/** 출발 대기 자리에서 distance 칸을 갔을 때 서는 칸을 하나씩 따라간다. */
function walk(steps: readonly number[]): PiecePosition {
  let position: PiecePosition = { nodeId: "O0", routeId: "OUTER" };
  for (const distance of steps) {
    const option = getMoveOptions(position, distance)[0];
    position = { nodeId: option.nodeId, routeId: option.routeId };
  }
  return position;
}

describe("Yut board routes", () => {
  it("forces the first shortcut for a piece stopped on the first corner", () => {
    expect(getMoveOptions({ nodeId: "O5", routeId: "OUTER" }, 2)).toEqual([
      { routeId: "CENTER_A", nodeId: "D1_2", finished: false, traversed: ["D1_1", "D1_2"] },
    ]);
  });

  it("forces the second shortcut for a piece stopped on the second corner", () => {
    expect(getMoveOptions({ nodeId: "O10", routeId: "OUTER" }, 2)).toEqual([
      { routeId: "CENTER_B", nodeId: "D3_2", finished: false, traversed: ["D3_1", "D3_2"] },
    ]);
  });

  it("keeps the outer route for a piece that only passes a corner", () => {
    expect(getMoveOptions({ nodeId: "O4", routeId: "OUTER" }, 2)).toEqual([
      { routeId: "OUTER", nodeId: "O6", finished: false, traversed: ["O5", "O6"] },
    ]);
  });

  it("keeps the first diagonal for a piece that only passes the center", () => {
    expect(getMoveOptions({ nodeId: "D1_2", routeId: "CENTER_A" }, 2)).toEqual([
      { routeId: "CENTER_A", nodeId: "D2_2", finished: false, traversed: ["CENTER", "D2_2"] },
    ]);
  });

  it("sends a piece stopped on the center out through the exit shortcut", () => {
    expect(getMoveOptions({ nodeId: "CENTER", routeId: "CENTER_A" }, 1)).toEqual([
      { routeId: "CENTER_B", nodeId: "D4_2", finished: false, traversed: ["D4_2"] },
    ]);
    expect(getMoveOptions({ nodeId: "CENTER", routeId: "CENTER_B" }, 1)).toEqual([
      { routeId: "CENTER_B", nodeId: "D4_2", finished: false, traversed: ["D4_2"] },
    ]);
  });

  it("ends the second shortcut at home instead of a far corner", () => {
    expect(getMoveOptions({ nodeId: "D4_1", routeId: "CENTER_B" }, 1)).toEqual([
      { routeId: "CENTER_B", nodeId: "FINISH", finished: true, traversed: ["FINISH"] },
    ]);
  });

  it("keeps every shortcut shorter than the outer lap", () => {
    // 첫 모서리에 멈추고 방에도 멈추는 최단 경로는 11칸이다.
    expect(walk([5, 3, 2]).nodeId).toBe("D4_1");
    expect(walk([5, 3, 3]).nodeId).toBe("FINISH");
    // 두 번째 모서리에 멈추고 방에도 멈추면 16칸이다.
    expect(walk([10, 3, 2]).nodeId).toBe("D4_1");
    expect(walk([10, 3, 3]).nodeId).toBe("FINISH");
    // 방을 지나쳐 첫 지름길을 끝까지 타면 16칸이다.
    expect(walk([5, 4, 2, 4]).nodeId).toBe("O19");
    expect(walk([5, 4, 2, 5]).nodeId).toBe("FINISH");
    // 모서리에 한 번도 멈추지 않으면 바깥 길 20칸을 모두 돈다.
    expect(walk([4, 4, 4, 4, 3]).nodeId).toBe("O19");
    expect(walk([4, 4, 4, 4, 4]).nodeId).toBe("FINISH");
  });

  it("returns the prior outer node for back-do", () => {
    expect(getMoveOptions({ nodeId: "O8", routeId: "OUTER" }, -1)).toEqual([
      { routeId: "OUTER", nodeId: "O7", finished: false, traversed: ["O7"] },
    ]);
  });

  it("follows the recorded diagonal predecessor for back-do", () => {
    expect(getMoveOptions({ nodeId: "CENTER", routeId: "CENTER_A" }, -1)).toEqual([
      { routeId: "CENTER_A", nodeId: "D1_2", finished: false, traversed: ["D1_2"] },
    ]);
    expect(getMoveOptions({ nodeId: "CENTER", routeId: "CENTER_B" }, -1)).toEqual([
      { routeId: "CENTER_B", nodeId: "D3_2", finished: false, traversed: ["D3_2"] },
    ]);
  });

  it("finishes on exact home arrival", () => {
    expect(getMoveOptions({ nodeId: "O19", routeId: "OUTER" }, 1)).toEqual([
      { routeId: "OUTER", nodeId: "FINISH", finished: true, traversed: ["FINISH"] },
    ]);
  });

  it("finishes when movement passes home", () => {
    expect(getMoveOptions({ nodeId: "O19", routeId: "OUTER" }, 2)).toEqual([
      { routeId: "OUTER", nodeId: "FINISH", finished: true, traversed: ["FINISH"] },
    ]);
  });
});
