/**
 * 명령마다 붙이는 고유 id. 서버가 같은 명령이 두 번 오는 것을 걸러내는 열쇠이며 uuid 형식이어야 한다.
 *
 * `crypto.randomUUID`는 보안 컨텍스트(https 또는 localhost)에서만 있다.
 * 같은 네트워크의 다른 기기가 http://<주소>:3000으로 들어오면 그 자리에는 함수가 아예 없어서
 * 준비하기나 색 고르기처럼 명령을 보내는 순간 터진다.
 * `crypto.getRandomValues`는 그런 자리에서도 쓸 수 있으므로, 없을 때는 그것으로 v4를 직접 만든다.
 */
export function newRequestId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // uuid v4의 표시 자리: 버전은 4, 변형은 10xx.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
