import { expect, test } from "@playwright/test";
import {
  RECONNECT_TOKEN_KEY,
  closePlayers,
  createRoom,
  currentNickname,
  joinRoom,
  openPlayer,
  readyPlayer,
  roomVersion,
  startGame,
  type BrowserPlayer,
} from "./helpers";

test("reload restores the seat and disconnect drives an automatic legal action before token recovery", async ({ browser }, testInfo) => {
  const players: BrowserPlayer[] = [];
  try {
    const host = await openPlayer(browser, testInfo, "Host");
    const guest = await openPlayer(browser, testInfo, "Guest");
    players.push(host, guest);
    const roomCode = await createRoom(host, "individual");
    await joinRoom(guest, roomCode);
    await readyPlayer(host, players);
    await readyPlayer(guest, players);
    await startGame(host, players);

    const token = await host.page.evaluate((key) => window.localStorage.getItem(key), RECONNECT_TOKEN_KEY);
    const seat = host.page.locator("li[data-player-id]", { hasText: "Host" });
    const playerId = await seat.getAttribute("data-player-id");
    expect(token).toBeTruthy();
    expect(playerId).toBeTruthy();

    await host.page.reload();
    await expect(host.page.getByRole("heading", { name: "윷판" })).toBeVisible();
    await expect(host.page.locator(`li[data-player-id='${playerId}']`)).toContainText("연결됨");
    expect(await host.page.evaluate((key) => window.localStorage.getItem(key), RECONNECT_TOKEN_KEY)).toBe(token);

    const beforeClose = await roomVersion(guest.page);
    await host.context.close();
    players.splice(players.indexOf(host), 1);
    await expect.poll(async () => roomVersion(guest.page), { timeout: 5_000 }).toBeGreaterThan(beforeClose + 1);
    await expect.poll(async () => currentNickname(guest.page)).toBe("Guest");
    const automaticVersion = await roomVersion(guest.page);

    const restored = await openPlayer(browser, testInfo, "Host", token!);
    players.push(restored);
    await expect(restored.page.getByRole("heading", { name: "윷판" })).toBeVisible();
    await expect(restored.page.locator(`li[data-player-id='${playerId}']`)).toContainText("연결됨");
    await expect.poll(async () => roomVersion(restored.page)).toBeGreaterThan(automaticVersion);
    await expect.poll(async () => roomVersion(guest.page)).toBe(await roomVersion(restored.page));
    expect(await restored.page.evaluate((key) => window.localStorage.getItem(key), RECONNECT_TOKEN_KEY)).toBe(token);
  } finally {
    await closePlayers(players);
  }
});
