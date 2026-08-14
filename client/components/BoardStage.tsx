"use client";

import { useEffect, useRef } from "react";
import type { PublicGameState } from "../../shared/protocol";
import {
  createBoardScene,
  nodeWorldPosition,
  shockwaveAt,
  type BoardScene,
} from "../three/boardScene";
import { impactAt, knockAt, timelineFor, vanishAt, walkAt } from "../three/moveAnimation";
import { createPieceMesh, placePieceAt } from "../three/piece";
import { boardGroups, stoneGroups, type StoneGroup } from "../three/stoneGroups";

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
  /** 지금 걷고 있는 덩이. 연출 중에는 이 덩이만 자리를 연출이 정한다. */
  walking: Stone | null;
  lost: boolean;
}

/** jsdom과 WebGL 없는 환경에서는 three를 아예 불러오지 않는다. */
function hasWebGL(): boolean {
  return typeof WebGL2RenderingContext !== "undefined"
    || typeof WebGLRenderingContext !== "undefined";
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
  /**
   * 연출이 읽을 말 목록. **지우지 말 것.** 연출 효과는 자취의 eventId 하나에만 매달려야
   * 하므로(그 효과의 deps 주석 참고) pieces/slots를 직접 읽을 수 없다. 읽는 곳이 한
   * 군데뿐이라 죽은 코드처럼 보이지만, 이 참조가 없으면 연출이 스냅숏마다 끊긴다.
   */
  const viewRef = useRef({ pieces, slots });

  useEffect(() => { activeRef.current = onActive; }, [onActive]);
  useEffect(() => { animatingRef.current = onAnimating; }, [onAnimating]);
  useEffect(() => { lastMoveRef.current = lastMove; }, [lastMove]);
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
        walking: null,
        lost: false,
      };
      threeRef.current = THREE;
      stageRef.current = stage;

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
      // 걷던 덩이를 지웠다면 연출이 붙잡은 손을 놓아 준다. 치운 메시를 나중에 다시
      // 앉히려 들지 않게 한다.
      if (stage.walking === stone) stage.walking = null;
    });

    wanted.forEach((group, key) => {
      const existing = stage.stones.get(key);
      if (existing) {
        existing.pieceIds = [...group.pieceIds];
        // 걷는 중인 덩이는 건드리지 않는다. 연출과 무관한 스냅숏이 와도 걸음이 한 프레임
        // 도착 칸으로 튀지 않는다. 연출이 끝나면 연출 스스로 권위 있는 자리에 앉힌다.
        if (existing !== stage.walking) placePieceAt(existing.mesh, nodeWorldPosition(group.nodeId));
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
    // 자취와 말 목록은 ref로 읽는다. deps 주석 참고.
    const move = lastMoveRef.current;
    const view = viewRef.current;
    if (!stage || !THREE || stage.lost || !move) return;
    if (playedRef.current === move.eventId) return;
    playedRef.current = move.eventId;

    const reduceMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    // 참으로 난 말은 판에 좌표가 없는 FINISH로 끝난다. 밟을 수 있는 칸까지만 걷는다.
    const finishing = move.path[move.path.length - 1] === "FINISH";
    const walkable = move.path.filter((nodeId) => nodeId !== "FINISH");
    // 한 걸음으로 참으로 나면(path가 ["FINISH"]) 밟을 칸이 하나도 없다. 그때는 떠난 칸이
    // 마지막 자리다. 이 목록이 비면 걸을 곳도, 사라질 자리도 없으므로 연출하지 않는다.
    const trail = walkable.length > 0
      ? walkable
      : (finishing && move.fromNodeId ? [move.fromNodeId] : []);
    if (reduceMotion || trail.length === 0) return;

    const destinationNodeId = trail[trail.length - 1];
    const destination = nodeWorldPosition(destinationNodeId);
    // 출발 대기에서 나온 말은 떠난 칸이 없다. 그때는 첫 칸에서 걸음을 시작한다.
    const departureNodeId = move.fromNodeId ?? trail[0];
    // 걸어갈 덩이는 도착 칸에 이미 서 있는 그 덩이다. 출발 칸으로 되돌려 다시 걸어오게 한다.
    const stone = [...stage.stones.values()].find((s) =>
      move.pieceIds.some((pieceId) => s.pieceIds.includes(pieceId)));
    // 권위 있는 자리로 되돌릴 것은 판 위의 덩이뿐이다. 유령은 치우면 그만이다.
    stage.walking = stone ?? null;

    /** 판에 없는 말을 잠깐 되살린다. 유령은 stage.ghosts 하나로만 관리한다. */
    const spawnGhost = (group: StoneGroup, nodeId: string): Stone => {
      const created = createPieceMesh(THREE, group.slot, group.stackSize);
      placePieceAt(created.mesh, nodeWorldPosition(nodeId));
      stage.board.pieceLayer.add(created.mesh);
      const ghost: Stone = {
        ...created,
        pieceIds: [...group.pieceIds],
        stackSize: group.stackSize,
        slot: group.slot,
        nodeId,
      };
      stage.ghosts.push(ghost);
      return ghost;
    };

    // 참으로 난 말은 같은 스냅숏에서 이미 FINISHED라 판에서 내려갔다. 잡힌 말과 똑같은
    // 함정이므로 똑같이 유령으로 푼다. 걷고 나서 마지막 칸에서 사그라든다.
    const walker = stone ?? (finishing
      ? stoneGroups(
        view.pieces.filter((piece) => move.pieceIds.includes(piece.id)),
        view.slots,
        () => true,
        () => departureNodeId,
      ).map((group) => spawnGhost(group, departureNodeId))[0]
      : undefined);

    // 잡힌 말은 권위 있는 상태에서 이미 대기 칸으로 돌아가 판에 없다.
    // 튕겨내기를 보여 주려면 도착 칸에 잠깐 되살려야 한다.
    // 걷는 유령과 움직임이 다르므로 따로 붙잡아 둔다(치우는 것은 stage.ghosts가 함께 한다).
    const knocked = stoneGroups(
      view.pieces.filter((piece) => move.capturedPieceIds.includes(piece.id)),
      view.slots,
      () => true,
      () => destinationNodeId,
    ).map((group) => spawnGhost(group, destinationNodeId));

    const timeline = timelineFor(trail.length, move.capturedPieceIds.length, finishing);
    animatingRef.current([...move.pieceIds, ...move.capturedPieceIds]);

    // 고리의 높이는 판이 정한다. 연출은 어느 칸에서 퍼질지만 정한다.
    const ring = stage.board.shockwave;
    ring.position.x = destination.x;
    ring.position.z = destination.z;

    /**
     * 연출이 어떻게 끝나든(다 재생, 겹쳐 온 자취, 언마운트, 컨텍스트 상실) 반드시 지나는 곳.
     * 걷던 덩이를 권위 있는 자리에 앉히고, 잠깐 살렸던 유령을 치운다. 두 번 불러도 안전하다.
     */
    const settle = () => {
      if (stage.walking) placePieceAt(stage.walking.mesh, nodeWorldPosition(stage.walking.nodeId));
      stage.walking = null;
      ring.visible = false;
      disposeGhosts(stage);
    };

    const finish = () => {
      settle();
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
      const walk = walkAt(trail.length, elapsed);
      const fromNodeId = walk.from < 0 ? departureNodeId : trail[walk.from];
      const from = nodeWorldPosition(fromNodeId);
      const to = nodeWorldPosition(trail[walk.to]);
      if (walker) {
        walker.mesh.position.set(
          from.x + (to.x - from.x) * walk.t,
          0.05 + walk.hop * 0.45,
          from.z + (to.z - from.z) * walk.t,
        );
        // 참으로 난 말은 마지막 칸에 닿은 뒤 그 자리에서 작아져 사라진다.
        if (finishing) walker.mesh.scale.setScalar(Math.max(vanishAt(timeline, elapsed), 0.001));
      }

      const impact = impactAt(timeline, elapsed);
      ring.visible = impact > 0;
      if (ring.visible) {
        const wave = shockwaveAt(impact);
        ring.scale.setScalar(wave.scale);
        (ring.material as import("three").MeshBasicMaterial).opacity = wave.opacity;
      }

      const knock = knockAt(timeline, elapsed);
      knocked.forEach((ghost) => {
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
    // finish()가 이미 settle()을 지났으므로 아래는 그저 다시 훑을 뿐 안전하다.
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
      settle();
      animatingRef.current([]);
    };
    // deps는 자취의 eventId 하나뿐이다. pieces와 slots는 스냅숏마다 새로 만들어지므로
    // deps에 넣으면 이 연출과 무관한 방송 하나에도 정리가 돌아 연출이 그 자리에서 죽는다
    // (효과 몸통은 playedRef에서 되돌아 나가므로 다시 시작하지도 않는다). 하필 잡기는
    // 보너스 던지기를 주므로, 튕겨내는 그 순간에 다음 스냅숏이 오기 가장 쉽다.
    // YutSticks가 "내려앉는 중이면 가로채지 않는다"고 적어 둔 것과 같은 뜻이다.
  }, [lastMove?.eventId]);

  return <canvas className="yut-board__canvas" ref={canvasRef} aria-hidden="true" />;
}
