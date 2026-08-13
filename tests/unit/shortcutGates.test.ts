import { describe, expect, it } from "vitest";
import { BOARD_NODES } from "../../server/game/board";
import {
  CENTER_NODE_ID,
  SHORTCUT_GATES,
  START_NODE_ID,
} from "../../client/boardLayout";

/**
 * 윷판이 강조하는 칸은 서버 규칙에서 그대로 나와야 한다. 판을 고치고 강조를 잊거나
 * 그 반대가 되면 이 테스트가 먼저 깨진다.
 */
describe("강조하는 칸과 서버 규칙", () => {
  const divertingNodes = Object.entries(BOARD_NODES)
    .filter(([, node]) => node.forwardRoute !== undefined)
    .map(([nodeId]) => nodeId);

  it("highlights exactly the nodes the server diverts onto a shortcut", () => {
    expect([...divertingNodes].sort()).toEqual(Object.keys(SHORTCUT_GATES).sort());
  });

  it("points each gate at the first node of its shortcut", () => {
    divertingNodes.forEach((nodeId) => {
      const node = BOARD_NODES[nodeId];
      const forwardRoute = node.forwardRoute;
      if (!forwardRoute) throw new Error(`${nodeId}에 forwardRoute가 없습니다.`);
      expect(SHORTCUT_GATES[nodeId]).toBe(node.next[forwardRoute]);
    });
  });

  it("treats the 방 as a gate and keeps the start where pieces enter the board", () => {
    // 방에 정확히 멈추면 참으로 향하는 지름길로 빠진다.
    expect(SHORTCUT_GATES[CENTER_NODE_ID]).toBeDefined();
    // 출발점은 판에 들어서는 칸이라 되돌아갈 앞 칸이 없다.
    expect(Object.keys(BOARD_NODES[START_NODE_ID].previous)).toHaveLength(0);
    expect(SHORTCUT_GATES[START_NODE_ID]).toBeUndefined();
  });
});
