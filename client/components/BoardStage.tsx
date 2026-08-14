"use client";

import { useEffect, useRef } from "react";
import type { PublicGameState } from "../../shared/protocol";
import { sideSlotOf } from "../sideColor";
import { createBoardScene, nodeWorldPosition, type BoardScene } from "../three/boardScene";
import { createPieceMesh, placePieceAt } from "../three/piece";

type ThreeModule = typeof import("three");
type Piece = PublicGameState["pieces"][number];

interface BoardStageProps {
  pieces: readonly Piece[];
  slots: ReadonlyMap<string, number>;
  /** 마지막 이동의 자취. Task 8이 이 값으로 연출을 재생한다. */
  lastMove: PublicGameState["lastMove"];
  /** 무대가 서면 true. 판이 2D 그림을 감추는 신호다. */
  onActive: (active: boolean) => void;
  /** 연출의 시작과 끝에 한 번씩만 부른다. Task 8에서 쓴다. */
  onAnimating: (pieceIds: readonly string[]) => void;
}

/** 판 위에 놓인 말 한 덩이. 잡기 연출을 위해 어떤 말이 담겼는지 기억한다. */
interface Stone {
  mesh: import("three").Group;
  disposables: Array<{ dispose: () => void }>;
  pieceIds: string[];
  stackSize: number;
  slot: number;
  nodeId: string;
}

interface Stage {
  renderer: import("three").WebGLRenderer;
  board: BoardScene;
  /** `칸:편` -> 덩이. 쌓인 수나 색이 바뀌면 지우고 다시 만든다. */
  stones: Map<string, Stone>;
  /** 잡힌 말을 튕겨내는 동안만 사는 덩이. 권위 있는 상태에는 이미 없는 말이다. */
  ghosts: Stone[];
  ring?: import("three").Mesh;
  lost: boolean;
}

/** jsdom과 WebGL 없는 환경에서는 three를 아예 불러오지 않는다. */
function hasWebGL(): boolean {
  return typeof WebGL2RenderingContext !== "undefined"
    || typeof WebGLRenderingContext !== "undefined";
}

interface StoneGroup {
  key: string;
  nodeId: string;
  slot: number;
  stackSize: number;
  pieceIds: string[];
}

/**
 * 말을 `칸:편`으로 모은다. 같은 칸의 같은 편은 업힌 한 덩이다.
 * `onlyBoard`가 false면 잡혀서 대기 칸으로 돌아간 말도 모은다. 튕겨내기 연출에 쓴다.
 */
function stoneGroups(
  pieces: readonly Piece[],
  slots: ReadonlyMap<string, number>,
  filter: (piece: Piece) => boolean,
  nodeIdOf: (piece: Piece) => string | undefined,
): StoneGroup[] {
  const groups = new Map<string, StoneGroup>();
  pieces.forEach((piece) => {
    if (!filter(piece)) return;
    const nodeId = nodeIdOf(piece);
    if (!nodeId) return;
    const controllerId = piece.teamId ?? piece.ownerId;
    const key = `${nodeId}:${controllerId}`;
    const found = groups.get(key);
    if (found) {
      found.pieceIds.push(piece.id);
      found.stackSize = Math.max(found.stackSize + 1, piece.stackSize);
      return;
    }
    groups.set(key, {
      key,
      nodeId,
      slot: sideSlotOf(slots, { teamId: piece.teamId, ownerId: piece.ownerId }) ?? 0,
      stackSize: Math.max(1, piece.stackSize),
      pieceIds: [piece.id],
    });
  });
  return [...groups.values()];
}

/** 판 위에 실제로 서 있는 덩이. */
function boardGroups(pieces: readonly Piece[], slots: ReadonlyMap<string, number>): StoneGroup[] {
  return stoneGroups(
    pieces,
    slots,
    (piece) => piece.status === "BOARD",
    (piece) => piece.nodeId,
  );
}

export function BoardStage({ pieces, slots, onActive }: BoardStageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<Stage | null>(null);
  const threeRef = useRef<ThreeModule | null>(null);
  const activeRef = useRef(onActive);
  const viewRef = useRef({ pieces, slots });

  useEffect(() => { activeRef.current = onActive; }, [onActive]);
  useEffect(() => { viewRef.current = { pieces, slots }; }, [pieces, slots]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !hasWebGL()) return;

    let disposed = false;
    let observer: ResizeObserver | null = null;
    const onContextLost = (event: Event) => {
      event.preventDefault();
      const stage = stageRef.current;
      if (stage) stage.lost = true;
      activeRef.current(false);
    };
    canvas.addEventListener("webglcontextlost", onContextLost);

    void import("three").then((THREE) => {
      if (disposed) return;
      let renderer: import("three").WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      } catch {
        return;
      }
      renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.12;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      const stage: Stage = {
        renderer,
        board: createBoardScene(THREE),
        stones: new Map(),
        ghosts: [],
        lost: false,
      };
      threeRef.current = THREE;
      stageRef.current = stage;

      // 충격파 고리는 한 번 만들어 숨겨 둔다. 잡을 때만 켠다.
      const ringGeometry = new THREE.RingGeometry(0.1, 0.16, 40).rotateX(-Math.PI / 2);
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: 0xffe6a8, transparent: true, opacity: 0.75, side: THREE.DoubleSide,
      });
      stage.board.disposables.push(ringGeometry, ringMaterial);
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.visible = false;
      stage.board.scene.add(ring);
      stage.ring = ring;

      const resize = () => {
        const size = Math.min(canvas.clientWidth, canvas.clientHeight);
        if (size === 0 || stage.lost) return;
        renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
        // 판이 정사각이라 절두체도 정사각이다. 캔버스도 정사각으로 맞춘다.
        renderer.setSize(size, size, false);
        renderer.render(stage.board.scene, stage.board.camera);
      };
      resize();
      observer = new ResizeObserver(resize);
      observer.observe(canvas);
      activeRef.current(true);
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      const stage = stageRef.current;
      if (stage) {
        [...stage.stones.values(), ...stage.ghosts].forEach((stone) => {
          stone.disposables.forEach((item) => { item.dispose(); });
        });
        stage.board.disposables.forEach((item) => { item.dispose(); });
        stage.renderer.dispose();
        stageRef.current = null;
      }
      activeRef.current(false);
    };
  }, []);

  // 판 위의 말이 바뀌면 덩이를 다시 놓는다. 이 효과가 연출 효과보다 먼저 선언되어야
  // 연출이 시작될 때 도착 칸의 덩이가 이미 서 있다.
  useEffect(() => {
    const stage = stageRef.current;
    const THREE = threeRef.current;
    if (!stage || !THREE || stage.lost) return;

    const wanted = new Map(boardGroups(pieces, slots).map((group) => [group.key, group]));

    stage.stones.forEach((stone, key) => {
      const group = wanted.get(key);
      // 쌓인 수나 색이 달라지면 두께가 달라지므로 다시 만든다.
      if (group && group.stackSize === stone.stackSize && group.slot === stone.slot) return;
      stage.board.pieceLayer.remove(stone.mesh);
      stone.disposables.forEach((item) => { item.dispose(); });
      stage.stones.delete(key);
    });

    wanted.forEach((group, key) => {
      const existing = stage.stones.get(key);
      if (existing) {
        existing.pieceIds = [...group.pieceIds];
        placePieceAt(existing.mesh, nodeWorldPosition(group.nodeId));
        return;
      }
      const created = createPieceMesh(THREE, group.slot, group.stackSize);
      placePieceAt(created.mesh, nodeWorldPosition(group.nodeId));
      stage.board.pieceLayer.add(created.mesh);
      stage.stones.set(key, {
        ...created,
        pieceIds: [...group.pieceIds],
        stackSize: group.stackSize,
        slot: group.slot,
        nodeId: group.nodeId,
      });
    });

    stage.renderer.render(stage.board.scene, stage.board.camera);
  }, [pieces, slots]);

  return <canvas className="yut-board__canvas" ref={canvasRef} aria-hidden="true" />;
}
