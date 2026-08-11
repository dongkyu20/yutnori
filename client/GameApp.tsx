"use client";

import { Lobby } from "./components/Lobby";
import { useGameSession } from "./useGameSession";

export function GameApp() {
  const session = useGameSession();

  if (!session.snapshot) return <Lobby session={session} />;

  return <main><p>참가자들을 기다리고 있습니다.</p></main>;
}
