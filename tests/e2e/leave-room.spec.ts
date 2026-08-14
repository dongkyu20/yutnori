import { expect, test } from "@playwright/test";
import {
  closePlayers,
  createRoom,
  joinRoom,
  openPlayer,
  readyPlayer,
  startGame,
  type BrowserPlayer,
} from "./helpers";

test("leaving releases the waiting-room seat and removes the player from an active game", async ({ browser }, testInfo) => {
  const players: BrowserPlayer[] = [];
  try {
    const host = await openPlayer(browser, testInfo, "Host");
    const guest = await openPlayer(browser, testInfo, "Guest");
    players.push(host, guest);
    const roomCode = await createRoom(host, "individual");
    await joinRoom(guest, roomCode);

    await guest.page.getByRole("button", { name: "방 나가기" }).click();
    await expect(guest.page.getByRole("heading", { name: "같이 던지고, 함께 웃는 한판" }))
      .toBeVisible();
    await expect(host.page.locator("li[data-player-id]", { hasText: "Guest" })).toHaveCount(0);
    await expect(guest.page.getByText("서버에 연결되었습니다.")).toBeVisible();

    guest.nickname = "GuestTwo";
    await joinRoom(guest, roomCode);
    await readyPlayer(host, players);
    await readyPlayer(guest, players);
    await startGame(host, players);

    guest.page.once("dialog", (dialog) => void dialog.accept());
    await guest.page.getByRole("button", { name: "방 나가기" }).click();

    await expect(guest.page.getByRole("heading", { name: "같이 던지고, 함께 웃는 한판" }))
      .toBeVisible();
    await expect(host.page.getByRole("dialog", { name: "경기 결과" })).toBeVisible();
    await expect(host.page.getByRole("dialog", { name: "경기 결과" })).toContainText("Host 승리!");
    await expect(host.page.locator("li[data-player-id]", { hasText: "GuestTwo" })).toHaveCount(0);
  } finally {
    await closePlayers(players);
  }
});
