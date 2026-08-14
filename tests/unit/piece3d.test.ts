import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { SIDE_COLORS } from "../../client/sideColor";
import { nodeWorldPosition } from "../../client/three/boardScene";
import { createPieceMesh, placePieceAt, PIECE_RADIUS } from "../../client/three/piece";

describe("3D 말", () => {
  const spanOf = (stone: { mesh: THREE.Object3D }) => {
    const box = new THREE.Box3().setFromObject(stone.mesh);
    return { x: box.max.x - box.min.x, y: box.max.y - box.min.y, z: box.max.z - box.min.z };
  };

  it("spreads a stack across the board rather than piling it upwards", () => {
    // 수직으로 내려다보는 판에서는 높이가 화면 자리를 바꾸지 못한다.
    // 그래서 업힌 말은 위로 쌓지 말고 판을 따라 어긋나게 놓아야 겹쳐 보인다.
    const single = spanOf(createPieceMesh(THREE, 0, 1));
    const pair = spanOf(createPieceMesh(THREE, 0, 2));
    const four = spanOf(createPieceMesh(THREE, 0, 4));

    expect(pair.x).toBeGreaterThan(single.x);
    expect(four.x).toBeGreaterThan(pair.x);
    // 옆으로 벌어지는 폭이 높이 변화보다 훨씬 커야 위에서 보인다.
    expect(four.x - single.x).toBeGreaterThan(four.y - single.y);
  });

  it("keeps a stack from sprawling past the square it stands on", () => {
    const four = spanOf(createPieceMesh(THREE, 0, 4));

    // 한 칸을 넘어서면 옆 칸의 말과 헷갈린다.
    expect(four.x).toBeLessThan(PIECE_RADIUS * 4);
    expect(four.z).toBeLessThan(PIECE_RADIUS * 4);
  });

  it("draws one stone per rider, up to the four a player owns", () => {
    const stones = (stackSize: number) => {
      let count = 0;
      createPieceMesh(THREE, 0, stackSize).mesh.traverse((child) => {
        if (child instanceof THREE.Mesh && child.geometry.type === "SphereGeometry") count += 1;
      });
      return count;
    };

    expect(stones(1)).toBe(1);
    expect(stones(3)).toBe(3);
    expect(stones(4)).toBe(4);
    // 규칙상 한 편의 말은 넷뿐이므로 그보다 많이 그리지 않는다.
    expect(stones(9)).toBe(4);
  });

  it("paints the stone with its own side colour", () => {
    const stone = createPieceMesh(THREE, 1, 1);
    const materials = stone.mesh.children
      .filter((child): child is THREE.Mesh => child instanceof THREE.Mesh)
      .map((child) => child.material as THREE.MeshStandardMaterial);

    expect(materials.length).toBeGreaterThan(0);
    expect(materials.some((material) => material.color.getHex() === SIDE_COLORS[1].base)).toBe(true);
    stone.disposables.forEach((item) => { item.dispose(); });
  });

  it("casts a shadow and sits on top of the board", () => {
    const stone = createPieceMesh(THREE, 0, 1);
    stone.mesh.children.forEach((child) => { expect(child.castShadow).toBe(true); });

    placePieceAt(stone.mesh, nodeWorldPosition("O3"));
    const at = nodeWorldPosition("O3");
    expect(stone.mesh.position.x).toBeCloseTo(at.x, 10);
    expect(stone.mesh.position.z).toBeCloseTo(at.z, 10);
    expect(stone.mesh.position.y).toBeGreaterThan(0);
  });

  it("keeps every slot paintable", () => {
    SIDE_COLORS.forEach((unusedColour, slot) => {
      const stone = createPieceMesh(THREE, slot, 1);
      expect(stone.mesh.children.length).toBeGreaterThan(0);
      stone.disposables.forEach((item) => { item.dispose(); });
    });
  });
});
