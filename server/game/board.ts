import type { MoveOption, PiecePosition } from "./types";

type RouteId = PiecePosition["routeId"];

interface BoardNode {
  readonly next: Readonly<Partial<Record<RouteId, string>>>;
  readonly previous: Readonly<Partial<Record<RouteId, string>>>;
  /** 이 칸에 정확히 멈춘 말이 다음에 나아가는 길. 지나가기만 한 말은 원래 길을 유지한다. */
  readonly forwardRoute?: RouteId;
}

function node(
  next: Partial<Record<RouteId, string>>,
  previous: Partial<Record<RouteId, string>>,
  forwardRoute?: RouteId,
): BoardNode {
  return Object.freeze({
    next: Object.freeze(next),
    previous: Object.freeze(previous),
    ...(forwardRoute ? { forwardRoute } : {}),
  });
}

export const BOARD_NODES: Readonly<Record<string, BoardNode>> = Object.freeze({
  // 판에 들어서는 기준점. 말이 여기에 서서 쉬는 일은 없고, 대기 자리에서 몇 칸인지를 재는 데만 쓴다.
  O0: node({ OUTER: "O1" }, {}),
  O1: node({ OUTER: "O2" }, { OUTER: "RETURN" }),
  O2: node({ OUTER: "O3" }, { OUTER: "O1" }),
  O3: node({ OUTER: "O4" }, { OUTER: "O2" }),
  O4: node({ OUTER: "O5" }, { OUTER: "O3" }),
  O5: node({ OUTER: "O6", CENTER_A: "D1_1" }, { OUTER: "O4" }, "CENTER_A"),
  O6: node({ OUTER: "O7" }, { OUTER: "O5" }),
  O7: node({ OUTER: "O8" }, { OUTER: "O6" }),
  O8: node({ OUTER: "O9" }, { OUTER: "O7" }),
  O9: node({ OUTER: "O10" }, { OUTER: "O8" }),
  O10: node({ OUTER: "O11", CENTER_B: "D3_1" }, { OUTER: "O9" }, "CENTER_B"),
  O11: node({ OUTER: "O12" }, { OUTER: "O10" }),
  O12: node({ OUTER: "O13" }, { OUTER: "O11" }),
  O13: node({ OUTER: "O14" }, { OUTER: "O12" }),
  O14: node({ OUTER: "O15" }, { OUTER: "O13" }),
  O15: node({ OUTER: "O16", CENTER_A: "O16" }, { OUTER: "O14", CENTER_A: "D2_1" }),
  O16: node({ OUTER: "O17", CENTER_A: "O17" }, { OUTER: "O15", CENTER_A: "O15" }),
  O17: node({ OUTER: "O18", CENTER_A: "O18" }, { OUTER: "O16", CENTER_A: "O16" }),
  O18: node({ OUTER: "O19", CENTER_A: "O19" }, { OUTER: "O17", CENTER_A: "O17" }),
  O19: node({ OUTER: "GOAL", CENTER_A: "GOAL" }, { OUTER: "O18", CENTER_A: "O18" }),
  D1_1: node({ CENTER_A: "D1_2" }, { CENTER_A: "O5" }),
  D1_2: node({ CENTER_A: "CENTER" }, { CENTER_A: "D1_1" }),
  // 방에 멈춘 말은 어느 지름길로 들어왔든 참으로 향하는 지름길로 빠진다.
  CENTER: node(
    { CENTER_A: "D2_2", CENTER_B: "D4_2" },
    { CENTER_A: "D1_2", CENTER_B: "D3_2" },
    "CENTER_B",
  ),
  D2_2: node({ CENTER_A: "D2_1" }, { CENTER_A: "CENTER" }),
  D2_1: node({ CENTER_A: "O15" }, { CENTER_A: "D2_2" }),
  D3_1: node({ CENTER_B: "D3_2" }, { CENTER_B: "O10" }),
  D3_2: node({ CENTER_B: "CENTER" }, { CENTER_B: "D3_1" }),
  D4_2: node({ CENTER_B: "D4_1" }, { CENTER_B: "CENTER" }),
  D4_1: node({ CENTER_B: "GOAL" }, { CENTER_B: "D4_2" }),
  /**
   * 빽도로 출발점까지 되돌아온 자리. 판에는 시작점 모서리와 같은 곳에 그려지지만 O0과는 다른 칸이다.
   * 한 바퀴를 돌아 참 앞에 선 것으로 쳐서, 다음에 앞으로 나아가면 몇 칸이 나오든 난다.
   * 여기서 빽도가 또 나오면 원래 있던 도 자리로 돌아간다.
   */
  RETURN: node({ OUTER: "FINISH" }, { OUTER: "O1" }),
  /**
   * 한 바퀴를 다 돌아 도착점에 선 자리. 시작점 모서리와 같은 곳이다.
   * 여기에 정확히 닿았다고 나는 것이 아니라, 다음에 한 칸이라도 더 가야 난다.
   * 어느 길로 들어왔든 나가는 길은 하나뿐이라 앞으로는 늘 참으로 향한다.
   */
  GOAL: node(
    // 지나쳐 가는 말은 들어온 길 이름을 그대로 지니므로 어느 이름으로도 참에 닿아야 한다.
    // 길이 갈리지 않으니 forwardRoute는 두지 않는다. 그것은 지름길 길목의 표식이다.
    { OUTER: "FINISH", CENTER_A: "FINISH", CENTER_B: "FINISH" },
    { OUTER: "O19", CENTER_A: "O19", CENTER_B: "D4_1" },
  ),
  FINISH: node({}, { OUTER: "GOAL", CENTER_A: "GOAL", CENTER_B: "GOAL" }),
});

/**
 * 판에 그려지는 한 칸. 도착점 모서리는 어떻게 들어섰느냐에 따라 칸 이름이 둘이지만
 * 눈에는 같은 자리이므로, 잡기와 업기는 이 이름으로 견준다.
 */
export function squareOf(nodeId: string): string {
  return nodeId === "RETURN" ? "GOAL" : nodeId;
}

function routesForMove(node: BoardNode, routeId: RouteId, distance: number): RouteId[] {
  if (distance > 0 && node.forwardRoute) {
    return [node.forwardRoute];
  }

  const edges = distance > 0 ? node.next : node.previous;
  return edges[routeId] ? [routeId] : [];
}

function moveAlongRoute(
  position: PiecePosition,
  routeId: RouteId,
  distance: number,
): MoveOption | undefined {
  let nodeId = position.nodeId;
  const traversed: string[] = [];
  const edgeName = distance > 0 ? "next" : "previous";

  for (let step = 0; step < Math.abs(distance); step += 1) {
    const nextNodeId = BOARD_NODES[nodeId]?.[edgeName][routeId];

    if (!nextNodeId) {
      return undefined;
    }

    nodeId = nextNodeId;
    traversed.push(nodeId);

    if (nodeId === "FINISH") {
      break;
    }
  }

  return { routeId, nodeId, finished: nodeId === "FINISH", traversed };
}

export function getMoveOptions(position: PiecePosition, distance: number): MoveOption[] {
  if (distance === 0) {
    return [{ routeId: position.routeId, nodeId: position.nodeId, finished: position.nodeId === "FINISH", traversed: [] }];
  }

  const currentNode = BOARD_NODES[position.nodeId];

  if (!currentNode) {
    return [];
  }

  return routesForMove(currentNode, position.routeId, distance)
    .map((routeId) => moveAlongRoute(position, routeId, distance))
    .filter((option): option is MoveOption => option !== undefined);
}
