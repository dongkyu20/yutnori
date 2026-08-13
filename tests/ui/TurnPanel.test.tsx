/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicGameState, PublicRoomSnapshot } from "../../shared/protocol";
import { TurnPanel } from "../../client/components/TurnPanel";
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
    vi.useRealTimers();
  });

  it("announces the current turn, shows stage-specific Korean guidance, and disables another player's action", () => {
    const { rerender } = render(
      <TurnPanel game={createGame()} currentPlayerNickname="민수" isCurrentPlayer={false} activeThrowId={null} onSelectThrow={() => undefined} onThrow={() => undefined} />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("현재 차례: 민수");
    expect(screen.getByText("윷을 던지세요")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "윷 던지기" })).toBeDisabled();

    rerender(
      <TurnPanel
        game={createGame({ turnStage: "AWAITING_PIECE" })}
        currentPlayerNickname="민수"
        isCurrentPlayer
        activeThrowId={null} onSelectThrow={() => undefined} onThrow={() => undefined}
      />,
    );
    expect(screen.getByText("움직일 말을 고르세요")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "윷 던지기" })).not.toBeInTheDocument();

    rerender(
      <TurnPanel
        game={createGame({ turnStage: "AWAITING_ROUTE" })}
        currentPlayerNickname="민수"
        isCurrentPlayer
        activeThrowId={null} onSelectThrow={() => undefined} onThrow={() => undefined}
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
          lastThrow: { eventId: `event-${result}`, result, sticks: [true, false, false, false] },
        })}
        currentPlayerNickname="민수"
        isCurrentPlayer
        activeThrowId={null} onSelectThrow={() => undefined} onThrow={() => undefined}
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
        activeThrowId={null}
        onSelectThrow={() => undefined}
        onThrow={onThrow}
      />,
    );
    const throwButton = screen.getByRole("button", { name: "윷 던지기" });

    throwButton.focus();
    await user.keyboard(" ");
    await user.keyboard("{Enter}");
    expect(onThrow).toHaveBeenCalledTimes(2);
  });

  it("animates sticks only when the authoritative throw event id changes", () => {
    const initial = createGame({
      turnStage: "AWAITING_PIECE",
      lastThrow: { eventId: "event-1", result: "DO", sticks: [true, false, false, false] },
    });
    const { rerender } = render(
      <TurnPanel game={initial} currentPlayerNickname="민수" isCurrentPlayer activeThrowId={null} onSelectThrow={() => undefined} onThrow={() => undefined} />,
    );

    expect(screen.getByTestId("yut-sticks")).not.toHaveAttribute("data-animating", "true");
    rerender(
      <TurnPanel
        game={{ ...initial, events: [{ id: "event-2", message: "말 이동", createdAt: 2 }] }}
        currentPlayerNickname="민수"
        isCurrentPlayer
        activeThrowId={null} onSelectThrow={() => undefined} onThrow={() => undefined}
      />,
    );
    expect(screen.getByTestId("yut-sticks")).not.toHaveAttribute("data-animating", "true");

    rerender(
      <TurnPanel
        game={{
          ...initial,
          lastThrow: { eventId: "event-3", result: "DO", sticks: [true, false, false, false] },
        }}
        currentPlayerNickname="민수"
        isCurrentPlayer
        activeThrowId={null} onSelectThrow={() => undefined} onThrow={() => undefined}
      />,
    );
    expect(screen.getByTestId("yut-sticks")).toHaveAttribute("data-animating", "true");
  });

  it("restarts the stick animation for a second throw before the first animation ends", () => {
    vi.useFakeTimers();
    const initial = createGame({
      turnStage: "AWAITING_PIECE",
      lastThrow: { eventId: "event-1", result: "DO", sticks: [true, false, false, false] },
    });
    const { rerender } = render(
      <TurnPanel game={initial} currentPlayerNickname="민수" isCurrentPlayer activeThrowId={null} onSelectThrow={() => undefined} onThrow={() => undefined} />,
    );

    rerender(
      <TurnPanel
        game={{
          ...initial,
          lastThrow: { eventId: "event-2", result: "DO", sticks: [true, false, false, false] },
        }}
        currentPlayerNickname="민수"
        isCurrentPlayer
        activeThrowId={null} onSelectThrow={() => undefined} onThrow={() => undefined}
      />,
    );
    const firstAnimatedSticks = screen.getByTestId("yut-sticks");
    expect(firstAnimatedSticks).toHaveAttribute("data-animating", "true");

    act(() => vi.advanceTimersByTime(100));
    rerender(
      <TurnPanel
        game={{
          ...initial,
          lastThrow: { eventId: "event-3", result: "DO", sticks: [true, false, false, false] },
        }}
        currentPlayerNickname="민수"
        isCurrentPlayer
        activeThrowId={null} onSelectThrow={() => undefined} onThrow={() => undefined}
      />,
    );
    const secondAnimatedSticks = screen.getByTestId("yut-sticks");
    expect(secondAnimatedSticks).not.toBe(firstAnimatedSticks);
    expect(secondAnimatedSticks).toHaveAttribute("data-animating", "true");

    act(() => vi.advanceTimersByTime(650));
    expect(screen.getByTestId("yut-sticks")).not.toHaveAttribute("data-animating", "true");
  });

  it("offers every held result, marks the active one, and disables unusable ones", async () => {
    const user = userEvent.setup();
    const onSelectThrow = vi.fn();
    render(
      <TurnPanel
        game={createGame({
          turnStage: "AWAITING_PIECE",
          pendingThrows: [
            { id: "event-1", result: "YUT", legalPieceIds: ["A-1"] },
            { id: "event-3", result: "BACK_DO", legalPieceIds: [] },
          ],
        })}
        currentPlayerNickname="민수"
        isCurrentPlayer
        activeThrowId="event-1"
        onSelectThrow={onSelectThrow}
        onThrow={() => undefined}
      />,
    );

    const yut = screen.getByRole("button", { name: "윷 쓰기" });
    expect(yut).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "빽도 쓰기" })).toBeDisabled();

    await user.click(yut);
    expect(onSelectThrow).toHaveBeenCalledWith("event-1");
  });

  it("asks for another throw while yut or mo keeps the turn open", () => {
    render(
      <TurnPanel
        game={createGame({
          throwsRemaining: 1,
          pendingThrows: [{ id: "event-1", result: "MO", legalPieceIds: [] }],
        })}
        currentPlayerNickname="민수"
        isCurrentPlayer
        activeThrowId={null}
        onSelectThrow={() => undefined}
        onThrow={() => undefined}
      />,
    );

    expect(screen.getByText("윷이나 모가 나왔습니다. 한 번 더 던지세요")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "모 쓰기" })).toBeDisabled();
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
