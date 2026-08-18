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
  liftScaleOf,
  settleMsFor,
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

/** 그 손버릇대로 던졌다면 가락이 가졌을 값. 손버릇 하나하나를 따로 보기 위한 것이다. */
function styleLayoutFor(style: (typeof TOSS_STYLES)[number], index: number, count: number) {
  const middle = (count - 1) / 2;
  const step = style.order === "뒤부터"
    ? count - 1 - index
    : style.order === "바깥부터"
      ? Math.round(middle - Math.abs(index - middle))
      : index;
  return {
    turns: style.minTurns,
    lift: style.lift,
    bounce: style.bounce,
    bounces: style.bounces,
    yawTurns: style.yawTurns,
    wobble: style.wobble,
    pitch: style.pitch,
    drift: style.drift,
    driftZ: style.driftZ,
    delayMs: step * style.staggerMs,
    tossMs: style.tossMs,
  };
}

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

describe("손버릇 하나하나", () => {
  // 어느 손버릇으로 던지든 지켜야 하는 것들. 새 축을 더할 때마다 여기서 걸린다.
  it.each(TOSS_STYLES.map((style) => [style.id, style] as const))(
    "%s은 결과 면으로 정확히 내려앉는다",
    (unusedId, style) => {
      const flags = [true, false, true, false];
      const key = `throw-${style.id}`;
      const layout = layoutFor(key, 4).map((spot, index) => ({
        ...spot,
        ...styleLayoutFor(style, index, 4),
      }));
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

  it.each(TOSS_STYLES.map((style) => [style.id, style] as const))(
    "%s은 눕힌 자세에서 던지기 시작한다",
    (unusedId, style) => {
      // 던지기 직전 화면에는 눕혀 둔 윷이 있다. 첫 칸이 그와 다르면
      // 굴러가기 전에 다른 자세가 한 번 번쩍인다. 세워 던지는 손버릇에서 그랬다.
      const flags = [true, false, true, false];
      const key = `start-${style.id}`;
      const layout = layoutFor(key, 4).map((spot, index) => ({
        ...spot,
        ...styleLayoutFor(style, index, 4),
      }));
      const views = makeViews(4);

      applyToss(views, flags, layout, 0);
      views.forEach((group, index) => {
        expect(group.rotation.z).toBeCloseTo(0, 6);
        expect(group.position.y).toBeCloseTo(restHeight(flags[index]), 6);
      });
    },
  );

  it("멍석 아래로는 어느 손버릇도 파고들지 않는다", () => {
    const flags = [true, false, true, false];
    TOSS_STYLES.forEach((style) => {
      const layout = layoutFor(`throw-${style.id}`, 4).map((spot, index) => ({
        ...spot,
        ...styleLayoutFor(style, index, 4),
      }));
      const views = makeViews(4);
      for (let elapsed = 0; elapsed <= settleMsOf(layout); elapsed += 10) {
        applyToss(views, flags, layout, elapsed);
        views.forEach((group, index) => {
          expect(group.position.y).toBeGreaterThanOrEqual(restHeight(flags[index]) - EPS);
        });
      }
    });
  });

  it("손버릇마다 움직이는 결이 다르다", () => {
    // 값 하나만 다른 손버릇을 여럿 두면 이름만 늘어날 뿐 눈에는 같은 것이 반복된다.
    expect(TOSS_STYLES.length).toBeGreaterThanOrEqual(10);
    const shapes = new Set(
      TOSS_STYLES.map((style) => [
        style.lift > 1 ? "높음" : style.lift > 0.7 ? "보통" : "낮음",
        style.minTurns >= 4 ? "많이구름" : "적게구름",
        style.yawTurns,
        style.pitch > 0 ? "세움" : "눕힘",
        style.driftZ > 0 ? "앞뒤" : "좌우",
        style.bounces,
        style.order,
        style.staggerMs === 0 ? "한꺼번에" : "차례로",
      ].join("/")),
    );
    // 열 가지가 저마다 다른 조합이어야 한다.
    expect(shapes.size).toBe(TOSS_STYLES.length);
  });
});

describe("던지는 힘", () => {
  it("힘껏 던지면 더 높이 뜨고 살살 던지면 낮게 뜬다", () => {
    // 높이는 던지는 사람이 고른다. 세 단계가 눈에 띄게 달라야 고르는 재미가 있다.
    const soft = layoutFor("event-9", 4, "soft");
    const normal = layoutFor("event-9", 4, "normal");
    const hard = layoutFor("event-9", 4, "hard");

    soft.forEach((spot, index) => {
      expect(spot.lift).toBeLessThan(normal[index].lift);
      expect(hard[index].lift).toBeGreaterThan(normal[index].lift);
    });
    // 힘은 높이와 구르는 결만 건드린다. 흩어져 앉는 자리는 그 던지기의 것이라 그대로다.
    soft.forEach((spot, index) => {
      expect(spot.x).toBe(normal[index].x);
      expect(spot.z).toBe(normal[index].z);
      expect(spot.yaw).toBe(normal[index].yaw);
    });
  });

  it("살살 던지면 일찍 내려앉아 바닥을 구르다 멎는다", () => {
    // 낮게 뜬 채 공중에서 빠르게 돌면 붕 떠 보인다. 살살 던진 윷은 먼저 닿고 굴러야 한다.
    const flags = [true, false, true, false];
    const layout = layoutFor("event-roll", 4, "soft");
    const views = makeViews(4);
    const settle = settleMsOf(layout);

    // 절반쯤 지난 뒤에는 이미 멍석에 닿아 있다.
    let rolledFrames = 0;
    let turnedWhileRolling = 0;
    let previousRoll = Number.NaN;
    for (let elapsed = Math.round(settle * 0.7); elapsed <= settle; elapsed += 10) {
      applyToss(views, flags, layout, elapsed);
      const group = views[0];
      // 축은 굴러가는 자세만큼만 떠 있다. 그 이상 뜨면 아직 나는 중이다.
      expect(group.position.y).toBeLessThanOrEqual(RADIUS + 1e-6);
      rolledFrames += 1;
      if (!Number.isNaN(previousRoll) && Math.abs(group.rotation.x - previousRoll) > 1e-4) {
        turnedWhileRolling += 1;
      }
      previousRoll = group.rotation.x;
    }
    expect(rolledFrames).toBeGreaterThan(3);
    // 닿은 뒤에도 한동안 구른다. 닿자마자 굳으면 미끄러지듯 멎어 어색하다.
    expect(turnedWhileRolling).toBeGreaterThan(2);
  });

  it("살살 던지면 공중에서 덜 돈다", () => {
    const soft = layoutFor("event-roll", 4, "soft");
    const hard = layoutFor("event-roll", 4, "hard");
    soft.forEach((spot, index) => {
      expect(spot.turns).toBeLessThanOrEqual(hard[index].turns);
      expect(spot.turns).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(spot.turns)).toBe(true);
    });
    expect(soft.reduce((sum, spot) => sum + spot.turns, 0))
      .toBeLessThan(hard.reduce((sum, spot) => sum + spot.turns, 0));
  });

  it("구르는 자세만큼만 축이 떠 있다", () => {
    // 배가 아래면 낮게, 옆이나 등이 아래면 반지름만큼. 이걸 무시하면 구르다 멍석을 파고든다.
    expect(rollHeight(0)).toBeCloseTo(CUT_DEPTH, 6);
    expect(rollHeight(Math.PI)).toBeCloseTo(RADIUS, 6);
    expect(rollHeight(Math.PI / 2)).toBeCloseTo(RADIUS, 6);
  });

  it("힘껏 던지면 멎는 데 걸리는 시간도 길어진다", () => {
    expect(settleMsFor("event-9", "hard")).toBeGreaterThan(settleMsFor("event-9", "normal"));
    expect(settleMsFor("event-9", "soft")).toBeLessThan(settleMsFor("event-9", "normal"));
  });

  it("힘을 알려 주지 않으면 보통으로 던진다", () => {
    // 시간이 다 되어 서버가 알아서 던질 때는 고른 힘이 없다.
    expect(layoutFor("event-9", 4)).toEqual(layoutFor("event-9", 4, "normal"));
    expect(liftScaleOf("normal")).toBe(1);
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
