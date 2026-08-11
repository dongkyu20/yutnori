import { expect, test } from "@playwright/test";
import {
  closePlayers,
  createRoom,
  currentNickname,
  joinRoom,
  openPlayer,
  performLegalAction,
  pieceState,
  playToWinner,
  readyPlayer,
  roomVersion,
  startGame,
  type BrowserPlayer,
} from "./helpers";

test("two isolated players create, join, move, and finish the same authoritative game", async ({ browser }, testInfo) => {
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
    expect(await currentNickname(host.page)).toBe("Host");
    expect(await currentNickname(guest.page)).toBe("Host");

    const beforeThrow = await roomVersion(host.page);
    await host.page.getByRole("button", { name: "윷 던지기" }).click();
    await expect.poll(async () => roomVersion(guest.page)).toBeGreaterThan(beforeThrow);
    expect(await roomVersion(host.page)).toBe(await roomVersion(guest.page));
    expect(await host.page.locator(".yut-result").innerText()).toBe(
      await guest.page.locator(".yut-result").innerText(),
    );

    const initialPieces = await pieceState(host.page);
    for (let action = 0; action < 20 && JSON.stringify(await pieceState(host.page)) === JSON.stringify(initialPieces); action += 1) {
      await performLegalAction(players);
    }
    expect(await pieceState(host.page)).not.toEqual(initialPieces);
    expect(await pieceState(host.page)).toEqual(await pieceState(guest.page));
    expect(await roomVersion(host.page)).toBe(await roomVersion(guest.page));

    await playToWinner(players);
    const hostResult = host.page.getByRole("dialog", { name: "경기 결과" });
    const guestResult = guest.page.getByRole("dialog", { name: "경기 결과" });
    await expect(hostResult).toBeVisible();
    await expect(guestResult).toBeVisible();
    expect(await hostResult.innerText()).toBe(await guestResult.innerText());
    expect(await pieceState(host.page)).toEqual(await pieceState(guest.page));
  } finally {
    await closePlayers(players);
  }
});
