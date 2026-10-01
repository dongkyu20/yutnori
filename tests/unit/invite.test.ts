/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { clearInviteCode, inviteUrl, readInviteCode, readSavedNickname, saveNickname } from "../../client/invite";

describe("invite links", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    window.localStorage.clear();
  });

  it("reads a valid room code from the query and uppercases it", () => {
    expect(readInviteCode("?room=ab2cde")).toBe("AB2CDE");
    expect(readInviteCode("?room=AB2CDE&x=1")).toBe("AB2CDE");
  });

  it("ignores missing or malformed codes", () => {
    expect(readInviteCode("")).toBeNull();
    expect(readInviteCode("?room=abc")).toBeNull();
    expect(readInviteCode("?room=%3Cscript%3E")).toBeNull();
  });

  it("builds a link back to this page and clears the query without reloading", () => {
    window.history.replaceState(null, "", "/play?room=AB2CDE&keep=1");
    expect(inviteUrl("AB2CDE")).toBe(`${window.location.origin}/play?room=AB2CDE`);
    clearInviteCode();
    expect(window.location.search).toBe("?keep=1");
  });

  it("remembers the last nickname", () => {
    expect(readSavedNickname()).toBe("");
    saveNickname("민수");
    expect(readSavedNickname()).toBe("민수");
  });
});
