"use client";

import { useEffect, useRef, useState } from "react";
import type { PublicGameState } from "../../shared/protocol";

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
  AWAITING_PIECE: "움직일 말을 고르세요",
  AWAITING_ROUTE: "갈 길을 고르세요",
  COMPLETE: "게임이 끝났습니다",
};

export function TurnPanel({ game, currentPlayerNickname, isCurrentPlayer, onThrow }: TurnPanelProps) {
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
      <p className="turn-panel__guidance">{STAGE_GUIDANCE[game.turnStage]}</p>
      <section className="yut-result" aria-labelledby="yut-result-heading">
        <h3 id="yut-result-heading">윷 결과</h3>
        <p>{game.lastThrow ? `던진 결과: ${RESULT_NAMES[game.lastThrow.result]}` : "아직 던진 결과가 없습니다"}</p>
        <ol key={currentThrowEventId ?? "no-throw"} className="yut-sticks" data-testid="yut-sticks" data-animating={animating ? "true" : undefined} aria-label="윷가락 네 개">
          {(game.lastThrow?.sticks ?? [false, false, false, false]).map((flat, index) => (
            <li key={index} className={`yut-stick${flat ? " yut-stick--flat" : ""}`} aria-label={`${index + 1}번 윷가락: ${flat ? "평평한 면" : "둥근 면"}`}>
              <span aria-hidden="true">{flat ? "배" : "등"}</span>
            </li>
          ))}
        </ol>
      </section>
      {game.turnStage === "AWAITING_THROW" && (
        <button type="button" className="turn-panel__throw" disabled={!isCurrentPlayer} onClick={onThrow}>윷 던지기</button>
      )}
    </aside>
  );
}
