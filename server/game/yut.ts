import type { ThrowOutcome, YutResult } from "./types";

// 배(평평한 면)가 위로 나온 개수가 그대로 칸 수가 되고, 하나도 없으면 모다.
const RESULT_TABLE = [
  ["MO", 5, 1],
  ["DO", 1, 0],
  ["GAE", 2, 0],
  ["GEOL", 3, 0],
  ["YUT", 4, 1],
] as const;

export function throwYut(random: () => number = Math.random): ThrowOutcome {
  const sticks = [random() < 0.5, random() < 0.5, random() < 0.5, random() < 0.5] as ThrowOutcome["sticks"];
  const flatCount = sticks.filter(Boolean).length;

  if (flatCount === 1 && sticks[0]) {
    return { sticks, result: "BACK_DO", distance: -1, bonusThrows: 0 };
  }

  const [result, distance, bonusThrows] = RESULT_TABLE[flatCount];

  return { sticks, result, distance, bonusThrows };
}

function randomWord(random: () => number): string {
  const unit = Math.min(Math.max(random(), 0), 1 - Number.EPSILON);
  return Math.floor(unit * 0x1_0000_0000).toString(36).padStart(7, "0");
}

/** 결과 난수와 별도로 뽑아 모든 참가자가 같은 무작위 연출을 재생하게 한다. */
export function createAnimationSeed(random: () => number = Math.random): string {
  return `${randomWord(random)}-${randomWord(random)}`;
}

/**
 * 던지자마자 한 번 더 던지게 해 주는 결과인가(윷·모).
 * 위 표에서 바로 읽으므로 표를 고치면 이 판단도 함께 따라온다.
 */
export function grantsExtraThrow(result: YutResult): boolean {
  return RESULT_TABLE.some((entry) => entry[0] === result && entry[2] === 1);
}
