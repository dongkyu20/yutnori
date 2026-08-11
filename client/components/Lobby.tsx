"use client";

import { useState } from "react";
import type { GameMode, ServerError } from "../../shared/protocol";
import { nicknameSchema, roomCodeSchema } from "../../shared/schemas";
import type { ConnectionState } from "../useGameSession";

export interface LobbySessionApi {
  connectionState: ConnectionState;
  error?: ServerError | null;
  createRoom: (nickname: string, mode: GameMode) => void | Promise<void>;
  joinRoom: (nickname: string, roomCode: string) => void | Promise<void>;
}

export function Lobby({ session }: { session: LobbySessionApi }) {
  const [nickname, setNickname] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [mode, setMode] = useState<GameMode>("individual");
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [roomCodeError, setRoomCodeError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const nicknameResult = nicknameSchema.safeParse(nickname);
  const roomCodeResult = roomCodeSchema.safeParse(roomCode);

  const validateNickname = (): string | null => {
    if (!nicknameResult.success) {
      setNicknameError("닉네임은 2~12자의 한글 또는 영문으로 입력해 주세요.");
      return null;
    }
    setNicknameError(null);
    return nicknameResult.data;
  };

  const createRoom = async (): Promise<void> => {
    const parsedNickname = validateNickname();
    if (submitting || !parsedNickname) return;
    setSubmitting(true);
    try {
      await session.createRoom(parsedNickname, mode);
    } finally {
      setSubmitting(false);
    }
  };

  const joinRoom = async (): Promise<void> => {
    const parsedNickname = validateNickname();
    const parsedRoomCode = roomCodeResult.success ? roomCodeResult.data : null;
    setRoomCodeError(parsedRoomCode ? null : "방 코드를 다시 확인해 주세요.");
    if (submitting || !parsedNickname || !parsedRoomCode) return;
    setSubmitting(true);
    try {
      await session.joinRoom(parsedNickname, parsedRoomCode);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main>
      <header>
        <p>한판윷</p>
        <h1>같이 던지고, 함께 웃는 한판</h1>
        <p>이름만 정하면 바로 친구들과 윷놀이를 시작할 수 있어요.</p>
      </header>

      {session.error && <p role="alert">{session.error.message}</p>}

      <section aria-labelledby="create-room-heading">
        <h2 id="create-room-heading">새 방 만들기</h2>
        <label htmlFor="nickname">닉네임</label>
        <input
          id="nickname"
          value={nickname}
          onChange={(event) => {
            setNickname(event.target.value);
            setNicknameError(null);
          }}
          aria-describedby={nicknameError ? "nickname-error" : undefined}
          autoComplete="nickname"
        />
        {nicknameError && <p id="nickname-error" role="alert">{nicknameError}</p>}

        <div role="group" aria-label="게임 방식">
          <button type="button" aria-pressed={mode === "individual"} onClick={() => setMode("individual")}>
            2–4명 개인전
          </button>
          <button type="button" aria-pressed={mode === "team"} onClick={() => setMode("team")}>
            8명 · 4팀 대항전
          </button>
        </div>
        <button type="button" onClick={() => void createRoom()} disabled={submitting}>
          {mode === "individual" ? "개인전 방 만들기" : "팀 대항전 방 만들기"}
        </button>
      </section>

      <section aria-labelledby="join-room-heading">
        <h2 id="join-room-heading">친구의 방에 참가하기</h2>
        <form onSubmit={(event) => {
          event.preventDefault();
          void joinRoom();
        }}>
          <label htmlFor="room-code">방 코드</label>
          <input
            id="room-code"
            value={roomCode}
            onChange={(event) => {
              setRoomCode(event.target.value.toUpperCase());
              setRoomCodeError(null);
            }}
            aria-describedby={roomCodeError ? "room-code-error" : undefined}
            autoCapitalize="characters"
            maxLength={6}
          />
          {roomCodeError && <p id="room-code-error" role="alert">{roomCodeError}</p>}
          <button type="submit" disabled={submitting}>방 참가하기</button>
        </form>
      </section>

      <aside aria-label="간단한 게임 규칙">
        <h2>게임 방법</h2>
        <p>개인전은 2~4명이, 팀 대항전은 8명이 모여 윷을 던집니다. 모든 말이 먼저 도착하면 승리해요.</p>
      </aside>

      <p aria-live="polite">
        {session.connectionState === "connected" ? "서버에 연결되었습니다." : "서버에 연결하는 중입니다."}
      </p>
    </main>
  );
}
