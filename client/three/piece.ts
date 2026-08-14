/**
 * 판 위의 말. 낮고 둥근 조약돌이며 편 색을 그대로 쓴다.
 * 수직으로 내려다보므로 개수는 형상이 아니라 DOM 글자가 읽는다. 여기서는 두께로만 무게를 준다.
 */
import { SIDE_COLORS } from "../sideColor";
import { BOARD_WORLD_SIZE } from "./boardScene";

type ThreeModule = typeof import("three");

export const PIECE_RADIUS = 0.042 * BOARD_WORLD_SIZE;
const BASE_HEIGHT = PIECE_RADIUS * 0.5;
/** 업힌 말 하나마다 이만큼 두꺼워진다. */
const STACK_STEP = PIECE_RADIUS * 0.28;
const MAX_STACK = 4;

export function pieceHeight(stackSize: number): number {
  const rides = Math.min(Math.max(stackSize, 1), MAX_STACK) - 1;
  return BASE_HEIGHT + rides * STACK_STEP;
}

/**
 * 아래는 납작한 원반, 위는 눌린 반구. 수직으로 보면 둥근 음영과 그림자가 입체감을 만든다.
 */
export function createPieceMesh(
  THREE: ThreeModule,
  slot: number,
  stackSize: number,
): { mesh: import("three").Group; disposables: Array<{ dispose: () => void }> } {
  const colour = SIDE_COLORS[slot] ?? SIDE_COLORS[0];
  const height = pieceHeight(stackSize);
  const disposables: Array<{ dispose: () => void }> = [];

  const side = new THREE.MeshStandardMaterial({ color: colour.deep, roughness: 0.62, metalness: 0.05 });
  const top = new THREE.MeshStandardMaterial({ color: colour.base, roughness: 0.48, metalness: 0.05 });
  disposables.push(side, top);

  const body = new THREE.CylinderGeometry(PIECE_RADIUS, PIECE_RADIUS * 0.92, height, 30);
  // 위쪽 반구를 눌러 조약돌처럼 만든다.
  const dome = new THREE.SphereGeometry(PIECE_RADIUS, 30, 12, 0, Math.PI * 2, 0, Math.PI / 2)
    .scale(1, 0.42, 1);
  disposables.push(body, dome);

  const group = new THREE.Group();
  const bodyMesh = new THREE.Mesh(body, side);
  bodyMesh.position.y = height / 2;
  const domeMesh = new THREE.Mesh(dome, top);
  domeMesh.position.y = height;
  [bodyMesh, domeMesh].forEach((mesh) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  });

  return { mesh: group, disposables };
}

/** 말을 칸 위에 앉힌다. y는 판 위 높이이므로 0보다 커야 한다. */
export function placePieceAt(
  mesh: import("three").Group,
  position: { x: number; y: number; z: number },
): void {
  mesh.position.set(position.x, position.y + 0.05, position.z);
}
