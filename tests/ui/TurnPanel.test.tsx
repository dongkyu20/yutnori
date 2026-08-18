/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicGameState, PublicRoomSnapshot } from "../../shared/protocol";
import { TurnPanel } from "../../client/components/TurnPanel";
import { settleMsFor } from "../../client/three/yutStick";
import { GameScreen } from "../../client/components/GameScreen";

function createGame(overrides: Partial<PublicGameState> = {}): PublicGameState {
  return {
    currentPlayerId: "player-a",
    turnStage: "AWAITING_THROW",
    actionExpiresAt: null,
    pieces: [],
    pendingThrows: [],
    throwsRemaining: 0,
    legalPieceIds: [],
    legalRoutes: [],
    lastThrow: null,
    lastMove: null,
    winnerId: null,
    events: [],
    ...overrides,
  };
}

const players: PublicRoomSnapshot["players"] = [
  { id: "player-a", nickname: "민수", connected: true, ready: true },
  { id: "player-b", nickname: "지수", connected: true, ready: true },
];

describe("TurnPanel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    // 스텁한 matchMedia는 restoreAllMocks가 되돌리지 않는다. 남겨 두면 다음 시험이
    // 움직임을 줄인 환경으로 오해해 연출이 아예 없는 것으로 본다.
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("announces the current turn, shows stage-specific Korean guidance, and disables another player's action", () => {
    const { rerender } = render(
      <TurnPanel game={createGame()} currentPlayerNickname="민수" isCurrentPlayer={false} onThrow={() => undefined} />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("현재 차례: 민수");
    expect(screen.getByText("윷을 던지세요")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "윷 던지기" })).toBeDisabled();

    rerender(
      <TurnPanel
        game={createGame({ turnStage: "AWAITING_PIECE" })}
        currentPlayerNickname="민수"
        isCurrentPlayer
        onThrow={() => undefined}
      />,
    );
    expect(screen.getByText("움직일 말을 고른 뒤 갈 칸을 고르세요")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "윷 던지기" })).not.toBeInTheDocument();

    rerender(
      <TurnPanel
        game={createGame({ turnStage: "AWAITING_ROUTE" })}
        currentPlayerNickname="민수"
        isCurrentPlayer
        onThrow={() => undefined}
      />,
    );
    expect(screen.getByText("갈 길을 고르세요")).toBeInTheDocument();
  });

  it.each([
    ["BACK_DO", "빽도"],
    ["DO", "도"],
    ["GAE", "개"],
    ["GEOL", "걸"],
    ["YUT", "윷"],
    ["MO", "모"],
  ] as const)("renders the %s result as Korean text", (result, koreanName) => {
    render(
      <TurnPanel
        game={createGame({
          lastThrow: {
            eventId: `event-${result}`,
            result,
            sticks: [true, false, false, false],
            animationSeed: `seed-${result}`,
          },
        })}
        currentPlayerNickname="민수"
        isCurrentPlayer
        onThrow={() => undefined}
      />,
    );

    expect(screen.getByText(`던진 결과: ${koreanName}`)).toBeInTheDocument();
    expect(screen.getAllByLabelText(/번 윷가락/)).toHaveLength(4);
  });

  it("activates the throw button with Space and Enter", async () => {
    const user = userEvent.setup();
    const onThrow = vi.fn();
    render(
      <TurnPanel
        game={createGame()}
        currentPlayerNickname="민수"
        isCurrentPlayer


        onThrow={onThrow}
      />,
    );
    const throwButton = screen.getByRole("button", { name: "윷 던지기" });

    throwButton.focus();
    await user.keyboard(" ");
    await user.keyboard("{Enter}");
    expect(onThrow).toHaveBeenCalledTimes(2);
  });

  it("세기 선택 없이 한 번에 던진다", async () => {
    const user = userEvent.setup();
    const onThrow = vi.fn();
    render(
      <TurnPanel
        game={createGame()}
        currentPlayerNickname="민수"
        isCurrentPlayer
        onThrow={onThrow}
      />,
    );

    expect(screen.queryByRole("group", { name: "던지는 힘" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "살살" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "힘껏" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "윷 던지기" }));
    expect(onThrow).toHaveBeenCalledWith();
  });

  it("holds the result back until the sticks have landed", () => {
    // 결과를 먼저 글자로 알려 주면 굴러가는 윷을 볼 까닭이 없어진다.
    vi.useFakeTimers();
    const initial = createGame({
      lastThrow: { eventId: "event-1", result: "DO", sticks: [true, false, false, false], animationSeed: "seed-1" },
    });
    const { rerender } = render(
      <TurnPanel game={initial} currentPlayerNickname="민수" isCurrentPlayer onThrow={() => undefined} />,
    );
    expect(screen.getByText("던진 결과: 도")).toBeInTheDocument();

    rerender(
      <TurnPanel
        game={{ ...initial, lastThrow: { eventId: "event-2", result: "MO", sticks: [true, true, true, true], animationSeed: "seed-2" } }}
        currentPlayerNickname="민수"
        isCurrentPlayer
        onThrow={() => undefined}
      />,
    );
    expect(screen.queryByText("던진 결과: 모")).not.toBeInTheDocument();

    const settleMs = settleMsFor("seed-2");
    act(() => vi.advanceTimersByTime(settleMs - 50));
    expect(screen.queryByText("던진 결과: 모")).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(50));
    expect(screen.getByText("던진 결과: 모")).toBeInTheDocument();
  });

  it("shows the result at once for a player who asked for less motion", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const initial = createGame({
      lastThrow: { eventId: "event-1", result: "DO", sticks: [true, false, false, false], animationSeed: "seed-1" },
    });
    const { rerender } = render(
      <TurnPanel game={initial} currentPlayerNickname="민수" isCurrentPlayer onThrow={() => undefined} />,
    );

    rerender(
      <TurnPanel
        game={{ ...initial, lastThrow: { eventId: "event-2", result: "MO", sticks: [true, true, true, true], animationSeed: "seed-2" } }}
        currentPlayerNickname="민수"
        isCurrentPlayer
        onThrow={() => undefined}
      />,
    );

    expect(screen.getByText("던진 결과: 모")).toBeInTheDocument();
    expect(screen.getByTestId("yut-sticks")).not.toHaveAttribute("data-animating", "true");
  });

  it("animates sticks only when the authoritative throw event id changes", () => {
    const initial = createGame({
      turnStage: "AWAITING_PIECE",
      lastThrow: { eventId: "event-1", result: "DO", sticks: [true, false, false, false], animationSeed: "seed-1" },
    });
    const { rerender } = render(
      <TurnPanel game={initial} currentPlayerNickname="민수" isCurrentPlayer onThrow={() => undefined} />,
    );

    expect(screen.getByTestId("yut-sticks")).not.toHaveAttribute("data-animating", "true");
    rerender(
      <TurnPanel
        game={{ ...initial, events: [{ id: "event-2", message: "말 이동", createdAt: 2 }] }}
        currentPlayerNickname="민수"
        isCurrentPlayer
        onThrow={() => undefined}
      />,
    );
    expect(screen.getByTestId("yut-sticks")).not.toHaveAttribute("data-animating", "true");

    rerender(
      <TurnPanel
        game={{
          ...initial,
          lastThrow: { eventId: "event-3", result: "DO", sticks: [true, false, false, false], animationSeed: "seed-3" },
        }}
        currentPlayerNickname="민수"
        isCurrentPlayer
        onThrow={() => undefined}
      />,
    );
    expect(screen.getByTestId("yut-sticks")).toHaveAttribute("data-animating", "true");
  });

  it("restarts the stick animation for a second throw before the first animation ends", () => {
    vi.useFakeTimers();
    const initial = createGame({
      turnStage: "AWAITING_PIECE",
      lastThrow: { eventId: "event-1", result: "DO", sticks: [true, false, false, false], animationSeed: "seed-1" },
    });
    const { rerender } = render(
      <TurnPanel game={initial} currentPlayerNickname="민수" isCurrentPlayer onThrow={() => undefined} />,
    );

    rerender(
      <TurnPanel
        game={{
          ...initial,
          lastThrow: { eventId: "event-2", result: "DO", sticks: [true, false, false, false], animationSeed: "seed-2" },
        }}
        currentPlayerNickname="민수"
        isCurrentPlayer
        onThrow={() => undefined}
      />,
    );
    const firstAnimatedSticks = screen.getByTestId("yut-sticks");
    expect(firstAnimatedSticks).toHaveAttribute("data-animating", "true");

    act(() => vi.advanceTimersByTime(100));
    rerender(
      <TurnPanel
        game={{
          ...initial,
          lastThrow: { eventId: "event-3", result: "DO", sticks: [true, false, false, false], animationSeed: "seed-3" },
        }}
        currentPlayerNickname="민수"
        isCurrentPlayer
        onThrow={() => undefined}
      />,
    );
    const secondAnimatedSticks = screen.getByTestId("yut-sticks");
    expect(secondAnimatedSticks).not.toBe(firstAnimatedSticks);
    expect(secondAnimatedSticks).toHaveAttribute("data-animating", "true");

    act(() => vi.advanceTimersByTime(settleMsFor("seed-3")));
    expect(screen.getByTestId("yut-sticks")).not.toHaveAttribute("data-animating", "true");
  });

  it("shows every held result without asking the player to pick one here", () => {
    render(
      <TurnPanel
        game={createGame({
          turnStage: "AWAITING_PIECE",
          pendingThrows: [
            { id: "event-1", result: "YUT", legalPieceIds: ["A-1"], moves: [] },
            { id: "event-3", result: "BACK_DO", legalPieceIds: [], moves: [] },
          ],
        })}
        currentPlayerNickname="민수"
        isCurrentPlayer
        onThrow={() => undefined}
      />,
    );

    const held = screen.getByRole("list", { name: "쓸 수 있는 결과" }).children;
    expect([...held].map((item) => item.textContent)).toEqual(["윷", "빽도, 쓸 말이 없습니다"]);
    // 어느 결과로 갈지는 판에서 갈 칸을 눌러 고른다. 이 자리에는 누를 것이 없다.
    expect(screen.queryByRole("button", { name: /쓰기/ })).not.toBeInTheDocument();
    // 쓸 말이 없는 결과는 흐리게 표시하고, 그 사정은 소리로도 읽힌다.
    expect(screen.getByText("빽도").closest("li")).toHaveClass("pending-throw--idle");
    expect(screen.getByText("윷").closest("li")).not.toHaveClass("pending-throw--idle");

    // 안내 문구도 새 순서를 말한다.
    expect(screen.getByText("움직일 말을 고른 뒤 갈 칸을 고르세요")).toBeInTheDocument();
  });

  it("asks for another throw while yut or mo keeps the turn open", () => {
    render(
      <TurnPanel
        game={createGame({
          throwsRemaining: 1,
          pendingThrows: [{ id: "event-1", result: "MO", legalPieceIds: [], moves: [] }],
        })}
        currentPlayerNickname="민수"
        isCurrentPlayer


        onThrow={() => undefined}
      />,
    );

    expect(screen.getByText("윷이나 모가 나왔습니다. 한 번 더 던지세요")).toBeInTheDocument();
    // 손에 든 모는 보여 주기만 한다. 아직 쓸 말이 없으므로 흐리다.
    expect(screen.getByText("모").closest("li")).toHaveClass("pending-throw--idle");
    expect(screen.getByRole("button", { name: "윷 던지기" })).toBeEnabled();
  });

  it("sends throw intent with the current room version and a UUID", async () => {
    const user = userEvent.setup();
    const sendCommand = vi.fn();
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000003");
    const snapshot: PublicRoomSnapshot = {
      roomCode: "AB2CDE",
      version: 21,
      phase: "playing",
      mode: "individual",
      hostPlayerId: "player-a",
      players,
      canStart: false,
      startEligibilityReason: null,
      game: createGame(),
    };
    render(<GameScreen snapshot={snapshot} playerId="player-a" sendCommand={sendCommand} />);

    await user.click(screen.getByRole("button", { name: "윷 던지기" }));

    expect(sendCommand).toHaveBeenCalledWith({
      type: "THROW_YUT",
      roomVersion: 21,
      requestId: "00000000-0000-4000-8000-000000000003",
    });
  });
});
