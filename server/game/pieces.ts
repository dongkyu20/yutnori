import { getMoveOptions, squareOf } from "./board";
import type {
  MoveOption,
  MoveResolution,
  Piece,
  PieceController,
} from "./types";

function ownershipId(piece: Piece): string {
  return piece.teamId ?? piece.ownerId;
}

function isControlledBy(piece: Piece, controller: PieceController): boolean {
  return controller.teamId !== undefined
    ? piece.teamId === controller.teamId
    : piece.teamId === undefined && piece.ownerId === controller.ownerId;
}

function areFriendly(left: Piece, right: Piece): boolean {
  return ownershipId(left) === ownershipId(right);
}

export function getLegalMoveOptions(piece: Piece, distance: number): MoveOption[] {
  if (piece.status === "FINISHED" || distance === 0) {
    return [];
  }

  if (piece.status === "HOME") {
    return distance > 0
      ? getMoveOptions({ nodeId: "O0", routeId: "OUTER" }, distance)
      : [];
  }

  return piece.position ? getMoveOptions(piece.position, distance) : [];
}

/** 움직일 수 있는 말과 그 말이 갈 곳. 업힌 묶음은 대표 말 하나로만 센다. */
export interface LegalMove {
  pieceId: string;
  option: MoveOption;
}

export function getLegalMoves(
  pieces: readonly Piece[],
  controller: PieceController,
  distance: number,
): LegalMove[] {
  const seenStacks = new Set<string>();

  return pieces.flatMap((piece) => {
    if (!isControlledBy(piece, controller)) {
      return [];
    }
    const [option] = getLegalMoveOptions(piece, distance);
    if (!option) {
      return [];
    }

    if (piece.stackId) {
      if (seenStacks.has(piece.stackId)) {
        return [];
      }
      seenStacks.add(piece.stackId);
    }

    return [{ pieceId: piece.id, option }];
  });
}

/** 갈 곳까지 함께 구한 뒤 id만 추린다. 두 목록이 어긋날 수 없도록 계산은 한 번만 한다. */
export function getLegalPieceIds(
  pieces: readonly Piece[],
  controller: PieceController,
  distance: number,
): string[] {
  return getLegalMoves(pieces, controller, distance).map((move) => move.pieceId);
}

function homePiece(piece: Piece): Piece {
  return {
    id: piece.id,
    ownerId: piece.ownerId,
    ...(piece.teamId ? { teamId: piece.teamId } : {}),
    status: "HOME",
  };
}

function finishedPiece(piece: Piece): Piece {
  return {
    id: piece.id,
    ownerId: piece.ownerId,
    ...(piece.teamId ? { teamId: piece.teamId } : {}),
    status: "FINISHED",
  };
}

function completedOwnerId(pieces: readonly Piece[], movedPiece: Piece): string | undefined {
  const ownerId = ownershipId(movedPiece);
  const ownedPieces = pieces.filter((piece) => ownershipId(piece) === ownerId);
  return ownedPieces.length > 0 && ownedPieces.every((piece) => piece.status === "FINISHED")
    ? ownerId
    : undefined;
}

export function movePieces(
  pieces: readonly Piece[],
  move: { pieceId: string; option: MoveOption },
): MoveResolution {
  const selectedPiece = pieces.find((piece) => piece.id === move.pieceId);
  if (!selectedPiece || selectedPiece.status === "FINISHED") {
    throw new Error("선택할 수 없는 말입니다.");
  }

  const movingPieces = selectedPiece.stackId
    ? pieces.filter((piece) => piece.stackId === selectedPiece.stackId)
    : [selectedPiece];
  const movingIds = new Set(movingPieces.map((piece) => piece.id));
  const movedPieceIds = movingPieces.map((piece) => piece.id);

  if (move.option.finished) {
    const nextPieces = pieces.map((piece) =>
      movingIds.has(piece.id) ? finishedPiece(piece) : { ...piece },
    );
    return {
      pieces: nextPieces,
      capturedPieceIds: [],
      movedPieceIds,
      bonusThrowsEarned: 0,
      finishedOwnerId: completedOwnerId(nextPieces, selectedPiece),
    };
  }

  // 도착점 모서리는 어떻게 들어섰느냐에 따라 칸 이름이 둘이다. 눈에는 같은 자리이므로
  // 이름이 아니라 자리로 견주어야 거기 선 말을 잡거나 업을 수 있다.
  const destinationSquare = squareOf(move.option.nodeId);
  const destinationPieces = pieces.filter(
    (piece) =>
      !movingIds.has(piece.id) &&
      piece.status === "BOARD" &&
      piece.position !== undefined &&
      squareOf(piece.position.nodeId) === destinationSquare,
  );
  const capturedPieces = destinationPieces.filter((piece) => !areFriendly(selectedPiece, piece));
  const capturedIds = new Set(capturedPieces.map((piece) => piece.id));
  const friendlyPieces = destinationPieces.filter((piece) => areFriendly(selectedPiece, piece));
  const friendlyIds = new Set(friendlyPieces.map((piece) => piece.id));
  const destinationStackId =
    friendlyPieces[0]?.stackId ??
    friendlyPieces[0]?.id ??
    selectedPiece.stackId ??
    selectedPiece.id;
  const destinationPosition = { nodeId: move.option.nodeId, routeId: move.option.routeId };

  const nextPieces = pieces.map((piece): Piece => {
    if (capturedIds.has(piece.id)) {
      return homePiece(piece);
    }
    if (movingIds.has(piece.id) || friendlyIds.has(piece.id)) {
      return {
        ...piece,
        status: "BOARD",
        position: destinationPosition,
        stackId: destinationStackId,
      };
    }
    return { ...piece, position: piece.position ? { ...piece.position } : undefined };
  });

  return {
    pieces: nextPieces,
    capturedPieceIds: capturedPieces.map((piece) => piece.id),
    movedPieceIds,
    bonusThrowsEarned: capturedPieces.length > 0 ? 1 : 0,
  };
}
