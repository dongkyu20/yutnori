"use client";

import { Lobby } from "./components/Lobby";
import { WaitingRoom } from "./components/WaitingRoom";
import { useGameSession } from "./useGameSession";

export function GameApp() {
  const session = useGameSession();

  if (!session.snapshot) return <Lobby session={session} />;

  if (session.snapshot.phase === "waiting") {
    return (
      <WaitingRoom
        snapshot={session.snapshot}
        playerId={session.playerId}
        sendCommand={session.sendCommand}
      />
    );
  }

  return <main><p>게임이 진행 중입니다.</p></main>;
}
