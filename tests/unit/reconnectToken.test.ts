/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearReconnectToken, readReconnectToken, writeReconnectToken } from "../../client/reconnectToken";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("reconnect token storage", () => {
  it("round-trips the token", () => {
    writeReconnectToken("token-1");
    expect(readReconnectToken()).toBe("token-1");
    clearReconnectToken();
    expect(readReconnectToken()).toBeNull();
  });

  it("survives a browser that refuses storage", () => {
    // 사생활 보호 모드나 쿠키 차단 설정에서는 접근만으로 예외가 난다.
    // 그 예외가 올라오면 화면 전체가 뜨지 않는다. 표 하나보다 훨씬 큰 손해다.
    const blocked = new Error("The operation is insecure.");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw blocked; });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw blocked; });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw blocked; });

    expect(() => writeReconnectToken("token-1")).not.toThrow();
    expect(readReconnectToken()).toBeNull();
    expect(() => clearReconnectToken()).not.toThrow();
  });
});
