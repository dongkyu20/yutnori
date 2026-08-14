import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  fileURLToPath(new URL("../../app/globals.css", import.meta.url)),
  "utf8",
);

function ruleBody(selector: string): string {
  const match = new RegExp(`(?:^|\\n)\\s*${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`${selector} 규칙을 찾지 못했습니다.`);
  return match[1];
}

/**
 * 갈 곳 버튼과 미리 보기는 판 전체를 덮는 층(inset: 0)이고 말 버튼보다 위에 있다.
 * 층이 클릭을 먹으면 말을 하나 고른 뒤 다른 말로 바꿔 고를 수 없다. 판 위에 말이
 * 하나뿐일 때는 드러나지 않아, 실제로 두 번째 말이 나가서야 알게 된 함정이다.
 * jsdom은 맞닿음 판정을 하지 않으므로 규칙 자체를 지킨다.
 */
describe("판을 덮는 층", () => {
  it.each([".yut-choices", ".yut-preview"])("%s는 클릭을 통과시킨다", (selector) => {
    expect(ruleBody(selector)).toMatch(/pointer-events:\s*none/);
    expect(ruleBody(selector)).toMatch(/inset:\s*0/);
  });

  it("갈 곳 버튼 자신은 다시 눌리게 한다", () => {
    expect(ruleBody(".yut-choice")).toMatch(/pointer-events:\s*auto/);
  });
});
