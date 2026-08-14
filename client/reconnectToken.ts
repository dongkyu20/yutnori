/**
 * 다시 들어올 때 쓰는 표. localStorage에 둔다.
 *
 * 브라우저는 localStorage를 막을 수 있다. 사생활 보호 모드, 쿠키 차단 설정,
 * 저장 공간이 꽉 찬 경우 모두 접근만으로 예외를 던진다. 그 예외가 그대로 올라오면
 * 화면 전체가 뜨지 않는다. 표 하나 못 읽는 것보다 훨씬 큰 손해다.
 * 여기서 막아 두면 최악이라도 "다시 들어오기"만 안 될 뿐, 게임은 그대로 굴러간다.
 */
const RECONNECT_TOKEN_KEY = "hanpanyut.reconnectToken";

export function readReconnectToken(): string | null {
  try {
    return window.localStorage.getItem(RECONNECT_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function writeReconnectToken(token: string): void {
  try {
    window.localStorage.setItem(RECONNECT_TOKEN_KEY, token);
  } catch {
    // 저장하지 못하면 새로 고침했을 때 새 참가자로 들어간다. 지금 판은 이어진다.
  }
}

export function clearReconnectToken(): void {
  try {
    window.localStorage.removeItem(RECONNECT_TOKEN_KEY);
  } catch {
    // 지우지 못한 표는 서버가 모르는 표다. 서버가 거절하고 새 자리를 내준다.
  }
}
