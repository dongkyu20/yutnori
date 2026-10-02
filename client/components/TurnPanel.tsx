"use client";

import { useEffect, useState } from "react";
import type { PublicGameState } from "../../shared/protocol";
import { settleMsFor } from "../three/yutStick";
import { YutSticks } from "./YutSticks";

interface TurnPanelProps {
  game: PublicGameState;
  currentPlayerNickname: string;
  isCurrentPlayer: boolean;
  onThrow: () => void;
}

const RESULT_NAMES: Record<NonNullable<PublicGameState["lastThrow"]>["result"], string> = {
  BACK_DO: "빽도", DO: "도", GAE: "개", GEOL: "걸", YUT: "윷", MO: "모",
};

const STAGE_GUIDANCE: Record<PublicGameState["turnStage"], string> = {
  AWAITING_THROW: "윷을 던지세요",
  // 이제 결과를 여기서 고르지 않는다. 말을 고르면 갈 수 있는 칸이 판에 뜬다.
  AWAITING_PIECE: "움직일 말을 고른 뒤 갈 칸을 고르세요",
  AWAITING_ROUTE: "갈 길을 고르세요",
  COMPLETE: "게임이 끝났습니다",
};

function guidanceFor(game: PublicGameState): string {
  if (game.turnStage === "AWAITING_THROW" && game.pendingThrows.length > 0) {
    return "윷이나 모가 나왔습니다. 한 번 더 던지세요";
  }
  return STAGE_GUIDANCE[game.turnStage];
}

/** 패널 맨 위에 크게 적는 "지금 할 일". 남의 차례에는 누구를 기다리는지 적는다. */
function headlineFor(
  game: PublicGameState,
  isCurrentPlayer: boolean,
  currentPlayerNickname: string,
  rolling: boolean,
): string {
  if (game.turnStage === "COMPLETE") return STAGE_GUIDANCE.COMPLETE;
  if (!isCurrentPlayer) return `${currentPlayerNickname}님 차례를 기다리는 중`;
  // 굴러가는 동안 "윷이나 모가 나왔습니다"를 보이면 결과가 먼저 새어 나간다.
  if (rolling) return "윷가락이 구르는 중…";
  if (game.turnStage === "AWAITING_THROW" && game.pendingThrows.length === 0) return "내 차례! 윷을 던지세요";
  return guidanceFor(game);
}

export function TurnPanel({
  game,
  currentPlayerNickname,
  isCurrentPlayer,
  onThrow,
}: TurnPanelProps) {
  const currentThrowEventId = game.lastThrow?.eventId ?? null;
  const currentAnimationSeed = game.lastThrow?.animationSeed ?? "resting";
  // 스냅샷마다 배열이 새로 오므로 글자로 바꿔 둔다. 그래야 다른 소식이 와도 타이머가 다시 돌지 않는다.
  const currentStickKey = (game.lastThrow?.sticks ?? []).map((flat) => (flat ? "1" : "0")).join("");
  const [throwState, setThrowState] = useState(() => ({ eventId: currentThrowEventId, rolling: false }));

  // 새 던지기는 그리는 그 자리에서 굴리기 시작한다. 효과로 미루면 결과 글자가
  // 한 프레임 먼저 지나가고, 그걸 본 사람에게는 연출이 뒷북이 된다.
  if (throwState.eventId !== currentThrowEventId) {
    // 움직임을 줄여 달라고 한 사람에게는 굴리지 않으므로 기다릴 것도 없다.
    const reduceMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    setThrowState({ eventId: currentThrowEventId, rolling: currentThrowEventId !== null && !reduceMotion });
  }
  const animating = throwState.rolling;

  useEffect(() => {
    if (!throwState.rolling) return;
    const timer = window.setTimeout(
      () => setThrowState((current) => ({ ...current, rolling: false })),
      // 서버 시드마다 물리 궤적과 길이가 다르므로 그 던지기의 길이를 그대로 쓴다.
      settleMsFor(currentAnimationSeed, [...currentStickKey].map((flag) => flag === "1")),
    );
    return () => window.clearTimeout(timer);
  }, [currentAnimationSeed, currentStickKey, throwState.eventId, throwState.rolling]);

  // 윷가락이 멎기 전에 결과를 글자로 알려 주면 굴러가는 윷을 볼 까닭이 없어진다.
  const resultText = animating
    ? "윷가락이 구르는 중…"
    : game.lastThrow
      ? `던진 결과: ${RESULT_NAMES[game.lastThrow.result]}`
      : "아직 던진 결과가 없습니다";

  return (
    <aside className="turn-panel" aria-labelledby="turn-panel-heading">
      <h2 id="turn-panel-heading">지금 할 일</h2>
      <p className="turn-panel__guidance turn-panel__headline">{headlineFor(game, isCurrentPlayer, currentPlayerNickname, animating)}</p>
      <p className="turn-panel__current" role="status" aria-live="polite">현재 차례: <strong>{currentPlayerNickname}</strong></p>
      {game.turnStage === "AWAITING_THROW" && isCurrentPlayer && (
        // 던질 사람에게만 보인다. 남의 차례에 잠긴 버튼을 늘어놓으면 내가 뭘 해야 하는지 헷갈린다.
        <div className="throw-controls">
          <button
            type="button"
            className="turn-panel__throw"
            onClick={() => onThrow()}
          >
            윷 던지기
          </button>
        </div>
      )}
      <section className="yut-result" aria-labelledby="yut-result-heading">
        <h3 id="yut-result-heading">윷 결과</h3>
        <p data-throw-settled={animating ? undefined : "true"}>{resultText}</p>
        <YutSticks
          sticks={game.lastThrow?.sticks ?? [false, false, false, false]}
          animating={animating}
          throwKey={currentThrowEventId ?? "no-throw"}
          animationSeed={currentAnimationSeed}
        />
      </section>
      {/* 굴러가는 동안에는 손에 든 결과도 숨긴다. 칩이 먼저 보이면 무엇이 나왔는지 다 알게 된다. */}
      {game.pendingThrows.length > 0 && !animating && (
        /* 무엇을 들고 있는지만 보여 준다. 어느 결과로 갈지는 판에서 갈 곳을 눌러 고른다. */
        <section className="pending-throws" aria-labelledby="pending-throws-heading">
          <h3 id="pending-throws-heading">쓸 수 있는 결과</h3>
          <ul className="pending-throws__list" aria-label="쓸 수 있는 결과">
            {game.pendingThrows.map((pending) => (
              <li
                key={pending.id}
                className={`pending-throw${pending.legalPieceIds.length === 0 ? " pending-throw--idle" : ""}`}
                data-throw-id={pending.id}
              >
                {RESULT_NAMES[pending.result]}
                {pending.legalPieceIds.length === 0 && <span className="sr-only">, 쓸 말이 없습니다</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
