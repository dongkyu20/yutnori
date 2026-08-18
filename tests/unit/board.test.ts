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
      { routeId: "CENTER_B", nodeId: "GOAL", finished: false, traversed: ["GOAL"] },
    ]);
  });

  it("keeps every shortcut shorter than the outer lap", () => {
    // 첫 모서리에 멈추고 방에도 멈추는 최단 경로는 11칸이고, 나려면 한 칸이 더 든다.
    expect(walk([5, 3, 2]).nodeId).toBe("D4_1");
    expect(walk([5, 3, 3]).nodeId).toBe("GOAL");
    expect(walk([5, 3, 4]).nodeId).toBe("FINISH");
    // 두 번째 모서리에 멈추고 방에도 멈추면 16칸이다.
    expect(walk([10, 3, 2]).nodeId).toBe("D4_1");
    expect(walk([10, 3, 3]).nodeId).toBe("GOAL");
    // 방을 지나쳐 첫 지름길을 끝까지 타면 16칸이다.
    expect(walk([5, 4, 2, 4]).nodeId).toBe("O19");
    expect(walk([5, 4, 2, 5]).nodeId).toBe("GOAL");
    // 모서리에 한 번도 멈추지 않으면 바깥 길은 스무 칸이고, 스물한 칸째에 난다.
    expect(walk([4, 4, 4, 4, 3]).nodeId).toBe("O19");
    expect(walk([4, 4, 4, 4, 4]).nodeId).toBe("GOAL");
    expect(walk([4, 4, 4, 4, 5]).nodeId).toBe("FINISH");
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

  it("treats a back-do onto the start as a completed lap", () => {
    // 도로 들어선 말이 곧바로 빽도를 만나면 출발점으로 되돌아간다.
    // 이 방은 그것을 한 바퀴 돌아 참 앞에 선 것으로 친다.
    expect(getMoveOptions({ nodeId: "O1", routeId: "OUTER" }, -1)).toEqual([
      { routeId: "OUTER", nodeId: "RETURN", finished: false, traversed: ["RETURN"] },
    ]);
  });

  it.each([1, 2, 3, 4, 5])("sends a lapped piece out with any forward result (%i)", (distance) => {
    expect(getMoveOptions({ nodeId: "RETURN", routeId: "OUTER" }, distance)).toEqual([
      { routeId: "OUTER", nodeId: "FINISH", finished: true, traversed: ["FINISH"] },
    ]);
  });

  it("sends a lapped piece back to the do square on another back-do", () => {
    expect(getMoveOptions({ nodeId: "RETURN", routeId: "OUTER" }, -1)).toEqual([
      { routeId: "OUTER", nodeId: "O1", finished: false, traversed: ["O1"] },
    ]);
  });

  it("keeps the start anchor itself walking the normal lap", () => {
    // 출발 대기 자리는 여전히 판에 들어서는 기준점이다. 여기서 나아가면 참이 아니라 첫 칸이다.
    expect(getMoveOptions({ nodeId: "O0", routeId: "OUTER" }, 1)).toEqual([
      { routeId: "OUTER", nodeId: "O1", finished: false, traversed: ["O1"] },
    ]);
  });

  it("stops on the finish corner instead of going out", () => {
    // 도착점은 설 수 있는 칸이다. 정확히 닿았다고 나는 것이 아니라, 거기서 한 칸 더 가야 난다.
    expect(getMoveOptions({ nodeId: "O19", routeId: "OUTER" }, 1)).toEqual([
      { routeId: "OUTER", nodeId: "GOAL", finished: false, traversed: ["GOAL"] },
    ]);
  });

  it("goes out when movement passes the finish corner", () => {
    expect(getMoveOptions({ nodeId: "O19", routeId: "OUTER" }, 2)).toEqual([
      { routeId: "OUTER", nodeId: "FINISH", finished: true, traversed: ["GOAL", "FINISH"] },
    ]);
  });

  it.each([1, 2, 3, 4, 5])("sends a piece waiting on the finish corner out with any result (%i)", (distance) => {
    // 걸로 도착점에 닿은 말은 다음 차례에 도 이상이면 난다.
    expect(getMoveOptions({ nodeId: "GOAL", routeId: "OUTER" }, distance)).toEqual([
      { routeId: "OUTER", nodeId: "FINISH", finished: true, traversed: ["FINISH"] },
    ]);
  });

  it("walks a piece on the finish corner back one station on a back-do", () => {
    expect(getMoveOptions({ nodeId: "GOAL", routeId: "OUTER" }, -1)).toEqual([
      { routeId: "OUTER", nodeId: "O19", finished: false, traversed: ["O19"] },
    ]);
    expect(getMoveOptions({ nodeId: "GOAL", routeId: "CENTER_B" }, -1)).toEqual([
      { routeId: "CENTER_B", nodeId: "D4_1", finished: false, traversed: ["D4_1"] },
    ]);
  });
});
