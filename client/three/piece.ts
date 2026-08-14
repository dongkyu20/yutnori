/**
 * 판 위의 말. 낮고 둥근 조약돌이며 편 색을 그대로 쓴다.
 * 업힌 묶음은 말 하나하나를 판을 따라 어긋나게 놓아 겹쳐 보이게 한다.
 * 수직으로 내려다보는 판에서는 높이가 화면 자리를 바꾸지 못하므로 위로 쌓아서는 셀 수 없다.
 */
import { SIDE_COLORS } from "../sideColor";
import { BOARD_WORLD_SIZE } from "./boardScene";

type ThreeModule = typeof import("three");

export const PIECE_RADIUS = 0.042 * BOARD_WORLD_SIZE;
const STONE_HEIGHT = PIECE_RADIUS * 0.5;
/**
 * 업힌 말 하나마다 판을 따라 밀어 놓는 거리(반지름 대비).
 * 수가 적을수록 더 벌린다. 둘뿐인데 바짝 붙이면 겹친 게 아니라 길쭉한 돌 하나로 보인다.
 * 대신 수가 많아지면 좁혀서, 묶음이 차지하는 폭은 어느 경우든 한 칸 안에 든다.
 */
const STACK_SPREAD: Readonly<Record<number, number>> = { 1: 0, 2: 0.88, 3: 0.7, 4: 0.58 };
/** 뒤에 놓이는 말일수록 아주 조금 높아 앞의 말을 가린다. 겹치는 순서를 눈에 보이게 한다. */
const STACK_RISE = PIECE_RADIUS * 0.2;
/** 한 편이 가진 말은 넷뿐이다. */
const MAX_STACK = 4;
/** 어긋나는 방향. 화면에서 왼쪽 위로 쌓여 올라가 보인다. */
const SPREAD_X = -0.72;
const SPREAD_Z = -0.7;

function stoneCount(stackSize: number): number {
  return Math.min(Math.max(Math.round(stackSize), 1), MAX_STACK);
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
  const riders = stoneCount(stackSize);
  const disposables: Array<{ dispose: () => void }> = [];

  const side = new THREE.MeshStandardMaterial({ color: colour.deep, roughness: 0.62, metalness: 0.05 });
  const top = new THREE.MeshStandardMaterial({ color: colour.base, roughness: 0.48, metalness: 0.05 });
  disposables.push(side, top);

  const body = new THREE.CylinderGeometry(PIECE_RADIUS, PIECE_RADIUS * 0.92, STONE_HEIGHT, 30);
  // 위쪽 반구를 눌러 조약돌처럼 만든다.
  const dome = new THREE.SphereGeometry(PIECE_RADIUS, 30, 12, 0, Math.PI * 2, 0, Math.PI / 2)
    .scale(1, 0.42, 1);
  disposables.push(body, dome);

  const group = new THREE.Group();
  // 묶음의 한가운데가 칸 위에 오도록 어긋난 만큼의 절반을 되돌려 놓는다.
  const centre = (riders - 1) / 2;
  const spread = PIECE_RADIUS * (STACK_SPREAD[riders] ?? STACK_SPREAD[MAX_STACK]);
  for (let rider = 0; rider < riders; rider += 1) {
    const offsetX = (rider - centre) * spread * SPREAD_X;
    const offsetZ = (rider - centre) * spread * SPREAD_Z;
    const lift = rider * STACK_RISE;

    const bodyMesh = new THREE.Mesh(body, side);
    bodyMesh.position.set(offsetX, lift + STONE_HEIGHT / 2, offsetZ);
    const domeMesh = new THREE.Mesh(dome, top);
    domeMesh.position.set(offsetX, lift + STONE_HEIGHT, offsetZ);
    [bodyMesh, domeMesh].forEach((mesh) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    });
  }

  return { mesh: group, disposables };
}

/** 말을 칸 위에 앉힌다. y는 판 위 높이이므로 0보다 커야 한다. */
export function placePieceAt(
  mesh: import("three").Group,
  position: { x: number; y: number; z: number },
): void {
  mesh.position.set(position.x, position.y + 0.05, position.z);
}
