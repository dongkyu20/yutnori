"use client";

import { GameScreen } from "./components/GameScreen";
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
        error={session.error}
        sendCommand={session.sendCommand}
      />
    );
  }

  return (
    <GameScreen
      snapshot={session.snapshot}
      playerId={session.playerId}
      connectionState={session.connectionState}
      reactions={session.reactions}
      error={session.error}
      sendCommand={session.sendCommand}
      leaveRoom={session.leaveRoom}
    />
  );
}
