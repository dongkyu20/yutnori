"use client";

import { useState } from "react";
import type { InRoomCommand, PublicRoomSnapshot, ServerError } from "../../shared/protocol";
import type { ConnectionState } from "../useGameSession";
import { newRequestId } from "../requestId";
import { sideClass, sideName, sideSlotOf, sideSlots } from "../sideColor";
import { EmojiReactions, type ReactionEvent } from "./EmojiReactions";
import { EventAnnouncer } from "./EventAnnouncer";
import { ResultDialog } from "./ResultDialog";
import { RoomAlert } from "./RoomAlert";
import { TurnPanel } from "./TurnPanel";
import { YutBoard } from "./YutBoard";

interface GameScreenProps {
  snapshot: PublicRoomSnapshot;
  playerId: string | null;
  connectionState?: ConnectionState;
  reactions?: readonly ReactionEvent[];
  /** 서버가 방금 거절한 명령이 있으면 그 까닭. */
  error?: ServerError | null;
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
  error = null,
  sendCommand,
  leaveRoom = NOOP,
}: GameScreenProps) {
  const [playersOpen, setPlayersOpen] = useState(true);
  const game = snapshot.game;
  if (!game) return <main><p role="alert">게임 정보를 불러오지 못했습니다.</p></main>;

  const currentPlayer = snapshot.players.find((player) => player.id === game.currentPlayerId);
  // 윷판의 말 색과 참가자 목록의 색을 같은 계산으로 맞춘다.
  const sides = sideSlots(snapshot.players);
  const metadata = () => ({ roomVersion: snapshot.version, requestId: newRequestId() });
  const winnerName = game.winnerId === null
    ? null
    : snapshot.mode === "team"
      ? `${game.winnerId}팀`
      : snapshot.players.find((player) => player.id === game.winnerId)?.nickname ?? game.winnerId;

  return (
    <main
      className="game-screen"
      data-room-version={snapshot.version}
      data-room-phase={snapshot.phase}
      data-current-player-id={game.currentPlayerId}
    >
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
      <RoomAlert error={error} />

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
              {snapshot.players.map((player) => {
                const slot = sideSlotOf(sides, { teamId: player.teamId, ownerId: player.id });
                return (
                  <li
                    key={player.id}
                    className={sideClass("game-player", slot)}
                    aria-current={player.id === game.currentPlayerId ? "true" : undefined}
                    data-player-id={player.id}
                    data-team-id={player.teamId}
                    data-side-slot={slot}
                  >
                    <strong>{player.nickname}</strong>
                    {player.teamId && <span>{player.teamId}팀</span>}
                    {sideName(slot) && <span>{sideName(slot)} 말</span>}
                    <span>{player.connected ? "연결됨" : "연결 끊김"}</span>
                    {player.id === game.currentPlayerId && <span>차례</span>}
                  </li>
                );
              })}
            </ul>
          </section>
        </aside>

        <section className="game-screen__board-column" aria-label="경기판">
          <YutBoard
            game={game}
            players={snapshot.players}
            playerId={playerId}
            legalPieceIds={game.legalPieceIds}
            onSelectMove={(throwId, pieceId) => {
              sendCommand({ type: "SELECT_PIECE", throwId, pieceId, ...metadata() });
            }}
            onSelectRoute={(routeId) => sendCommand({ type: "SELECT_ROUTE", routeId, ...metadata() })}
          />
        </section>

        <section className="game-screen__turn-column" aria-label="차례 조작">
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
      </div>

      <EventAnnouncer events={game.events} />

      {winnerName && (
        <ResultDialog
          winnerName={winnerName}
          onPlayAgain={() => sendCommand({ type: "PLAY_AGAIN", ...metadata() })}
          onReturnToLobby={leaveRoom}
        />
      )}
    </main>
  );
}
