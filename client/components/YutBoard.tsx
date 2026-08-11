"use client";

import type { CSSProperties } from "react";
import type { PublicGameState, PublicRoomSnapshot, TeamId } from "../../shared/protocol";

type BoardCoordinate = { x: number; y: number };

const NODE_COORDINATES: Readonly<Record<string, BoardCoordinate>> = {
  O0: { x: 92, y: 92 }, O1: { x: 75, y: 92 }, O2: { x: 58, y: 92 },
  O3: { x: 42, y: 92 }, O4: { x: 25, y: 92 }, O5: { x: 8, y: 92 },
  O6: { x: 8, y: 75 }, O7: { x: 8, y: 58 }, O8: { x: 8, y: 42 },
  O9: { x: 8, y: 25 }, O10: { x: 8, y: 8 }, O11: { x: 25, y: 8 },
  O12: { x: 42, y: 8 }, O13: { x: 58, y: 8 }, O14: { x: 75, y: 8 },
  O15: { x: 92, y: 8 }, O16: { x: 92, y: 25 }, O17: { x: 92, y: 42 },
  O18: { x: 92, y: 58 }, O19: { x: 92, y: 75 },
  D1_1: { x: 25, y: 75 }, D1_2: { x: 42, y: 58 }, CENTER: { x: 50, y: 50 },
  D2_2: { x: 58, y: 42 }, D2_1: { x: 75, y: 25 }, D3_1: { x: 25, y: 25 },
  D3_2: { x: 42, y: 42 }, D4_2: { x: 66, y: 48 }, D4_1: { x: 82, y: 32 },
};

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
  { from: "D4_1", to: "O15", route: "center-b" },
];

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

export function YutBoard({ game, players, playerId, onSelectPiece, onSelectRoute }: YutBoardProps) {
  const isCurrentPlayer = playerId === game.currentPlayerId;
  const legalPieces = new Set(game.legalPieceIds);
  const groups = groupPieces(game.pieces);
  const boardGroups = groups.filter((group) => group.status === "BOARD" && group.nodeId);
  const homeGroups = groups.filter((group) => group.status === "HOME");
  const finishedGroups = groups.filter((group) => group.status === "FINISHED");

  const renderPiece = (group: PieceGroup) => {
    const legalPieceId = group.pieces.find((piece) => legalPieces.has(piece.id))?.id;
    const count = Math.max(group.pieces.length, group.pieces[0]?.stackSize ?? 1);
    const label = `${controllerName(group, players)} 말 ${count}개 ${groupLocation(group)}`;
    const enabled = Boolean(isCurrentPlayer && game.turnStage === "AWAITING_PIECE" && legalPieceId);
    return (
      <button
        key={group.key}
        type="button"
        className={`yut-piece yut-piece--${(group.teamId ?? "player").toLowerCase()}`}
        style={group.nodeId ? nodeStyle(group.nodeId) : undefined}
        aria-label={label}
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
      <div className="yut-board__track" aria-label="윷판 경로">
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
          {Object.keys(NODE_COORDINATES).map((nodeId) => (
            <li
              key={nodeId}
              data-testid={`board-node-${nodeId}`}
              data-node-x={NODE_COORDINATES[nodeId].x}
              data-node-y={NODE_COORDINATES[nodeId].y}
              className="yut-board__node"
              style={nodeStyle(nodeId)}
              aria-label={describeNode(nodeId)}
            />
          ))}
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
