/**
 * 윷판의 배치. DOM 판과 3D 장면이 같은 좌표를 써야 하므로 컴포넌트 밖에 둔다.
 * 번호가 커지는 순서가 진행 방향이고, 화면에서 반시계로 돈다.
 */

export type BoardCoordinate = { x: number; y: number };

/**
 * 판 좌표. 번호가 커지는 순서가 그대로 진행 방향이고, 화면에서 반시계로 돈다.
 * 오른쪽 아래 시작점에서 오른쪽 변을 타고 올라가 위쪽 변을 왼쪽으로 지난다.
 * 서버의 길 구조에는 방향이 없으므로 이 표만 바꾸면 진행 방향이 바뀐다.
 */
export const NODE_COORDINATES: Readonly<Record<string, BoardCoordinate>> = {
  // 오른쪽 변을 따라 위로
  O0: { x: 92, y: 92 }, O1: { x: 92, y: 75 }, O2: { x: 92, y: 58 },
  O3: { x: 92, y: 42 }, O4: { x: 92, y: 25 }, O5: { x: 92, y: 8 },
  // 위쪽 변을 따라 왼쪽으로
  O6: { x: 75, y: 8 }, O7: { x: 58, y: 8 }, O8: { x: 42, y: 8 },
  O9: { x: 25, y: 8 }, O10: { x: 8, y: 8 },
  // 왼쪽 변을 따라 아래로
  O11: { x: 8, y: 25 }, O12: { x: 8, y: 42 }, O13: { x: 8, y: 58 },
  O14: { x: 8, y: 75 }, O15: { x: 8, y: 92 },
  // 아래쪽 변을 따라 오른쪽으로 돌아온다
  O16: { x: 25, y: 92 }, O17: { x: 42, y: 92 },
  O18: { x: 58, y: 92 }, O19: { x: 75, y: 92 },
  // 지름길은 모서리에서 방까지 14%씩 세 걸음으로 고르게 나눈다. 예전처럼 방 바로 앞
  // 한 걸음만 11%로 좁히면, 3D 칸 하나가 13%를 차지하므로 네 대각선 칸의 테가
  // 방의 테를 파고들어 가운데 동그라미만 잘려 보인다.
  D1_1: { x: 78, y: 22 }, D1_2: { x: 64, y: 36 }, CENTER: { x: 50, y: 50 },
  D2_2: { x: 36, y: 64 }, D2_1: { x: 22, y: 78 }, D3_1: { x: 22, y: 22 },
  D3_2: { x: 36, y: 36 }, D4_2: { x: 64, y: 64 }, D4_1: { x: 78, y: 78 },
};

/** 말이 판에 들어서는 칸이자 참으로 돌아오는 칸. */
export const START_NODE_ID = "O0";
export const CENTER_NODE_ID = "CENTER";
/**
 * 지름길로 빠지는 길목과 그 첫 칸. 서버 BOARD_NODES의 forwardRoute와 짝을 이루며,
 * 여기에 정확히 멈춘 말은 바깥길이 아니라 이 방향 지름길로 들어선다.
 */
export const SHORTCUT_GATES: Readonly<Record<string, string>> = Object.freeze({
  O5: "D1_1",
  O10: "D3_1",
  CENTER: "D4_2",
});

export type BoardSegment = { from: string; to: string; route: "outer" | "center-a" | "center-b" };

const OUTER_SEGMENTS: BoardSegment[] = Array.from({ length: 19 }, (_, index) => ({
  from: `O${index}`,
  to: `O${index + 1}`,
  route: "outer",
}));

export const BOARD_SEGMENTS: readonly BoardSegment[] = [
  ...OUTER_SEGMENTS,
  { from: "O19", to: "O0", route: "outer" },
  { from: "O5", to: "D1_1", route: "center-a" },
  { from: "D1_1", to: "D1_2", route: "center-a" },
  { from: "D1_2", to: "CENTER", route: "center-a" },
  { from: "CENTER", to: "D2_2", route: "center-a" },
  { from: "D2_2", to: "D2_1", route: "center-a" },
  { from: "D2_1", to: "O15", route: "center-a" },
  { from: "O10", to: "D3_1", route: "center-b" },
  { from: "D3_1", to: "D3_2", route: "center-b" },
  { from: "D3_2", to: "CENTER", route: "center-b" },
  { from: "CENTER", to: "D4_2", route: "center-b" },
  { from: "D4_2", to: "D4_1", route: "center-b" },
  { from: "D4_1", to: "O0", route: "center-b" },
];

/** 시작점(O0)에서 첫 걸음이 닿는 칸. 진행 방향 살촉을 여기로 세운다. */
export const FIRST_STEP_NODE_ID = OUTER_SEGMENTS[0].to;
