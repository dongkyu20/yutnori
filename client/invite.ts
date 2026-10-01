import { roomCodeSchema } from "../shared/schemas";

const NICKNAME_KEY = "yut.nickname";

/** 초대 링크의 방 코드. 형식이 맞지 않으면 초대가 아닌 것으로 본다. */
export function readInviteCode(search: string = globalThis.location?.search ?? ""): string | null {
  const raw = new URLSearchParams(search).get("room");
  if (!raw) return null;
  const parsed = roomCodeSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** 방에 들어간 뒤 새로고침해도 초대 화면이 다시 뜨지 않게 주소에서 지운다. */
export function clearInviteCode(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("room")) return;
    url.searchParams.delete("room");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // 주소를 못 바꿔도 게임에는 지장이 없다.
  }
}

/** 이 페이지로 돌아와 곧장 그 방에 들어오게 하는 주소. */
export function inviteUrl(roomCode: string): string {
  return `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
}

export function readSavedNickname(): string {
  try {
    return window.localStorage.getItem(NICKNAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveNickname(nickname: string): void {
  try {
    window.localStorage.setItem(NICKNAME_KEY, nickname);
  } catch {
    // 기억하지 못해도 다음에 다시 쓰면 된다.
  }
}
