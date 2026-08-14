"use client";

import { useEffect, useRef, useState } from "react";
import type { PublicGameState } from "../../shared/protocol";
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

export function TurnPanel({
  game,
  currentPlayerNickname,
  isCurrentPlayer,
  onThrow,
}: TurnPanelProps) {
  const currentThrowEventId = game.lastThrow?.eventId ?? null;
  const previousThrowEventId = useRef(currentThrowEventId);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (currentThrowEventId && currentThrowEventId !== previousThrowEventId.current) {
      setAnimating(true);
      const timer = window.setTimeout(() => setAnimating(false), 650);
      previousThrowEventId.current = currentThrowEventId;
      return () => window.clearTimeout(timer);
    }
    previousThrowEventId.current = currentThrowEventId;
  }, [currentThrowEventId]);

  return (
    <aside className="turn-panel" aria-labelledby="turn-panel-heading">
      <h2 id="turn-panel-heading">차례 안내</h2>
      <p role="status" aria-live="polite">현재 차례: <strong>{currentPlayerNickname}</strong></p>
      <p className="turn-panel__guidance">{guidanceFor(game)}</p>
      <section className="yut-result" aria-labelledby="yut-result-heading">
        <h3 id="yut-result-heading">윷 결과</h3>
        <p>{game.lastThrow ? `던진 결과: ${RESULT_NAMES[game.lastThrow.result]}` : "아직 던진 결과가 없습니다"}</p>
        <YutSticks
          sticks={game.lastThrow?.sticks ?? [false, false, false, false]}
          animating={animating}
          throwKey={currentThrowEventId ?? "no-throw"}
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
        <button type="button" className="turn-panel__throw" disabled={!isCurrentPlayer} onClick={onThrow}>윷 던지기</button>
      )}
    </aside>
  );
}
