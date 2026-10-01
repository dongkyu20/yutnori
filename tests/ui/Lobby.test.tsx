/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { Lobby, type LobbySessionApi } from "../../client/components/Lobby";

function renderLobby(overrides: Partial<LobbySessionApi> = {}, inviteCode: string | null = null) {
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

  render(<Lobby session={session} inviteCode={inviteCode} />);
  return { requests };
}

describe("Lobby", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

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

  it("joins with the one shared nickname and moves focus to it when it is missing", async () => {
    const user = userEvent.setup();
    const { requests } = renderLobby();

    await user.type(screen.getByLabelText("방 코드"), "AB2CDE");
    await user.click(screen.getByRole("button", { name: "방 참가하기" }));

    expect(screen.getByLabelText("닉네임")).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent("닉네임은 2~12자");
    expect(requests).toEqual([]);
  });

  it("opens straight into the invited room and joins with only a nickname", async () => {
    const user = userEvent.setup();
    const { requests } = renderLobby({}, "AB2CDE");

    expect(screen.getByText("AB2CDE 방에 초대받았어요")).toBeInTheDocument();
    expect(screen.queryByLabelText("방 코드")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "개인전 방 만들기" })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("닉네임"), "지우");
    await user.keyboard("{Enter}");
    expect(requests).toEqual([{ nickname: "지우", roomCode: "AB2CDE" }]);
  });

  it("lets an invited player make their own room instead", async () => {
    const user = userEvent.setup();
    renderLobby({}, "AB2CDE");
    await user.click(screen.getByRole("button", { name: "다른 방 만들기" }));
    expect(screen.getByRole("button", { name: "개인전 방 만들기" })).toBeInTheDocument();
    expect(screen.getByLabelText("방 코드")).toBeInTheDocument();
  });

  it("prefills the last nickname and saves the one used", async () => {
    window.localStorage.setItem("yut.nickname", "민수");
    const user = userEvent.setup();
    const { requests } = renderLobby();
    expect(screen.getByLabelText<HTMLInputElement>("닉네임").value).toBe("민수");
    await user.click(screen.getByRole("button", { name: "개인전 방 만들기" }));
    expect(requests).toEqual([{ nickname: "민수", mode: "individual" }]);
    expect(window.localStorage.getItem("yut.nickname")).toBe("민수");
  });
});
