import { afterEach, describe, expect, it, vi } from "vitest";
import { parseClientCommand } from "../../shared/schemas";
import { newRequestId } from "../../client/requestId";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("명령 요청 id", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("uses the browser's own generator when it exists", () => {
    const randomUUID = vi.fn(() => "00000000-0000-4000-8000-000000000001" as const);
    vi.stubGlobal("crypto", { randomUUID, getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });

    expect(newRequestId()).toBe("00000000-0000-4000-8000-000000000001");
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it("still makes an id when randomUUID is missing", () => {
    // crypto.randomUUID는 https나 localhost에서만 있다. 같은 네트워크에서 http로 들어오면 없다.
    // getRandomValues는 그런 자리에서도 쓸 수 있으므로 그것으로 직접 만든다.
    vi.stubGlobal("crypto", {
      getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
    });

    const id = newRequestId();

    expect(id).toMatch(UUID_V4);
    expect(newRequestId()).not.toBe(id);
  });

  it("makes an id the server will accept", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
    });

    // 서버는 requestId를 uuid로 검사한다. 모양만 그럴듯해서는 안 되고 실제로 통과해야 한다.
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const parsed = parseClientCommand({
        type: "SET_READY",
        ready: true,
        roomVersion: 1,
        requestId: newRequestId(),
      });
      expect(parsed.success).toBe(true);
    }
  });
});
