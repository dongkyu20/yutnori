"use client";

import type { TeamId } from "../../shared/protocol";
import { SIDE_NAMES } from "../sideColor";

export interface RailPlayer {
  id: string;
  nickname: string;
  connected: boolean;
  ready: boolean;
  teamId?: TeamId;
  colorSlot?: number;
}

interface PlayerRailProps {
  players: RailPlayer[];
  hostPlayerId: string;
  currentPlayerId: string | null;
  showTeamControls: boolean;
  /** 팀전인가. 팀 색은 팀에 먼저 들어온 사람이 정하므로 방장 권한과는 별개다. */
  isTeamMode: boolean;
  teamSizes: Record<TeamId, number>;
  onToggleReady: (player: RailPlayer) => void;
  onAssignTeam: (playerId: string, teamId: TeamId) => void;
  onChooseColor: (slot: number) => void;
  onKick: (player: RailPlayer) => void;
}

const TEAM_IDS: TeamId[] = ["A", "B", "C", "D"];

/**
 * 이 사람이 색을 고를 수 있는가.
 * 개인전은 자기 색을 자기가, 팀전은 팀에 먼저 들어온 사람이 팀 색을 정한다. 서버 규칙과 같다.
 */
function canChooseColor(player: RailPlayer, players: readonly RailPlayer[], isTeamMode: boolean): boolean {
  if (!isTeamMode) return true;
  if (!player.teamId) return false;
  return players.find((candidate) => candidate.teamId === player.teamId)?.id === player.id;
}

/** 그 색을 이미 쓰고 있는 다른 편의 이름. 없으면 비어 있는 색이다. */
function holderOf(
  slot: number,
  player: RailPlayer,
  players: readonly RailPlayer[],
  isTeamMode: boolean,
): string | null {
  const mine = isTeamMode ? player.teamId : player.id;
  const holder = players.find((candidate) => {
    if (candidate.colorSlot !== slot) return false;
    return (isTeamMode ? candidate.teamId : candidate.id) !== mine;
  });
  if (!holder) return null;
  return isTeamMode && holder.teamId ? `${holder.teamId}팀` : holder.nickname;
}

export function PlayerRail({
  players,
  hostPlayerId,
  currentPlayerId,
  showTeamControls,
  isTeamMode,
  teamSizes,
  onToggleReady,
  onAssignTeam,
  onChooseColor,
  onKick,
}: PlayerRailProps) {
  return (
    <ul className="player-rail" aria-label="참가자 목록">
      {players.map((player) => {
        const isHost = player.id === hostPlayerId;
        const isCurrentPlayer = player.id === currentPlayerId;
        return (
          <li
            key={player.id}
            className="player-rail__item"
            data-player-id={player.id}
            data-team-id={player.teamId}
          >
            <div className="player-rail__identity">
              <strong className="player-rail__name">{player.nickname}</strong>
              {isHost && <span className="player-rail__badge player-rail__badge--host"> 방장</span>}
            </div>
            <div className="player-rail__status">
              <span className={`player-rail__badge player-rail__badge--${player.connected ? "online" : "offline"}`}>
                {player.connected ? "연결됨" : "연결 끊김"}
              </span>
              <span className={`player-rail__badge player-rail__badge--${player.ready ? "ready" : "idle"}`}>
                {player.ready ? "준비 완료" : "준비 안 됨"}
              </span>
            </div>
            {isCurrentPlayer && (
              <button
                className={`player-rail__ready${player.ready ? " player-rail__ready--on" : ""}`}
                type="button"
                onClick={() => onToggleReady(player)}
              >
                {player.ready ? "준비 취소" : "준비하기"}
              </button>
            )}
            {isCurrentPlayer && canChooseColor(player, players, isTeamMode) && (
              <fieldset className="player-rail__colors">
                <legend>{isTeamMode ? `${player.teamId}팀 말 색` : "내 말 색"}</legend>
                {SIDE_NAMES.map((name, slot) => {
                  const holder = holderOf(slot, player, players, isTeamMode);
                  return (
                    <button
                      key={name}
                      type="button"
                      className={`player-rail__color player-rail__color--side-${slot}`}
                      aria-label={holder ? `${name}, ${holder}이(가) 쓰는 색` : `${name} 고르기`}
                      aria-pressed={player.colorSlot === slot}
                      data-color-slot={slot}
                      // 남이 선점한 색은 고를 수 없다. 누가 쓰는지는 이름으로 알려 준다.
                      disabled={holder !== null}
                      onClick={() => onChooseColor(slot)}
                    >
                      {name}
                    </button>
                  );
                })}
              </fieldset>
            )}
            {showTeamControls && (
              <label className="player-rail__team">
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
              <button className="player-rail__kick" type="button" onClick={() => onKick(player)}>{player.nickname} 내보내기</button>
            )}
            {!showTeamControls && currentPlayerId === hostPlayerId && !isHost && (
              <button className="player-rail__kick" type="button" onClick={() => onKick(player)}>{player.nickname} 내보내기</button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
