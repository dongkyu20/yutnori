"use client";

import { useMemo, useState, type CSSProperties } from "react";
import type { PublicGameState, PublicRoomSnapshot, TeamId } from "../../shared/protocol";
import { sideClass, sideSlotOf, sideSlots } from "../sideColor";
import {
  BOARD_SEGMENTS,
  CENTER_NODE_ID,
  FIRST_STEP_NODE_ID,
  NODE_COORDINATES,
  SHORTCUT_GATES,
  START_NODE_ID,
  type BoardSegment,
} from "../boardLayout";
import { BoardStage } from "./BoardStage";

type Piece = PublicGameState["pieces"][number];

const RESULT_NAMES: Record<NonNullable<PublicGameState["lastThrow"]>["result"], string> = {
  BACK_DO: "빽도", DO: "도", GAE: "개", GEOL: "걸", YUT: "윷", MO: "모",
};

interface PieceGroup {
  key: string;
  pieces: Piece[];
  status: Piece["status"];
  nodeId?: string;
  controllerId: string;
  teamId?: TeamId;
}

type PendingThrow = PublicGameState["pendingThrows"][number];

interface YutBoardProps {
  game: PublicGameState;
  players: PublicRoomSnapshot["players"];
  playerId: string | null;
  /** 손에 든 어느 결과로든 움직일 수 있는 말. */
  legalPieceIds: readonly string[];
  /** 말과 결과를 함께 정해 서버에 보낸다. */
  onSelectMove: (throwId: string, pieceId: string) => void;
  onSelectRoute: (routeId: string) => void;
  /** 지금 연출 중인 말. 이 말의 글자는 3D 말과 어긋나므로 감춘다. */
  animatingPieceIds?: readonly string[];
}

/** 고른 말이 결과 하나로 갈 수 있는 곳. 판 위에 버튼 하나로 뜬다. */
interface MoveChoice {
  throwId: string;
  resultName: string;
  /** 밟고 지나갈 칸. 도착 칸은 뺀다. */
  trail: string[];
  /** 표시를 놓을 칸. 참으로 나면 좌표가 없으므로 시작점 모서리에 놓는다. */
  markerNodeId: string;
  /** 같은 칸에 닿는 선택지가 여럿일 때 몇 번째인지. 버튼을 그만큼 밀어 겹치지 않게 한다. */
  stack: number;
  /** 도착 칸에 말이 서 있는지. 서 있으면 그 말의 한가운데를 비켜 놓는다. */
  onPiece: boolean;
  badge: "잡기" | "완주" | null;
}

function onBoard(nodeId: string): boolean {
  return NODE_COORDINATES[nodeId] !== undefined;
}

/**
 * 고른 말이 갈 수 있는 곳을 결과마다 하나씩 모은다.
 * 잡을 수 있는지는 서버가 따로 보내 주지 않아도 된다. 도착 칸에 남의 말이 서 있는지 보면 안다.
 */
function choicesFor(
  pieceId: string | null,
  pendingThrows: readonly PendingThrow[],
  pieces: readonly Piece[],
): MoveChoice[] {
  if (!pieceId) return [];
  const mover = pieces.find((piece) => piece.id === pieceId);
  if (!mover) return [];
  const controllerId = mover.teamId ?? mover.ownerId;

  const perNode = new Map<string, number>();
  // 말이 서 있는 칸에는 표시를 겹쳐 놓지 않는다. 겹치면 그 말을 눌러 고를 수 없다.
  // 업어 가려고 내 말 위를 목적지로 삼을 때 실제로 일어난다.
  const occupied = new Set(
    pieces.flatMap((piece) => (piece.status === "BOARD" && piece.nodeId ? [piece.nodeId] : [])),
  );

  return pendingThrows.flatMap((pending) => {
    const move = pending.moves.find((entry) => entry.pieceId === pieceId);
    if (!move) return [];
    const captures = !move.finished && pieces.some((piece) =>
      piece.status === "BOARD"
      && piece.nodeId === move.destinationNodeId
      && (piece.teamId ?? piece.ownerId) !== controllerId);
    const markerNodeId = onBoard(move.destinationNodeId) ? move.destinationNodeId : START_NODE_ID;
    const stack = perNode.get(markerNodeId) ?? 0;
    perNode.set(markerNodeId, stack + 1);

    return [{
      throwId: pending.id,
      resultName: RESULT_NAMES[pending.result],
      trail: move.path.filter((nodeId) => onBoard(nodeId) && nodeId !== move.destinationNodeId),
      markerNodeId,
      stack,
      onPiece: occupied.has(markerNodeId),
      badge: move.finished ? "완주" : captures ? "잡기" : null,
    }];
  });
}

/** 갈 곳 버튼을 소리로 읽는 말. 참으로 나는 선택지는 빌려 쓴 칸 이름을 읽으면 안 된다. */
function choiceLabel(choice: MoveChoice, describe: (nodeId: string) => string): string {
  const where = choice.badge === "완주" ? "완주" : describe(choice.markerNodeId);
  const extra = choice.badge === "잡기" ? ", 상대 말을 잡습니다" : "";
  return `${choice.resultName}로 ${where}${extra}`;
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
  // 빽도로 출발점까지 되돌아온 자리. 판에는 시작점 모서리에 겹쳐 그려진다.
  if (nodeId === "RETURN") return "되돌아온 출발점, 다음 이동에 완주";
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

/**
 * 말 위에 얹을 짧은 표.
 * 이름을 다 적으면 말이 이름 길이만큼 늘어나, 이름이 긴 편의 말만 타원이 된다.
 * 온전한 이름은 aria-label에 남아 스크린 리더가 읽는다.
 */
function shortName(name: string): string {
  return [...name].slice(0, 2).join("");
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
  onSelectMove,
  onSelectRoute,
  animatingPieceIds = [],
}: YutBoardProps) {
  const isCurrentPlayer = playerId === game.currentPlayerId;
  const legalPieces = new Set(legalPieceIds);
  // game.pieces가 새 배열로 올 때만 다시 만든다. 그렇지 않으면 무관한 리렌더마다
  // BoardStage에 새 slots를 넘겨 그 효과들이 다시 돌게 된다.
  const slots = useMemo(() => sideSlots(players), [players]);
  const [stageActive, setStageActive] = useState(false);
  const [animating, setAnimating] = useState<readonly string[]>([]);
  // 고른 말. 이것이 정해져야 갈 곳이 판에 뜬다.
  const [chosenPieceId, setChosenPieceId] = useState<string | null>(null);
  // 아직 고르지 않았을 때 마우스나 초점만으로 미리 보여 주는 말.
  const [previewPieceId, setPreviewPieceId] = useState<string | null>(null);
  // 밖에서 온 자리표시와 무대 스스로 알아낸 것을 합친다. 부모가 값을 안 줘도 무대는 늘 동작한다.
  const travelling = new Set([...animatingPieceIds, ...animating]);

  // 고른 말이 사라지거나 차례가 넘어가면 선택을 놓는다.
  const choosable = isCurrentPlayer && game.turnStage === "AWAITING_PIECE";
  const activePieceId = choosable && chosenPieceId && legalPieces.has(chosenPieceId)
    ? chosenPieceId
    : null;
  const choices = choicesFor(activePieceId, game.pendingThrows, game.pieces);
  // 고르기 전에는 흐리게, 고른 뒤에는 누를 수 있는 버튼으로 같은 자리를 보여 준다.
  const previewChoices = activePieceId
    ? []
    : choicesFor(choosable ? previewPieceId : null, game.pendingThrows, game.pieces);
  const groups = groupPieces(game.pieces);
  const boardGroups = groups.filter((group) => group.status === "BOARD" && group.nodeId);
  const homeGroups = groups.filter((group) => group.status === "HOME");
  const finishedGroups = groups.filter((group) => group.status === "FINISHED");

  const renderPiece = (group: PieceGroup) => {
    const legalPieceId = group.pieces.find((piece) => legalPieces.has(piece.id))?.id;
    const count = Math.max(group.pieces.length, group.pieces[0]?.stackSize ?? 1);
    const label = `${controllerName(group, players)} 말 ${count}개 ${groupLocation(group)}`;
    const enabled = Boolean(choosable && legalPieceId);
    const chosen = Boolean(legalPieceId && legalPieceId === activePieceId);
    const slot = sideSlotOf(slots, { teamId: group.teamId, ownerId: group.controllerId });
    const isTravelling = group.pieces.some((piece) => travelling.has(piece.id));
    const className = `${sideClass("yut-piece", slot)}`
      + `${isTravelling ? " yut-piece--travelling" : ""}`
      + `${chosen ? " yut-piece--chosen" : ""}`;
    return (
      <button
        key={group.key}
        type="button"
        className={className}
        style={group.nodeId ? nodeStyle(group.nodeId) : undefined}
        aria-label={label}
        aria-pressed={enabled ? chosen : undefined}
        data-side-slot={slot}
        data-piece-ids={group.pieces.map((piece) => piece.id).sort().join(",")}
        data-piece-status={group.status}
        data-node-id={group.nodeId}
        data-controller-id={group.controllerId}
        disabled={!enabled}
        // 누르면 고르기만 한다. 실제 이동은 판에 뜬 갈 곳을 눌러야 일어난다.
        onClick={() => {
          if (!enabled || !legalPieceId) return;
          setChosenPieceId(chosen ? null : legalPieceId);
        }}
        onPointerEnter={() => { if (enabled && legalPieceId) setPreviewPieceId(legalPieceId); }}
        onPointerLeave={() => setPreviewPieceId(null)}
        onFocus={() => { if (enabled && legalPieceId) setPreviewPieceId(legalPieceId); }}
        onBlur={() => setPreviewPieceId(null)}
      >
        <span className="yut-piece__team">{group.teamId ?? shortName(controllerName(group, players))}</span>
        <span className="yut-piece__count"> ×{count}</span>
      </button>
    );
  };

  return (
    <section className="yut-board" aria-labelledby="yut-board-heading">
      <h2 id="yut-board-heading">윷판</h2>
      <div
        className={`yut-board__track${stageActive ? " yut-board__track--3d" : ""}`}
        aria-label="윷판 경로, 반시계 방향으로 진행"
      >
        <BoardStage
          pieces={game.pieces}
          slots={slots}
          lastMove={game.lastMove}
          onActive={setStageActive}
          onAnimating={setAnimating}
        />
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
        {previewChoices.length > 0 && (
          <div className="yut-preview" data-testid="move-preview" aria-hidden="true">
            {previewChoices.flatMap((choice) => choice.trail.map((nodeId) => (
              <span
                key={`${choice.throwId}:${nodeId}`}
                className="yut-preview__step"
                data-preview-step={nodeId}
                style={nodeStyle(nodeId)}
              />
            )))}
            {previewChoices.map((choice) => (
              <span
                key={choice.throwId}
                className="yut-preview__goal"
                data-preview-goal={choice.markerNodeId}
                style={nodeStyle(choice.markerNodeId)}
              >
                {choice.badge && <span className="yut-preview__badge">{choice.badge}</span>}
              </span>
            ))}
          </div>
        )}
        <div className="yut-board__pieces">{boardGroups.map(renderPiece)}</div>
        {choices.length > 0 && activePieceId && (
          <div className="yut-choices" data-testid="move-choices">
            {choices.map((choice) => (
              <button
                key={choice.throwId}
                type="button"
                className="yut-choice"
                // 두 결과가 같은 칸에 닿으면 버튼이 겹치므로 하나씩 밀어 놓는다.
                style={{
                  ...nodeStyle(choice.markerNodeId),
                  "--choice-stack": choice.stack,
                  "--choice-nudge": choice.onPiece ? "2rem" : "0rem",
                } as CSSProperties}
                data-throw-id={choice.throwId}
                data-destination={choice.markerNodeId}
                aria-label={choiceLabel(choice, describeNode)}
                onClick={() => onSelectMove(choice.throwId, activePieceId)}
              >
                <span className="yut-choice__result">{choice.resultName}</span>
                {choice.badge && <span className="yut-choice__badge">{choice.badge}</span>}
              </button>
            ))}
          </div>
        )}
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
