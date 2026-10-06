"use client";

import { useState } from "react";
import type { InRoomCommand, PublicRoomSnapshot, ServerError, TeamId } from "../../shared/protocol";
import { inviteUrl } from "../invite";
import { newRequestId } from "../requestId";
import { teamLabel } from "../teamName";
import { PlayerRail } from "./PlayerRail";
import { RoomAlert } from "./RoomAlert";

interface WaitingRoomProps {
  snapshot: PublicRoomSnapshot;
  playerId: string | null;
  /** 서버가 방금 거절한 명령이 있으면 그 까닭. */
  error?: ServerError | null;
  sendCommand: (command: InRoomCommand) => void;
  /** 방을 떠난다. 자리와 고른 색이 함께 풀린다. */
  leaveRoom?: () => void;
}

const TEAM_IDS: TeamId[] = ["A", "B", "C", "D"];

/** 두 명씩 남김없이 짝지을 수 있는 인원. 서버 규칙과 같다. */
const SHUFFLE_SIZES = [4, 6, 8];

const NOOP = (): void => undefined;

type CopyKind = "link" | "code";

const COPIED_MESSAGES: Record<CopyKind, string> = {
  link: "초대 링크가 복사되었습니다. 친구에게 보내 주세요.",
  code: "방 코드가 복사되었습니다.",
};
const COPY_FAILED_MESSAGES: Record<CopyKind, string> = {
  link: "초대 링크를 직접 복사해주세요.",
  code: "방 코드를 직접 복사해주세요.",
};

export function WaitingRoom({
  snapshot,
  playerId,
  error = null,
  sendCommand,
  leaveRoom = NOOP,
}: WaitingRoomProps) {
  // 무엇을 복사했는지(또는 복사하지 못했는지). 안내 문구가 달라진다.
  const [copied, setCopied] = useState<CopyKind | null>(null);
  const [copyError, setCopyError] = useState<CopyKind | null>(null);
  const isHost = playerId === snapshot.hostPlayerId;
  const capacity = snapshot.mode === "individual" ? 4 : 8;
  const teamSizes = Object.fromEntries(TEAM_IDS.map((teamId) => [
    teamId,
    snapshot.players.filter((player) => player.teamId === teamId).length,
  ])) as Record<TeamId, number>;

  const metadata = () => ({ roomVersion: snapshot.version, requestId: newRequestId() });
  const canShuffle = SHUFFLE_SIZES.includes(snapshot.players.length);
  // 내 팀은 내가 짓는다. 방장은 어느 팀이든 고칠 수 있다. 서버 규칙과 같다.
  const myTeamId = snapshot.players.find((player) => player.id === playerId)?.teamId;

  const copy = async (kind: CopyKind): Promise<void> => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(kind === "link" ? inviteUrl(snapshot.roomCode) : snapshot.roomCode);
      setCopied(kind);
      setCopyError(null);
    } catch {
      setCopied(null);
      setCopyError(kind);
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
      teamNames={snapshot.teamNames}
      onChooseColor={(slot) => sendCommand({ type: "CHOOSE_COLOR", slot, ...metadata() })}
      onKick={(player) => kick(player.id, player.nickname)}
    />
  );

  return (
    <main className="waiting-room" data-room-version={snapshot.version} data-room-phase={snapshot.phase}>
      <header className="waiting-room__hero">
        <p>한판윷</p>
        <h1>대기실</h1>
        <p className="waiting-room__code">방 코드 <strong>{snapshot.roomCode}</strong></p>
        <p>참가 인원 {`${snapshot.players.length}/${capacity}`}</p>
        <p className="waiting-room__hint">친구에게 초대 링크를 보내면 닉네임만 쓰고 바로 들어올 수 있어요.</p>
        <div className="waiting-room__hero-actions">
          <button className="waiting-room__action" type="button" onClick={() => void copy("link")}>초대 링크 복사</button>
          <button className="waiting-room__action waiting-room__action--secondary" type="button" onClick={() => void copy("code")}>방 코드 복사</button>
          <button className="room-leave" type="button" onClick={leaveRoom}>방 나가기</button>
        </div>
        {copied && <p className="waiting-room__status" role="status">{COPIED_MESSAGES[copied]}</p>}
        {copyError && <p className="waiting-room__status waiting-room__status--error" role="alert">{COPY_FAILED_MESSAGES[copyError]}</p>}
      </header>

      <RoomAlert error={error} />

      {snapshot.mode === "team" && isHost && (
        <div className="waiting-room__shuffle">
          <button
            className="waiting-room__action waiting-room__action--secondary"
            type="button"
            disabled={!canShuffle}
            aria-describedby={canShuffle ? undefined : "shuffle-help"}
            onClick={() => sendCommand({ type: "SHUFFLE_TEAMS", ...metadata() })}
          >
            팀 랜덤 배정
          </button>
          {!canShuffle && <p id="shuffle-help" className="waiting-room__hint">4·6·8명일 때 랜덤으로 나눌 수 있어요</p>}
        </div>
      )}

      {snapshot.mode === "individual" ? renderPlayers(snapshot.players) : (
        <section className="waiting-room__teams" aria-label="팀 구성">
          {TEAM_IDS.map((teamId) => {
            const members = snapshot.players.filter((player) => player.teamId === teamId);
            const name = snapshot.teamNames?.[teamId] ?? "";
            const label = teamLabel(teamId, snapshot.teamNames);
            return (
              <section key={teamId} className="waiting-room__team-card" aria-label={label}>
                <h2>{label}</h2>
                <p>{members.length}/2</p>
                {(isHost || myTeamId === teamId) && (
                  <form
                    className="team-name"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const field = event.currentTarget.elements.namedItem("teamName");
                      if (field instanceof HTMLInputElement) {
                        sendCommand({ type: "SET_TEAM_NAME", teamId, name: field.value, ...metadata() });
                      }
                    }}
                  >
                    {/* 서버가 보낸 이름이 바뀌면 key가 바뀌어 입력칸이 새로 선다.
                        값을 따로 붙들지 않아도 남이 바꾼 이름이 그대로 비친다. */}
                    <input
                      key={name}
                      id={`team-name-${teamId}`}
                      name="teamName"
                      className="team-name__input"
                      defaultValue={name}
                      maxLength={12}
                      placeholder={`${teamId}팀`}
                      aria-label={`${label} 이름`}
                    />
                    <button className="team-name__save" type="submit" aria-label={`${label} 이름 정하기`}>정하기</button>
                  </form>
                )}
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
        ) : (
          <p className="waiting-room__waiting">방장이 게임을 시작하기를 기다리는 중입니다.</p>
        )}
      </section>
    </main>
  );
}
