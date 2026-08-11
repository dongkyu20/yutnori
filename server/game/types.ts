export type YutResult = "BACK_DO" | "DO" | "GAE" | "GEOL" | "YUT" | "MO";

export interface ThrowOutcome {
  sticks: [boolean, boolean, boolean, boolean];
  result: YutResult;
  distance: -1 | 1 | 2 | 3 | 4 | 5;
  bonusThrows: 0 | 1;
}
