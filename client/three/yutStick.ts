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
  x: LENGTH / 2 + 0.42,
  y: RADIUS + CUT_DEPTH + 1.35,
  z: (3 * ROW_GAP) / 2 + RADIUS + 0.22,
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

/**
 * 던지는 손버릇. 던질 때마다 하나가 걸린다.
 *
 * 자리만 흩어지고 동작이 늘 같으면 백 번을 던져도 한 번 본 것과 다르지 않다.
 * 높이 띄우는 손, 낮게 굴리는 손, 넓게 뿌리는 손이 저마다 달리 보이도록 나눈다.
 */
export interface TossStyle {
  id: "높이" | "구르기" | "흩뿌리기" | "잰걸음" | "엇갈리기"
    | "쏟아붓기" | "세워던지기" | "앞구르기" | "팽이" | "통통";
  /** 한 가락이 나는 시간과, 가락끼리 벌어지는 시차. */
  tossMs: number;
  staggerMs: number;
  lift: number;
  bounce: number;
  /** 굴림 바퀴 수의 범위. */
  minTurns: number;
  turnSpread: number;
  /** 나는 동안 수평으로 도는 바퀴. */
  yawTurns: number;
  /** 옆으로 미끄러져 들어오는 폭. 음수와 양수가 섞이면 서로 엇갈린다. */
  drift: number;
  /** 흔들림과 흩어짐. */
  wobble: number;
  spread: number;
  /** 앞뒤로 밀려 들어오는 폭. */
  driftZ: number;
  /** 곧추섰다 눕는 정도. */
  pitch: number;
  /** 앉으면서 튀는 횟수. */
  bounces: number;
  /** 떨어지는 차례. */
  order: "앞부터" | "뒤부터" | "바깥부터";
}

/**
 * lift와 drift는 기준 높이·기준 폭에 곱하는 배수다. 1 언저리를 벗어나면
 * 윷가락이 화면 밖으로 날아가 그림자만 남는다. 다양함은 높이보다 굴림·시차·흩어짐에서 낸다.
 */
/**
 * 던지는 힘. 던지는 사람이 고르고, 서버가 되돌려 준 값으로 모두가 같은 높이를 본다.
 * 힘은 보기만 바꾼다. 무엇이 나올지에는 아무 영향이 없다.
 */
export type ThrowPower = "soft" | "normal" | "hard";

const POWER_LIFT: Readonly<Record<ThrowPower, number>> = { soft: 0.68, normal: 1, hard: 1.3 };
const POWER_SPAN: Readonly<Record<ThrowPower, number>> = { soft: 0.9, normal: 1, hard: 1.12 };
/** 공중에서 도는 바퀴. 살살 던진 윷이 빠르게 돌면 낮게 뜬 채 붕 떠 보인다. */
const POWER_TURNS: Readonly<Record<ThrowPower, number>> = { soft: 0.5, normal: 1, hard: 1.15 };
/**
 * 나는 시간 중 어디쯤에서 멍석에 닿는지. 1이면 끝까지 날다 앉는다.
 * 살살 던진 윷은 일찍 닿아 남은 시간 동안 바닥을 구르다 멎는다.
 */
const POWER_TOUCHDOWN: Readonly<Record<ThrowPower, number>> = { soft: 0.5, normal: 1, hard: 1 };

/** 그 힘이 높이를 몇 배로 만드는지. */
export function liftScaleOf(power: ThrowPower): number {
  return POWER_LIFT[power];
}

export const TOSS_STYLES: readonly TossStyle[] = Object.freeze([
  // 높이 띄워 천천히 떨어뜨린다. 구르는 바퀴는 적어 한 장 한 장이 또렷하다.
  { id: "높이", tossMs: 980, staggerMs: 70, lift: 1.2, bounce: 0.1, bounces: 1, minTurns: 2, turnSpread: 1, yawTurns: 0, drift: 0.35, driftZ: 0, pitch: 0, wobble: 0.18, spread: 0.22, order: "앞부터" },
  // 낮게 던져 많이 굴린다. 옆에서 밀려 들어와 미끄러지듯 멎는다.
  { id: "구르기", tossMs: 840, staggerMs: 45, lift: 0.55, bounce: 0.3, bounces: 1, minTurns: 4, turnSpread: 2, yawTurns: 0, drift: 1.1, driftZ: 0, pitch: 0, wobble: 0.1, spread: 0.16, order: "앞부터" },
  // 넓게 뿌린다. 수평으로 한 바퀴 돌며 자리도 크게 벌어진다.
  { id: "흩뿌리기", tossMs: 900, staggerMs: 55, lift: 0.95, bounce: 0.16, bounces: 1, minTurns: 3, turnSpread: 2, yawTurns: 1, drift: 0.8, driftZ: 0, pitch: 0, wobble: 0.32, spread: 0.34, order: "바깥부터" },
  // 짧고 빠르게. 낮게 뜨고 두 번 톡톡 튄다.
  { id: "잰걸음", tossMs: 620, staggerMs: 38, lift: 0.7, bounce: 0.34, bounces: 2, minTurns: 3, turnSpread: 1, yawTurns: 0, drift: 0.5, driftZ: 0, pitch: 0, wobble: 0.22, spread: 0.14, order: "뒤부터" },
  // 서로 엇갈려 지나간다. 반대쪽에서 비스듬히 들어와 자리를 바꾸듯 앉는다.
  { id: "엇갈리기", tossMs: 880, staggerMs: 30, lift: 1.0, bounce: 0.14, bounces: 1, minTurns: 3, turnSpread: 2, yawTurns: 1, drift: 0.95, driftZ: 0.6, pitch: 0, wobble: 0.26, spread: 0.2, order: "바깥부터" },
  // 넷이 한꺼번에 떨어진다. 시차가 없어 한 번의 쿵으로 들린다.
  { id: "쏟아붓기", tossMs: 760, staggerMs: 0, lift: 0.85, bounce: 0.22, bounces: 1, minTurns: 3, turnSpread: 1, yawTurns: 0, drift: 0.4, driftZ: 0, pitch: 0, wobble: 0.14, spread: 0.26, order: "앞부터" },
  // 곧추세워 던진다. 서서 날다가 앉으면서 눕는다.
  { id: "세워던지기", tossMs: 900, staggerMs: 50, lift: 0.8, bounce: 0.12, bounces: 1, minTurns: 2, turnSpread: 1, yawTurns: 0, drift: 0.35, driftZ: 0, pitch: 1, wobble: 0.1, spread: 0.2, order: "앞부터" },
  // 앞쪽에서 굴러 들어온다. 좌우가 아니라 앞뒤로 밀려 두 번 튄다.
  { id: "앞구르기", tossMs: 820, staggerMs: 42, lift: 0.7, bounce: 0.24, bounces: 2, minTurns: 4, turnSpread: 1, yawTurns: 0, drift: 0.2, driftZ: 1.2, pitch: 0, wobble: 0.12, spread: 0.18, order: "뒤부터" },
  // 팽이처럼 수평으로 두 바퀴 돌며 내려앉는다.
  { id: "팽이", tossMs: 940, staggerMs: 48, lift: 1.05, bounce: 0.14, bounces: 1, minTurns: 2, turnSpread: 2, yawTurns: 2, drift: 0.5, driftZ: 0.4, pitch: 0, wobble: 0.2, spread: 0.24, order: "바깥부터" },
  // 낮게 던져 세 번 통통 튄다. 멍석을 두드리는 소리가 들릴 것 같은 손이다.
  { id: "통통", tossMs: 700, staggerMs: 34, lift: 0.6, bounce: 0.3, bounces: 3, minTurns: 3, turnSpread: 1, yawTurns: 0, drift: 0.45, driftZ: 0.5, pitch: 0, wobble: 0.28, spread: 0.2, order: "앞부터" },
]);

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

/** 이 던지기에 걸린 손버릇. 같은 던지기는 어느 자리에서 봐도 같은 손버릇으로 굴러간다. */
export function styleFor(throwKey: string): TossStyle {
  // 자리를 흩는 난수와 다른 씨를 쓴다. 같은 난수를 나눠 쓰면 손버릇이 흩어짐에 딸려 간다.
  const random = mulberry32(hash32(`${throwKey}:손버릇`));
  return TOSS_STYLES[Math.floor(random() * TOSS_STYLES.length)] ?? TOSS_STYLES[0];
}

/** 가락이 떨어지는 차례. 앞에서부터, 뒤에서부터, 또는 바깥 두 짝이 먼저. */
function landingOrder(order: TossStyle["order"], index: number, count: number): number {
  if (order === "뒤부터") return count - 1 - index;
  if (order === "바깥부터") {
    const middle = (count - 1) / 2;
    // 가운데에서 먼 것부터 0, 1, 2… 차례를 받는다.
    return Math.round(Math.abs(index - middle) * -1 + middle);
  }
  return index;
}

/** 같은 던지기는 언제 다시 그려도 같은 자리에 흩어지도록 결과 id로 난수를 고정한다. */
export function layoutFor(
  throwKey: string,
  count: number,
  power: ThrowPower = "normal",
): StickLayout[] {
  const random = mulberry32(hash32(throwKey));
  const style = styleFor(throwKey);
  const offset = ((count - 1) * ROW_GAP) / 2;
  return Array.from({ length: count }, (unusedValue, index) => {
    // 엇갈리는 손버릇은 짝수·홀수를 반대쪽에서 밀어 넣어 서로 지나가게 한다.
    const side = style.id === "엇갈리기" ? (index % 2 === 0 ? 1 : -1) : random() - 0.5;
    return {
      x: (random() - 0.5) * style.spread * 2,
      z: index * ROW_GAP - offset + (random() - 0.5) * Math.min(style.spread, 0.3),
      yaw: (random() - 0.5) * (0.17 + style.spread),
      turns: Math.max(
        1,
        Math.round((style.minTurns + Math.floor(random() * (style.turnSpread + 1))) * POWER_TURNS[power]),
      ),
      drift: side * style.drift * (0.6 + random() * 0.8),
      // 힘은 높이와 나는 시간만 건드린다. 흩어지는 자리와 구르는 바퀴는 그 던지기의 것이다.
      delayMs: Math.round(landingOrder(style.order, index, count) * style.staggerMs * POWER_SPAN[power]),
      tossMs: Math.round(style.tossMs * POWER_SPAN[power]),
      lift: style.lift * (0.88 + random() * 0.24) * POWER_LIFT[power],
      bounce: style.bounce,
      bounces: style.bounces,
      touchdown: POWER_TOUCHDOWN[power],
      yawTurns: style.yawTurns,
      wobble: style.wobble,
      driftZ: side * style.driftZ * (0.6 + random() * 0.8),
      pitch: style.pitch,
    };
  });
}

/** 이 던지기의 연출이 끝나는 때. 가장 늦게 멎는 가락에 맞춘다. */
export function settleMsOf(layout: readonly StickLayout[]): number {
  return layout.reduce((latest, spot) => Math.max(latest, spot.delayMs + spot.tossMs), 0);
}

/** 던지기 id와 힘만 알면 연출 길이를 얻는다. 결과 글자를 언제 내보일지 정하는 데 쓴다. */
export function settleMsFor(throwKey: string, power: ThrowPower = "normal"): number {
  return settleMsOf(layoutFor(throwKey, STICK_COUNT, power));
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
    group.position.set(
      spot.x + left * spot.drift,
      // 나는 중에는 뜬 높이를, 닿은 뒤에는 구르는 자세만큼을 따른다.
      // 세워진 만큼도 들어 올린다. 그러지 않으면 아래쪽 끝이 멍석을 파고든다.
      Math.max(rollHeight(roll), restHeight(flat) + airborne + Math.sin(tilt) * (LENGTH / 2)),
      spot.z + left * spot.driftZ,
    );
    if (progress < 1) running = true;
  });
  return running;
}
