import { describe, expect, it } from "vitest";
import type { PublicGameState } from "../../shared/protocol";
import {
  controllerIdOf,
  sideClass,
  sideName,
  sideSlotOf,
  sideSlots,
  SIDE_COUNT,
} from "../../client/sideColor";

type Piece = PublicGameState["pieces"][number];

function individualPieces(ownerIds: readonly string[]): Piece[] {
  return ownerIds.flatMap((ownerId) => Array.from({ length: 4 }, (unusedValue, index) => ({
    id: `${ownerId}-${index + 1}`,
    ownerId,
    status: "HOME" as const,
    stackSize: 1,
  })));
}

function teamPieces(teamIds: readonly ["A" | "B" | "C" | "D", string][]): Piece[] {
  return teamIds.flatMap(([teamId, ownerId]) => Array.from({ length: 4 }, (unusedValue, index) => ({
    id: `${teamId}-${index + 1}`,
    ownerId,
    teamId,
    status: "HOME" as const,
    stackSize: 1,
  })));
}

describe("편 색 배정", () => {
  it("gives every player in an individual game its own colour", () => {
    const slots = sideSlots(individualPieces(["p1", "p2", "p3", "p4"]));

    expect([...slots.values()]).toEqual([0, 1, 2, 3]);
    expect(new Set(slots.values()).size).toBe(SIDE_COUNT);
  });

  it("keeps a team's colour tied to its name, not to the seating", () => {
    const slots = sideSlots(teamPieces([["C", "p1"], ["A", "p2"], ["D", "p3"], ["B", "p4"]]));

    expect(slots.get("A")).toBe(0);
    expect(slots.get("B")).toBe(1);
    expect(slots.get("C")).toBe(2);
    expect(slots.get("D")).toBe(3);
    // 팀전에서는 참가자가 아니라 팀이 색을 가진다.
    expect(slots.has("p1")).toBe(false);
  });

  it("holds a colour still when the player list changes mid-game", () => {
    const pieces = individualPieces(["p1", "p2", "p3"]);
    const before = sideSlots(pieces);
    // 말 목록은 게임 시작 때 정해지므로, 참가자 목록이 흔들려도 같은 색이 나온다.
    const after = sideSlots([...pieces].reverse().reverse());

    ["p1", "p2", "p3"].forEach((ownerId) => {
      expect(after.get(ownerId)).toBe(before.get(ownerId));
    });
    expect(sideSlotOf(before, { ownerId: "p2" })).toBe(1);
  });

  it("reads a side by team first and by owner otherwise", () => {
    expect(controllerIdOf({ teamId: "B", ownerId: "p9" })).toBe("B");
    expect(controllerIdOf({ ownerId: "p9" })).toBe("p9");

    const slots = sideSlots(individualPieces(["p1", "p2"]));
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
