import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import { selectVisibleUpdate, useUpdateStore } from "@/stores/use-update-store";

const STORAGE_KEY = "update-state";

function release(latest: string, available = true) {
  return {
    current: "0.1.6",
    latest,
    available,
    releaseUrl: `https://github.com/iamVinhNT/QurioDB/releases/tag/v${latest}`,
    publishedAt: "2026-10-27T10:00:00Z",
  };
}

function resetStore() {
  useUpdateStore.setState({
    status: "idle",
    result: null,
    error: null,
    lastCheckedAt: null,
    skippedVersion: null,
    notifiedVersion: null,
  });
}

describe("useUpdateStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetStore();
  });

  afterEach(() => {
    localStorage.clear();
    resetStore();
  });

  it("stores the result and check time after a successful check", async () => {
    mocks.invoke.mockResolvedValueOnce(release("0.1.7"));

    await useUpdateStore.getState().check();

    const state = useUpdateStore.getState();
    expect(state.status).toBe("done");
    expect(state.result?.latest).toBe("0.1.7");
    expect(state.error).toBeNull();
    expect(state.lastCheckedAt).toEqual(expect.any(Number));
  });

  it("stores the error code without throwing when the check fails", async () => {
    mocks.invoke.mockRejectedValueOnce("network");

    await expect(useUpdateStore.getState().check()).resolves.toBeUndefined();

    expect(useUpdateStore.getState().status).toBe("error");
    expect(useUpdateStore.getState().error).toBe("network");
  });

  it("keeps the previous result when a later check fails", async () => {
    mocks.invoke.mockResolvedValueOnce(release("0.1.7"));
    await useUpdateStore.getState().check();
    mocks.invoke.mockRejectedValueOnce("rateLimited");

    await useUpdateStore.getState().check();

    expect(useUpdateStore.getState().result?.latest).toBe("0.1.7");
    expect(selectVisibleUpdate(useUpdateStore.getState())?.latest).toBe("0.1.7");
  });

  it("does not start a second check while one is running", async () => {
    let resolve!: (value: unknown) => void;
    mocks.invoke.mockReturnValueOnce(new Promise((r) => (resolve = r)));

    const first = useUpdateStore.getState().check();
    await useUpdateStore.getState().check();
    resolve(release("0.1.7"));
    await first;

    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("shows an available update that is not skipped", () => {
    useUpdateStore.setState({ result: release("0.1.7") });

    expect(selectVisibleUpdate(useUpdateStore.getState())?.latest).toBe("0.1.7");
  });

  it("hides a result that is not an update", () => {
    useUpdateStore.setState({ result: release("0.1.6", false) });

    expect(selectVisibleUpdate(useUpdateStore.getState())).toBeNull();
  });

  it("hides the skipped version but shows a later one", () => {
    useUpdateStore.getState().skip("0.1.7");
    useUpdateStore.setState({ result: release("0.1.7") });
    expect(selectVisibleUpdate(useUpdateStore.getState())).toBeNull();

    useUpdateStore.setState({ result: release("0.1.8") });
    expect(selectVisibleUpdate(useUpdateStore.getState())?.latest).toBe("0.1.8");
  });

  it("persists only the skipped and notified versions", async () => {
    mocks.invoke.mockResolvedValueOnce(release("0.1.7"));
    await useUpdateStore.getState().check();
    useUpdateStore.getState().skip("0.1.7");
    useUpdateStore.getState().markNotified("0.1.7");

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");

    expect(persisted.state).toEqual({ skippedVersion: "0.1.7", notifiedVersion: "0.1.7" });
  });
});
