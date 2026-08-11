"use client";

import { useEffect, useRef, useState } from "react";
import type { PublicGameState } from "../../shared/protocol";

type GameEvent = PublicGameState["events"][number];

interface EventLogProps {
  events: readonly GameEvent[];
}

const MAX_VISIBLE_EVENTS = 50;

export function EventLog({ events }: EventLogProps) {
  const orderedEvents = [...events]
    .sort((left, right) => left.createdAt - right.createdAt)
    .slice(-MAX_VISIBLE_EVENTS);
  const knownEventIds = useRef<Set<string> | null>(null);
  const [announcement, setAnnouncement] = useState<GameEvent | null>(null);

  useEffect(() => {
    if (knownEventIds.current === null) {
      knownEventIds.current = new Set(events.map((event) => event.id));
      return;
    }

    const appended = events.filter((event) => !knownEventIds.current?.has(event.id));
    knownEventIds.current = new Set(events.map((event) => event.id));
    setAnnouncement(appended.at(-1) ?? null);
  }, [events]);

  return (
    <section className="event-log" aria-labelledby="event-log-heading">
      <h2 id="event-log-heading">경기 기록</h2>
      <ol className="event-log__list" aria-label="경기 기록">
        {orderedEvents.map((event) => <li key={event.id}>{event.message}</li>)}
      </ol>
      <div className="sr-only" role="status" aria-label="새 경기 기록" aria-live="polite">
        {announcement && <span key={announcement.id}>{announcement.message}</span>}
      </div>
    </section>
  );
}
