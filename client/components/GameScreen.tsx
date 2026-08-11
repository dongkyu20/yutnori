"use client";

import type { InRoomCommand, PublicRoomSnapshot } from "../../shared/protocol";
import { TurnPanel } from "./TurnPanel";
import { YutBoard } from "./YutBoard";

interface GameScreenProps {
  snapshot: PublicRoomSnapshot;
  playerId: string | null;
  sendCommand: (command: InRoomCommand) => void;
}

export function GameScreen({ snapshot, playerId, sendCommand }: GameScreenProps) {
  const game = snapshot.game;
  if (!game) return <main><p role="alert">게임 정보를 불러오지 못했습니다.</p></main>;

  const currentPlayer = snapshot.players.find((player) => player.id === game.currentPlayerId);
  const metadata = () => ({ roomVersion: snapshot.version, requestId: crypto.randomUUID() });

  return (
    <main className="game-screen">
      <header className="game-screen__header"><h1>한판윷</h1><p>방 코드 <strong>{snapshot.roomCode}</strong></p></header>
      <div className="game-screen__play-area">
        <YutBoard
          game={game}
          players={snapshot.players}
          playerId={playerId}
          onSelectPiece={(pieceId) => sendCommand({ type: "SELECT_PIECE", pieceId, ...metadata() })}
          onSelectRoute={(routeId) => sendCommand({ type: "SELECT_ROUTE", routeId, ...metadata() })}
        />
        <TurnPanel
          game={game}
          currentPlayerNickname={currentPlayer?.nickname ?? game.currentPlayerId}
          isCurrentPlayer={playerId === game.currentPlayerId}
          onThrow={() => sendCommand({ type: "THROW_YUT", ...metadata() })}
        />
      </div>
    </main>
  );
}
