import { describe, expect, it } from "vitest";
import { getMoveOptions } from "../../server/game/board";

describe("Yut board routes", () => {
  it("offers outer and center routes from the first corner", () => {
    const options = getMoveOptions({ nodeId: "O5", routeId: "OUTER" }, 2);

    expect(options).toEqual([
      { routeId: "OUTER", nodeId: "O7", finished: false, traversed: ["O6", "O7"] },
      { routeId: "CENTER_A", nodeId: "D1_2", finished: false, traversed: ["D1_1", "D1_2"] },
    ]);
  });

  it("offers outer and second center routes from the second corner", () => {
    expect(getMoveOptions({ nodeId: "O10", routeId: "OUTER" }, 2)).toEqual([
      { routeId: "OUTER", nodeId: "O12", finished: false, traversed: ["O11", "O12"] },
      { routeId: "CENTER_B", nodeId: "D3_2", finished: false, traversed: ["D3_1", "D3_2"] },
    ]);
  });

  it("uses the recorded first diagonal route after both paths merge at center", () => {
    expect(getMoveOptions({ nodeId: "CENTER", routeId: "CENTER_A" }, 1)).toEqual([
      { routeId: "CENTER_A", nodeId: "D2_2", finished: false, traversed: ["D2_2"] },
    ]);
  });

  it("uses the recorded second diagonal route after both paths merge at center", () => {
    expect(getMoveOptions({ nodeId: "CENTER", routeId: "CENTER_B" }, 1)).toEqual([
      { routeId: "CENTER_B", nodeId: "D4_2", finished: false, traversed: ["D4_2"] },
    ]);
  });

  it("returns the prior outer node for back-do", () => {
    expect(getMoveOptions({ nodeId: "O8", routeId: "OUTER" }, -1)).toEqual([
      { routeId: "OUTER", nodeId: "O7", finished: false, traversed: ["O7"] },
    ]);
  });

  it("follows the recorded diagonal predecessor for back-do", () => {
    expect(getMoveOptions({ nodeId: "CENTER", routeId: "CENTER_A" }, -1)).toEqual([
      { routeId: "CENTER_A", nodeId: "D1_2", finished: false, traversed: ["D1_2"] },
    ]);
  });

  it("finishes on exact home arrival", () => {
    expect(getMoveOptions({ nodeId: "O19", routeId: "OUTER" }, 1)).toEqual([
      { routeId: "OUTER", nodeId: "FINISH", finished: true, traversed: ["FINISH"] },
    ]);
  });

  it("finishes when movement passes home", () => {
    expect(getMoveOptions({ nodeId: "O19", routeId: "OUTER" }, 2)).toEqual([
      { routeId: "OUTER", nodeId: "FINISH", finished: true, traversed: ["FINISH"] },
    ]);
  });
});
