import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { SIDE_COLORS } from "../../client/sideColor";
import { nodeWorldPosition } from "../../client/three/boardScene";
import { createPieceMesh, pieceHeight, placePieceAt, PIECE_RADIUS } from "../../client/three/piece";

describe("3D 말", () => {
  it("grows thicker as more pieces ride together", () => {
    // 업힌 묶음은 무게가 보여야 한다. 수직으로 보면 실루엣은 같으므로 두께와 그림자로만 드러난다.
    expect(pieceHeight(2)).toBeGreaterThan(pieceHeight(1));
    expect(pieceHeight(4)).toBeGreaterThan(pieceHeight(2));
    // 판을 뚫고 솟지 않도록 상한이 있다.
    expect(pieceHeight(4)).toBeLessThan(PIECE_RADIUS * 3);
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
