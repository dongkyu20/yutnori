"use client";

import { useState } from "react";
import type { InRoomCommand, PublicRoomSnapshot } from "../../shared/protocol";
import type { ConnectionState } from "../useGameSession";
import { EmojiReactions, type ReactionEvent } from "./EmojiReactions";
import { EventLog } from "./EventLog";
import { ResultDialog } from "./ResultDialog";
import { TurnPanel } from "./TurnPanel";
import { YutBoard } from "./YutBoard";

interface GameScreenProps {
  snapshot: PublicRoomSnapshot;
  playerId: string | null;
  connectionState?: ConnectionState;
  reactions?: readonly ReactionEvent[];
  sendCommand: (command: InRoomCommand) => void;
  leaveRoom?: () => void;
}

const CONNECTION_MESSAGES: Record<ConnectionState, string> = {
  connected: "서버와 연결되었습니다.",
  connecting: "서버에 연결하는 중입니다.",
  reconnecting: "게임에 다시 연결하는 중입니다.",
  offline: "연결이 끊겼습니다. 연결 상태를 확인해 주세요.",
};
const NOOP = () => undefined;

export function GameScreen({
  snapshot,
  playerId,
  connectionState = "connected",
  reactions = [],
  sendCommand,
  leaveRoom = NOOP,
}: GameScreenProps) {
  const [playersOpen, setPlayersOpen] = useState(true);
  const [logOpen, setLogOpen] = useState(true);
  const game = snapshot.game;
  if (!game) return <main><p role="alert">게임 정보를 불러오지 못했습니다.</p></main>;

  const currentPlayer = snapshot.players.find((player) => player.id === game.currentPlayerId);
  const metadata = () => ({ roomVersion: snapshot.version, requestId: crypto.randomUUID() });
  const winnerName = game.winnerId === null
    ? null
    : snapshot.mode === "team"
      ? `${game.winnerId}팀`
      : snapshot.players.find((player) => player.id === game.winnerId)?.nickname ?? game.winnerId;

  return (
    <main className="game-screen">
      <header className="game-screen__header">
        <div><p className="game-screen__eyebrow">우리의 한 판</p><h1>한판윷</h1></div>
        <p>방 코드 <strong>{snapshot.roomCode}</strong></p>
      </header>
      <p
        className={`connection-status connection-status--${connectionState}`}
        role="status"
        aria-label="연결 상태"
      >
        {CONNECTION_MESSAGES[connectionState]}
      </p>

      <div className="game-screen__layout">
        <aside className="game-screen__players">
          <button
            className="panel-toggle"
            type="button"
            aria-controls="game-player-panel"
            aria-expanded={playersOpen}
            onClick={() => setPlayersOpen((open) => !open)}
          >
            참가자 패널 {playersOpen ? "접기" : "펼치기"}
          </button>
          <section
            id="game-player-panel"
            className={playersOpen ? "game-panel" : "game-panel game-panel--collapsed"}
            aria-label="참가자"
          >
            <h2>참가자</h2>
            <ul className="game-player-list">
              {snapshot.players.map((player) => (
                <li
                  key={player.id}
                  className={`game-player game-player--${(player.teamId ?? "individual").toLowerCase()}`}
                  aria-current={player.id === game.currentPlayerId ? "true" : undefined}
                >
                  <strong>{player.nickname}</strong>
                  {player.teamId && <span>{player.teamId}팀</span>}
                  <span>{player.connected ? "연결됨" : "연결 끊김"}</span>
                  {player.id === game.currentPlayerId && <span>차례</span>}
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <section className="game-screen__board-column" aria-label="경기판과 차례 조작">
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
          <EmojiReactions
            reactions={reactions}
            players={snapshot.players}
            onReact={(emoji) => sendCommand({ type: "REACT", emoji })}
          />
        </section>

        <aside className="game-screen__log">
          <button
            className="panel-toggle"
            type="button"
            aria-controls="game-event-panel"
            aria-expanded={logOpen}
            onClick={() => setLogOpen((open) => !open)}
          >
            경기 기록 패널 {logOpen ? "접기" : "펼치기"}
          </button>
          <div
            id="game-event-panel"
            className={logOpen ? "game-panel" : "game-panel game-panel--collapsed"}
          >
            <EventLog events={game.events} />
          </div>
        </aside>
      </div>

      {winnerName && <ResultDialog winnerName={winnerName} onReturnToLobby={leaveRoom} />}
    </main>
  );
}
