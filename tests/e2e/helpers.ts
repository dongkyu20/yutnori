import { expect, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";

export const RECONNECT_TOKEN_KEY = "hanpanyut.reconnectToken";

export interface BrowserPlayer {
  context: BrowserContext;
  nickname: string;
  page: Page;
}

export type LegalActionResult =
  | { kind: "advanced"; version: number }
  | { kind: "finished" };

type LegalActionReadiness = "throw" | "piece" | "route" | "waiting";
type EnabledLegalAction = Exclude<LegalActionReadiness, "waiting">;

type LegalActionProbe =
  | { kind: "finished" }
  | { kind: "waiting" }
  | {
    action: EnabledLegalAction;
    actor: BrowserPlayer;
    beforeVersion: number;
    kind: "action";
    nickname: string;
  };
type ReadyLegalActionProbe = Exclude<LegalActionProbe, { kind: "waiting" }>;

const LEGAL_ACTION_DEADLINE_MS = 10_000;
// Functional E2E runs with reduced motion, so a stale action can be abandoned well within the 1s turn deadline.
const LEGAL_ACTION_CLICK_TIMEOUT_MS = 500;

interface CanonicalGameSnapshot {
  currentNickname: string | null;
  finished: boolean;
}

interface ActorGameSnapshot {
  action: LegalActionReadiness;
  finished: boolean;
  version: number;
}

function projectContextOptions(testInfo: TestInfo) {
  const use = testInfo.project.use;
  return {
    ...use.contextOptions,
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
  let convergedVersion = previousVersion;
  await expect.poll(async () => {
    const versions = await Promise.all(players.map(({ page }) => roomVersion(page)));
    const converged = versions.every((version) => version > previousVersion)
      && new Set(versions).size === 1;
    if (converged) convergedVersion = versions[0];
    return converged;
  }).toBe(true);
  return convergedVersion;
}

export async function waitForVersionConvergence(
  players: readonly BrowserPlayer[],
): Promise<number> {
  let convergedVersion = Number.NaN;
  await expect.poll(async () => {
    const versions = await Promise.all(players.map(({ page }) => roomVersion(page)));
    const converged = new Set(versions).size === 1;
    if (converged) convergedVersion = versions[0];
    return converged;
  }).toBe(true);
  return convergedVersion;
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

async function canonicalGameSnapshot(page: Page): Promise<CanonicalGameSnapshot> {
  return page.evaluate(() => {
    const dialogs = [...document.querySelectorAll<HTMLElement>("[role='dialog']")];
    const finished = dialogs.some((dialog) => dialog.innerText.includes("경기 결과"));
    const currentNickname = document
      .querySelector<HTMLElement>(".game-player[aria-current='true'] strong")
      ?.innerText.trim() ?? null;
    return { currentNickname, finished };
  });
}

async function actorGameSnapshot(page: Page): Promise<ActorGameSnapshot> {
  return page.locator("main[data-room-version]").evaluate((main) => {
    const dialogs = [...document.querySelectorAll<HTMLElement>("[role='dialog']")];
    const finished = dialogs.some((dialog) => dialog.innerText.includes("경기 결과"));
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("button:enabled")];
    const action = buttons.some((button) => button.innerText.trim() === "윷 던지기")
      ? "throw"
      : document.querySelector("button.yut-piece:enabled")
        ? "piece"
        : document.querySelector("button.yut-route:enabled")
          ? "route"
          : "waiting";
    return {
      action,
      finished,
      version: Number(main.getAttribute("data-room-version")),
    };
  });
}

async function gameFinished(players: readonly BrowserPlayer[]): Promise<boolean> {
  const snapshots = await Promise.all(players.map(({ page }) =>
    canonicalGameSnapshot(page).catch(() => ({ currentNickname: null, finished: false })),
  ));
  return snapshots.some(({ finished }) => finished);
}

async function probeLegalAction(players: readonly BrowserPlayer[]): Promise<LegalActionProbe> {
  const canonical = await canonicalGameSnapshot(players[0].page);
  if (canonical.finished) return { kind: "finished" };
  const nickname = canonical.currentNickname;
  if (!nickname) throw new Error("The canonical page has no current browser player.");
  const actor = players.find((player) => player.nickname === nickname);
  if (!actor) throw new Error(`Current browser player ${nickname} was not found.`);
  const actorSnapshot = await actorGameSnapshot(actor.page);

  if (actorSnapshot.finished) return { kind: "finished" };
  if (actorSnapshot.action === "waiting") return { kind: "waiting" };
  return {
    action: actorSnapshot.action,
    actor,
    beforeVersion: actorSnapshot.version,
    kind: "action",
    nickname,
  };
}

function actionLocator(page: Page, action: EnabledLegalAction) {
  if (action === "throw") return page.getByRole("button", { name: "윷 던지기" });
  if (action === "piece") return page.locator("button.yut-piece:enabled").first();
  return page.locator("button.yut-route:enabled").first();
}

async function legalActionDiagnostics(
  players: readonly BrowserPlayer[],
  lastClickError: string,
  lastPollError: string,
): Promise<string> {
  const canonical = await canonicalGameSnapshot(players[0].page)
    .catch(() => ({ currentNickname: null, finished: false }));
  const actor = players.find((player) => player.nickname === canonical.currentNickname) ?? players[0];
  const actorSnapshot = await actorGameSnapshot(actor.page)
    .catch(() => ({ action: "waiting" as const, finished: false, version: Number.NaN }));
  return `current=${canonical.currentNickname ?? "unavailable"}, version=${actorSnapshot.version}, `
    + `canonicalFinished=${canonical.finished}, actorFinished=${actorSnapshot.finished}, `
    + `action=${actorSnapshot.action}, lastClickError=${lastClickError}, lastPollError=${lastPollError}`;
}

export async function performLegalAction(
  players: readonly BrowserPlayer[],
): Promise<LegalActionResult> {
  const deadline = Date.now() + LEGAL_ACTION_DEADLINE_MS;
  let lastClickError = "none";
  let lastPollError = "none";

  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    let readyProbe: ReadyLegalActionProbe | undefined;
    try {
      await expect.poll(async () => {
        const next = await probeLegalAction(players);
        if (next.kind !== "waiting") readyProbe = next;
        return next.kind;
      }, {
        intervals: [50, 100, 250],
        message: "waiting for a current-player action or finish dialog",
        timeout: remaining,
      }).not.toBe("waiting");
    } catch (cause) {
      lastPollError = cause instanceof Error ? cause.message.split("\n", 1)[0] : String(cause);
      break;
    }

    const probe = readyProbe;
    if (!probe) continue;
    if (probe.kind === "finished") return { kind: "finished" };

    try {
      await actionLocator(probe.actor.page, probe.action).click({
        timeout: Math.min(LEGAL_ACTION_CLICK_TIMEOUT_MS, Math.max(1, deadline - Date.now())),
      });
    } catch (cause) {
      if (await gameFinished(players)) return { kind: "finished" };
      lastClickError = cause instanceof Error ? cause.message.split("\n", 1)[0] : String(cause);
      continue;
    }

    return {
      kind: "advanced",
      version: await waitForVersionAfter(players, probe.beforeVersion),
    };
  }

  if (await gameFinished(players)) return { kind: "finished" };
  throw new Error(
    `No legal action or finish dialog became ready before the deadline `
    + `(${await legalActionDiagnostics(players, lastClickError, lastPollError)}).`,
  );
}

export async function advanceCurrentTurn(players: readonly BrowserPlayer[]): Promise<string> {
  const startingNickname = await currentNickname(players[0].page);
  for (let action = 0; action < 50; action += 1) {
    const result = await performLegalAction(players);
    if (result.kind === "finished") {
      throw new Error(`The game finished unexpectedly while advancing ${startingNickname}'s turn.`);
    }
    const nextNickname = await currentNickname(players[0].page);
    if (nextNickname !== startingNickname) return nextNickname;
  }
  throw new Error(`${startingNickname}'s turn did not complete after 50 legal actions.`);
}

export async function playToWinner(players: readonly BrowserPlayer[]): Promise<void> {
  for (let action = 0; action < 1_000; action += 1) {
    if (await players[0].page.getByRole("dialog", { name: "경기 결과" }).count()) return;
    const result = await performLegalAction(players);
    if (result.kind === "finished") return;
  }
  throw new Error("The seeded game did not finish after 1,000 legal actions.");
}
