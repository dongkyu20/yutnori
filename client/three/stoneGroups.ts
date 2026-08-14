/**
 * 판 위의 말을 3D 덩이로 묶는 규칙. DOM 버튼과 3D 말이 같은 것을 가리키게 하는 약속
 * (묶는 열쇠, 편 색 자리, 두께)이 여기 한 곳에 있다. three도 DOM도 쓰지 않으므로
 * Node에서 그대로 검증한다.
 */
import type { PublicGameState } from "../../shared/protocol";
import { sideSlotOf } from "../sideColor";

type Piece = PublicGameState["pieces"][number];

export interface StoneGroup {
  key: string;
  nodeId: string;
  slot: number;
  stackSize: number;
  pieceIds: string[];
}

/**
 * 말을 `칸:편`으로 모은다. 같은 칸의 같은 편은 업힌 한 덩이다.
 * `filter`로 모을 말을 고르고, `nodeIdOf`로 그 말이 놓일 칸을 정한다.
 * 잡기와 참으로 나기 연출은 판에서 내려간 말을 어떤 칸에 되살려야 하므로 이 둘을 갈아 끼운다.
 */
export function stoneGroups(
  pieces: readonly Piece[],
  slots: ReadonlyMap<string, number>,
  filter: (piece: Piece) => boolean,
  nodeIdOf: (piece: Piece) => string | undefined,
): StoneGroup[] {
  const groups = new Map<string, StoneGroup>();
  pieces.forEach((piece) => {
    if (!filter(piece)) return;
    const nodeId = nodeIdOf(piece);
    if (!nodeId) return;
    const controllerId = piece.teamId ?? piece.ownerId;
    const key = `${nodeId}:${controllerId}`;
    const found = groups.get(key);
    if (found) {
      found.pieceIds.push(piece.id);
      // stackSize는 서버가 이미 묶음 전체의 크기로 적어 보낸 값이다. 말마다 하나씩 더하면
      // 두 개짜리가 세 개 두께로 그려진다. 여기서 세는 것은 실제로 담긴 말의 수뿐이다.
      // 잡히거나 참으로 난 말은 묶음이 풀려 각자 1이 되므로 말 수 쪽이 답이 된다.
      found.stackSize = Math.max(found.pieceIds.length, piece.stackSize, found.stackSize);
      return;
    }
    groups.set(key, {
      key,
      nodeId,
      slot: sideSlotOf(slots, { teamId: piece.teamId, ownerId: piece.ownerId }) ?? 0,
      stackSize: Math.max(1, piece.stackSize),
      pieceIds: [piece.id],
    });
  });
  return [...groups.values()];
}

/** 판 위에 실제로 서 있는 덩이. */
export function boardGroups(
  pieces: readonly Piece[],
  slots: ReadonlyMap<string, number>,
): StoneGroup[] {
  return stoneGroups(
    pieces,
    slots,
    (piece) => piece.status === "BOARD",
    (piece) => piece.nodeId,
  );
}
