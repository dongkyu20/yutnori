/**
 * 윷가락의 형상·자세·구도 계산. WebGL 없이도 검증할 수 있게 three 모듈을 인수로 받고
 * 렌더러에 손대지 않는다. 재질과 텍스처는 YutSticks 컴포넌트가 맡는다.
 */

type ThreeModule = typeof import("three");
type Group = import("three").Group;

/* 치수: 지름 한가운데보다 얕게 톱질해 등이 반원보다 넓고 배는 좁다. */
export const RADIUS = 0.3;
export const LENGTH = 2.5;
/** 축에서 배(자른 면)까지의 거리. 0이면 정확히 반원기둥이 된다. */
export const CUT_DEPTH = 0.1;
export const CUT_HALF_WIDTH = Math.sqrt(RADIUS * RADIUS - CUT_DEPTH * CUT_DEPTH);
const CUT_ANGLE = Math.asin(CUT_DEPTH / RADIUS);
/** 마구리는 온전한 원이 아니라 톱질로 잘린 활꼴이다. */
const CAP_ARC = Math.PI / 2 + CUT_ANGLE;

export const ROW_GAP = 0.8;
/** 서버 throwYut()은 첫 번째 윷가락만 배로 뒤집혔을 때를 빽도로 센다. */
export const MARKED_INDEX = 0;

/** 윷가락은 네 개다. 하나씩 늦게 떨어지므로 마지막 것이 언제 멎는지가 곧 연출의 끝이다. */
export const STICK_COUNT = 4;
/** 손버릇이 정한 높이에 곱해지는 기준 높이. */
const LIFT = 2.05;
/** 회전한 가락의 어느 꼭짓점도 중심에서 이 거리보다 멀어질 수 없다. */
const STICK_REACH = Math.hypot(LENGTH / 2, RADIUS, RADIUS);
const MAX_LANDING_X = 0.32;
const MAX_LANDING_Z_JITTER = 0.12;
const MAX_DRIFT_X = 1.2;
const MAX_DRIFT_Z = 1;
const MAX_LIFT = 1.18 * 1.16 * LIFT;

/* 멍석을 위에서 내려다보는 시선. */
const VIEW_ELEVATION = 0.74;
const VIEW_YAW = -0.19;
export const FOV = 34;
/**
 * 카메라가 반드시 담아야 하는 자리. x와 z는 멍석 한가운데에서 잰 반너비·반깊이이고,
 * y는 멍석 바닥에서 잰 높이다. 윷가락이 날아오르는 공간까지 넣어야
 * 던진 윷이 화면 위로 빠져나가 그림자만 남지 않는다.
 * 멍석 아래는 볼 일이 없으므로 위로만 담는다.
 */
export const CONTENT = {
  x: MAX_LANDING_X + MAX_DRIFT_X + STICK_REACH + 0.08,
  y: RADIUS + MAX_LIFT + LENGTH / 2 + STICK_REACH + 0.08,
  z: (3 * ROW_GAP) / 2 + MAX_LANDING_Z_JITTER + MAX_DRIFT_Z + STICK_REACH + 0.08,
};

export interface StickLayout {
  x: number;
  z: number;
  yaw: number;
  /** 목표 면에 정확히 내려앉도록 정수 바퀴만 굴린다. */
  turns: number;
  drift: number;
  /** 이 가락이 날기 시작하는 때와 나는 데 걸리는 시간. 가락마다 다르다. */
  delayMs: number;
  tossMs: number;
  /** 뜨는 높이와, 내려앉아 한 번 튀는 높이의 비율. */
  lift: number;
  bounce: number;
  /** 나는 동안 수평으로 도는 바퀴. 정수라야 흩어진 각도에 정확히 앉는다. */
  yawTurns: number;
  /** 날면서 좌우로 흔들리는 폭. */
  wobble: number;
  /** 앞뒤로 밀려 들어오는 폭. 좌우로만 들어오면 어느 손버릇이든 결이 비슷해진다. */
  driftZ: number;
  /** 세워졌다 눕는 정도. 1이면 날 때 곧추섰다가 앉으면서 눕는다. */
  pitch: number;
  /** 앉으면서 튀는 횟수. */
  bounces: number;
  /** 나는 시간 중 멍석에 닿는 지점. 이 뒤로는 굴러가며 멎는다. */
  touchdown: number;
}

function easeOutCubic(value: number): number {
  return 1 - (1 - value) ** 3;
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

/** 배가 위면 둥근 등으로 눕고, 등이 위면 좁은 배로 눕는다. */
export function restHeight(flat: boolean): number {
  return flat ? RADIUS : CUT_DEPTH;
}

/** 굴림은 X축 회전이다. 0이면 등이 위, π면 배가 위다. */
export function restRoll(flat: boolean): number {
  return flat ? Math.PI : 0;
}

/**
 * 굴러가는 동안 축이 멍석에서 떠 있는 높이.
 * 배가 아래면 얕게, 옆이나 등이 아래면 반지름만큼 뜬다.
 * 이걸 무시하고 눕힌 높이로 붙들면 구르는 사이 멍석을 파고든다.
 */
export function rollHeight(roll: number): number {
  const bellyDown = Math.max(0, Math.cos(roll));
  return RADIUS - (RADIUS - CUT_DEPTH) * bellyDown ** 3;
}

/** 크게 한 번 뜬 뒤 짧게 한 번 튀고 멍석에 앉는다. 끝나면 정확히 0으로 닫아 눕힌 높이와 어긋나지 않는다. */
export function tossLift(progress: number, bounce = 0.16, bounces = 1): number {
  const step = clamp01(progress);
  if (step >= 1) return 0;
  if (step < 0.68) return Math.sin((step / 0.68) * Math.PI);
  // 남은 구간을 튀는 횟수만큼 나누고, 뒤로 갈수록 낮게 튀다 0으로 닫는다.
  const tail = ((step - 0.68) / 0.32) * bounces;
  const which = Math.floor(tail);
  return Math.sin((tail - which) * Math.PI) * bounce * (1 - which / bounces);
}

function hash32(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function between(random: () => number, minimum: number, maximum: number): number {
  return minimum + random() * (maximum - minimum);
}

function wholeBetween(random: () => number, minimum: number, maximum: number): number {
  return Math.floor(between(random, minimum, maximum + 1));
}

/**
 * 서버가 보낸 시드로 매 가락의 초기 속도·회전·바운스를 직접 만든다.
 * 몇 개의 동작을 고르는 대신 모든 축을 연속 범위에서 뽑아 매번 다른 궤적이 나온다.
 */
export function layoutFor(
  animationSeed: string,
  count: number,
): StickLayout[] {
  const random = mulberry32(hash32(animationSeed));
  const offset = ((count - 1) * ROW_GAP) / 2;
  const sharedFlightMs = between(random, 700, 1_020);
  const sharedLift = between(random, 0.58, 1.18);

  return Array.from({ length: count }, (unusedValue, index) => {
    return {
      x: between(random, -MAX_LANDING_X, MAX_LANDING_X),
      z: index * ROW_GAP - offset + between(random, -MAX_LANDING_Z_JITTER, MAX_LANDING_Z_JITTER),
      yaw: between(random, -0.28, 0.28),
      // 결과 면에 정확히 닿으려면 앞선 회전 수만 정수여야 한다.
      turns: wholeBetween(random, 2, 6),
      drift: between(random, -MAX_DRIFT_X, MAX_DRIFT_X),
      delayMs: Math.round(between(random, 0, 120)),
      tossMs: Math.round(sharedFlightMs * between(random, 0.88, 1.12)),
      lift: sharedLift * between(random, 0.84, 1.16),
      bounce: between(random, 0.08, 0.34),
      bounces: wholeBetween(random, 1, 3),
      // 일찍 닿은 뒤 남은 시간은 멍석 위에서 굴러 감속한다.
      touchdown: between(random, 0.55, 0.94),
      yawTurns: wholeBetween(random, -2, 2),
      wobble: between(random, 0.08, 0.36),
      driftZ: between(random, -MAX_DRIFT_Z, MAX_DRIFT_Z),
      pitch: between(random, 0, 1),
    };
  });
}

/** 이 던지기의 연출이 끝나는 때. 가장 늦게 멎는 가락에 맞춘다. */
export function settleMsOf(layout: readonly StickLayout[]): number {
  return layout.reduce((latest, spot) => Math.max(latest, spot.delayMs + spot.tossMs), 0);
}

/** 서버 연출 시드만 알면 결과 글자를 언제 내보일지 계산할 수 있다. */
export function settleMsFor(animationSeed: string): number {
  return settleMsOf(layoutFor(animationSeed, STICK_COUNT));
}

export interface StickGeometry {
  /** 둥근 등. 잘린 만큼 반원보다 넓게 감긴다. */
  shell: import("three").BufferGeometry;
  /** 톱으로 자른 배. */
  face: import("three").BufferGeometry;
  /** 양 끝 활꼴 마구리. */
  caps: import("three").BufferGeometry[];
}

/**
 * 길이축을 X로 눕히고 배는 아래(-Y)를 보게 만든다.
 * 세 조각의 경계가 x = -CUT_DEPTH, z = ±CUT_HALF_WIDTH에서 정확히 맞물린다.
 */
export function createStickGeometry(THREE: ThreeModule): StickGeometry {
  const shell = new THREE.CylinderGeometry(
    RADIUS, RADIUS, LENGTH, 44, 1, true, -CUT_ANGLE, Math.PI + CUT_ANGLE * 2,
  ).rotateZ(Math.PI / 2);

  const face = new THREE.PlaneGeometry(CUT_HALF_WIDTH * 2, LENGTH)
    .rotateY(-Math.PI / 2)
    .translate(-CUT_DEPTH, 0, 0)
    .rotateZ(Math.PI / 2);

  const shape = new THREE.Shape().absarc(0, 0, RADIUS, -CAP_ARC, CAP_ARC, false);
  const caps = [1, -1].map((side) => {
    const cap = new THREE.ShapeGeometry(shape, 22);
    // ShapeGeometry는 도형 좌표를 그대로 UV로 쓴다. 마구리 지름에 맞춰 0..1로 접는다.
    const uv = cap.getAttribute("uv");
    for (let index = 0; index < uv.count; index += 1) {
      uv.setXY(index, uv.getX(index) / (RADIUS * 2) + 0.5, uv.getY(index) / (RADIUS * 2) + 0.5);
    }
    uv.needsUpdate = true;
    return cap
      .rotateX((-Math.PI / 2) * side)
      .translate(0, (LENGTH / 2) * side, 0)
      .rotateZ(Math.PI / 2);
  });

  return { shell, face, caps };
}

/**
 * 콘텐츠 상자의 여덟 모서리를 카메라 좌표로 재서 화면에 꼭 맞는 거리를 구한다.
 * 좁은 모바일 패널과 넓은 데스크톱 패널이 같은 구도를 유지한다.
 */
export function frameCamera(
  THREE: ThreeModule,
  camera: import("three").PerspectiveCamera,
  aspect: number,
): void {
  camera.fov = FOV;
  camera.aspect = aspect;

  const direction = new THREE.Vector3(
    Math.sin(VIEW_YAW) * Math.cos(VIEW_ELEVATION),
    Math.sin(VIEW_ELEVATION),
    Math.cos(VIEW_YAW) * Math.cos(VIEW_ELEVATION),
  );
  const target = new THREE.Vector3(0, CONTENT.y * 0.5, 0);
  const right = new THREE.Vector3(0, 1, 0).cross(direction).normalize();
  const up = direction.clone().cross(right).normalize();

  const tanY = Math.tan((FOV * Math.PI) / 360);
  const tanX = tanY * aspect;
  const corner = new THREE.Vector3();
  let distance = 0;
  [-1, 1].forEach((signX) => [0, 1].forEach((heightRatio) => [-1, 1].forEach((signZ) => {
    corner.set(CONTENT.x * signX, CONTENT.y * heightRatio, CONTENT.z * signZ).sub(target);
    const depth = corner.dot(direction);
    distance = Math.max(
      distance,
      depth + Math.abs(corner.dot(right)) / tanX,
      depth + Math.abs(corner.dot(up)) / tanY,
    );
  })));

  camera.position.copy(direction).multiplyScalar(distance * 1.04).add(target);
  camera.lookAt(target);
  camera.near = Math.max(0.1, distance * 0.2);
  camera.far = distance * 3 + 12;
  camera.updateProjectionMatrix();
}

/** 결과 면을 위로 두고 멍석에 눕힌 자세. */
export function applyRest(
  views: readonly Group[],
  flags: readonly boolean[],
  layout: readonly StickLayout[],
): void {
  views.forEach((group, index) => {
    const flat = flags[index] ?? false;
    const spot = layout[index];
    group.position.set(spot.x, restHeight(flat), spot.z);
    group.rotation.set(restRoll(flat), spot.yaw, 0);
  });
}

/**
 * 목표 각도에서 정수 바퀴 앞선 지점부터 굴려 언제나 결과 면으로 멈춘다.
 * 다 내려앉았으면 false를 돌려준다.
 */
export function applyToss(
  views: readonly Group[],
  flags: readonly boolean[],
  layout: readonly StickLayout[],
  elapsed: number,
): boolean {
  let running = false;
  views.forEach((group, index) => {
    const flat = flags[index] ?? false;
    const spot = layout[index];
    const progress = clamp01((elapsed - spot.delayMs) / spot.tossMs);
    const eased = easeOutCubic(progress);
    const left = 1 - eased;
    // 곧추선 각도. 눕힌 자세에서 시작해 날면서 섰다가 앉으면서 다시 눕는다.
    // 처음부터 세워 두면 굴러가기 전에 선 윷이 한 번 번쩍인다.
    // 다 앉은 뒤에는 딱 0이어야 눕힌 자세와 어긋나지 않는다.
    const tilt = progress >= 1 ? 0 : Math.sin(progress * Math.PI) * spot.pitch * (Math.PI / 2);
    const roll = restRoll(flat) - spot.turns * Math.PI * 2 * left;
    // 닿는 시점을 앞당기면 남은 시간은 멍석 위를 구르며 멎는 데 쓰인다.
    const airborne = spot.lift * LIFT * tossLift(progress / spot.touchdown, spot.bounce, spot.bounces);
    group.rotation.set(
      roll,
      // 수평 회전도 정수 바퀴라야 흩어진 각도에 정확히 앉는다.
      spot.yaw + left * (spot.drift * 0.7 + spot.yawTurns * Math.PI * 2),
      tilt + left * Math.sin(progress * Math.PI * 3) * spot.wobble,
    );
    const { x: qx, y: qy, z: qz, w: qw } = group.quaternion;
    // 회전 행렬의 세계 Y행으로 가락의 보수적인 경계 상자를 투영한다.
    // 중심점이 아니라 실제 형상 전체가 멍석 위에 오도록 필요한 높이를 구한다.
    const axisX = 2 * (qx * qy + qw * qz);
    const axisY = 1 - 2 * (qx * qx + qz * qz);
    const axisZ = 2 * (qy * qz - qw * qx);
    const lowestLocalY = -Math.abs(axisX) * (LENGTH / 2)
      + axisY * (axisY >= 0 ? -CUT_DEPTH : RADIUS)
      - Math.abs(axisZ) * RADIUS;
    const clearance = -lowestLocalY;
    // 시작과 끝은 applyRest와 숫자까지 같은 값으로 닫고, 움직이는 동안만
    // 회전한 실제 형상의 여유 높이를 적용한다.
    const centerHeight = progress <= 0 || progress >= 1
      ? restHeight(flat)
      : Math.max(
        clearance,
        rollHeight(roll),
        restHeight(flat) + airborne + Math.sin(tilt) * (LENGTH / 2),
      );
    group.position.set(
      spot.x + left * spot.drift,
      centerHeight,
      spot.z + left * spot.driftZ,
    );
    if (progress < 1) running = true;
  });
  return running;
}
