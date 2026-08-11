"use client";

import type { TeamId } from "../../shared/protocol";

export interface RailPlayer {
  id: string;
  nickname: string;
  connected: boolean;
  ready: boolean;
  teamId?: TeamId;
}

interface PlayerRailProps {
  players: RailPlayer[];
  hostPlayerId: string;
  currentPlayerId: string | null;
  showTeamControls: boolean;
  teamSizes: Record<TeamId, number>;
  onToggleReady: (player: RailPlayer) => void;
  onAssignTeam: (playerId: string, teamId: TeamId) => void;
  onKick: (player: RailPlayer) => void;
}

const TEAM_IDS: TeamId[] = ["A", "B", "C", "D"];

export function PlayerRail({
  players,
  hostPlayerId,
  currentPlayerId,
  showTeamControls,
  teamSizes,
  onToggleReady,
  onAssignTeam,
  onKick,
}: PlayerRailProps) {
  return (
    <ul aria-label="참가자 목록">
      {players.map((player) => {
        const isHost = player.id === hostPlayerId;
        const isCurrentPlayer = player.id === currentPlayerId;
        return (
          <li key={player.id}>
            <strong>{player.nickname}</strong>{isHost && <span> 방장</span>}
            <span>{player.connected ? "연결됨" : "연결 끊김"}</span>
            <span>{player.ready ? "준비 완료" : "준비 안 됨"}</span>
            {isCurrentPlayer && (
              <button type="button" onClick={() => onToggleReady(player)}>
                {player.ready ? "준비 취소" : "준비하기"}
              </button>
            )}
            {showTeamControls && (
              <label>
                {player.nickname} 팀 배정
                <select
                  aria-label={`${player.nickname} 팀 배정`}
                  value={player.teamId ?? ""}
                  onChange={(event) => {
                    if (event.target.value) onAssignTeam(player.id, event.target.value as TeamId);
                  }}
                >
                  <option value="">미배정</option>
                  {TEAM_IDS.map((teamId) => (
                    <option
                      key={teamId}
                      value={teamId}
                      disabled={teamSizes[teamId] >= 2 && player.teamId !== teamId}
                    >
                      팀 {teamId}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {showTeamControls && !isHost && (
              <button type="button" onClick={() => onKick(player)}>{player.nickname} 내보내기</button>
            )}
            {!showTeamControls && currentPlayerId === hostPlayerId && !isHost && (
              <button type="button" onClick={() => onKick(player)}>{player.nickname} 내보내기</button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
