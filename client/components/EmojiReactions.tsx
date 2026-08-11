"use client";

import { useEffect, useRef, useState } from "react";
import type { PublicRoomSnapshot } from "../../shared/protocol";
import type { ReactionEmoji, ReactionEvent } from "../socket";

export type { ReactionEvent } from "../socket";

interface EmojiReactionsProps {
  reactions: readonly ReactionEvent[];
  players: PublicRoomSnapshot["players"];
  onReact: (emoji: ReactionEmoji) => void;
}

const REACTIONS: ReadonlyArray<{ emoji: ReactionEmoji; label: string }> = [
  { emoji: "👏", label: "박수 보내기" },
  { emoji: "🔥", label: "불꽃 보내기" },
  { emoji: "😮", label: "놀람 보내기" },
  { emoji: "🎉", label: "축하 보내기" },
];

export function EmojiReactions({ reactions, players, onReact }: EmojiReactionsProps) {
  const [coolingDown, setCoolingDown] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  const sendReaction = (emoji: ReactionEmoji) => {
    if (coolingDown) return;
    onReact(emoji);
    setCoolingDown(true);
    timerRef.current = window.setTimeout(() => {
      setCoolingDown(false);
      timerRef.current = null;
    }, 800);
  };

  return (
    <section className="emoji-reactions" aria-labelledby="emoji-reactions-heading">
      <h2 id="emoji-reactions-heading" className="sr-only">반응 보내기</h2>
      <div className="emoji-reactions__buttons">
        {REACTIONS.map(({ emoji, label }) => (
          <button
            key={emoji}
            type="button"
            aria-label={label}
            disabled={coolingDown}
            onClick={() => sendReaction(emoji)}
          >
            <span aria-hidden="true">{emoji}</span>
          </button>
        ))}
      </div>
      <div className="emoji-reactions__stream" role="status" aria-label="실시간 반응" aria-live="polite">
        {reactions.map((reaction) => {
          const nickname = players.find((player) => player.id === reaction.playerId)?.nickname ?? "참가자";
          return <span key={reaction.id}>{nickname} {reaction.emoji}</span>;
        })}
      </div>
    </section>
  );
}
