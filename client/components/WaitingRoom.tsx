"use client";

import { useState } from "react";
import type { InRoomCommand, PublicRoomSnapshot, ServerError, TeamId } from "../../shared/protocol";
import { newRequestId } from "../requestId";
import { PlayerRail } from "./PlayerRail";
import { RoomAlert } from "./RoomAlert";

interface WaitingRoomProps {
  snapshot: PublicRoomSnapshot;
  playerId: string | null;
  /** 서버가 방금 거절한 명령이 있으면 그 까닭. */
  error?: ServerError | null;
  sendCommand: (command: InRoomCommand) => void;
}

const TEAM_IDS: TeamId[] = ["A", "B", "C", "D"];

export function WaitingRoom({ snapshot, playerId, error = null, sendCommand }: WaitingRoomProps) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const isHost = playerId === snapshot.hostPlayerId;
  const capacity = snapshot.mode === "individual" ? 4 : 8;
  const teamSizes = Object.fromEntries(TEAM_IDS.map((teamId) => [
    teamId,
    snapshot.players.filter((player) => player.teamId === teamId).length,
  ])) as Record<TeamId, number>;

  const metadata = () => ({ roomVersion: snapshot.version, requestId: newRequestId() });

  const copyRoomCode = async (): Promise<void> => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(snapshot.roomCode);
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  };

  const kick = (targetPlayerId: string, nickname: string): void => {
    if (window.confirm(`${nickname}님을 내보낼까요?`)) {
      sendCommand({ type: "KICK_PLAYER", playerId: targetPlayerId, ...metadata() });
    }
  };

  const renderPlayers = (players: PublicRoomSnapshot["players"]) => (
    <PlayerRail
      players={players}
      hostPlayerId={snapshot.hostPlayerId}
      currentPlayerId={playerId}
      showTeamControls={isHost && snapshot.mode === "team"}
      isTeamMode={snapshot.mode === "team"}
      teamSizes={teamSizes}
      onToggleReady={(player) => sendCommand({ type: "SET_READY", ready: !player.ready, ...metadata() })}
      onAssignTeam={(targetPlayerId, teamId) => sendCommand({
        type: "ASSIGN_TEAM", playerId: targetPlayerId, teamId, ...metadata(),
      })}
      onChooseColor={(slot) => sendCommand({ type: "CHOOSE_COLOR", slot, ...metadata() })}
      onKick={(player) => kick(player.id, player.nickname)}
    />
  );

  return (
    <main className="waiting-room" data-room-version={snapshot.version} data-room-phase={snapshot.phase}>
      <header className="waiting-room__hero">
        <h1>대기실</h1>
        <p>참가 인원 {`${snapshot.players.length}/${capacity}`}</p>
        <p>방 코드: <strong>{snapshot.roomCode}</strong></p>
        <button className="waiting-room__action" type="button" onClick={() => void copyRoomCode()}>방 코드 복사</button>
        {copied && <p className="waiting-room__status" role="status">방 코드가 복사되었습니다.</p>}
        {copyError && <p className="waiting-room__status waiting-room__status--error" role="alert">방 코드를 직접 복사해주세요.</p>}
      </header>

      <RoomAlert error={error} />

      {snapshot.mode === "individual" ? renderPlayers(snapshot.players) : (
        <section className="waiting-room__teams" aria-label="팀 구성">
          {TEAM_IDS.map((teamId) => {
            const members = snapshot.players.filter((player) => player.teamId === teamId);
            return (
              <section key={teamId} className="waiting-room__team-card" aria-label={`팀 ${teamId}`}>
                <h2>팀 {teamId}</h2>
                <p>{members.length}/2</p>
                {renderPlayers(members)}
              </section>
            );
          })}
          {snapshot.players.some((player) => !player.teamId) && (
            <section className="waiting-room__team-card" aria-label="미배정 참가자">
              <h2>미배정</h2>
              {renderPlayers(snapshot.players.filter((player) => !player.teamId))}
            </section>
          )}
        </section>
      )}

      <section className="waiting-room__footer" aria-labelledby="start-heading">
        <h2 id="start-heading">게임 준비</h2>
        {!snapshot.canStart && <p role="status">{snapshot.startEligibilityReason}</p>}
        {isHost ? (
          <button
            className="waiting-room__action"
            type="button"
            disabled={!snapshot.canStart}
            onClick={() => sendCommand({ type: "START_GAME", ...metadata() })}
          >
            게임 시작
          </button>
        ) : null}
      </section>
    </main>
  );
}
