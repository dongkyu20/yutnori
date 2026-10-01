"use client";

import { useEffect } from "react";
import { clearInviteCode } from "./invite";
import { GameScreen } from "./components/GameScreen";
import { Lobby } from "./components/Lobby";
import { WaitingRoom } from "./components/WaitingRoom";
import { useGameSession } from "./useGameSession";

export function GameApp() {
  const session = useGameSession();
  const inRoom = session.snapshot !== null;

  // 방에 들어갔으면 초대 주소는 할 일을 다 했다. 새로고침에 초대 화면이 다시 뜨지 않게 지운다.
  useEffect(() => {
    if (inRoom) clearInviteCode();
  }, [inRoom]);

  if (!session.snapshot) return <Lobby session={session} />;

  if (session.snapshot.phase === "waiting") {
    return (
      <WaitingRoom
        snapshot={session.snapshot}
        playerId={session.playerId}
        error={session.error}
        sendCommand={session.sendCommand}
        leaveRoom={session.leaveRoom}
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
