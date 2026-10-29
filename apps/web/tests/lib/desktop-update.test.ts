import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  getVersion: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: mocks.getVersion }));

import {
  checkForUpdate,
  getInstalledVersion,
  openReleasePage,
} from "@/lib/desktop-update";

describe("desktop update wrappers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls the typed update check command", async () => {
    const check = {
      current: "0.1.6",
      latest: "0.1.7",
      available: true,
      releaseUrl: "https://github.com/iamVinhNT/QurioDB/releases/tag/v0.1.7",
      publishedAt: "2026-10-27T10:00:00Z",
    };
    mocks.invoke.mockResolvedValueOnce(check);

    await expect(checkForUpdate()).resolves.toEqual(check);
    expect(mocks.invoke).toHaveBeenCalledWith("check_for_update");
  });

  it("rejects with the error code the command returned", async () => {
    mocks.invoke.mockRejectedValueOnce("rateLimited");

    await expect(checkForUpdate()).rejects.toBe("rateLimited");
  });

  it("maps unknown command failures to a network error", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("IPC unavailable"));

    await expect(checkForUpdate()).rejects.toBe("network");
  });

  it("passes only the version to the open command", async () => {
    mocks.invoke.mockResolvedValueOnce(undefined);

    await openReleasePage("0.1.7");

    expect(mocks.invoke).toHaveBeenCalledWith("open_release_page", { version: "0.1.7" });
  });

  it("keeps the server error code", async () => {
    mocks.invoke.mockRejectedValueOnce("serverError");

    await expect(checkForUpdate()).rejects.toBe("serverError");
  });

  it("reads the installed version from the Tauri app API", async () => {
    mocks.getVersion.mockResolvedValueOnce("0.1.6");

    await expect(getInstalledVersion()).resolves.toBe("0.1.6");
  });
});
