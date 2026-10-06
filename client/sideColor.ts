import type { TeamId } from "../shared/protocol";

/**
 * 편마다 말 색을 하나씩 준다. 팀전은 팀 이름이, 개인전은 참가 순서가 색을 정한다.
 * 윷판과 참가자 목록이 같은 계산을 쓰므로 어느 색이 내 말인지 바로 읽힌다.
 */
export const SIDE_COUNT = 4;
export const SIDE_NAMES = ["주홍", "청록", "보라", "먹"] as const;

export interface SideColor {
  /** 밝은 쪽. 무늬의 넓은 띠. */
  base: number;
  /** 어두운 쪽. 무늬의 좁은 띠와 그림자. */
  deep: number;
}

/**
 * 편 색. CSS와 3D가 같은 값을 써야 하므로 여기를 단일 출처로 삼는다.
 * globals.css의 .yut-piece--side-N과 어긋나면 sideColor 테스트가 깨진다.
 */
export const SIDE_COLORS: readonly SideColor[] = Object.freeze([
  { base: 0xc84a35, deep: 0x782718 },
  { base: 0x147d73, deep: 0x084841 },
  // 보라. 예전에는 치자(금색)였으나 윷판의 길목·방 테두리가 같은 금색이라
  // 그 칸에 올라선 말이 테에 묻혔다. 주홍·청록·먹 어느 것과도 멀다.
  { base: 0x7a4fa3, deep: 0x442460 },
  { base: 0x606966, deep: 0x1f2724 },
]);



interface Side {
  teamId?: TeamId;
  /** 개인전에서 말을 가진 참가자. */
  ownerId: string;
}

/** 말을 조작하는 편의 식별자. 팀전은 팀, 개인전은 참가자다. */
export function controllerIdOf(side: Side): string {
  return side.teamId ?? side.ownerId;
}

/** 색을 가진 편을 알아내는 데 필요한 참가자 정보. */
export interface ColoredPlayer {
  id: string;
  teamId?: TeamId;
  /** 서버가 정한 색 자리. 대기실에서 아직 고르지 않았으면 없다. */
  colorSlot?: number;
}

/**
 * 편별 색 자리를 참가자 목록에서 읽는다. 색은 참가자가 직접 고르고 서버가 지키므로,
 * 말이 만들어진 순서 같은 것에서 유추하지 않는다. 대기실에도 아직 말이 없다.
 * 팀전은 팀원 둘이 같은 값을 받으므로 팀 하나에 색 하나로 모인다.
 */
export function sideSlots(players: readonly ColoredPlayer[]): ReadonlyMap<string, number> {
  const slots = new Map<string, number>();
  for (const player of players) {
    if (player.colorSlot === undefined) continue;
    slots.set(player.teamId ?? player.id, player.colorSlot);
  }
  return slots;
}

export function sideSlotOf(slots: ReadonlyMap<string, number>, side: Side): number | undefined {
  return slots.get(controllerIdOf(side));
}

/** 색을 아직 모르는 편은 색 클래스 없이 기본 모습으로 둔다. */
export function sideClass(base: string, slot: number | undefined): string {
  return slot === undefined ? base : `${base} ${base}--side-${slot}`;
}

export function sideName(slot: number | undefined): string | null {
  return slot === undefined ? null : SIDE_NAMES[slot];
}
