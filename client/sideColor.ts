import type { PublicGameState, TeamId } from "../shared/protocol";

/**
 * 편마다 말 색을 하나씩 준다. 팀전은 팀 이름이, 개인전은 참가 순서가 색을 정한다.
 * 윷판과 참가자 목록이 같은 계산을 쓰므로 어느 색이 내 말인지 바로 읽힌다.
 */
export const SIDE_COUNT = 4;
export const SIDE_NAMES = ["주홍", "청록", "치자", "먹"] as const;

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
  { base: 0xd5a62d, deep: 0x76590d },
  { base: 0x606966, deep: 0x1f2724 },
]);

const TEAM_SLOTS: Readonly<Record<TeamId, number>> = { A: 0, B: 1, C: 2, D: 3 };

type Piece = PublicGameState["pieces"][number];

interface Side {
  teamId?: TeamId;
  /** 개인전에서 말을 가진 참가자. */
  ownerId: string;
}

/** 말을 조작하는 편의 식별자. 팀전은 팀, 개인전은 참가자다. */
export function controllerIdOf(side: Side): string {
  return side.teamId ?? side.ownerId;
}

/**
 * 편별 색 자리를 매긴다. 말 목록은 게임이 시작될 때 정해진 뒤 순서가 바뀌지 않으므로,
 * 누가 나가거나 다시 접속해도 경기 중에 색이 뒤바뀌지 않는다.
 */
export function sideSlots(pieces: readonly Piece[]): ReadonlyMap<string, number> {
  const slots = new Map<string, number>();
  for (const piece of pieces) {
    if (piece.teamId) {
      slots.set(piece.teamId, TEAM_SLOTS[piece.teamId]);
      continue;
    }
    if (!slots.has(piece.ownerId)) slots.set(piece.ownerId, slots.size % SIDE_COUNT);
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
