import { getMoveOptions } from "./board";
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

export function getLegalPieceIds(
  pieces: readonly Piece[],
  controller: PieceController,
  distance: number,
): string[] {
  const seenStacks = new Set<string>();

  return pieces.flatMap((piece) => {
    if (!isControlledBy(piece, controller) || getLegalMoveOptions(piece, distance).length === 0) {
      return [];
    }

    if (piece.stackId) {
      if (seenStacks.has(piece.stackId)) {
        return [];
      }
      seenStacks.add(piece.stackId);
    }

    return [piece.id];
  });
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

  const destinationPieces = pieces.filter(
    (piece) =>
      !movingIds.has(piece.id) &&
      piece.status === "BOARD" &&
      piece.position?.nodeId === move.option.nodeId,
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
