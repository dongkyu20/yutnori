import type { ThrowOutcome } from "./types";

export function throwYut(random: () => number = Math.random): ThrowOutcome {
  const sticks = [random() < 0.5, random() < 0.5, random() < 0.5, random() < 0.5] as ThrowOutcome["sticks"];
  const flatCount = sticks.filter(Boolean).length;

  if (flatCount === 1 && sticks[0]) {
    return { sticks, result: "BACK_DO", distance: -1, bonusThrows: 0 };
  }

  // 배(평평한 면)가 위로 나온 개수가 그대로 칸 수가 되고, 하나도 없으면 모다.
  const table = [
    ["MO", 5, 1],
    ["DO", 1, 0],
    ["GAE", 2, 0],
    ["GEOL", 3, 0],
    ["YUT", 4, 1],
  ] as const;
  const [result, distance, bonusThrows] = table[flatCount];

  return { sticks, result, distance, bonusThrows };
}
