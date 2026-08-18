"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ThrowPower } from "../../shared/protocol";
import {
  applyRest,
  applyToss,
  createStickGeometry,
  frameCamera,
  layoutFor,
  mulberry32,
  FOV,
  MARKED_INDEX,
} from "../three/yutStick";

type ThreeModule = typeof import("three");

interface YutSticksProps {
  /** 각 윷가락이 배(평평한 면)를 위로 보이는지 여부. */
  sticks: readonly boolean[];
  animating: boolean;
  /** 던질 때마다 바뀌는 값. 굴림과 흩어짐을 다시 만든다. */
  throwKey: string;
  /** 던진 사람이 고른 힘. 서버가 되돌려 준 값이라 모두 같은 높이로 본다. */
  power?: ThrowPower;
}

interface Stage {
  renderer: import("three").WebGLRenderer;
  scene: import("three").Scene;
  camera: import("three").PerspectiveCamera;
  views: import("three").Group[];
  disposables: Array<{ dispose: () => void }>;
  lost: boolean;
}

/** jsdom과 WebGL 없는 환경에서는 three를 아예 불러오지 않는다. */
function hasWebGL(): boolean {
  return typeof WebGL2RenderingContext !== "undefined"
    || typeof WebGLRenderingContext !== "undefined";
}

interface Painter {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
}

function createPainter(width: number, height: number): Painter | null {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  return context ? { canvas, context } : null;
}

/** 나뭇결을 길이 방향(캔버스 세로)으로 그린다. UV의 v축이 윷가락 길이다. */
function paintGrain(
  painter: Painter,
  base: string,
  strokes: Array<{ color: string; count: number; alpha: number; width: number }>,
  random: () => number,
): void {
  const { canvas, context } = painter;
  context.fillStyle = base;
  context.fillRect(0, 0, canvas.width, canvas.height);

  strokes.forEach((stroke) => {
    context.strokeStyle = stroke.color;
    for (let index = 0; index < stroke.count; index += 1) {
      const x = random() * canvas.width;
      const drift = (random() - 0.5) * canvas.width * 0.09;
      context.globalAlpha = stroke.alpha * (0.35 + random() * 0.65);
      context.lineWidth = stroke.width * (0.4 + random());
      context.beginPath();
      context.moveTo(x, -8);
      context.bezierCurveTo(
        x + drift, canvas.height * 0.34,
        x - drift, canvas.height * 0.67,
        x + drift * 0.5, canvas.height + 8,
      );
      context.stroke();
    }
  });
  context.globalAlpha = 1;
}

/** 배 양 끝의 톱질 모서리를 어둡게 눌러 깎인 각이 보이게 한다. */
function paintCutEdges(painter: Painter): void {
  const { canvas, context } = painter;
  const edge = canvas.width * 0.13;
  [0, canvas.width].forEach((from) => {
    const inward = from === 0 ? edge : canvas.width - edge;
    const gradient = context.createLinearGradient(from, 0, inward, 0);
    gradient.addColorStop(0, "rgba(72, 45, 20, 0.55)");
    gradient.addColorStop(1, "rgba(72, 45, 20, 0)");
    context.fillStyle = gradient;
    context.fillRect(Math.min(from, inward), 0, edge, canvas.height);
  });
}

/** 빽도 윷가락의 배에 먹으로 새긴 표. 이 면이 위로 보일 때만 빽도가 된다. */
function paintBackDoMark(painter: Painter): void {
  const { canvas, context } = painter;
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const reach = canvas.width * 0.26;

  context.strokeStyle = "#2c1c0e";
  context.lineCap = "round";
  context.lineWidth = canvas.width * 0.075;
  context.globalAlpha = 0.85;
  [1, -1].forEach((slope) => {
    context.beginPath();
    context.moveTo(centerX - reach, centerY - reach * slope);
    context.lineTo(centerX + reach, centerY + reach * slope);
    context.stroke();
  });

  context.lineWidth = canvas.width * 0.045;
  context.globalAlpha = 0.7;
  [-1, 1].forEach((side) => {
    const y = centerY + side * canvas.height * 0.15;
    context.beginPath();
    context.moveTo(centerX - reach * 0.8, y);
    context.lineTo(centerX + reach * 0.8, y);
    context.stroke();
  });
  context.globalAlpha = 1;
}

/** 마구리의 나이테. */
function paintEndGrain(painter: Painter, random: () => number): void {
  const { canvas, context } = painter;
  context.fillStyle = "#d9b884";
  context.fillRect(0, 0, canvas.width, canvas.height);

  const centerX = canvas.width * (0.42 + random() * 0.16);
  const centerY = canvas.height * (0.42 + random() * 0.16);
  context.strokeStyle = "#8d6231";
  for (let ring = 1; ring < 11; ring += 1) {
    context.globalAlpha = 0.16 + random() * 0.2;
    context.lineWidth = canvas.width * (0.006 + random() * 0.012);
    context.beginPath();
    context.ellipse(
      centerX, centerY,
      (canvas.width * ring) / 22, (canvas.height * ring) / 20,
      random() * 0.4, 0, Math.PI * 2,
    );
    context.stroke();
  }
  context.globalAlpha = 1;
}

interface WoodMaps {
  bark: import("three").Texture;
  cut: import("three").Texture;
  marked: import("three").Texture;
  end: import("three").Texture;
}

function toTexture(
  THREE: ThreeModule,
  renderer: import("three").WebGLRenderer,
  painter: Painter,
): import("three").Texture {
  const texture = new THREE.CanvasTexture(painter.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

/** 텍스처를 캔버스에 직접 그려 외부 이미지 없이 나뭇결을 만든다. */
function createWoodMaps(
  THREE: ThreeModule,
  renderer: import("three").WebGLRenderer,
): WoodMaps | null {
  const bark = createPainter(128, 512);
  const cut = createPainter(128, 512);
  const marked = createPainter(128, 512);
  const end = createPainter(128, 128);
  if (!bark || !cut || !marked || !end) return null;

  const random = mulberry32(0x59757401);
  paintGrain(bark, "#7c4f26", [
    { color: "#361f0d", count: 46, alpha: 0.32, width: 2.2 },
    { color: "#c08a4c", count: 22, alpha: 0.22, width: 1.5 },
  ], random);

  [cut, marked].forEach((painter) => {
    // 두 배는 같은 결이되 표시된 윷가락에만 먹 표를 더한다.
    paintGrain(painter, "#e8cb9c", [
      { color: "#b4854a", count: 34, alpha: 0.3, width: 2 },
      { color: "#fbeacd", count: 16, alpha: 0.28, width: 1.6 },
    ], mulberry32(0x62d02a));
    paintCutEdges(painter);
  });
  paintBackDoMark(marked);
  paintEndGrain(end, random);

  return {
    bark: toTexture(THREE, renderer, bark),
    cut: toTexture(THREE, renderer, cut),
    marked: toTexture(THREE, renderer, marked),
    end: toTexture(THREE, renderer, end),
  };
}

function woodMaterial(
  THREE: ThreeModule,
  map: import("three").Texture | null,
  fallbackColor: number,
  roughness: number,
): import("three").MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: map ? 0xffffff : fallbackColor,
    map,
    // 결 무늬를 그대로 요철로 써서 표면이 나무처럼 거칠어 보이게 한다.
    bumpMap: map,
    bumpScale: map ? 0.45 : 0,
    roughness,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
}

function buildStage(THREE: ThreeModule, canvas: HTMLCanvasElement, count: number): Stage | null {
  let renderer: import("three").WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  const disposables: Stage["disposables"] = [];

  const maps = createWoodMaps(THREE, renderer);
  if (maps) disposables.push(maps.bark, maps.cut, maps.marked, maps.end);
  const bark = woodMaterial(THREE, maps?.bark ?? null, 0x8a5a2b, 0.78);
  const cut = woodMaterial(THREE, maps?.cut ?? null, 0xf2dcae, 0.62);
  const marked = woodMaterial(THREE, maps?.marked ?? null, 0xf2dcae, 0.62);
  const end = woodMaterial(THREE, maps?.end ?? null, 0xd9b884, 0.7);
  disposables.push(bark, cut, marked, end);

  const geometry = createStickGeometry(THREE);
  disposables.push(geometry.shell, geometry.face, ...geometry.caps);

  scene.add(new THREE.HemisphereLight(0xfff4e2, 0x6a5842, 1.05));
  const key = new THREE.DirectionalLight(0xfff1d6, 2.5);
  key.position.set(2.3, 5.4, 2.9);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = 3.5;
  key.shadow.bias = -0.0016;
  Object.assign(key.shadow.camera, {
    left: -3.4, right: 3.4, top: 3.4, bottom: -3.4, near: 0.5, far: 16,
  });
  key.shadow.camera.updateProjectionMatrix();
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xa8d8cf, 0.55);
  fill.position.set(-3.2, 1.5, 2.4);
  scene.add(fill);

  // 멍석은 그림자만 받는 투명 면이라 패널의 한지 바탕이 그대로 보인다.
  const matGeometry = new THREE.PlaneGeometry(16, 16).rotateX(-Math.PI / 2);
  const matMaterial = new THREE.ShadowMaterial({ color: 0x2b1f12, opacity: 0.3 });
  disposables.push(matGeometry, matMaterial);
  const mat = new THREE.Mesh(matGeometry, matMaterial);
  mat.receiveShadow = true;
  scene.add(mat);

  const views: import("three").Group[] = [];
  for (let index = 0; index < count; index += 1) {
    const group = new THREE.Group();
    [
      new THREE.Mesh(geometry.shell, bark),
      new THREE.Mesh(geometry.face, index === MARKED_INDEX ? marked : cut),
      new THREE.Mesh(geometry.caps[0], end),
      new THREE.Mesh(geometry.caps[1], end),
    ].forEach((mesh) => {
      mesh.castShadow = true;
      group.add(mesh);
    });
    scene.add(group);
    views.push(group);
  }

  return { renderer, scene, camera, views, disposables, lost: false };
}

export function YutSticks({ sticks, animating, throwKey, power = "normal" }: YutSticksProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<Stage | null>(null);
  const frameRef = useRef(0);
  const tossRef = useRef({ key: "", running: false });
  const [webgl, setWebgl] = useState(false);

  const stickKey = sticks.map((flat) => (flat ? "1" : "0")).join("");
  // 부모가 매번 새 배열을 넘겨도 결과가 같으면 굴림을 다시 시작하지 않는다.
  const flags = useMemo(() => [...stickKey].map((flag) => flag === "1"), [stickKey]);
  const poseRef = useRef({ flags, throwKey, power });

  useEffect(() => { poseRef.current = { flags, throwKey, power }; }, [flags, throwKey, power]);

  // three는 WebGL이 있을 때만 내려받는다. 무대는 한 번만 만들고 크기 변화에만 반응한다.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !hasWebGL()) return;

    let disposed = false;
    let observer: ResizeObserver | null = null;
    // 컨텍스트를 잃으면 3D를 접고 CSS 윷가락을 다시 띄워 결과가 계속 읽히게 한다.
    const onContextLost = (event: Event) => {
      event.preventDefault();
      const stage = stageRef.current;
      if (stage) stage.lost = true;
      cancelAnimationFrame(frameRef.current);
      setWebgl(false);
    };
    canvas.addEventListener("webglcontextlost", onContextLost);

    void import("three").then((THREE) => {
      if (disposed) return;
      const stage = buildStage(THREE, canvas, 4);
      if (!stage) return;
      stageRef.current = stage;

      const resize = () => {
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        if (width === 0 || height === 0 || stage.lost) return;
        stage.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
        stage.renderer.setSize(width, height, false);
        frameCamera(THREE, stage.camera, width / height);
        stage.renderer.render(stage.scene, stage.camera);
      };

      const pose = poseRef.current;
      applyRest(stage.views, pose.flags, layoutFor(pose.throwKey, stage.views.length, pose.power));
      resize();
      observer = new ResizeObserver(resize);
      observer.observe(canvas);
      setWebgl(true);
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      cancelAnimationFrame(frameRef.current);
      const stage = stageRef.current;
      if (stage) {
        stage.disposables.forEach((item) => { item.dispose(); });
        stage.renderer.dispose();
        stageRef.current = null;
      }
    };
  }, []);

  // 결과가 바뀌면 던져 굴리고, 그 밖에는 결과 면으로 조용히 눕힌다.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || stage.lost) return;

    const layout = layoutFor(throwKey, stage.views.length, power);
    const reduceMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    if (!animating || reduceMotion || tossRef.current.key === throwKey) {
      // 내려앉는 중이면 가로채지 않는다. 부모가 다시 그려도 굴림이 끊기지 않는다.
      if (tossRef.current.running) return;
      applyRest(stage.views, flags, layout);
      stage.renderer.render(stage.scene, stage.camera);
      return;
    }

    tossRef.current = { key: throwKey, running: true };
    const start = performance.now();
    const step = (now: number) => {
      if (stage.lost) return;
      const running = applyToss(stage.views, flags, layout, now - start);
      stage.renderer.render(stage.scene, stage.camera);
      tossRef.current.running = running;
      if (running) frameRef.current = requestAnimationFrame(step);
    };
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(step);
  }, [flags, animating, throwKey, power, webgl]);

  return (
    <div className={`yut-stage${webgl ? " yut-stage--3d" : ""}`}>
      <canvas className="yut-stage__canvas" ref={canvasRef} aria-hidden="true" />
      <ol
        key={throwKey}
        className="yut-sticks"
        data-testid="yut-sticks"
        data-animating={animating ? "true" : undefined}
        aria-label="윷가락 네 개"
      >
        {sticks.map((flat, index) => (
          <li
            key={index}
            className={`yut-stick${flat ? " yut-stick--flat" : ""}${index === MARKED_INDEX ? " yut-stick--marked" : ""}`}
            aria-label={`${index + 1}번 윷가락: ${flat ? "평평한 면" : "둥근 면"}${index === MARKED_INDEX ? " (빽도 표시)" : ""}`}
          >
            <span className="yut-stick__body" aria-hidden="true">
              <span className="yut-stick__face yut-stick__face--round">등</span>
              <span className="yut-stick__face yut-stick__face--flat">배</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
