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

  it("takes a team name with digits and inner spaces but no symbols", () => {
    const base = { type: "SET_TEAM_NAME", teamId: "A", roomVersion: 3, requestId: "00000000-0000-4000-8000-000000000003" };
    const nameOf = (name: string) => {
      const parsed = parseClientCommand({ ...base, name });
      return parsed.success && parsed.data.type === "SET_TEAM_NAME" ? parsed.data.name : null;
    };

    // 팀 이름은 "2조"처럼 숫자로 부르고 "범 내려온다"처럼 띄어 쓰는 일이 흔하다.
    expect(nameOf("윷가락 2조")).toBe("윷가락 2조");
    expect(nameOf("Team B")).toBe("Team B");
    // 앞뒤 공백과 거듭된 공백은 닉네임과 같은 방식으로 다듬는다.
    expect(nameOf("  범   내려온다  ")).toBe("범 내려온다");
    // 빈 이름은 이름을 지우라는 뜻이라 통과시킨다.
    expect(nameOf("")).toBe("");

    expect(nameOf("팀@A")).toBeNull();
    expect(nameOf("🔥불꽃")).toBeNull();
    expect(nameOf("열세글자짜리이름입니다")).toBe("열세글자짜리이름입니다");
    expect(nameOf("열세글자를넘기는아주긴이름")).toBeNull();
    expect(parseClientCommand({ ...base, name: "좋은이름", extra: 1 }).success).toBe(false);
  });
});
