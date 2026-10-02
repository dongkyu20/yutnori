import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  applyRest,
  applyToss,
  createStickGeometry,
  frameCamera,
  layoutFor,
  restHeight,
  rollHeight,
  settleMsFor,
  settleMsOf,
  restRoll,
  tossStyleFor,
  TOSS_STYLES,
  tossLift,
  CONTENT,
  CUT_DEPTH,
  CUT_HALF_WIDTH,
  FOV,
  LENGTH,
  RADIUS,
} from "../../client/three/yutStick";

const EPS = 1e-6;
const PHYSICS_SEEDS = Array.from({ length: 24 }, (unusedValue, index) => `physics-seed-${index}`);
const AUDIT_SEEDS = Array.from({ length: 80 }, (unusedValue, index) => `audit-${index}`);

/** 조각 하나의 정점을 [x, y, z] 배열로 펼친다. */
function vertices(geometry: THREE.BufferGeometry): Array<[number, number, number]> {
  const position = geometry.getAttribute("position");
  return Array.from({ length: position.count }, (unusedValue, index) => [
    position.getX(index), position.getY(index), position.getZ(index),
  ]);
}

function allVertices(): Array<[number, number, number]> {
  const geometry = createStickGeometry(THREE);
  return [geometry.shell, geometry.face, ...geometry.caps].flatMap(vertices);
}

/** 자세를 적용한 뒤 윷가락 전체 정점을 세계 좌표로 옮긴다. */
function worldPoints(group: THREE.Group, points: Array<[number, number, number]>): THREE.Vector3[] {
  group.updateMatrixWorld(true);
  return points.map(([x, y, z]) => new THREE.Vector3(x, y, z).applyMatrix4(group.matrixWorld));
}

function minimumWorldY(group: THREE.Group, points: Array<[number, number, number]>): number {
  group.updateMatrixWorld(true);
  const point = new THREE.Vector3();
  return points.reduce((minimum, [x, y, z]) => {
    point.set(x, y, z).applyMatrix4(group.matrixWorld);
    return Math.min(minimum, point.y);
  }, Number.POSITIVE_INFINITY);
}

function maximumProjectedExtent(
  group: THREE.Group,
  points: Array<[number, number, number]>,
  camera: THREE.PerspectiveCamera,
): { x: number; y: number; z: number } {
  group.updateMatrixWorld(true);
  const point = new THREE.Vector3();
  return points.reduce((maximum, [x, y, z]) => {
    point.set(x, y, z).applyMatrix4(group.matrixWorld).project(camera);
    return {
      x: Math.max(maximum.x, Math.abs(point.x)),
      y: Math.max(maximum.y, Math.abs(point.y)),
      z: Math.max(maximum.z, point.z),
    };
  }, { x: 0, y: 0, z: Number.NEGATIVE_INFINITY });
}

function makeViews(count: number): THREE.Group[] {
  return Array.from({ length: count }, () => new THREE.Group());
}

describe("윷가락 형상", () => {
  it("lays the length along X and never dips below the sawn face", () => {
    const points = allVertices();

    points.forEach(([x, y]) => {
      expect(Math.abs(x)).toBeLessThanOrEqual(LENGTH / 2 + EPS);
      // 배가 국소 좌표 y = -CUT_DEPTH에 있으므로 그 아래로 내려가는 정점은 없어야 한다.
      expect(y).toBeGreaterThanOrEqual(-CUT_DEPTH - EPS);
    });
    expect(Math.max(...points.map(([x]) => x))).toBeCloseTo(LENGTH / 2, 6);
    expect(Math.min(...points.map(([x]) => x))).toBeCloseTo(-LENGTH / 2, 6);
    // 등은 반지름만큼 부풀고, 두께는 반지름 + 톱질 깊이다.
    expect(Math.max(...points.map(([, y]) => y))).toBeCloseTo(RADIUS, 4);
  });

  it("keeps the bark on the cylinder surface and wider than a half circle", () => {
    const { shell } = createStickGeometry(THREE);
    const points = vertices(shell);

    points.forEach(([, y, z]) => {
      expect(Math.hypot(y, z)).toBeCloseTo(RADIUS, 5);
    });
    // 얕게 잘랐으므로 등이 감는 각은 180도보다 크다.
    const arc = Math.PI + 2 * Math.asin(CUT_DEPTH / RADIUS);
    expect(arc).toBeGreaterThan(Math.PI);
    expect(Math.min(...points.map(([, y]) => y))).toBeCloseTo(-CUT_DEPTH, 5);
    // 등의 가장 두꺼운 자리는 분할 간격만큼만 원주에서 모자란다.
    expect(Math.max(...points.map(([, , z]) => Math.abs(z)))).toBeCloseTo(RADIUS, 4);
  });

  it("closes the sawn face exactly where the bark ends", () => {
    const { face } = createStickGeometry(THREE);
    const points = vertices(face);

    points.forEach(([, y, z]) => {
      expect(y).toBeCloseTo(-CUT_DEPTH, 6);
      expect(Math.abs(z)).toBeCloseTo(CUT_HALF_WIDTH, 6);
    });
    // 배는 지름보다 좁다. 이 폭이 등의 끝선과 맞물린다.
    expect(CUT_HALF_WIDTH).toBeLessThan(RADIUS);
    expect(face.getAttribute("normal").getY(0)).toBeCloseTo(-1, 6);
  });

  it("caps both ends with the sawn circular segment and unit uvs", () => {
    const { caps } = createStickGeometry(THREE);

    caps.forEach((cap, index) => {
      const expectedX = index === 0 ? -LENGTH / 2 : LENGTH / 2;
      vertices(cap).forEach(([x, y, z]) => {
        expect(x).toBeCloseTo(expectedX, 6);
        expect(y).toBeGreaterThanOrEqual(-CUT_DEPTH - EPS);
        expect(Math.hypot(y, z)).toBeLessThanOrEqual(RADIUS + EPS);
      });
      // 마구리 바깥 정점은 원주에 닿는다.
      const radii = vertices(cap).map(([, y, z]) => Math.hypot(y, z));
      expect(Math.max(...radii)).toBeCloseTo(RADIUS, 5);

      const uv = cap.getAttribute("uv");
      for (let vertex = 0; vertex < uv.count; vertex += 1) {
        expect(uv.getX(vertex)).toBeGreaterThanOrEqual(-EPS);
        expect(uv.getX(vertex)).toBeLessThanOrEqual(1 + EPS);
        expect(uv.getY(vertex)).toBeGreaterThanOrEqual(-EPS);
        expect(uv.getY(vertex)).toBeLessThanOrEqual(1 + EPS);
      }
    });
    // 두 마구리는 각자 바깥쪽을 본다.
    expect(caps[0].getAttribute("normal").getX(0)).toBeCloseTo(-1, 6);
    expect(caps[1].getAttribute("normal").getX(0)).toBeCloseTo(1, 6);
  });
});

describe("내려앉은 자세", () => {
  it.each([
    { label: "배가 위", flat: true, faceUp: 1 },
    { label: "등이 위", flat: false, faceUp: -1 },
  ])("rests on the mat with $label", ({ flat, faceUp }) => {
    const points = allVertices();
    const views = makeViews(4);
    const flags = [flat, flat, flat, flat];
    const layout = layoutFor("event-rest", views.length);
    applyRest(views, flags, layout);

    views.forEach((group, index) => {
      const world = worldPoints(group, points);
      // 어느 면으로 눕든 멍석(y = 0)에 정확히 닿고 파고들지 않는다.
      expect(Math.min(...world.map((point) => point.y))).toBeCloseTo(0, 5);
      // 배의 법선이 위(+Y) 또는 아래(-Y)를 정확히 향한다. 흩어짐 회전은 Y축이라 영향이 없다.
      const faceNormal = new THREE.Vector3(0, -1, 0).applyQuaternion(group.quaternion);
      expect(faceNormal.y).toBeCloseTo(faceUp, 6);
      expect(group.position.y).toBeCloseTo(restHeight(flat), 6);
      expect(group.rotation.x).toBeCloseTo(restRoll(flat), 6);
      expect(group.position.z).toBeCloseTo(layout[index].z, 6);
      expect(group.rotation.z).toBe(0);
    });
  });

  it("scatters deterministically per throw and keeps the row order", () => {
    const first = layoutFor("event-7", 4);
    const again = layoutFor("event-7", 4);
    const other = layoutFor("event-8", 4);

    expect(again).toEqual(first);
    expect(other).not.toEqual(first);
    // 흩어져도 네 짝의 앞뒤 순서는 유지되어 결과를 읽기 쉽다.
    first.forEach((spot, index) => {
      if (index === 0) return;
      expect(spot.z).toBeGreaterThan(first[index - 1].z);
    });
    first.forEach((spot) => {
      expect(Number.isInteger(spot.turns)).toBe(true);
      expect(spot.turns).toBeGreaterThanOrEqual(2);
    });
  });
});

describe("서버 시드 물리 궤적", () => {
  it("몇 개의 프리셋 대신 연속적으로 다른 물리 궤적을 만든다", () => {
    const firstSticks = Array.from(
      { length: 80 },
      (unusedValue, index) => layoutFor(`server-seed-${index}`, 4)[0],
    );

    expect(new Set(firstSticks.map((spot) => spot.tossMs)).size).toBeGreaterThan(40);
    expect(new Set(firstSticks.map((spot) => spot.touchdown)).size).toBeGreaterThan(40);
    expect(new Set(firstSticks.map((spot) => spot.bounce)).size).toBeGreaterThan(40);
  });

  it("그 던지기의 연출 길이를 알려 준다", () => {
    // 차례 패널이 이 값으로 결과 글자를 미룬다. 실제 연출보다 짧으면 결과가 미리 새어 나간다.
    const layout = layoutFor("event-toss", 4);
    const settle = settleMsOf(layout);
    layout.forEach((spot) => {
      expect(spot.delayMs + spot.tossMs).toBeLessThanOrEqual(settle);
    });
    expect(settle).toBe(Math.max(...layout.map((spot) => spot.delayMs + spot.tossMs)));
  });
});

describe("무작위 궤적 안전성", () => {
  it.each(PHYSICS_SEEDS)(
    "%s은 결과 면으로 정확히 내려앉는다",
    (seed) => {
      const flags = [true, false, true, false];
      const layout = layoutFor(seed, 4);
      const views = makeViews(4);
      const rested = makeViews(4);

      applyToss(views, flags, layout, settleMsOf(layout));
      applyRest(rested, flags, layout);
      views.forEach((group, index) => {
        expect(group.position.toArray()).toEqual(rested[index].position.toArray());
        expect(group.rotation.toArray()).toEqual(rested[index].rotation.toArray());
      });
    },
  );

  it.each(PHYSICS_SEEDS)(
    "%s은 눕힌 자세에서 던지기 시작한다",
    (seed) => {
      // 던지기 직전 화면에는 눕혀 둔 윷이 있다. 첫 칸이 그와 다르면
      // 굴러가기 전에 다른 자세가 한 번 번쩍인다. 세워 던지는 손버릇에서 그랬다.
      const flags = [true, false, true, false];
      const layout = layoutFor(seed, 4);
      const views = makeViews(4);

      applyToss(views, flags, layout, 0);
      views.forEach((group, index) => {
        expect(group.rotation.z).toBeCloseTo(0, 6);
        expect(group.position.y).toBeCloseTo(restHeight(flags[index]), 6);
      });
    },
  );

  it("무작위 궤적이 멍석 아래로 파고들지 않는다", () => {
    const points = allVertices();
    const flags = [true, false, true, false];
    AUDIT_SEEDS.forEach((seed) => {
      const layout = layoutFor(seed, 4);
      const views = makeViews(4);
      for (let elapsed = 0; elapsed <= settleMsOf(layout); elapsed += 16) {
        applyToss(views, flags, layout, elapsed);
        views.forEach((group) => {
          expect(minimumWorldY(group, points)).toBeGreaterThanOrEqual(-EPS);
        });
      }
    });
  });

  it("모든 무작위 물리값을 화면 안의 안전한 범위로 제한한다", () => {
    const spots = PHYSICS_SEEDS.flatMap((seed) => layoutFor(seed, 4));
    spots.forEach((spot) => {
      expect(spot.delayMs).toBeGreaterThanOrEqual(0);
      // 흩뿌리기는 가락마다 차례로 날리므로 마지막 가락이 0.33초쯤 늦다.
      expect(spot.delayMs).toBeLessThanOrEqual(340);
      expect(spot.tossMs).toBeGreaterThanOrEqual(570);
      expect(spot.tossMs).toBeLessThanOrEqual(1_290);
      // 낮게 굴리기는 낮게 날고 일찍 닿는다.
      expect(spot.lift).toBeGreaterThan(0.25);
      expect(spot.lift).toBeLessThan(1.37);
      expect(spot.touchdown).toBeGreaterThanOrEqual(0.3);
      expect(spot.touchdown).toBeLessThanOrEqual(0.94);
    });
  });
});

describe("굴림 높이", () => {
  it("구르는 자세만큼만 축이 떠 있다", () => {
    // 배가 아래면 낮게, 옆이나 등이 아래면 반지름만큼. 이걸 무시하면 구르다 멍석을 파고든다.
    expect(rollHeight(0)).toBeCloseTo(CUT_DEPTH, 6);
    expect(rollHeight(Math.PI)).toBeCloseTo(RADIUS, 6);
    expect(rollHeight(Math.PI / 2)).toBeCloseTo(RADIUS, 6);
  });

});

describe("던져 굴리기", () => {
  const flags = [true, false, true, false];

  it("starts a whole number of turns away from the landing face", () => {
    const views = makeViews(4);
    const layout = layoutFor("event-toss", views.length);

    expect(applyToss(views, flags, layout, 0)).toBe(true);
    views.forEach((group, index) => {
      const turned = restRoll(flags[index]) - group.rotation.x;
      expect(turned / (Math.PI * 2)).toBeCloseTo(layout[index].turns, 6);
      expect(group.position.y).toBeCloseTo(restHeight(flags[index]), 6);
    });
  });

  it("lifts the sticks off the mat and lands them on the result face", () => {
    const views = makeViews(4);
    const layout = layoutFor("event-toss", views.length);

    // 가락마다 나는 때와 걸리는 시간이 다르므로 저마다의 한가운데에서 살핀다.
    layout.forEach((spot, index) => {
      applyToss(views, flags, layout, spot.delayMs + spot.tossMs * 0.35);
      expect(views[index].position.y).toBeGreaterThan(restHeight(flags[index]) + 0.5);
    });

    const settled = applyToss(views, flags, layout, settleMsOf(layout));
    expect(settled).toBe(false);

    const rested = makeViews(4);
    applyRest(rested, flags, layout);
    views.forEach((group, index) => {
      expect(group.position.toArray()).toEqual(rested[index].position.toArray());
      expect(group.rotation.toArray()).toEqual(rested[index].rotation.toArray());
    });
  });

  it("never pushes a stick through the mat while it flies", () => {
    const views = makeViews(4);
    const layout = layoutFor("event-toss", views.length);

    for (let elapsed = 0; elapsed <= settleMsOf(layout); elapsed += 12) {
      expect(tossLift(elapsed / settleMsOf(layout))).toBeGreaterThanOrEqual(0);
      applyToss(views, flags, layout, elapsed);
      views.forEach((group, index) => {
        expect(group.position.y).toBeGreaterThanOrEqual(restHeight(flags[index]) - EPS);
      });
    }
  });
});

describe("구도", () => {
  it.each([
    { label: "넓은 데스크톱 패널", aspect: 2.6 },
    { label: "좁은 모바일 패널", aspect: 1.1 },
    { label: "정사각 패널", aspect: 1 },
  ])("fits the whole toss area on $label", ({ aspect }) => {
    const camera = new THREE.PerspectiveCamera(FOV, aspect, 0.1, 100);
    frameCamera(THREE, camera, aspect);
    camera.updateMatrixWorld(true);

    let widest = 0;
    // 멍석 바닥부터 윷이 날아오르는 높이까지가 담겨야 한다. 아래쪽은 볼 일이 없다.
    [-1, 1].forEach((signX) => [0, 1].forEach((heightRatio) => [-1, 1].forEach((signZ) => {
      const ndc = new THREE.Vector3(CONTENT.x * signX, CONTENT.y * heightRatio, CONTENT.z * signZ)
        .project(camera);
      expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(ndc.y)).toBeLessThanOrEqual(1);
      expect(ndc.z).toBeLessThanOrEqual(1);
      widest = Math.max(widest, Math.abs(ndc.x), Math.abs(ndc.y));
    })));
    // 화면을 남기지 않고 꽉 채운다. 여백은 4퍼센트 남짓이다.
    expect(widest).toBeGreaterThan(0.9);
    // 멍석을 위에서 내려다본다.
    expect(camera.position.y).toBeGreaterThan(CONTENT.y);
  });

  it.each([
    { label: "넓은 데스크톱 패널", aspect: 2.6 },
    { label: "좁은 모바일 패널", aspect: 1.1 },
    { label: "정사각 패널", aspect: 1 },
  ])("keeps every generated stick vertex visible on $label", ({ aspect }) => {
    const camera = new THREE.PerspectiveCamera(FOV, aspect, 0.1, 100);
    frameCamera(THREE, camera, aspect);
    camera.updateMatrixWorld(true);
    const points = allVertices();
    const flags = [true, false, true, false];

    AUDIT_SEEDS.forEach((seed) => {
      const layout = layoutFor(seed, 4);
      const views = makeViews(4);
      for (let elapsed = 0; elapsed <= settleMsOf(layout); elapsed += 16) {
        applyToss(views, flags, layout, elapsed);
        views.forEach((group) => {
          const extent = maximumProjectedExtent(group, points, camera);
          expect(extent.x).toBeLessThanOrEqual(1 + EPS);
          expect(extent.y).toBeLessThanOrEqual(1 + EPS);
          expect(extent.z).toBeLessThanOrEqual(1 + EPS);
        });
      }
    });
  });
});

describe("던지기 스타일과 극적인 순간", () => {
  const STYLE_SEEDS = Array.from({ length: 240 }, (unusedValue, index) => `style-${index}`);
  const MIXED = [true, false, true, false];
  const YUT = [true, true, true, true];
  const MO = [false, false, false, false];

  it("시드마다 다섯 가지 던지기 스타일이 고루 나온다", () => {
    const seen = new Map<string, number>();
    STYLE_SEEDS.forEach((seed) => {
      const style = tossStyleFor(seed);
      seen.set(style, (seen.get(style) ?? 0) + 1);
    });
    expect([...seen.keys()].sort()).toEqual([...TOSS_STYLES].sort());
    // 어느 하나가 거의 안 나오면 다양하다고 느끼지 못한다.
    seen.forEach((count) => expect(count).toBeGreaterThan(STYLE_SEEDS.length * 0.1));
  });

  it("가끔 한 가락만 끝에 세워져 버티다 쓰러진다", () => {
    const teeters = STYLE_SEEDS.map((seed) => layoutFor(seed, 4, MIXED).filter((spot) => spot.teeterMs > 0).length);
    // 버틸 때는 늘 한 가락뿐이다.
    teeters.forEach((count) => expect(count).toBeLessThanOrEqual(1));
    const share = teeters.filter((count) => count === 1).length / STYLE_SEEDS.length;
    expect(share).toBeGreaterThan(0.1);
    expect(share).toBeLessThan(0.35);
  });

  it("버티는 가락은 내려앉는 순간 곧추서 있고, 다 버틴 뒤에는 결과 면으로 눕는다", () => {
    const seed = STYLE_SEEDS.find((candidate) => layoutFor(candidate, 4, MIXED).some((spot) => spot.teeterMs > 0))!;
    const layout = layoutFor(seed, 4, MIXED);
    const index = layout.findIndex((spot) => spot.teeterMs > 0);
    const spot = layout[index];
    const views = makeViews(4);

    applyToss(views, MIXED, layout, spot.delayMs + spot.durationMs - spot.teeterMs);
    expect(views[index].rotation.z).toBeGreaterThan(1.1);

    expect(applyToss(views, MIXED, layout, settleMsOf(layout))).toBe(false);
    const rested = makeViews(4);
    applyRest(rested, MIXED, layout);
    expect(views[index].rotation.toArray()).toEqual(rested[index].rotation.toArray());
    expect(views[index].position.toArray()).toEqual(rested[index].position.toArray());
  });

  it("윷이나 모가 나오면 내려앉기 직전을 느리게 보여 준다", () => {
    STYLE_SEEDS.slice(0, 40).forEach((seed) => {
      const normal = settleMsOf(layoutFor(seed, 4, MIXED));
      // 나는 시간만 늘어난다. 버티는 시간은 그대로다.
      expect(settleMsOf(layoutFor(seed, 4, YUT))).toBeGreaterThan(normal + 300);
      expect(settleMsOf(layoutFor(seed, 4, MO))).toBeGreaterThan(normal + 300);
    });
    // 결과 글자를 미루는 시간도 결과를 알아야 맞는다.
    expect(settleMsFor("slow-seed", YUT)).toBe(settleMsOf(layoutFor("slow-seed", 4, YUT)));
    expect(settleMsFor("slow-seed", MIXED)).toBe(settleMsOf(layoutFor("slow-seed", 4, MIXED)));
  });

  it.each([
    ["섞인 결과", MIXED],
    ["윷", YUT],
    ["모", MO],
  ])("%s: 어느 스타일이든 결과 면으로 끝나고, 멍석을 뚫지 않고, 화면 밖으로 나가지 않는다", (label, flags) => {
    const points = allVertices();
    const cameras = [2.6, 1.1].map((aspect) => {
      const camera = new THREE.PerspectiveCamera(FOV, aspect, 0.1, 100);
      frameCamera(THREE, camera, aspect);
      camera.updateMatrixWorld(true);
      return camera;
    });
    STYLE_SEEDS.slice(0, 120).forEach((seed) => {
      const layout = layoutFor(seed, 4, flags);
      const views = makeViews(4);
      const settle = settleMsOf(layout);
      for (let elapsed = 0; elapsed <= settle; elapsed += 24) {
        applyToss(views, flags, layout, elapsed);
        views.forEach((group) => {
          expect(minimumWorldY(group, points)).toBeGreaterThanOrEqual(-EPS);
          cameras.forEach((camera) => {
            const extent = maximumProjectedExtent(group, points, camera);
            expect(extent.x).toBeLessThanOrEqual(1 + EPS);
            expect(extent.y).toBeLessThanOrEqual(1 + EPS);
          });
        });
      }
      expect(applyToss(views, flags, layout, settle)).toBe(false);
      const rested = makeViews(4);
      applyRest(rested, flags, layout);
      views.forEach((group, index) => {
        expect(group.position.toArray()).toEqual(rested[index].position.toArray());
        expect(group.rotation.toArray()).toEqual(rested[index].rotation.toArray());
      });
    });
  });
});

