import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  applyRest,
  applyToss,
  createStickGeometry,
  frameCamera,
  layoutFor,
  restHeight,
  settleMsOf,
  styleFor,
  TOSS_STYLES,
  restRoll,
  tossLift,
  CONTENT,
  CUT_DEPTH,
  CUT_HALF_WIDTH,
  FOV,
  LENGTH,
  RADIUS,
} from "../../client/three/yutStick";

const EPS = 1e-6;

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

describe("던지는 손버릇", () => {
  it("던질 때마다 손버릇이 달라지되 같은 던지기는 늘 같다", () => {
    // 자리만 흩어지고 동작이 늘 같으면 백 번을 던져도 한 번 본 것과 같다.
    expect(styleFor("event-7")).toEqual(styleFor("event-7"));
    const picked = new Set(
      Array.from({ length: 120 }, (unusedValue, index) => styleFor("event-" + index).id),
    );
    expect(picked.size).toBeGreaterThan(1);
    // 준비한 손버릇은 모두 언젠가 나와야 한다. 안 나오는 것은 없는 것과 같다.
    expect(picked).toEqual(new Set(TOSS_STYLES.map((style) => style.id)));
  });

  it("손버릇마다 높이와 걸리는 시간이 서로 다르다", () => {
    const lifts = new Set(TOSS_STYLES.map((style) => style.lift));
    const spans = new Set(TOSS_STYLES.map((style) => style.tossMs));
    expect(lifts.size).toBeGreaterThan(1);
    expect(spans.size).toBeGreaterThan(1);
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
});
