"use client";

import type { CSSProperties } from "react";
import type { PublicGameState, PublicRoomSnapshot, TeamId } from "../../shared/protocol";
import { sideClass, sideSlotOf, sideSlots } from "../sideColor";

type BoardCoordinate = { x: number; y: number };

/**
 * 판 좌표. 번호가 커지는 순서가 그대로 진행 방향이고, 화면에서 반시계로 돈다.
 * 오른쪽 아래 시작점에서 오른쪽 변을 타고 올라가 위쪽 변을 왼쪽으로 지난다.
 * 서버의 길 구조에는 방향이 없으므로 이 표만 바꾸면 진행 방향이 바뀐다.
 */
const NODE_COORDINATES: Readonly<Record<string, BoardCoordinate>> = {
  // 오른쪽 변을 따라 위로
  O0: { x: 92, y: 92 }, O1: { x: 92, y: 75 }, O2: { x: 92, y: 58 },
  O3: { x: 92, y: 42 }, O4: { x: 92, y: 25 }, O5: { x: 92, y: 8 },
  // 위쪽 변을 따라 왼쪽으로
  O6: { x: 75, y: 8 }, O7: { x: 58, y: 8 }, O8: { x: 42, y: 8 },
  O9: { x: 25, y: 8 }, O10: { x: 8, y: 8 },
  // 왼쪽 변을 따라 아래로
  O11: { x: 8, y: 25 }, O12: { x: 8, y: 42 }, O13: { x: 8, y: 58 },
  O14: { x: 8, y: 75 }, O15: { x: 8, y: 92 },
  // 아래쪽 변을 따라 오른쪽으로 돌아온다
  O16: { x: 25, y: 92 }, O17: { x: 42, y: 92 },
  O18: { x: 58, y: 92 }, O19: { x: 75, y: 92 },
  D1_1: { x: 75, y: 25 }, D1_2: { x: 58, y: 42 }, CENTER: { x: 50, y: 50 },
  D2_2: { x: 42, y: 58 }, D2_1: { x: 25, y: 75 }, D3_1: { x: 25, y: 25 },
  D3_2: { x: 42, y: 42 }, D4_2: { x: 58, y: 58 }, D4_1: { x: 75, y: 75 },
};

/** 말이 판에 들어서는 칸이자 참으로 돌아오는 칸. */
export const START_NODE_ID = "O0";
export const CENTER_NODE_ID = "CENTER";
/**
 * 지름길로 빠지는 길목과 그 첫 칸. 서버 BOARD_NODES의 forwardRoute와 짝을 이루며,
 * 여기에 정확히 멈춘 말은 바깥길이 아니라 이 방향 지름길로 들어선다.
 */
export const SHORTCUT_GATES: Readonly<Record<string, string>> = Object.freeze({
  O5: "D1_1",
  O10: "D3_1",
  CENTER: "D4_2",
});

type BoardSegment = { from: string; to: string; route: "outer" | "center-a" | "center-b" };

const OUTER_SEGMENTS: BoardSegment[] = Array.from({ length: 19 }, (_, index) => ({
  from: `O${index}`,
  to: `O${index + 1}`,
  route: "outer",
}));

const BOARD_SEGMENTS: readonly BoardSegment[] = [
  ...OUTER_SEGMENTS,
  { from: "O19", to: "O0", route: "outer" },
  { from: "O5", to: "D1_1", route: "center-a" },
  { from: "D1_1", to: "D1_2", route: "center-a" },
  { from: "D1_2", to: "CENTER", route: "center-a" },
  { from: "CENTER", to: "D2_2", route: "center-a" },
  { from: "D2_2", to: "D2_1", route: "center-a" },
  { from: "D2_1", to: "O15", route: "center-a" },
  { from: "O10", to: "D3_1", route: "center-b" },
  { from: "D3_1", to: "D3_2", route: "center-b" },
  { from: "D3_2", to: "CENTER", route: "center-b" },
  { from: "CENTER", to: "D4_2", route: "center-b" },
  { from: "D4_2", to: "D4_1", route: "center-b" },
  { from: "D4_1", to: "O0", route: "center-b" },
];

/** 시작점(O0)에서 첫 걸음이 닿는 칸. 진행 방향 살촉을 여기로 세운다. */
const FIRST_STEP_NODE_ID = OUTER_SEGMENTS[0].to;

type Piece = PublicGameState["pieces"][number];

interface PieceGroup {
  key: string;
  pieces: Piece[];
  status: Piece["status"];
  nodeId?: string;
  controllerId: string;
  teamId?: TeamId;
}

interface YutBoardProps {
  game: PublicGameState;
  players: PublicRoomSnapshot["players"];
  playerId: string | null;
  /** 지금 고른 윷 결과로 움직일 수 있는 말. */
  legalPieceIds: readonly string[];
  onSelectPiece: (pieceId: string) => void;
  onSelectRoute: (routeId: string) => void;
}

function nodeStyle(nodeId: string): CSSProperties {
  const coordinate = NODE_COORDINATES[nodeId] ?? NODE_COORDINATES.O0;
  return {
    "--node-x": `${coordinate.x}%`,
    "--node-y": `${coordinate.y}%`,
  } as CSSProperties;
}

function segmentStyle(segment: BoardSegment): CSSProperties {
  const from = NODE_COORDINATES[segment.from];
  const to = NODE_COORDINATES[segment.to];
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  return {
    "--segment-x": `${from.x}%`,
    "--segment-y": `${from.y}%`,
    "--segment-length": `${Math.hypot(deltaX, deltaY)}%`,
    "--segment-angle": `${Math.atan2(deltaY, deltaX) * 180 / Math.PI}deg`,
  } as CSSProperties;
}

/** 두 칸을 잇는 방향을 각도로 넘긴다. 살촉을 그 방향으로 돌리는 데 쓴다. */
function headingStyle(name: string, fromId: string, toId: string): CSSProperties {
  const from = NODE_COORDINATES[fromId];
  const to = NODE_COORDINATES[toId];
  return {
    [name]: `${Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI}deg`,
  } as CSSProperties;
}

/** 시작점과 길목은 살촉이 가리킬 방향까지 함께 넘긴다. */
function nodeStyleFor(nodeId: string): CSSProperties {
  if (nodeId === START_NODE_ID) {
    return { ...nodeStyle(nodeId), ...headingStyle("--start-angle", nodeId, FIRST_STEP_NODE_ID) };
  }
  const gate = SHORTCUT_GATES[nodeId];
  return gate
    ? { ...nodeStyle(nodeId), ...headingStyle("--gate-angle", nodeId, gate) }
    : nodeStyle(nodeId);
}

/** 강조가 필요한 칸의 역할. 없으면 평범한 칸이다. */
function nodeRole(nodeId: string): "출발점" | "지름길 길목" | null {
  if (nodeId === START_NODE_ID) return "출발점";
  return SHORTCUT_GATES[nodeId] ? "지름길 길목" : null;
}

function nodeClass(nodeId: string): string {
  const names = ["yut-board__node"];
  if (nodeId === START_NODE_ID) names.push("yut-board__node--start");
  if (SHORTCUT_GATES[nodeId]) names.push("yut-board__node--gate");
  if (nodeId === CENTER_NODE_ID) names.push("yut-board__node--center");
  return names.join(" ");
}

function describeNode(nodeId: string): string {
  if (nodeId === "CENTER") return "가운데 지점";
  if (nodeId.startsWith("O")) return `바깥 지점 ${Number(nodeId.slice(1))}`;
  const match = /^D(\d)_(\d)$/.exec(nodeId);
  return match ? `대각선 지점 ${match[1]}-${match[2]}` : nodeId;
}

function groupPieces(pieces: readonly Piece[]): PieceGroup[] {
  const groups = new Map<string, PieceGroup>();
  for (const piece of pieces) {
    const controllerId = piece.teamId ?? piece.ownerId;
    const key = piece.status === "BOARD"
      ? `BOARD:${piece.nodeId}:${controllerId}`
      : `${piece.status}:${piece.id}`;
    const group = groups.get(key);
    if (group) group.pieces.push(piece);
    else groups.set(key, {
      key,
      pieces: [piece],
      status: piece.status,
      nodeId: piece.nodeId,
      controllerId,
      ...(piece.teamId ? { teamId: piece.teamId } : {}),
    });
  }
  return [...groups.values()];
}

function controllerName(group: PieceGroup, players: PublicRoomSnapshot["players"]): string {
  if (group.teamId) return `${group.teamId}팀`;
  return players.find((player) => player.id === group.controllerId)?.nickname ?? group.controllerId;
}

function groupLocation(group: PieceGroup): string {
  if (group.status === "HOME") return "출발 대기";
  if (group.status === "FINISHED") return "완주";
  return describeNode(group.nodeId ?? "O0");
}

function routeName(routeId: string): string {
  return routeId === "OUTER" ? "바깥길" : "가운데길";
}

export function YutBoard({
  game,
  players,
  playerId,
  legalPieceIds,
  onSelectPiece,
  onSelectRoute,
}: YutBoardProps) {
  const isCurrentPlayer = playerId === game.currentPlayerId;
  const legalPieces = new Set(legalPieceIds);
  const slots = sideSlots(game.pieces);
  const groups = groupPieces(game.pieces);
  const boardGroups = groups.filter((group) => group.status === "BOARD" && group.nodeId);
  const homeGroups = groups.filter((group) => group.status === "HOME");
  const finishedGroups = groups.filter((group) => group.status === "FINISHED");

  const renderPiece = (group: PieceGroup) => {
    const legalPieceId = group.pieces.find((piece) => legalPieces.has(piece.id))?.id;
    const count = Math.max(group.pieces.length, group.pieces[0]?.stackSize ?? 1);
    const label = `${controllerName(group, players)} 말 ${count}개 ${groupLocation(group)}`;
    const enabled = Boolean(isCurrentPlayer && game.turnStage === "AWAITING_PIECE" && legalPieceId);
    const slot = sideSlotOf(slots, { teamId: group.teamId, ownerId: group.controllerId });
    return (
      <button
        key={group.key}
        type="button"
        className={sideClass("yut-piece", slot)}
        style={group.nodeId ? nodeStyle(group.nodeId) : undefined}
        aria-label={label}
        data-side-slot={slot}
        data-piece-ids={group.pieces.map((piece) => piece.id).sort().join(",")}
        data-piece-status={group.status}
        data-node-id={group.nodeId}
        data-controller-id={group.controllerId}
        disabled={!enabled}
        onClick={() => { if (enabled && legalPieceId) onSelectPiece(legalPieceId); }}
      >
        <span className="yut-piece__team">{group.teamId ?? controllerName(group, players)}</span>
        <span className="yut-piece__count"> ×{count}</span>
      </button>
    );
  };

  return (
    <section className="yut-board" aria-labelledby="yut-board-heading">
      <h2 id="yut-board-heading">윷판</h2>
      <div className="yut-board__track" aria-label="윷판 경로, 반시계 방향으로 진행">
        <div className="yut-board__segments" aria-hidden="true">
          {BOARD_SEGMENTS.map((segment) => (
            <span
              key={`${segment.route}:${segment.from}:${segment.to}`}
              className="yut-board__segment"
              data-testid={`board-segment-${segment.route}-${segment.from}-${segment.to}`}
              data-from={segment.from}
              data-to={segment.to}
              style={segmentStyle(segment)}
            />
          ))}
        </div>
        <ol className="yut-board__nodes">
          {Object.keys(NODE_COORDINATES).map((nodeId) => {
            const role = nodeRole(nodeId);
            return (
              <li
                key={nodeId}
                data-testid={`board-node-${nodeId}`}
                data-node-x={NODE_COORDINATES[nodeId].x}
                data-node-y={NODE_COORDINATES[nodeId].y}
                data-node-role={role ?? undefined}
                className={nodeClass(nodeId)}
                style={nodeStyleFor(nodeId)}
                aria-label={role ? `${describeNode(nodeId)}, ${role}` : describeNode(nodeId)}
              />
            );
          })}
        </ol>
        <div className="yut-board__pieces">{boardGroups.map(renderPiece)}</div>
        {game.turnStage === "AWAITING_ROUTE" && game.legalRoutes.map((route) => (
          <button
            key={route.routeId}
            type="button"
            className="yut-route"
            style={nodeStyle(route.destinationNodeId)}
            disabled={!isCurrentPlayer}
            aria-label={`${routeName(route.routeId)} 선택: ${describeNode(route.destinationNodeId)} 도착`}
            onClick={() => onSelectRoute(route.routeId)}
          >
            {routeName(route.routeId)}
          </button>
        ))}
      </div>
      <div className="yut-board__racks">
        <section aria-label="출발 대기 말"><h3>출발</h3><div className="yut-board__rack">{homeGroups.map(renderPiece)}</div></section>
        <section aria-label="완주한 말"><h3>완주</h3><div className="yut-board__rack">{finishedGroups.map(renderPiece)}</div></section>
      </div>
    </section>
  );
}
