/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { Lobby, type LobbySessionApi } from "../../client/components/Lobby";

function renderLobby(overrides: Partial<LobbySessionApi> = {}) {
  const requests: Array<unknown> = [];
  const session: LobbySessionApi = {
    connectionState: "connected",
    createRoom: async (nickname, mode) => {
      requests.push({ nickname, mode });
    },
    joinRoom: async (nickname, roomCode) => {
      requests.push({ nickname, roomCode });
    },
    ...overrides,
  };

  render(<Lobby session={session} />);
  return { requests };
}

describe("Lobby", () => {
  afterEach(cleanup);

  it("shows a visible nickname error instead of creating a room without a valid guest name", async () => {
    const user = userEvent.setup();
    const { requests } = renderLobby();

    await user.click(screen.getByRole("button", { name: "개인전 방 만들기" }));

    expect(screen.getByRole("alert")).toHaveTextContent("닉네임은 2~12자의 한글 또는 영문으로 입력해 주세요.");
    expect(requests).toEqual([]);
  });

  it("submits a trimmed nickname and the selected team mode when creating a room", async () => {
    const user = userEvent.setup();
    const { requests } = renderLobby();

    await user.type(screen.getByLabelText("닉네임"), "  한판  ");
    await user.click(screen.getByRole("button", { name: "4·6·8명 팀 대항전" }));
    await user.click(screen.getByRole("button", { name: "팀 대항전 방 만들기" }));

    expect(requests).toEqual([{ nickname: "한판", mode: "team" }]);
  });

  it("uppercases a valid room code and joins through the keyboard-submitted form", async () => {
    const user = userEvent.setup();
    const { requests } = renderLobby();

    await user.type(screen.getByLabelText("닉네임"), "Guest");
    await user.type(screen.getByLabelText("방 코드"), "ab2cde");
    await user.keyboard("{Enter}");

    expect(screen.getByLabelText<HTMLInputElement>("방 코드").value).toBe("AB2CDE");
    expect(requests).toEqual([{ nickname: "Guest", roomCode: "AB2CDE" }]);
  });

  it("disables a create button while its request is still pending", async () => {
    const user = userEvent.setup();
    let resolveCreate: (() => void) | undefined;
    const { requests } = renderLobby({
      createRoom: (nickname, mode) => new Promise<void>((resolve) => {
        requests.push({ nickname, mode });
        resolveCreate = resolve;
      }),
    });

    await user.type(screen.getByLabelText("닉네임"), "Guest");
    await user.click(screen.getByRole("button", { name: "개인전 방 만들기" }));

    expect(screen.getByRole("button", { name: "개인전 방 만들기" })).toBeDisabled();
    expect(requests).toEqual([{ nickname: "Guest", mode: "individual" }]);
    resolveCreate?.();
  });
});
