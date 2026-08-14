"use client";

import { useEffect, useRef } from "react";
import type { PublicGameState } from "../../shared/protocol";
import { sideSlotOf } from "../sideColor";
import { createBoardScene, nodeWorldPosition, type BoardScene } from "../three/boardScene";
import { impactAt, knockAt, timelineFor, walkAt } from "../three/moveAnimation";
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
 * `filter`로 모을 말을 고르고, `nodeIdOf`로 그 말이 놓일 칸을 정한다.
 * 잡기 연출은 대기 칸으로 돌아간 말을 도착 칸에 되살려야 하므로 이 둘을 갈아 끼운다.
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

/**
 * 도착 칸에 잠깐 되살린 유령 덩이를 치운다. 정상 종료(`finish`)와 중간에 끊긴 연출의
 * 정리(effect cleanup)가 이 하나만 부르게 해, 치우는 코드가 두 곳에서 따로 늙지 않게 한다.
 */
function disposeGhosts(stage: Stage): void {
  stage.ghosts.forEach((ghost) => {
    stage.board.pieceLayer.remove(ghost.mesh);
    ghost.disposables.forEach((item) => { item.dispose(); });
  });
  stage.ghosts = [];
}

export function BoardStage({ pieces, slots, lastMove, onActive, onAnimating }: BoardStageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<Stage | null>(null);
  const threeRef = useRef<ThreeModule | null>(null);
  const activeRef = useRef(onActive);
  const frameRef = useRef(0);
  const playedRef = useRef<string | null>(null);
  const animatingRef = useRef(onAnimating);
  const lastMoveRef = useRef(lastMove);

  useEffect(() => { activeRef.current = onActive; }, [onActive]);
  useEffect(() => { animatingRef.current = onAnimating; }, [onAnimating]);
  useEffect(() => { lastMoveRef.current = lastMove; }, [lastMove]);

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
      // 재접속하면 스냅숏에 지난 자취가 담겨 온다. 처음 본 것은 재생하지 않는다.
      playedRef.current = lastMoveRef.current?.eventId ?? null;
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

  // 새 자취가 오면 걸어가고, 잡았으면 튕겨낸다. 반드시 말을 놓는 효과 **아래**에 선언한다.
  useEffect(() => {
    const stage = stageRef.current;
    const THREE = threeRef.current;
    if (!stage || !THREE || stage.lost || !lastMove) return;
    if (playedRef.current === lastMove.eventId) return;
    playedRef.current = lastMove.eventId;

    const reduceMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    // 참으로 난 말은 판에 좌표가 없는 FINISH로 끝난다. 밟을 수 있는 칸까지만 걷는다.
    const walkable = lastMove.path.filter((nodeId) => nodeId !== "FINISH");
    if (reduceMotion || walkable.length === 0) return;

    const destinationNodeId = walkable[walkable.length - 1];
    const destination = nodeWorldPosition(destinationNodeId);
    // 걸어갈 덩이는 도착 칸에 이미 서 있는 그 덩이다. 출발 칸으로 되돌려 다시 걸어오게 한다.
    const walker = [...stage.stones.values()].find((stone) =>
      lastMove.pieceIds.some((pieceId) => stone.pieceIds.includes(pieceId)));

    // 잡힌 말은 권위 있는 상태에서 이미 대기 칸으로 돌아가 판에 없다.
    // 튕겨내기를 보여 주려면 도착 칸에 잠깐 되살려야 한다.
    stoneGroups(
      pieces.filter((piece) => lastMove.capturedPieceIds.includes(piece.id)),
      slots,
      () => true,
      () => destinationNodeId,
    ).forEach((group) => {
      const created = createPieceMesh(THREE, group.slot, group.stackSize);
      placePieceAt(created.mesh, destination);
      stage.board.pieceLayer.add(created.mesh);
      stage.ghosts.push({
        ...created,
        pieceIds: [...group.pieceIds],
        stackSize: group.stackSize,
        slot: group.slot,
        nodeId: destinationNodeId,
      });
    });

    const timeline = timelineFor(walkable.length, lastMove.capturedPieceIds.length);
    animatingRef.current([...lastMove.pieceIds, ...lastMove.capturedPieceIds]);

    const ring = stage.ring;
    if (ring) ring.position.set(destination.x, 0.06, destination.z);

    const finish = () => {
      // 권위 있는 자리로 되돌리고, 잠깐 살렸던 말을 치운다.
      if (walker) placePieceAt(walker.mesh, nodeWorldPosition(walker.nodeId));
      if (ring) ring.visible = false;
      disposeGhosts(stage);
      if (!stage.lost) stage.renderer.render(stage.board.scene, stage.board.camera);
      animatingRef.current([]);
    };

    const start = performance.now();
    const step = (now: number) => {
      if (stage.lost) {
        finish();
        return;
      }
      const elapsed = now - start;
      const walk = walkAt(walkable.length, elapsed);
      const fromNodeId = walk.from < 0 ? lastMove.fromNodeId ?? walkable[0] : walkable[walk.from];
      const from = nodeWorldPosition(fromNodeId);
      const to = nodeWorldPosition(walkable[walk.to]);
      if (walker) {
        walker.mesh.position.set(
          from.x + (to.x - from.x) * walk.t,
          0.05 + walk.hop * 0.45,
          from.z + (to.z - from.z) * walk.t,
        );
      }

      const impact = impactAt(timeline, elapsed);
      if (ring) {
        ring.visible = impact > 0;
        ring.scale.setScalar(0.4 + impact * 2.6);
        (ring.material as import("three").MeshBasicMaterial).opacity = 0.75 * (1 - impact);
      }

      const knock = knockAt(timeline, elapsed);
      stage.ghosts.forEach((ghost) => {
        ghost.mesh.position.set(destination.x, 0.05 + knock.lift, destination.z + knock.drift);
        ghost.mesh.scale.setScalar(Math.max(knock.scale, 0.001));
      });

      stage.renderer.render(stage.board.scene, stage.board.camera);
      if (elapsed < timeline.totalMs) {
        frameRef.current = requestAnimationFrame(step);
        return;
      }
      finish();
    };
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(step);

    // 언마운트하거나 다음 자취가 겹쳐 오면 이 자취의 진행을 여기서 끊는다. 정상 종료라면
    // finish()가 이미 유령을 치우고 고리를 꺼 두었으므로 아래는 그저 다시 훑을 뿐 안전하다.
    // 겹쳐 온 다음 자취라면 이 정리가 새 연출의 준비보다 먼저 실행되어, 이전 유령이
    // 새 튕겨내기 프레임에 섞여 들어가는 일이 없다. onAnimating도 함께 비워, 중간에
    // 끊긴 연출의 글자 숨김이 다음 렌더까지 남지 않게 한다.
    return () => {
      cancelAnimationFrame(frameRef.current);
      // 진짜 언마운트라면 무대를 세우는 효과의 정리가 먼저 돌아 stones/ghosts를 이미
      // 한 번 dispose하고 stageRef.current를 null로 비운다(두 효과 모두 여기서
      // 닫히는 클린업 목록에 걸려 있고, React는 훅을 선언한 순서대로 정리를 부른다).
      // 그 시점엔 이 효과가 붙잡은 `stage`가 이미 정리된 뒤이므로, 살아 있는 참조인
      // stageRef로 다시 확인해 두 번 dispose하지 않게 막는다.
      if (!stageRef.current) return;
      disposeGhosts(stage);
      if (ring) ring.visible = false;
      animatingRef.current([]);
    };
  }, [lastMove, pieces, slots]);

  return <canvas className="yut-board__canvas" ref={canvasRef} aria-hidden="true" />;
}
