"use client";

import { useEffect, useRef, useState } from "react";
import type { PublicGameState } from "../../shared/protocol";

type GameEvent = PublicGameState["events"][number];

interface EventAnnouncerProps {
  events: readonly GameEvent[];
}

/**
 * 눈에 보이는 경기 기록은 없앴지만, 방금 무슨 일이 있었는지는 스크린 리더로 계속 읽혀야 한다.
 * 화면에는 나타나지 않고 새로 붙은 사건만 한 번씩 알린다.
 */
export function EventAnnouncer({ events }: EventAnnouncerProps) {
  const knownEventIds = useRef<Set<string> | null>(null);
  const [announcement, setAnnouncement] = useState<GameEvent | null>(null);

  useEffect(() => {
    // 처음 받은 사건들은 이미 지나간 일이다. 재접속하자마자 과거를 읊지 않는다.
    if (knownEventIds.current === null) {
      knownEventIds.current = new Set(events.map((event) => event.id));
      return;
    }

    const appended = events.filter((event) => !knownEventIds.current?.has(event.id));
    knownEventIds.current = new Set(events.map((event) => event.id));
    setAnnouncement(appended.at(-1) ?? null);
  }, [events]);

  return (
    <div className="sr-only" role="status" aria-label="새 경기 기록" aria-live="polite">
      {/* key를 사건 id로 두어 같은 문구가 이어져도 다시 읽힌다. */}
      {announcement && <span key={announcement.id}>{announcement.message}</span>}
    </div>
  );
}
