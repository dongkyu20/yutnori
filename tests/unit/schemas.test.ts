import { describe, expect, it } from "vitest";
import { nicknameSchema, normalizeNickname, parseClientCommand, roomCodeSchema } from "../../shared/schemas";

describe("guest inputs", () => {
  it("normalizes internal whitespace", () => {
    expect(normalizeNickname("  \uC737   \uACE0\uC218 ")).toBe("\uC737 \uACE0\uC218");
  });

  it("rejects a one-character nickname", () => {
    expect(nicknameSchema.safeParse("\uAE40").success).toBe(false);
  });

  it.each(["\uD83D\uDE00\uD83D\uDE00", "\uAE40 \uC218", "yut1", "abcdefghijklm"])(
    "rejects an invalid nickname: %s",
    (nickname) => {
      expect(nicknameSchema.safeParse(nickname).success).toBe(false);
    },
  );

  it.each(["go", "\uAC00\uB098\uB2E4\uB77C\uB9C8\uBC14\uC0AC\uC544\uC790\uCC28\uCE74\uD0C0"])(
    "accepts an allowed nickname at the length boundary: %s",
    (nickname) => {
      expect(nicknameSchema.safeParse(nickname).success).toBe(true);
    },
  );

  it("accepts an unambiguous six-character room code", () => {
    expect(roomCodeSchema.parse("7KM2RX")).toBe("7KM2RX");
  });

  it("rejects ambiguous room-code characters", () => {
    expect(roomCodeSchema.safeParse("O0IL12").success).toBe(false);
  });

  it("rejects the removed throw-power option", () => {
    expect(parseClientCommand({
      type: "THROW_YUT",
      power: "hard",
      roomVersion: 1,
      requestId: "00000000-0000-4000-8000-000000000001",
    }).success).toBe(false);
  });

  it("accepts a team shuffle and rejects extra fields on it", () => {
    const base = { type: "SHUFFLE_TEAMS", roomVersion: 3, requestId: "00000000-0000-4000-8000-000000000002" };
    expect(parseClientCommand(base).success).toBe(true);
    expect(parseClientCommand({ ...base, seed: 1 }).success).toBe(false);
  });
});
