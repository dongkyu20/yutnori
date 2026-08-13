"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";

interface ResultDialogProps {
  winnerName: string;
  /** 같은 참가자와 팀 그대로 대기실로 돌아가 한 판 더 준비한다. */
  onPlayAgain: () => void;
  onReturnToLobby: () => void;
}

export function ResultDialog({ winnerName, onPlayAgain, onReturnToLobby }: ResultDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const playAgainButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    playAgainButtonRef.current?.focus();
    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  const trapFocus = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
      "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
    ) ?? [])];
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable.at(-1) ?? first;
    if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  };

  return (
    <div className="result-dialog__backdrop">
      <dialog
        open
        ref={dialogRef}
        className="result-dialog"
        aria-modal="true"
        aria-labelledby="result-dialog-title"
        onKeyDown={trapFocus}
        tabIndex={-1}
      >
        <p className="result-dialog__eyebrow">경기 종료</p>
        <h2 id="result-dialog-title">경기 결과</h2>
        <p className="result-dialog__winner"><strong>{winnerName}</strong> 승리!</p>
        <div className="result-dialog__actions">
          <button
            ref={playAgainButtonRef}
            type="button"
            className="result-dialog__again"
            onClick={onPlayAgain}
          >
            같은 사람들과 다시 하기
          </button>
          <button type="button" className="result-dialog__leave" onClick={onReturnToLobby}>
            로비로 돌아가기
          </button>
        </div>
        <p className="result-dialog__hint">
          다시 하기를 누르면 참가자와 팀을 그대로 두고 대기실로 돌아갑니다.
        </p>
      </dialog>
    </div>
  );
}
