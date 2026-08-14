"use client";

import type { ServerError } from "../../shared/protocol";

interface RoomAlertProps {
  error: ServerError | null;
}

/**
 * 서버가 명령을 거절했을 때 그 까닭을 보여 준다.
 * 이것이 없으면 눌러도 아무 일이 없는 것처럼 보인다 — 색이 겹쳤는지, 방이 이미 바뀌었는지 알 길이 없다.
 * 다음 스냅숏이 오면(=무언가 통했으면) useGameSession이 지운다.
 */
export function RoomAlert({ error }: RoomAlertProps) {
  if (!error) return null;

  return (
    <p className="room-alert" role="alert" data-error-code={error.code}>
      {error.message}
    </p>
  );
}
