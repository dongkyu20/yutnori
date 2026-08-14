/**
 * 3D 윷판. three를 인수로 받아 렌더러를 만들지 않으므로 Node에서도 검증할 수 있다.
 * 판을 수직으로 내려다보는 정사 투영이라 퍼센트 좌표가 그대로 화면 좌표가 된다.
 */
import {
  BOARD_SEGMENTS,
  CENTER_NODE_ID,
  FIRST_STEP_NODE_ID,
  NODE_COORDINATES,
  SHORTCUT_GATES,
  START_NODE_ID,
} from "../boardLayout";

type ThreeModule = typeof import("three");

/** 판 100%가 차지하는 월드 길이. 값 자체는 취향이고, 비율만 중요하다. */
export const BOARD_WORLD_SIZE = 10;
/** 판 두께. 칸과 말이 그 위에 앉는다. */
const BOARD_THICKNESS = 0.35;
const NODE_RADIUS = 0.062 * BOARD_WORLD_SIZE;
const NODE_HEIGHT = 0.05;
const PATH_WIDTH = 0.022 * BOARD_WORLD_SIZE;

/**
 * 잡기 충격파 고리. 도착 칸에는 잡은 말이 서 있고 수직으로 내려다보므로 말의 반지름
 * (piece.ts의 PIECE_RADIUS = 0.042 * BOARD_WORLD_SIZE) 안쪽은 통째로 가려진다.
 * 그래서 고리는 가장 작을 때의 안쪽 반지름부터 이미 그 원 바깥에 있다.
 */
export const SHOCKWAVE_INNER_RADIUS = 0.05 * BOARD_WORLD_SIZE;
export const SHOCKWAVE_OUTER_RADIUS = 0.065 * BOARD_WORLD_SIZE;
/** 다 퍼진 고리의 바깥 반지름. 칸 표식의 2.5배라 도착 칸을 넉넉히 넘어선다. */
export const SHOCKWAVE_MAX_RADIUS = NODE_RADIUS * 2.5;
/** 고리가 앉는 높이. 길과 칸 표식(길목 고리 포함)보다 위라 판에 파묻히지 않는다. */
const SHOCKWAVE_HEIGHT = 0.16;
const SHOCKWAVE_OPACITY = 0.85;
/** 이 지점을 지나서야 사그라든다. 앞부분을 또렷하게 두어야 퍼지는 것이 읽힌다. */
const SHOCKWAVE_FADE_FROM = 0.6;

/**
 * 퍼진 정도(0..1)를 고리의 배율과 투명도로 옮긴다. three를 쓰지 않으므로 Node에서 검증한다.
 * 고리는 처음부터 말보다 크므로, 예전처럼 첫 프레임부터 흐려지게 두면 다 퍼져 보일 무렵에는
 * 이미 아무것도 남지 않는다. 끝자락에서만 사그라들게 한다.
 */
export function shockwaveAt(spread: number): { scale: number; opacity: number } {
  const t = Math.min(Math.max(spread, 0), 1);
  const radius = SHOCKWAVE_OUTER_RADIUS + (SHOCKWAVE_MAX_RADIUS - SHOCKWAVE_OUTER_RADIUS) * t;
  const fade = t <= SHOCKWAVE_FADE_FROM
    ? 1
    : 1 - (t - SHOCKWAVE_FADE_FROM) / (1 - SHOCKWAVE_FADE_FROM);
  return { scale: radius / SHOCKWAVE_OUTER_RADIUS, opacity: SHOCKWAVE_OPACITY * fade };
}

/** 퍼센트 좌표를 월드로. x는 오른쪽, z는 화면 아래쪽, y는 판 위쪽이다. */
export function nodeWorldPosition(nodeId: string): { x: number; y: number; z: number } {
  const percent = NODE_COORDINATES[nodeId] ?? NODE_COORDINATES[START_NODE_ID];
  return {
    x: ((percent.x - 50) / 100) * BOARD_WORLD_SIZE,
    y: 0,
    z: ((percent.y - 50) / 100) * BOARD_WORLD_SIZE,
  };
}

/**
 * 절두체를 판 크기에 정확히 맞추고 수직으로 내려다본다.
 * up을 -Z로 두어야 판의 z가 화면 아래로 가고 퍼센트 좌표와 방향이 맞는다.
 */
export function frameBoardCamera(THREE: ThreeModule, camera: import("three").OrthographicCamera): void {
  const half = BOARD_WORLD_SIZE / 2;
  camera.left = -half;
  camera.right = half;
  camera.top = half;
  camera.bottom = -half;
  camera.near = 0.1;
  camera.far = BOARD_WORLD_SIZE * 4;
  camera.up.set(0, 0, -1);
  camera.position.set(0, BOARD_WORLD_SIZE, 0);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}

export interface BoardScene {
  scene: import("three").Scene;
  camera: import("three").OrthographicCamera;
  /** 말을 담는 층. Task 5가 여기에 넣는다. */
  pieceLayer: import("three").Group;
  /** 잡을 때만 켜는 충격파 고리. 자리와 배율은 연출이 정하고 크기 비율은 여기가 정한다. */
  shockwave: import("three").Mesh;
  nodeCount: number;
  disposables: Array<{ dispose: () => void }>;
}

/** 길은 판보다 조금 파인 음각 띠로 그린다. */
function addPaths(
  THREE: ThreeModule,
  scene: import("three").Scene,
  disposables: BoardScene["disposables"],
): void {
  const material = new THREE.MeshStandardMaterial({ color: 0x6d5b46, roughness: 0.9 });
  disposables.push(material);
  BOARD_SEGMENTS.forEach((segment) => {
    const from = nodeWorldPosition(segment.from);
    const to = nodeWorldPosition(segment.to);
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    const geometry = new THREE.BoxGeometry(length, 0.02, PATH_WIDTH);
    disposables.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set((from.x + to.x) / 2, 0.012, (from.z + to.z) / 2);
    mesh.rotation.y = -Math.atan2(to.z - from.z, to.x - from.x);
    mesh.receiveShadow = true;
    scene.add(mesh);
  });
}

/** 칸. 출발점은 주홍, 길목과 방은 금색으로 두른다. DOM CSS가 하던 강조를 그대로 옮긴다. */
function addNodes(
  THREE: ThreeModule,
  scene: import("three").Scene,
  disposables: BoardScene["disposables"],
): number {
  const plain = new THREE.MeshStandardMaterial({ color: 0xf4ead3, roughness: 0.78 });
  const start = new THREE.MeshStandardMaterial({ color: 0xc84a35, roughness: 0.6 });
  const gate = new THREE.MeshStandardMaterial({ color: 0xd5a62d, roughness: 0.6 });
  disposables.push(plain, start, gate);

  const disc = new THREE.CylinderGeometry(NODE_RADIUS, NODE_RADIUS * 0.94, NODE_HEIGHT, 28);
  const ring = new THREE.TorusGeometry(NODE_RADIUS * 1.12, NODE_RADIUS * 0.13, 10, 30)
    .rotateX(Math.PI / 2);
  disposables.push(disc, ring);

  const nodeIds = Object.keys(NODE_COORDINATES);
  nodeIds.forEach((nodeId) => {
    const at = nodeWorldPosition(nodeId);
    const isStart = nodeId === START_NODE_ID;
    const isGate = SHORTCUT_GATES[nodeId] !== undefined;
    const body = new THREE.Mesh(disc, isGate && nodeId === CENTER_NODE_ID ? gate : plain);
    body.position.set(at.x, NODE_HEIGHT / 2, at.z);
    body.castShadow = true;
    body.receiveShadow = true;
    scene.add(body);

    if (isStart || isGate) {
      const emphasis = new THREE.Mesh(ring, isStart ? start : gate);
      emphasis.position.set(at.x, NODE_HEIGHT * 0.9, at.z);
      scene.add(emphasis);
    }
  });
  return nodeIds.length;
}

/** 출발점과 길목이 가리키는 방향의 살촉. 판 좌표에서 각을 구한다. */
function addArrows(
  THREE: ThreeModule,
  scene: import("three").Scene,
  disposables: BoardScene["disposables"],
): void {
  const material = new THREE.MeshStandardMaterial({ color: 0xa8811a, roughness: 0.55 });
  const startMaterial = new THREE.MeshStandardMaterial({ color: 0xc84a35, roughness: 0.55 });
  const head = new THREE.ConeGeometry(NODE_RADIUS * 0.42, NODE_RADIUS * 0.72, 3)
    .rotateX(Math.PI / 2);
  disposables.push(material, startMaterial, head);

  const arrows: Array<{ nodeId: string; toward: string; start: boolean }> = [
    { nodeId: START_NODE_ID, toward: FIRST_STEP_NODE_ID, start: true },
    ...Object.entries(SHORTCUT_GATES).map(([nodeId, toward]) => ({ nodeId, toward, start: false })),
  ];

  arrows.forEach(({ nodeId, toward, start }) => {
    const at = nodeWorldPosition(nodeId);
    const target = nodeWorldPosition(toward);
    const angle = Math.atan2(target.z - at.z, target.x - at.x);
    const distance = NODE_RADIUS * 1.75;
    const mesh = new THREE.Mesh(head, start ? startMaterial : material);
    mesh.position.set(at.x + Math.cos(angle) * distance, NODE_HEIGHT, at.z + Math.sin(angle) * distance);
    // head는 rotateX(PI/2) 때문에 로컬 +Z를 바라본다. angle은 +X축 기준으로 잰 각이므로
    // 그대로 -angle을 넣으면 +X를 바라보게 돌아 항상 90도가 어긋난다.
    // +Z가 기준이 되도록 90도(PI/2)를 더 얹어야 목표 방향과 맞는다.
    mesh.rotation.y = Math.PI / 2 - angle;
    scene.add(mesh);
  });
}

/** 잡기 고리는 한 번 만들어 숨겨 둔다. 잡을 때만 켠다. */
function addShockwave(
  THREE: ThreeModule,
  scene: import("three").Scene,
  disposables: BoardScene["disposables"],
): import("three").Mesh {
  const geometry = new THREE.RingGeometry(SHOCKWAVE_INNER_RADIUS, SHOCKWAVE_OUTER_RADIUS, 48)
    .rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffe6a8,
    transparent: true,
    opacity: SHOCKWAVE_OPACITY,
    side: THREE.DoubleSide,
    // 반투명한 겹침일 뿐이므로 깊이를 적지 않는다. 말이 고리 뒤에 숨지 않게 한다.
    depthWrite: false,
  });
  disposables.push(geometry, material);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = SHOCKWAVE_HEIGHT;
  mesh.visible = false;
  scene.add(mesh);
  return mesh;
}

export function createBoardScene(THREE: ThreeModule): BoardScene {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  frameBoardCamera(THREE, camera);

  const disposables: BoardScene["disposables"] = [];

  const boardGeometry = new THREE.BoxGeometry(
    BOARD_WORLD_SIZE * 1.02, BOARD_THICKNESS, BOARD_WORLD_SIZE * 1.02,
  );
  const boardMaterial = new THREE.MeshStandardMaterial({ color: 0xfff9eb, roughness: 0.85 });
  disposables.push(boardGeometry, boardMaterial);
  const board = new THREE.Mesh(boardGeometry, boardMaterial);
  board.position.y = -BOARD_THICKNESS / 2;
  board.receiveShadow = true;
  scene.add(board);

  addPaths(THREE, scene, disposables);
  const nodeCount = addNodes(THREE, scene, disposables);
  addArrows(THREE, scene, disposables);

  scene.add(new THREE.HemisphereLight(0xfff4e2, 0x6a5842, 1.15));
  // 주광만 그림자를 드리운다. 비스듬히 두어 말의 둥근 면이 살게 한다.
  const key = new THREE.DirectionalLight(0xfff1d6, 1.9);
  key.position.set(BOARD_WORLD_SIZE * 0.35, BOARD_WORLD_SIZE * 0.9, -BOARD_WORLD_SIZE * 0.3);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = 3;
  key.shadow.bias = -0.0015;
  const span = BOARD_WORLD_SIZE * 0.75;
  Object.assign(key.shadow.camera, {
    left: -span, right: span, top: span, bottom: -span, near: 0.5, far: BOARD_WORLD_SIZE * 3,
  });
  key.shadow.camera.updateProjectionMatrix();
  scene.add(key);

  const pieceLayer = new THREE.Group();
  scene.add(pieceLayer);
  const shockwave = addShockwave(THREE, scene, disposables);

  return { scene, camera, pieceLayer, shockwave, nodeCount, disposables };
}
