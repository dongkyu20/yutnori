import { describe, expect, it } from "vitest";
import {
  impactAt,
  knockAt,
  timelineFor,
  vanishAt,
  walkAt,
  STEP_MS,
  WALK_MAX_MS,
} from "../../client/three/moveAnimation";

describe("이동 연출 시간", () => {
  it("spends one step per node until the walk would drag", () => {
    expect(timelineFor(1, 0).walkMs).toBe(STEP_MS);
    expect(timelineFor(5, 0).walkMs).toBe(5 * STEP_MS);
    // 모가 다섯 칸이라 상한 안에 든다.
    expect(timelineFor(5, 0).walkMs).toBeLessThanOrEqual(WALK_MAX_MS);
  });

  it("never lets a long path drag past the cap", () => {
    [9, 12, 20, 30].forEach((steps) => {
      expect(timelineFor(steps, 0).walkMs).toBeLessThanOrEqual(WALK_MAX_MS);
    });
  });

  it("adds the impact and knock-back only when something was captured", () => {
    const plain = timelineFor(3, 0);
    const capturing = timelineFor(3, 1);

    expect(plain.impactMs).toBe(0);
    expect(plain.knockMs).toBe(0);
    expect(plain.totalMs).toBe(plain.walkMs);
    expect(capturing.impactMs).toBeGreaterThan(0);
    expect(capturing.knockMs).toBeGreaterThan(0);
    expect(capturing.totalMs).toBeGreaterThan(plain.totalMs);
  });

  it("walks from the departure node to the first node and lands on the last", () => {
    const steps = 3;
    const start = walkAt(steps, 0);
    expect(start).toMatchObject({ from: -1, to: 0, t: 0 });
    expect(start.hop).toBeCloseTo(0, 6);

    const end = walkAt(steps, timelineFor(steps, 0).walkMs);
    // 마지막 프레임은 도착 칸에 정확히 앉는다. 권위 있는 자리와 어긋나면 안 된다.
    expect(end).toMatchObject({ from: steps - 1, to: steps - 1, t: 1 });
    expect(end.hop).toBeCloseTo(0, 6);
  });

  it("crosses every node in order without skipping", () => {
    const steps = 5;
    const walkMs = timelineFor(steps, 0).walkMs;
    const seen = new Set<number>();
    for (let elapsed = 0; elapsed <= walkMs; elapsed += 5) {
      const at = walkAt(steps, elapsed);
      seen.add(at.to);
      expect(at.t).toBeGreaterThanOrEqual(0);
      expect(at.t).toBeLessThanOrEqual(1);
      expect(at.hop).toBeGreaterThanOrEqual(0);
      expect(at.to - at.from).toBeLessThanOrEqual(1);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it("hops between nodes and touches down on each one", () => {
    const steps = 2;
    const stepMs = timelineFor(steps, 0).walkMs / steps;
    // 칸에 닿는 순간에는 높이가 0이고, 칸 사이에서 떠오른다.
    expect(walkAt(steps, stepMs).hop).toBeCloseTo(0, 6);
    expect(walkAt(steps, stepMs * 0.5).hop).toBeGreaterThan(0);
  });

  it("rings the shockwave only inside its window", () => {
    const timeline = timelineFor(2, 1);
    expect(impactAt(timeline, timeline.walkMs - 1)).toBe(0);
    expect(impactAt(timeline, timeline.walkMs + timeline.impactMs / 2)).toBeGreaterThan(0);
    expect(impactAt(timeline, timeline.totalMs)).toBe(0);
    expect(impactAt(timelineFor(2, 0), 10)).toBe(0);
  });

  it("gives a finishing piece its own window after the walk", () => {
    const plain = timelineFor(2, 0);
    const finishing = timelineFor(2, 0, true);

    expect(plain.vanishMs).toBe(0);
    expect(finishing.walkMs).toBe(plain.walkMs);
    expect(finishing.vanishMs).toBeGreaterThan(0);
    expect(finishing.totalMs).toBe(finishing.walkMs + finishing.vanishMs);
  });

  it("shrinks the finishing piece away only after it has walked its last node", () => {
    const timeline = timelineFor(2, 0, true);

    // 걷는 동안에는 원래 크기 그대로다.
    expect(vanishAt(timeline, 0)).toBe(1);
    expect(vanishAt(timeline, timeline.walkMs)).toBe(1);
    const mid = vanishAt(timeline, timeline.walkMs + timeline.vanishMs * 0.5);
    expect(mid).toBeLessThan(1);
    expect(mid).toBeGreaterThan(0);
    // 끝에서 정확히 0이 되어 흔적을 남기지 않는다.
    expect(vanishAt(timeline, timeline.totalMs)).toBeCloseTo(0, 6);
    // 참으로 나지 않는 이동은 말이 그대로 서 있어야 한다.
    expect(vanishAt(timelineFor(2, 0), 10_000)).toBe(1);
  });

  it("throws the captured stone up, carries it toward its rack, and shrinks it away", () => {
    const timeline = timelineFor(2, 1);
    const begin = timeline.walkMs;

    expect(knockAt(timeline, begin - 1)).toMatchObject({ t: 0, drift: 0 });
    const mid = knockAt(timeline, begin + timeline.knockMs * 0.4);
    expect(mid.lift).toBeGreaterThan(0);
    expect(mid.scale).toBeLessThan(1);
    expect(mid.scale).toBeGreaterThan(0);
    // 출발자리는 판 아래쪽(DOM 대기 칸)이므로 화면 아래로 밀려 간다.
    expect(mid.drift).toBeGreaterThan(0);

    const done = knockAt(timeline, timeline.totalMs);
    expect(done.t).toBe(1);
    expect(done.scale).toBeCloseTo(0, 6);
    expect(done.drift).toBeGreaterThan(mid.drift);
  });
});
