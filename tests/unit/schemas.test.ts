import { describe, expect, it } from "vitest";
import { nicknameSchema, normalizeNickname, roomCodeSchema } from "../../shared/schemas";

describe("guest inputs", () => {
  it("normalizes internal whitespace", () => {
    expect(normalizeNickname("  \uC737   \uACE0\uC218 ")).toBe("\uC737 \uACE0\uC218");
  });
  it("rejects a one-character nickname", () => {
    expect(nicknameSchema.safeParse("\uAE40").success).toBe(false);
  });
  it("accepts an unambiguous six-character room code", () => {
    expect(roomCodeSchema.parse("7KM2RX")).toBe("7KM2RX");
  });
  it("rejects ambiguous room-code characters", () => {
    expect(roomCodeSchema.safeParse("O0IL12").success).toBe(false);
  });
});
