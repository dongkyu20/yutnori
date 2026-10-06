import type { PublicRoomSnapshot, TeamId } from "../shared/protocol";

/** 팀이 직접 지은 이름들. 짓지 않은 팀은 여기에 없다. 개인전 스냅샷에는 아예 오지 않는다. */
export type TeamNames = PublicRoomSnapshot["teamNames"];

/**
 * 화면에서 그 팀을 부를 이름. 직접 지은 이름이 있으면 그것을, 없으면 글자를 쓴다.
 * 대기실과 판과 결과창이 모두 이 계산을 써야 한 팀이 화면마다 다른 이름으로 불리지 않는다.
 */
export function teamLabel(teamId: TeamId, names: TeamNames): string {
  return names?.[teamId] ?? `${teamId}팀`;
}

/**
 * 말 위에 얹을 짧은 표. 말은 크기가 고정이라 긴 이름을 다 적으면 넘친다.
 * 이름을 지은 팀은 앞 두 글자로, 짓지 않은 팀은 글자 하나로 부른다.
 * 온전한 이름은 말의 aria-label에 남아 스크린 리더가 읽는다.
 */
export function shortTeamLabel(teamId: TeamId, names: TeamNames): string {
  const name = names?.[teamId];
  // 띄어 쓴 이름은 앞 두 글자에 빈칸이 끼어 "범 "처럼 어정쩡하게 잘린다. 잘라 낸 뒤 다듬는다.
  return name ? [...name].slice(0, 2).join("").trim() : teamId;
}
