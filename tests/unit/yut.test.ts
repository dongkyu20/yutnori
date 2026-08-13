import { describe, expect, it } from "vitest";
import { throwYut } from "../../server/game/yut";

const rng = (values: number[]) => {
  let index = 0;
  return () => values[index++];
};

describe("throwYut", () => {
  it("returns back-do when only the marked stick is flat", () => {
    expect(throwYut(rng([0.1, 0.9, 0.9, 0.9]))).toMatchObject({
      result: "BACK_DO",
      distance: -1,
    });
  });

  it("returns yut for four flat sides", () => {
    expect(throwYut(rng([0.1, 0.1, 0.1, 0.1]))).toMatchObject({
      result: "YUT",
      distance: 4,
      bonusThrows: 1,
    });
  });

  it("returns mo for four rounded sides", () => {
    expect(throwYut(rng([0.9, 0.9, 0.9, 0.9]))).toMatchObject({
      result: "MO",
      distance: 5,
      bonusThrows: 1,
    });
  });

  it.each([
    { name: "do", values: [0.9, 0.1, 0.9, 0.9], result: "DO", distance: 1 },
    { name: "gae", values: [0.1, 0.1, 0.9, 0.9], result: "GAE", distance: 2 },
    { name: "geol", values: [0.1, 0.1, 0.1, 0.9], result: "GEOL", distance: 3 },
  ] as const)("returns $name for its flat-side count", ({ values, result, distance }) => {
    expect(throwYut(rng([...values]))).toMatchObject({ result, distance, bonusThrows: 0 });
  });
});
