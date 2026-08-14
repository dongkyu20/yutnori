import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { NODE_COORDINATES } from "../../client/boardLayout";
import {
  createBoardScene,
  frameBoardCamera,
  nodeWorldPosition,
  BOARD_WORLD_SIZE,
} from "../../client/three/boardScene";

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
