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

export const TOSS_MS = 780;
export const STAGGER_MS = 55;
const LIFT = 2.05;

/* 멍석을 위에서 내려다보는 시선. */
const VIEW_ELEVATION = 0.74;
const VIEW_YAW = -0.19;
export const FOV = 34;
/** 카메라가 반드시 담아야 하는 상자의 반너비·반높이·반깊이. */
export const CONTENT = {
  x: LENGTH / 2 + 0.42,
  y: RADIUS + CUT_DEPTH,
  z: (3 * ROW_GAP) / 2 + RADIUS + 0.22,
};

export interface StickLayout {
  x: number;
  z: number;
  yaw: number;
  /** 목표 면에 정확히 내려앉도록 정수 바퀴만 굴린다. */
  turns: number;
  drift: number;
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

/** 크게 한 번 뜬 뒤 짧게 한 번 튀고 멍석에 앉는다. 끝나면 정확히 0으로 닫아 눕힌 높이와 어긋나지 않는다. */
export function tossLift(progress: number): number {
  const step = clamp01(progress);
  if (step >= 1) return 0;
  if (step < 0.68) return Math.sin((step / 0.68) * Math.PI);
  return Math.sin(((step - 0.68) / 0.32) * Math.PI) * 0.16;
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

/** 같은 던지기는 언제 다시 그려도 같은 자리에 흩어지도록 결과 id로 난수를 고정한다. */
export function layoutFor(throwKey: string, count: number): StickLayout[] {
  const random = mulberry32(hash32(throwKey));
  const offset = ((count - 1) * ROW_GAP) / 2;
  return Array.from({ length: count }, (unusedValue, index) => ({
    x: (random() - 0.5) * 0.32,
    z: index * ROW_GAP - offset + (random() - 0.5) * 0.1,
    yaw: (random() - 0.5) * 0.17,
    turns: 2 + Math.floor(random() * 2),
    drift: (random() - 0.5) * 1.15,
  }));
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
  [-1, 1].forEach((signX) => [-1, 1].forEach((signY) => [-1, 1].forEach((signZ) => {
    corner.set(CONTENT.x * signX, CONTENT.y * signY, CONTENT.z * signZ).sub(target);
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
    const progress = clamp01((elapsed - index * STAGGER_MS) / TOSS_MS);
    const eased = easeOutCubic(progress);
    const left = 1 - eased;
    group.rotation.set(
      restRoll(flat) - spot.turns * Math.PI * 2 * left,
      spot.yaw + left * spot.drift * 0.7,
      left * Math.sin(progress * Math.PI * 3) * 0.28,
    );
    group.position.set(
      spot.x + left * spot.drift,
      restHeight(flat) + LIFT * tossLift(progress),
      spot.z,
    );
    if (progress < 1) running = true;
  });
  return running;
}
