import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  controllerIdOf,
  sideClass,
  sideName,
  sideSlotOf,
  sideSlots,
  SIDE_COLORS,
  SIDE_COUNT,
  SIDE_NAMES,
} from "../../client/sideColor";

describe("편 색 배정", () => {
  it("reads each player's own chosen colour", () => {
    const slots = sideSlots([
      { id: "p1", colorSlot: 3 },
      { id: "p2", colorSlot: 0 },
      { id: "p3", colorSlot: 2 },
    ]);

    // 자리 순서가 아니라 고른 값을 그대로 쓴다.
    expect(slots.get("p1")).toBe(3);
    expect(slots.get("p2")).toBe(0);
    expect(slots.get("p3")).toBe(2);
    expect(slots.size).toBeLessThanOrEqual(SIDE_COUNT);
  });

  it("gives a team one colour that both members share", () => {
    const slots = sideSlots([
      { id: "p1", teamId: "A", colorSlot: 2 },
      { id: "p2", teamId: "A", colorSlot: 2 },
      { id: "p3", teamId: "B", colorSlot: 0 },
      { id: "p4", teamId: "B", colorSlot: 0 },
    ]);

    expect(slots.get("A")).toBe(2);
    expect(slots.get("B")).toBe(0);
    // 팀전에서는 참가자가 아니라 팀이 색을 가진다.
    expect(slots.has("p1")).toBe(false);
  });

  it("leaves a player without a colour until they pick one", () => {
    // 대기실에서는 아직 아무 색도 없을 수 있다. 그때는 색 클래스를 붙이지 않는다.
    const slots = sideSlots([{ id: "p1", colorSlot: 1 }, { id: "p2" }]);

    expect(slots.get("p1")).toBe(1);
    expect(slots.has("p2")).toBe(false);
    expect(sideSlotOf(slots, { ownerId: "p2" })).toBeUndefined();
    expect(sideClass("yut-piece", sideSlotOf(slots, { ownerId: "p2" }))).toBe("yut-piece");
  });

  it("reads a side by team first and by owner otherwise", () => {
    expect(controllerIdOf({ teamId: "B", ownerId: "p9" })).toBe("B");
    expect(controllerIdOf({ ownerId: "p9" })).toBe("p9");

    const slots = sideSlots([{ id: "p1", colorSlot: 0 }, { id: "p2", colorSlot: 1 }]);
    expect(sideSlotOf(slots, { ownerId: "p2" })).toBe(1);
    expect(sideSlotOf(slots, { ownerId: "unknown" })).toBeUndefined();
  });

  it("names the colour and falls back to a plain class for an unknown side", () => {
    expect(sideClass("yut-piece", 2)).toBe("yut-piece yut-piece--side-2");
    expect(sideClass("yut-piece", undefined)).toBe("yut-piece");
    expect(sideName(0)).toBe("주홍");
    expect(sideName(undefined)).toBeNull();
  });
});

describe("편 색 팔레트", () => {
  const hex = (value: number) => `#${value.toString(16).toUpperCase().padStart(6, "0")}`;

  it("keeps one colour per side in the same order as the names", () => {
    expect(SIDE_COLORS).toHaveLength(SIDE_COUNT);
    expect(SIDE_COLORS).toHaveLength(SIDE_NAMES.length);
    SIDE_COLORS.forEach((colour) => {
      expect(colour.base).toBeGreaterThanOrEqual(0);
      expect(colour.base).toBeLessThanOrEqual(0xffffff);
      expect(colour.deep).not.toBe(colour.base);
    });
  });

  it("matches the colours the stylesheet paints, so 3D and CSS cannot drift", () => {
    // globals.css의 .yut-piece--side-N이 쓰는 색과 팔레트가 어긋나면 판과 목록의 색이 달라진다.
    const stylesheet = readFileSync(
      new URL("../../app/globals.css", import.meta.url),
      "utf8",
    );

    SIDE_COLORS.forEach((colour, slot) => {
      const rule = new RegExp(`\\.yut-piece--side-${slot}\\s*\\{[^}]*\\}`).exec(stylesheet);
      expect(rule, `.yut-piece--side-${slot} 규칙이 없습니다`).not.toBeNull();
      expect(rule![0].toUpperCase()).toContain(hex(colour.base));
      expect(rule![0].toUpperCase()).toContain(hex(colour.deep));
    });
  });
});
