"use client";

import { useEffect, useRef, useState } from "react";
import type { GameMode, ServerError } from "../../shared/protocol";
import { nicknameSchema, roomCodeSchema } from "../../shared/schemas";
import { clearInviteCode, readInviteCode, readSavedNickname, saveNickname } from "../invite";
import type { ConnectionState } from "../useGameSession";

export interface LobbySessionApi {
  connectionState: ConnectionState;
  error?: ServerError | null;
  createRoom: (nickname: string, mode: GameMode) => void | Promise<void>;
  joinRoom: (nickname: string, roomCode: string) => void | Promise<void>;
}

interface LobbyProps {
  session: LobbySessionApi;
  /** 초대받은 방 코드. 주지 않으면 주소의 `?room=`에서 읽는다. */
  inviteCode?: string | null;
}

export function Lobby({ session, inviteCode: inviteProp }: LobbyProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nicknameRef = useRef<HTMLInputElement>(null);
  // 주소와 저장된 닉네임은 브라우저에만 있다. 처음 그릴 때 읽으면 서버가 그린 HTML과 어긋나므로
  // 붙은 뒤에 읽는다.
  const [inviteCode, setInviteCode] = useState<string | null>(inviteProp ?? null);
  const [nickname, setNickname] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [mode, setMode] = useState<GameMode>("individual");
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [roomCodeError, setRoomCodeError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const nicknameResult = nicknameSchema.safeParse(nickname);
  const roomCodeResult = roomCodeSchema.safeParse(roomCode);
  const canInteract = session.connectionState === "connected";
  const invited = inviteCode !== null;

  useEffect(() => {
    headingRef.current?.focus();
    const saved = readSavedNickname();
    if (saved) setNickname((current) => current || saved);
    if (inviteProp === undefined) setInviteCode(readInviteCode());
    // 붙을 때 한 번만 읽는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 초대받아 온 사람은 닉네임만 쓰면 되므로 곧장 그 칸으로 보낸다.
  useEffect(() => {
    if (invited) nicknameRef.current?.focus();
  }, [invited]);

  const validateNickname = (): string | null => {
    if (!nicknameResult.success) {
      setNicknameError("닉네임은 2~12자의 한글 또는 영문으로 입력해 주세요.");
      nicknameRef.current?.focus();
      return null;
    }
    setNicknameError(null);
    saveNickname(nicknameResult.data);
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

  const joinRoom = async (code: string | null): Promise<void> => {
    if (!canInteract) return;
    const parsedNickname = validateNickname();
    setRoomCodeError(code ? null : "방 코드를 다시 확인해 주세요.");
    if (submitting || !parsedNickname || !code) return;
    setSubmitting(true);
    try {
      await session.joinRoom(parsedNickname, code);
    } finally {
      setSubmitting(false);
    }
  };

  const nicknameField = (
    <div className="lobby-identity__field">
      <label className="lobby-field" htmlFor="nickname">닉네임</label>
      <input
        id="nickname"
        ref={nicknameRef}
        className="lobby-input lobby-input--nickname"
        value={nickname}
        onChange={(event) => {
          setNickname(event.target.value);
          setNicknameError(null);
        }}
        aria-describedby={nicknameError ? "nickname-help nickname-error" : "nickname-help"}
        aria-invalid={nicknameError ? true : undefined}
        autoComplete="nickname"
        placeholder="친구들에게 보일 이름"
      />
      <p className="lobby-help" id="nickname-help">한글 또는 영문 2~12자</p>
      {nicknameError && <p className="lobby-help lobby-help--error" id="nickname-error" role="alert">{nicknameError}</p>}
    </div>
  );

  return (
    <main className={`lobby${invited ? " lobby--invited" : ""}`}>
      <header className="lobby__hero">
        <p>한판윷</p>
        {invited && <p className="lobby__invite-note">{inviteCode} 방에 초대받았어요</p>}
        <h1 ref={headingRef} tabIndex={-1}>같이 던지고, 함께 웃는 한판</h1>
        <p>{invited ? "닉네임만 정하면 바로 들어갈 수 있어요." : "닉네임을 정하고, 방을 만들거나 친구의 방 코드로 들어오세요."}</p>
      </header>

      {session.error && <p className="lobby__alert" role="alert">{session.error.message}</p>}

      {invited ? (
        <section className="lobby-card lobby-card--invite" aria-labelledby="invite-heading">
          <h2 id="invite-heading">초대받은 방</h2>
          <p className="lobby-invite__code">{inviteCode}</p>
          <form className="lobby-form" onSubmit={(event) => {
            event.preventDefault();
            void joinRoom(inviteCode);
          }}>
            {nicknameField}
            <button className="lobby-action" type="submit" disabled={!canInteract || submitting}>방 참가하기</button>
          </form>
          <button
            className="lobby-link"
            type="button"
            onClick={() => {
              setInviteCode(null);
              clearInviteCode();
            }}
          >
            다른 방 만들기
          </button>
        </section>
      ) : (
        <>
          <section className="lobby-identity" aria-label="내 정보">{nicknameField}</section>

          <div className="lobby-paths">
            <section className="lobby-card" aria-labelledby="create-room-heading">
              <h2 id="create-room-heading">새 방 만들기</h2>
              <div className="lobby-mode" role="group" aria-label="게임 방식">
                <button className="lobby-mode__button" type="button" aria-pressed={mode === "individual"} onClick={() => setMode("individual")} disabled={!canInteract || submitting}>
                  2–4명 개인전
                </button>
                <button className="lobby-mode__button" type="button" aria-pressed={mode === "team"} onClick={() => setMode("team")} disabled={!canInteract || submitting}>
                  4·6·8명 팀 대항전
                </button>
              </div>
              <button className="lobby-action" type="button" onClick={() => void createRoom()} disabled={!canInteract || submitting}>
                {mode === "individual" ? "개인전 방 만들기" : "팀 대항전 방 만들기"}
              </button>
            </section>

            <section className="lobby-card" aria-labelledby="join-room-heading">
              <h2 id="join-room-heading">코드로 참가하기</h2>
              <form className="lobby-form" onSubmit={(event) => {
                event.preventDefault();
                void joinRoom(roomCodeResult.success ? roomCodeResult.data : null);
              }}>
                <label className="lobby-field" htmlFor="room-code">방 코드</label>
                <input
                  id="room-code"
                  className="lobby-input lobby-input--code"
                  value={roomCode}
                  onChange={(event) => {
                    setRoomCode(event.target.value.toUpperCase());
                    setRoomCodeError(null);
                  }}
                  aria-describedby={roomCodeError ? "room-code-error" : undefined}
                  autoCapitalize="characters"
                  maxLength={6}
                  placeholder="6자리"
                />
                {roomCodeError && <p className="lobby-help lobby-help--error" id="room-code-error" role="alert">{roomCodeError}</p>}
                <button className="lobby-action" type="submit" disabled={!canInteract || submitting}>방 참가하기</button>
              </form>
            </section>
          </div>
        </>
      )}

      <aside className="lobby-card lobby-card--note" aria-label="간단한 게임 규칙">
        <h2>게임 방법</h2>
        <p>개인전은 2~4명이, 팀 대항전은 두 명씩 짝을 지어 4·6·8명이 모여 윷을 던집니다. 모든 말이 먼저 도착하면 승리해요.</p>
        {!canInteract && <p className="lobby-help">서버에 연결되면 방을 만들고 참가할 수 있어요.</p>}
      </aside>

      <p className="lobby__status" aria-live="polite">
        {session.connectionState === "connected" ? "서버에 연결되었습니다." : "서버에 연결하는 중입니다."}
      </p>
    </main>
  );
}
