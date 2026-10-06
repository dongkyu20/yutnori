import { expect, test, type Page } from "@playwright/test";
import {
  advanceCurrentTurn,
  closePlayers,
  createRoom,
  currentNickname,
  enabledPieceIds,
  joinRoom,
  openPlayer,
  performLegalAction,
  readyPlayer,
  roomVersion,
  startGame,
  throwPending,
  waitForVersionAfter,
  type BrowserPlayer,
} from "./helpers";

const TURN_ORDER = ["AOne", "BOne", "COne", "DOne", "ATwo", "BTwo", "CTwo", "DTwo"];

interface TeamTurnView {
  actionEnabled: boolean;
  currentNickname: string | null;
  pieceIds: string[];
}

/** 한 페이지의 차례·팀 말·조작 권한을 같은 DOM 시점에서 읽는다. */
async function teamTurnView(page: Page, teamId: string): Promise<TeamTurnView> {
  return page.evaluate((controllerId) => {
    const pieceIds = [...document.querySelectorAll<HTMLElement>(`[data-controller-id='${controllerId}']`)]
      .flatMap((element) => (element.dataset.pieceIds ?? "").split(","))
      .filter(Boolean);
    return {
      actionEnabled: document.querySelector(
        ".turn-panel__throw:enabled, button.yut-piece:enabled, button.yut-route:enabled",
      ) !== null,
      currentNickname: document
        .querySelector<HTMLElement>(".game-player[aria-current='true'] strong")
        ?.innerText.trim() ?? null,
      pieceIds: [...new Set(pieceIds)].sort(),
    };
  }, teamId);
}

test("eight isolated players fill teams A-D and share pieces in interleaved turn order", async ({ browser }, testInfo) => {
  const players: BrowserPlayer[] = [];
  try {
    for (const nickname of TURN_ORDER) players.push(await openPlayer(browser, testInfo, nickname));
    const host = players[0];
    const roomCode = await createRoom(host, "team");
    for (const player of players.slice(1)) await joinRoom(player, roomCode);

    const startButton = host.page.getByRole("button", { name: "게임 시작" });
    await expect(startButton).toBeDisabled();
    for (const player of players) {
      const teamId = player.nickname[0];
      const before = await roomVersion(host.page);
      await host.page.getByLabel(`${player.nickname} 팀 배정`).selectOption(teamId);
      await waitForVersionAfter(players, before);
    }
    for (const teamId of ["A", "B", "C", "D"]) {
      await expect(host.page.getByRole("region", { name: `${teamId}팀`, exact: true })).toContainText("2/2");
    }
    await expect(startButton).toBeDisabled();

    for (const player of players.slice(0, -1)) {
      await readyPlayer(player, players);
      await expect(startButton).toBeDisabled();
    }
    await readyPlayer(players.at(-1)!, players);
    await expect(startButton).toBeEnabled();
    await startGame(host, players);

    for (let index = 0; index < TURN_ORDER.length; index += 1) {
      const expectedNickname = TURN_ORDER[index];
      expect(await currentNickname(host.page)).toBe(expectedNickname);

      const teamId = expectedNickname[0];
      const expectedPieceIds = [`${teamId}-1`, `${teamId}-2`, `${teamId}-3`, `${teamId}-4`];
      const teammateIndex = (index + 4) % 8;
      const views = await Promise.all(players.map((player) => teamTurnView(player.page, teamId)));
      expect(views.map((view) => view.currentNickname)).toEqual(
        Array.from({ length: players.length }, () => expectedNickname),
      );
      for (const view of views) expect(view.pieceIds).toEqual(expectedPieceIds);
      expect(views[index].actionEnabled).toBe(true);
      expect(views[teammateIndex].actionEnabled).toBe(false);
      await performLegalAction(players);
      let afterThrow = await currentNickname(host.page);
      // 윷이나 모는 던질 기회를 더 주므로, 말을 고르는 단계가 될 때까지 계속 던진다.
      let bonusThrows = 0;
      while (afterThrow === expectedNickname && (await throwPending(players[index].page))) {
        if ((bonusThrows += 1) > 50) {
          throw new Error(`${expectedNickname}의 보너스 던지기가 끝나지 않았습니다.`);
        }
        await performLegalAction(players);
        afterThrow = await currentNickname(host.page);
      }
      if (afterThrow === expectedNickname) {
        const controlledPieceIds = await enabledPieceIds(players[index].page);
        expect(controlledPieceIds.length).toBeGreaterThan(0);
        expect(controlledPieceIds.every((pieceId) => expectedPieceIds.includes(pieceId))).toBe(true);
        expect(await enabledPieceIds(players[teammateIndex].page)).toEqual([]);
        await advanceCurrentTurn(players);
      }
      expect(await enabledPieceIds(players[teammateIndex].page)).toEqual([]);
    }
    expect(await currentNickname(host.page)).toBe("AOne");
  } finally {
    await closePlayers(players);
  }
});
