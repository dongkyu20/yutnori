"use client";

import { useEffect, useRef, useState } from "react";
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
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [nickname, setNickname] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [mode, setMode] = useState<GameMode>("individual");
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [roomCodeError, setRoomCodeError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const nicknameResult = nicknameSchema.safeParse(nickname);
  const roomCodeResult = roomCodeSchema.safeParse(roomCode);
  const canInteract = session.connectionState === "connected";

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const validateNickname = (): string | null => {
    if (!nicknameResult.success) {
      setNicknameError("닉네임은 2~12자의 한글 또는 영문으로 입력해 주세요.");
      return null;
    }
    setNicknameError(null);
    return nicknameResult.data;
  };

  const createRoom = async (): Promise<void> => {
    if (!canInteract) return;
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
    if (!canInteract) return;
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
    <main className="lobby">
      <header className="lobby__hero">
        <p>한판윷</p>
        <h1 ref={headingRef} tabIndex={-1}>같이 던지고, 함께 웃는 한판</h1>
        <p>이름만 정하면 바로 친구들과 윷놀이를 시작할 수 있어요.</p>
      </header>

      {session.error && <p className="lobby__alert" role="alert">{session.error.message}</p>}

      <section className="lobby-card" aria-labelledby="create-room-heading">
        <h2 id="create-room-heading">새 방 만들기</h2>
        <label className="lobby-field" htmlFor="nickname">닉네임</label>
        <input
          id="nickname"
          className="lobby-input"
          value={nickname}
          onChange={(event) => {
            setNickname(event.target.value);
            setNicknameError(null);
          }}
          aria-describedby={nicknameError ? "nickname-error" : undefined}
          autoComplete="nickname"
        />
        {nicknameError && <p className="lobby-help lobby-help--error" id="nickname-error" role="alert">{nicknameError}</p>}

        <div className="lobby-mode" role="group" aria-label="게임 방식">
          <button className="lobby-mode__button" type="button" aria-pressed={mode === "individual"} onClick={() => setMode("individual")} disabled={!canInteract || submitting}>
            2–4명 개인전
          </button>
          <button className="lobby-mode__button" type="button" aria-pressed={mode === "team"} onClick={() => setMode("team")} disabled={!canInteract || submitting}>
            8명 · 4팀 대항전
          </button>
        </div>
        <button className="lobby-action" type="button" onClick={() => void createRoom()} disabled={!canInteract || submitting}>
          {mode === "individual" ? "개인전 방 만들기" : "팀 대항전 방 만들기"}
        </button>
      </section>

      <section className="lobby-card" aria-labelledby="join-room-heading">
        <h2 id="join-room-heading">친구의 방에 참가하기</h2>
        <form className="lobby-form" onSubmit={(event) => {
          event.preventDefault();
          void joinRoom();
        }}>
          <label className="lobby-field" htmlFor="room-code">방 코드</label>
          <input
            id="room-code"
            className="lobby-input"
            value={roomCode}
            onChange={(event) => {
              setRoomCode(event.target.value.toUpperCase());
              setRoomCodeError(null);
            }}
            aria-describedby={roomCodeError ? "room-code-error" : undefined}
            autoCapitalize="characters"
            maxLength={6}
          />
          {roomCodeError && <p className="lobby-help lobby-help--error" id="room-code-error" role="alert">{roomCodeError}</p>}
          <button className="lobby-action" type="submit" disabled={!canInteract || submitting}>방 참가하기</button>
        </form>
      </section>

      <aside className="lobby-card lobby-card--note" aria-label="간단한 게임 규칙">
        <h2>게임 방법</h2>
        <p>개인전은 2~4명이, 팀 대항전은 8명이 모여 윷을 던집니다. 모든 말이 먼저 도착하면 승리해요.</p>
        {!canInteract && <p className="lobby-help">서버에 연결되면 방을 만들고 참가할 수 있어요.</p>}
      </aside>

      <p className="lobby__status" aria-live="polite">
        {session.connectionState === "connected" ? "서버에 연결되었습니다." : "서버에 연결하는 중입니다."}
      </p>
    </main>
  );
}
