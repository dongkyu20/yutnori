import type { MoveOption, PiecePosition } from "./types";

type RouteId = PiecePosition["routeId"];

interface BoardNode {
  readonly next: Readonly<Partial<Record<RouteId, string>>>;
  readonly previous: Readonly<Partial<Record<RouteId, string>>>;
  readonly forwardChoices?: readonly RouteId[];
}

function node(
  next: Partial<Record<RouteId, string>>,
  previous: Partial<Record<RouteId, string>>,
  forwardChoices?: readonly RouteId[],
): BoardNode {
  return Object.freeze({
    next: Object.freeze(next),
    previous: Object.freeze(previous),
    ...(forwardChoices ? { forwardChoices: Object.freeze([...forwardChoices]) } : {}),
  });
}

export const BOARD_NODES: Readonly<Record<string, BoardNode>> = Object.freeze({
  O0: node({ OUTER: "O1" }, {}),
  O1: node({ OUTER: "O2" }, { OUTER: "O0" }),
  O2: node({ OUTER: "O3" }, { OUTER: "O1" }),
  O3: node({ OUTER: "O4" }, { OUTER: "O2" }),
  O4: node({ OUTER: "O5" }, { OUTER: "O3" }),
  O5: node({ OUTER: "O6", CENTER_A: "D1_1" }, { OUTER: "O4" }, ["OUTER", "CENTER_A"]),
  O6: node({ OUTER: "O7" }, { OUTER: "O5" }),
  O7: node({ OUTER: "O8" }, { OUTER: "O6" }),
  O8: node({ OUTER: "O9" }, { OUTER: "O7" }),
  O9: node({ OUTER: "O10" }, { OUTER: "O8" }),
  O10: node({ OUTER: "O11", CENTER_B: "D3_1" }, { OUTER: "O9" }, ["OUTER", "CENTER_B"]),
  O11: node({ OUTER: "O12" }, { OUTER: "O10" }),
  O12: node({ OUTER: "O13" }, { OUTER: "O11" }),
  O13: node({ OUTER: "O14" }, { OUTER: "O12" }),
  O14: node({ OUTER: "O15" }, { OUTER: "O13" }),
  O15: node(
    { OUTER: "O16", CENTER_A: "O16", CENTER_B: "O16" },
    { OUTER: "O14", CENTER_A: "D2_1", CENTER_B: "D4_1" },
  ),
  O16: node({ OUTER: "O17", CENTER_A: "O17", CENTER_B: "O17" }, { OUTER: "O15", CENTER_A: "O15", CENTER_B: "O15" }),
  O17: node({ OUTER: "O18", CENTER_A: "O18", CENTER_B: "O18" }, { OUTER: "O16", CENTER_A: "O16", CENTER_B: "O16" }),
  O18: node({ OUTER: "O19", CENTER_A: "O19", CENTER_B: "O19" }, { OUTER: "O17", CENTER_A: "O17", CENTER_B: "O17" }),
  O19: node({ OUTER: "FINISH", CENTER_A: "FINISH", CENTER_B: "FINISH" }, { OUTER: "O18", CENTER_A: "O18", CENTER_B: "O18" }),
  D1_1: node({ CENTER_A: "D1_2" }, { CENTER_A: "O5" }),
  D1_2: node({ CENTER_A: "CENTER" }, { CENTER_A: "D1_1" }),
  CENTER: node(
    { CENTER_A: "D2_2", CENTER_B: "D4_2" },
    { CENTER_A: "D1_2", CENTER_B: "D3_2" },
  ),
  D2_2: node({ CENTER_A: "D2_1" }, { CENTER_A: "CENTER" }),
  D2_1: node({ CENTER_A: "O15" }, { CENTER_A: "D2_2" }),
  D3_1: node({ CENTER_B: "D3_2" }, { CENTER_B: "O10" }),
  D3_2: node({ CENTER_B: "CENTER" }, { CENTER_B: "D3_1" }),
  D4_2: node({ CENTER_B: "D4_1" }, { CENTER_B: "CENTER" }),
  D4_1: node({ CENTER_B: "O15" }, { CENTER_B: "D4_2" }),
  FINISH: node({}, { OUTER: "O19", CENTER_A: "O19", CENTER_B: "O19" }),
});

function routesForMove(node: BoardNode, routeId: RouteId, distance: number): RouteId[] {
  if (distance > 0 && node.forwardChoices) {
    return [...node.forwardChoices];
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
