import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { FIRST_STEP_NODE_ID, NODE_COORDINATES, SHORTCUT_GATES, START_NODE_ID } from "../../client/boardLayout";
import {
  createBoardScene,
  frameBoardCamera,
  nodeWorldPosition,
  shockwaveAt,
  BOARD_WORLD_SIZE,
  SHOCKWAVE_INNER_RADIUS,
  SHOCKWAVE_MAX_RADIUS,
  SHOCKWAVE_OUTER_RADIUS,
} from "../../client/three/boardScene";
import { PIECE_RADIUS } from "../../client/three/piece";

describe("3D 윷판", () => {
  it("places a node from its percent coordinate", () => {
    // 판 가운데가 원점, x는 오른쪽, z는 화면 아래쪽이다.
    expect(nodeWorldPosition("CENTER")).toEqual({ x: 0, y: 0, z: 0 });

    const start = nodeWorldPosition("O0");
    expect(start.x).toBeCloseTo((92 - 50) / 100 * BOARD_WORLD_SIZE, 10);
    expect(start.z).toBeCloseTo((92 - 50) / 100 * BOARD_WORLD_SIZE, 10);
    expect(start.y).toBe(0);
  });

  it("projects every node exactly onto its percent position on screen", () => {
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    frameBoardCamera(THREE, camera);
    camera.updateMatrixWorld(true);

    Object.entries(NODE_COORDINATES).forEach(([nodeId, percent]) => {
      const world = nodeWorldPosition(nodeId);
      const ndc = new THREE.Vector3(world.x, world.y, world.z).project(camera);
      // 퍼센트 0..100이 화면 -1..1로 그대로 옮겨진다. y는 화면 위가 +1이라 뒤집힌다.
      expect(ndc.x).toBeCloseTo((percent.x - 50) / 50, 10);
      expect(ndc.y).toBeCloseTo(-(percent.y - 50) / 50, 10);
    });
  });

  it("looks straight down so nothing shifts with height", () => {
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    frameBoardCamera(THREE, camera);
    camera.updateMatrixWorld(true);

    // 말이 떠올라도 화면 자리는 그대로여야 한다. 원근이 없으니 높이는 자리를 바꾸지 못한다.
    const onBoard = new THREE.Vector3(1.2, 0, -2.3).project(camera);
    const lifted = new THREE.Vector3(1.2, 2.5, -2.3).project(camera);
    expect(lifted.x).toBeCloseTo(onBoard.x, 10);
    expect(lifted.y).toBeCloseTo(onBoard.y, 10);
  });

  it("builds the board with a layer for pieces and disposable resources", () => {
    const board = createBoardScene(THREE);

    expect(board.scene.children).toContain(board.pieceLayer);
    expect(board.disposables.length).toBeGreaterThan(0);
    board.disposables.forEach((item) => { expect(typeof item.dispose).toBe("function"); });
    // 칸마다 표식이 하나씩 있어야 한다.
    expect(board.nodeCount).toBe(Object.keys(NODE_COORDINATES).length);
  });
});

describe("충격파 고리", () => {
  it("never hides behind the stone standing on the landing node", () => {
    // 수직으로 내려다보면 말은 반지름 PIECE_RADIUS만큼을 통째로 가린다.
    // 고리는 가장 작을 때조차 그 원 바깥에 있어야 처음부터 보인다.
    expect(SHOCKWAVE_INNER_RADIUS).toBeGreaterThan(PIECE_RADIUS);
    expect(shockwaveAt(0).scale * SHOCKWAVE_INNER_RADIUS).toBeGreaterThan(PIECE_RADIUS);
  });

  it("spreads outward from the node to well past it", () => {
    expect(shockwaveAt(0).scale).toBeCloseTo(1, 10);
    expect(shockwaveAt(1).scale * SHOCKWAVE_OUTER_RADIUS).toBeCloseTo(SHOCKWAVE_MAX_RADIUS, 10);
    // 커지기만 한다. 중간에 오므라들면 퍼지는 것으로 읽히지 않는다.
    let previous = 0;
    for (let t = 0; t <= 1; t += 0.05) {
      const scale = shockwaveAt(t).scale;
      expect(scale).toBeGreaterThanOrEqual(previous);
      previous = scale;
    }
  });

  it("stays bright while it is worth looking at and only fades at the end", () => {
    const full = shockwaveAt(0).opacity;
    expect(full).toBeGreaterThan(0.5);
    // 처음부터 흐려지면 다 퍼졌을 때는 이미 보이지 않는다. 절반을 지나도록 또렷해야 한다.
    expect(shockwaveAt(0.5).opacity).toBeCloseTo(full, 10);
    expect(shockwaveAt(0.8).opacity).toBeLessThan(full);
    expect(shockwaveAt(1).opacity).toBeCloseTo(0, 10);
  });

  it("hangs the ring on the board, hidden, with its resources tracked", () => {
    const board = createBoardScene(THREE);

    expect(board.scene.children).toContain(board.shockwave);
    expect(board.shockwave.visible).toBe(false);
    expect(board.disposables).toContain(board.shockwave.geometry);
    expect(board.disposables).toContain(board.shockwave.material);
  });
});

describe("살촉 방향", () => {
  it("aims every arrowhead at its shortcut (or the first step) target", () => {
    const board = createBoardScene(THREE);
    board.scene.updateMatrixWorld(true);

    // addArrows가 만드는 살촉은 시작점 하나와 SHORTCUT_GATES 개수만큼.
    const expected: Array<{ nodeId: string; toward: string }> = [
      { nodeId: START_NODE_ID, toward: FIRST_STEP_NODE_ID },
      ...Object.entries(SHORTCUT_GATES).map(([nodeId, toward]) => ({ nodeId, toward })),
    ];

    // 살촉은 원뿔(ConeGeometry) 메시로만 그려진다. 칸 표식은 원기둥/토러스라 걸러진다.
    const coneMeshes: THREE.Mesh[] = [];
    board.scene.traverse((object) => {
      if (object instanceof THREE.Mesh && object.geometry instanceof THREE.ConeGeometry) {
        coneMeshes.push(object);
      }
    });
    expect(coneMeshes.length).toBe(expected.length);

    expected.forEach(({ nodeId, toward }) => {
      const at = nodeWorldPosition(nodeId);
      const atVec = new THREE.Vector3(at.x, at.y, at.z);

      // 어느 살촉이 이 칸 것인지는 위치로 찾는다: 오프셋이 인접 칸 간격보다 짧으므로
      // "at"에 가장 가까운 원뿔이 바로 그 칸의 살촉이다.
      let closest: THREE.Mesh | undefined;
      let closestDistance = Infinity;
      coneMeshes.forEach((mesh) => {
        const worldPosition = new THREE.Vector3();
        mesh.getWorldPosition(worldPosition);
        const distance = worldPosition.distanceTo(atVec);
        if (distance < closestDistance) {
          closestDistance = distance;
          closest = mesh;
        }
      });
      expect(closest).toBeDefined();

      const target = nodeWorldPosition(toward);
      const wanted = new THREE.Vector3(target.x - at.x, 0, target.z - at.z).normalize();

      // 원뿔은 rotateX(PI/2) 이후 +Z를 향한다. 그 축을 메시의 월드 회전으로 돌린 것이
      // 실제로 살촉이 가리키는 방향이다.
      const quaternion = new THREE.Quaternion();
      closest!.getWorldQuaternion(quaternion);
      const actual = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion).normalize();

      expect(wanted.angleTo(actual)).toBeCloseTo(0, 5);
    });
  });
});
