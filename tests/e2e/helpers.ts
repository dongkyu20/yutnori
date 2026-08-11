import { expect, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";

export const RECONNECT_TOKEN_KEY = "hanpanyut.reconnectToken";

export interface BrowserPlayer {
  context: BrowserContext;
  nickname: string;
  page: Page;
}

function projectContextOptions(testInfo: TestInfo) {
  const use = testInfo.project.use;
  return {
    viewport: use.viewport,
    userAgent: use.userAgent,
    deviceScaleFactor: use.deviceScaleFactor,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
  };
}

export async function openPlayer(
  browser: Browser,
  testInfo: TestInfo,
  nickname: string,
  reconnectToken?: string,
): Promise<BrowserPlayer> {
  const context = await browser.newContext(projectContextOptions(testInfo));
  if (reconnectToken) {
    await context.addInitScript(
      ({ key, token }) => window.localStorage.setItem(key, token),
      { key: RECONNECT_TOKEN_KEY, token: reconnectToken },
    );
  }
  const page = await context.newPage();
  await page.goto(testInfo.project.use.baseURL as string);
  await expect(page.getByText(/서버[에와] 연결되었습니다\./)).toBeVisible();
  return { context, nickname, page };
}

export async function closePlayers(players: readonly BrowserPlayer[]): Promise<void> {
  await Promise.all(players.map(async ({ context }) => {
    await context.close().catch(() => undefined);
  }));
}

export async function createRoom(host: BrowserPlayer, mode: "individual" | "team"): Promise<string> {
  await host.page.getByLabel("닉네임").fill(host.nickname);
  if (mode === "team") {
    await host.page.getByRole("button", { name: "8명 · 4팀 대항전" }).click();
  }
  await host.page.getByRole("button", {
    name: mode === "team" ? "팀 대항전 방 만들기" : "개인전 방 만들기",
  }).click();
  await expect(host.page.getByRole("heading", { name: "대기실" })).toBeVisible();
  return (await host.page.locator("header strong").textContent())!.trim();
}

export async function joinRoom(player: BrowserPlayer, roomCode: string): Promise<void> {
  await player.page.getByLabel("닉네임").fill(player.nickname);
  await player.page.getByLabel("방 코드").fill(roomCode);
  await player.page.getByRole("button", { name: "방 참가하기" }).click();
  await expect(player.page.getByRole("heading", { name: "대기실" })).toBeVisible();
}

export async function roomVersion(page: Page): Promise<number> {
  const value = await page.locator("main[data-room-version]").getAttribute("data-room-version");
  return Number(value);
}

export async function waitForVersionAfter(
  players: readonly BrowserPlayer[],
  previousVersion: number,
): Promise<number> {
  await expect.poll(async () => {
    const versions = await Promise.all(players.map(({ page }) => roomVersion(page)));
    return versions.every((version) => version > previousVersion) && new Set(versions).size === 1;
  }).toBe(true);
  return roomVersion(players[0].page);
}

export async function readyPlayer(
  player: BrowserPlayer,
  observers: readonly BrowserPlayer[],
): Promise<number> {
  const before = await roomVersion(player.page);
  await player.page.getByRole("button", { name: "준비하기" }).click();
  return waitForVersionAfter(observers, before);
}

export async function startGame(
  host: BrowserPlayer,
  observers: readonly BrowserPlayer[],
): Promise<number> {
  const before = await roomVersion(host.page);
  await host.page.getByRole("button", { name: "게임 시작" }).click();
  await expect(host.page.getByRole("heading", { name: "윷판" })).toBeVisible();
  return waitForVersionAfter(observers, before);
}

export async function currentNickname(page: Page): Promise<string> {
  return (await page.locator(".game-player[aria-current='true'] strong").textContent())!.trim();
}

export async function pieceState(page: Page): Promise<string[]> {
  return page.locator("[data-piece-ids]").evaluateAll((elements) => elements.map((element) => [
    element.getAttribute("data-piece-ids"),
    element.getAttribute("data-piece-status"),
    element.getAttribute("data-node-id"),
    element.getAttribute("data-controller-id"),
  ].join(":")).sort());
}

export async function teamPieceIds(page: Page, teamId: string): Promise<string[]> {
  const values = await page.locator(`[data-controller-id='${teamId}']`).evaluateAll((elements) =>
    elements.flatMap((element) => (element.getAttribute("data-piece-ids") ?? "").split(",")),
  );
  return [...new Set(values.filter(Boolean))].sort();
}

export async function enabledPieceIds(page: Page): Promise<string[]> {
  const values = await page.locator("button.yut-piece:enabled").evaluateAll((elements) =>
    elements.flatMap((element) => (element.getAttribute("data-piece-ids") ?? "").split(",")),
  );
  return [...new Set(values.filter(Boolean))].sort();
}

export async function performLegalAction(
  players: readonly BrowserPlayer[],
): Promise<number> {
  const nickname = await currentNickname(players[0].page);
  const actor = players.find((player) => player.nickname === nickname);
  if (!actor) throw new Error(`Current browser player ${nickname} was not found.`);
  const before = await roomVersion(actor.page);
  const throwButton = actor.page.getByRole("button", { name: "윷 던지기" });
  const pieceButton = actor.page.locator("button.yut-piece:enabled").first();
  const routeButton = actor.page.locator("button.yut-route:enabled").first();

  if (await throwButton.count() && await throwButton.isEnabled()) await throwButton.click();
  else if (await pieceButton.count()) await pieceButton.click();
  else if (await routeButton.count()) await routeButton.click();
  else throw new Error(`No legal action was rendered for ${nickname}.`);

  return waitForVersionAfter(players, before);
}

export async function advanceCurrentTurn(players: readonly BrowserPlayer[]): Promise<string> {
  const startingNickname = await currentNickname(players[0].page);
  for (let action = 0; action < 50; action += 1) {
    await performLegalAction(players);
    const nextNickname = await currentNickname(players[0].page);
    if (nextNickname !== startingNickname) return nextNickname;
  }
  throw new Error(`${startingNickname}'s turn did not complete after 50 legal actions.`);
}

export async function playToWinner(players: readonly BrowserPlayer[]): Promise<void> {
  for (let action = 0; action < 1_000; action += 1) {
    if (await players[0].page.getByRole("dialog", { name: "경기 결과" }).count()) return;
    await performLegalAction(players);
  }
  throw new Error("The seeded game did not finish after 1,000 legal actions.");
}
