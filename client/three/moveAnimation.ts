/**
 * 이동과 잡기 연출의 시간 계산. three도 DOM도 쓰지 않는 순수 함수라 Node에서 검증한다.
 * 연출은 표현일 뿐이므로 마지막 프레임은 반드시 권위 있는 자리와 같아야 한다.
 */

/** 칸 하나를 밟는 데 쓰는 시간. */
export const STEP_MS = 110;
/** 경로가 길어도 밟아 가기 전체는 이 시간을 넘지 않는다. */
export const WALK_MAX_MS = 900;
export const IMPACT_MS = 260;
export const KNOCK_MS = 520;
/** 참으로 난 말이 마지막 칸에서 사그라드는 데 쓰는 시간. */
export const VANISH_MS = 320;

export interface MoveTimeline {
  walkMs: number;
  impactMs: number;
  knockMs: number;
  vanishMs: number;
  totalMs: number;
}

export function timelineFor(steps: number, captures: number, finishing = false): MoveTimeline {
  const walked = Math.max(steps, 1);
  // 칸이 많으면 칸당 시간을 줄여 전체를 상한 안에 묶는다.
  const walkMs = Math.min(walked * STEP_MS, WALK_MAX_MS);
  const impactMs = captures > 0 ? IMPACT_MS : 0;
  const knockMs = captures > 0 ? KNOCK_MS : 0;
  // 참으로 나기와 잡기는 같은 이동에서 겹치지 않는다(도착 칸이 판 밖이라 잡을 상대가 없다).
  // 그래도 창은 나란히 두고 가장 긴 것에 맞춘다.
  const vanishMs = finishing ? VANISH_MS : 0;
  return {
    walkMs,
    impactMs,
    knockMs,
    vanishMs,
    totalMs: walkMs + Math.max(impactMs, knockMs, vanishMs),
  };
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

/**
 * 지금 몇 번째 칸과 몇 번째 칸 사이에 있는지. from이 -1이면 떠난 칸이다.
 * hop은 칸 사이에서만 떠오르고 칸에 닿는 순간 0이 된다.
 */
export function walkAt(
  steps: number,
  elapsed: number,
): { from: number; to: number; t: number; hop: number } {
  const walked = Math.max(steps, 1);
  const walkMs = Math.min(walked * STEP_MS, WALK_MAX_MS);
  const stepMs = walkMs / walked;
  const progress = clamp01(elapsed / walkMs) * walked;

  if (progress >= walked) {
    return { from: walked - 1, to: walked - 1, t: 1, hop: 0 };
  }
  const index = Math.floor(progress);
  const t = progress - index;
  return {
    from: index - 1,
    to: index,
    t,
    // 반원 궤적. 양 끝이 정확히 0이라 칸마다 또박또박 닿는다.
    hop: Math.sin(t * Math.PI) * (stepMs / STEP_MS),
  };
}

/** 도착 칸에서 퍼지는 충격파. 창 밖에서는 0이다. */
export function impactAt(timeline: MoveTimeline, elapsed: number): number {
  if (timeline.impactMs === 0) return 0;
  const t = (elapsed - timeline.walkMs) / timeline.impactMs;
  if (t <= 0 || t >= 1) return 0;
  return t;
}

/**
 * 참으로 난 말이 마지막 칸에서 작아져 사라지는 배율. 창 밖에서는 1이라 그대로 서 있다.
 * FINISH 칸은 판에 좌표가 없으므로 밟을 수 있는 마지막 칸이 사라질 자리다.
 */
export function vanishAt(timeline: MoveTimeline, elapsed: number): number {
  if (timeline.vanishMs === 0) return 1;
  return 1 - clamp01((elapsed - timeline.walkMs) / timeline.vanishMs);
}

/** 잡힌 말이 떠올라 자기 출발자리 쪽으로 밀려 가며 작아진다. */
export function knockAt(
  timeline: MoveTimeline,
  elapsed: number,
): { t: number; lift: number; scale: number; drift: number } {
  if (timeline.knockMs === 0) return { t: 0, lift: 0, scale: 1, drift: 0 };
  const t = clamp01((elapsed - timeline.walkMs) / timeline.knockMs);
  return {
    t,
    // 한 번 크게 떴다가 내려온다.
    lift: Math.sin(t * Math.PI) * 2.2,
    // 끝에서 정확히 0이 되어 흔적을 남기지 않는다.
    scale: 1 - t,
    // 출발 대기 칸은 판 아래 DOM에 있다. 화면 아래로 밀려 가며 사라진다.
    drift: t * t * 3.2,
  };
}
