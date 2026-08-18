"use client";

import { useEffect, useState } from "react";
import type { PublicGameState, ThrowPower } from "../../shared/protocol";
import { settleMsFor } from "../three/yutStick";
import { YutSticks } from "./YutSticks";

interface TurnPanelProps {
  game: PublicGameState;
  currentPlayerNickname: string;
  isCurrentPlayer: boolean;
  onThrow: (power: ThrowPower) => void;
}

const RESULT_NAMES: Record<NonNullable<PublicGameState["lastThrow"]>["result"], string> = {
  BACK_DO: "빽도", DO: "도", GAE: "개", GEOL: "걸", YUT: "윷", MO: "모",
};

/** 던지는 힘. 보기만 바뀌고 무엇이 나올지는 달라지지 않는다. */
const POWER_CHOICES: ReadonlyArray<{ power: ThrowPower; label: string }> = [
  { power: "soft", label: "살살" },
  { power: "normal", label: "보통" },
  { power: "hard", label: "힘껏" },
];

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

export function TurnPanel({
  game,
  currentPlayerNickname,
  isCurrentPlayer,
  onThrow,
}: TurnPanelProps) {
  const currentThrowEventId = game.lastThrow?.eventId ?? null;
  // 내가 다음에 던질 힘. 실제 연출은 서버가 되돌려 준 힘으로 하므로 모두가 같은 높이를 본다.
  const [power, setPower] = useState<ThrowPower>("normal");
  const thrownPower = game.lastThrow?.power ?? "normal";
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
      // 던지기마다 손버릇이 달라 연출 길이도 다르다. 그 던지기의 길이를 그대로 쓴다.
      settleMsFor(throwState.eventId ?? "", thrownPower),
    );
    return () => window.clearTimeout(timer);
  }, [throwState.eventId, throwState.rolling, thrownPower]);

  // 윷가락이 멎기 전에 결과를 글자로 알려 주면 굴러가는 윷을 볼 까닭이 없어진다.
  const resultText = animating
    ? "윷가락이 구르는 중…"
    : game.lastThrow
      ? `던진 결과: ${RESULT_NAMES[game.lastThrow.result]}`
      : "아직 던진 결과가 없습니다";

  return (
    <aside className="turn-panel" aria-labelledby="turn-panel-heading">
      <h2 id="turn-panel-heading">차례 안내</h2>
      <p role="status" aria-live="polite">현재 차례: <strong>{currentPlayerNickname}</strong></p>
      <p className="turn-panel__guidance">{guidanceFor(game)}</p>
      <section className="yut-result" aria-labelledby="yut-result-heading">
        <h3 id="yut-result-heading">윷 결과</h3>
        <p data-throw-settled={animating ? undefined : "true"}>{resultText}</p>
        <YutSticks
          sticks={game.lastThrow?.sticks ?? [false, false, false, false]}
          animating={animating}
          throwKey={currentThrowEventId ?? "no-throw"}
          power={thrownPower}
        />
      </section>
      {game.pendingThrows.length > 0 && (
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
      {game.turnStage === "AWAITING_THROW" && (
        <div className="throw-controls">
          <fieldset className="throw-power" disabled={!isCurrentPlayer}>
            <legend>던지는 힘</legend>
            {POWER_CHOICES.map((choice) => (
              <button
                key={choice.power}
                type="button"
                className="throw-power__option"
                aria-pressed={power === choice.power}
                onClick={() => setPower(choice.power)}
              >
                {choice.label}
              </button>
            ))}
          </fieldset>
          <p className="throw-power__hint">높이만 달라집니다. 나오는 결과와는 무관합니다.</p>
          <button
            type="button"
            className="turn-panel__throw"
            disabled={!isCurrentPlayer}
            onClick={() => onThrow(power)}
          >
            윷 던지기
          </button>
        </div>
      )}
    </aside>
  );
}
