"use client";

import { useEffect, useState } from "react";
import type { InRoomCommand, PublicRoomSnapshot, ServerError } from "../../shared/protocol";
import type { ConnectionState } from "../useGameSession";
import { inviteUrl } from "../invite";
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
/** 초대 링크를 복사했다는 표시를 버튼에 남겨 두는 시간. */
const COPY_FEEDBACK_MS = 2000;
/** 내 차례 알림이 떠 있는 시간. 움직임을 줄인 사람도 읽을 만큼은 둔다. */
const TURN_BANNER_MS = 2200;

export function GameScreen({
  snapshot,
  playerId,
  connectionState = "connected",
  reactions = [],
  error = null,
  sendCommand,
  leaveRoom = NOOP,
}: GameScreenProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const game = snapshot.game;
  const isMyTurn = Boolean(game && playerId && game.currentPlayerId === playerId && game.winnerId === null);
  // 남의 차례에서 내 차례로 넘어오는 순간에만 알림을 띄운다. 윷·모로 한 번 더 던질 때는 띄우지 않는다.
  const [turnBanner, setTurnBanner] = useState({ wasMyTurn: isMyTurn, count: isMyTurn ? 1 : 0 });
  if (turnBanner.wasMyTurn !== isMyTurn) {
    setTurnBanner((current) => ({ wasMyTurn: isMyTurn, count: isMyTurn ? current.count + 1 : current.count }));
  }
  const [bannerShownFor, setBannerShownFor] = useState(0);
  useEffect(() => {
    if (turnBanner.count === 0) return;
    const timer = window.setTimeout(() => setBannerShownFor(turnBanner.count), TURN_BANNER_MS);
    return () => window.clearTimeout(timer);
  }, [turnBanner.count]);
  useEffect(() => {
    if (copyState === "idle") return;
    const timer = window.setTimeout(() => setCopyState("idle"), COPY_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [copyState]);
  const showTurnBanner = isMyTurn && turnBanner.count > 0 && bannerShownFor !== turnBanner.count;
  if (!game) return <main><p role="alert">게임 정보를 불러오지 못했습니다.</p></main>;

  const currentPlayer = snapshot.players.find((player) => player.id === game.currentPlayerId);
  // 윷판의 말 색과 참가자 목록의 색을 같은 계산으로 맞춘다.
  const sides = sideSlots(snapshot.players);
  const metadata = () => ({ roomVersion: snapshot.version, requestId: newRequestId() });
  const winnerName = game.winnerId === null
    ? null
    : game.winnerName
      ?? (snapshot.mode === "team"
        ? `${game.winnerId}팀`
        : snapshot.players.find((player) => player.id === game.winnerId)?.nickname ?? game.winnerId);

  const copyInvite = async (): Promise<void> => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(inviteUrl(snapshot.roomCode));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  /** 그 편의 출발 대기·완주 말 개수. 팀전은 팀이 함께 쓰는 말을 센다. */
  const pieceCounts = (controllerId: string) => {
    const owned = game.pieces.filter((piece) => (piece.teamId ?? piece.ownerId) === controllerId);
    return {
      home: owned.filter((piece) => piece.status === "HOME").length,
      finished: owned.filter((piece) => piece.status === "FINISHED").length,
    };
  };

  // 진행 중인 판을 두고 나가면 내 말이 걷힌다. 되돌릴 수 없으므로 한 번 묻는다.
  const confirmLeave = (): void => {
    if (snapshot.phase !== "playing" || window.confirm("지금 나가면 내 말이 판에서 걷힙니다. 나갈까요?")) {
      leaveRoom();
    }
  };

  return (
    <main
      className={`game-screen${isMyTurn ? " game-screen--my-turn" : ""}`}
      data-room-version={snapshot.version}
      data-room-phase={snapshot.phase}
      data-current-player-id={game.currentPlayerId}
    >
      <header className="game-bar">
        <strong className="game-bar__title">한판윷</strong>
        <p className="game-bar__room">방 <strong>{snapshot.roomCode}</strong></p>
        <p
          className={`connection-status connection-status--${connectionState}`}
          role="status"
          aria-label="연결 상태"
          title={CONNECTION_MESSAGES[connectionState]}
        >
          {/* 잘 이어져 있을 때는 점 하나로 줄인다. 글은 스크린 리더와 툴팁에 남는다. */}
          <span className={connectionState === "connected" ? "sr-only" : undefined}>{CONNECTION_MESSAGES[connectionState]}</span>
        </p>
        <span className="game-bar__spacer" />
        <button type="button" className="game-bar__invite" aria-label="초대 링크 복사" onClick={() => void copyInvite()}>
          {copyState === "copied" ? "복사됨" : copyState === "failed" ? "복사 실패" : "초대 링크"}
        </button>
        <button type="button" className="room-leave" onClick={confirmLeave}>방 나가기</button>
      </header>
      <RoomAlert error={error} />

      <ul className="game-players" aria-label="참가자">
        {snapshot.players.map((player) => {
          const slot = sideSlotOf(sides, { teamId: player.teamId, ownerId: player.id });
          const counts = pieceCounts(player.teamId ?? player.id);
          const isTurn = player.id === game.currentPlayerId;
          return (
            <li
              key={player.id}
              className={sideClass("game-player", slot)}
              aria-current={isTurn ? "true" : undefined}
              data-player-id={player.id}
              data-team-id={player.teamId}
              data-side-slot={slot}
            >
              <strong>{player.nickname}</strong>
              {player.id === playerId && <span className="game-player__me">나</span>}
              {player.teamId && <span className="game-player__meta">{player.teamId}팀</span>}
              {sideName(slot) && <span className="game-player__meta">{sideName(slot)} 말</span>}
              <span className="game-player__meta">대기 {counts.home} · 완주 {counts.finished}</span>
              {!player.connected && <span className="game-player__offline">연결 끊김</span>}
              {isTurn && <span className="sr-only">차례</span>}
            </li>
          );
        })}
      </ul>

      <div className="game-screen__layout">
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

        <section className="game-screen__turn-column action-panel" aria-label="차례 조작">
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

      {showTurnBanner && (
        <div key={turnBanner.count} className="turn-banner" data-testid="turn-banner" aria-hidden="true">
          <span className="turn-banner__text">내 차례!</span>
        </div>
      )}

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
