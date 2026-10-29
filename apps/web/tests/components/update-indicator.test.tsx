import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, render, screen } from "../test-utils";

const mocks = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() });
  return { invoke: vi.fn(), toast };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { UpdateIndicator } from "@/components/update-indicator";
import { useSettingsStore } from "@/stores/use-settings-store";
import { useUpdateStore } from "@/stores/use-update-store";

const FIVE_SECONDS = 5_000;
const ONE_DAY = 24 * 60 * 60 * 1000;

function release(latest: string, available = true) {
  return {
    current: "0.1.6",
    latest,
    available,
    releaseUrl: `https://github.com/iamVinhNT/QurioDB/releases/tag/v${latest}`,
    publishedAt: "2026-10-27T10:00:00Z",
  };
}

function resetUpdateStore() {
  useUpdateStore.setState({
    status: "idle",
    result: null,
    error: null,
    lastCheckedAt: null,
    skippedVersion: null,
    notifiedVersion: null,
  });
}

function checkCalls() {
  return mocks.invoke.mock.calls.filter(([command]) => command === "check_for_update");
}

describe("UpdateIndicator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.__TAURI_INTERNALS__ = {};
    resetUpdateStore();
    useSettingsStore.getState().resetDefaults();
    mocks.invoke.mockResolvedValue(release("0.1.6", false));
  });

  afterEach(() => {
    vi.useRealTimers();
    delete window.__TAURI_INTERNALS__;
    resetUpdateStore();
    localStorage.clear();
  });

  describe("automatic checks", () => {
    beforeEach(() => vi.useFakeTimers());

    it("checks five seconds after mount and then once a day", async () => {
      render(<UpdateIndicator />);

      await act(() => vi.advanceTimersByTimeAsync(FIVE_SECONDS - 1));
      expect(checkCalls()).toHaveLength(0);

      await act(() => vi.advanceTimersByTimeAsync(1));
      expect(checkCalls()).toHaveLength(1);

      await act(() => vi.advanceTimersByTimeAsync(ONE_DAY));
      expect(checkCalls()).toHaveLength(2);
    });

    it("does not check when automatic checks are off", async () => {
      useSettingsStore.getState().updateGeneral({ autoCheckUpdates: false });

      render(<UpdateIndicator />);
      await act(() => vi.advanceTimersByTimeAsync(ONE_DAY + FIVE_SECONDS));

      expect(checkCalls()).toHaveLength(0);
    });

    it("renders nothing and never calls Tauri outside the desktop app", async () => {
      delete window.__TAURI_INTERNALS__;

      const { container } = render(<UpdateIndicator />);
      await act(() => vi.advanceTimersByTimeAsync(ONE_DAY + FIVE_SECONDS));

      expect(container).toBeEmptyDOMElement();
      expect(mocks.invoke).not.toHaveBeenCalled();
    });

    it("shows the icon and toast once a newer version is found", async () => {
      mocks.invoke.mockResolvedValue(release("0.1.7"));

      render(<UpdateIndicator />);
      await act(() => vi.advanceTimersByTimeAsync(FIVE_SECONDS));

      expect(screen.getByRole("button", { name: "Update available: 0.1.7" })).toBeInTheDocument();
      expect(mocks.toast).toHaveBeenCalledTimes(1);
      expect(mocks.toast).toHaveBeenCalledWith(
        "QurioDB 0.1.7 is available",
        expect.objectContaining({ description: "You have 0.1.6." }),
      );
    });

    it("shows nothing when the automatic check fails", async () => {
      mocks.invoke.mockRejectedValue("network");

      const { container } = render(<UpdateIndicator />);
      await act(() => vi.advanceTimersByTimeAsync(FIVE_SECONDS));

      expect(container).toBeEmptyDOMElement();
      expect(mocks.toast).not.toHaveBeenCalled();
      expect(mocks.toast.error).not.toHaveBeenCalled();
    });
  });

  it("does not show the toast again for a version already announced", () => {
    useUpdateStore.setState({ result: release("0.1.7"), notifiedVersion: "0.1.7" });

    render(<UpdateIndicator />);

    expect(screen.getByRole("button", { name: "Update available: 0.1.7" })).toBeInTheDocument();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("hides the icon when the result is not an update", () => {
    useUpdateStore.setState({ result: release("0.1.6", false) });

    const { container } = render(<UpdateIndicator />);

    expect(container).toBeEmptyDOMElement();
  });

  it("opens the popover from the toast action", async () => {
    useUpdateStore.setState({ result: release("0.1.7") });
    render(<UpdateIndicator />);

    const [, options] = mocks.toast.mock.calls[0];
    act(() => options.action.onClick());

    expect(await screen.findByText("Update available")).toBeInTheDocument();
  });

  it("opens the release page from the popover", async () => {
    const user = userEvent.setup();
    useUpdateStore.setState({ result: release("0.1.7"), notifiedVersion: "0.1.7" });
    render(<UpdateIndicator />);

    await user.click(screen.getByRole("button", { name: "Update available: 0.1.7" }));
    await user.click(await screen.findByRole("button", { name: "Download from GitHub" }));

    expect(mocks.invoke).toHaveBeenCalledWith("open_release_page", { version: "0.1.7" });
  });

  it("skips the version and hides the icon", async () => {
    const user = userEvent.setup();
    useUpdateStore.setState({ result: release("0.1.7"), notifiedVersion: "0.1.7" });
    render(<UpdateIndicator />);

    await user.click(screen.getByRole("button", { name: "Update available: 0.1.7" }));
    await user.click(await screen.findByRole("button", { name: "Skip this version" }));

    expect(useUpdateStore.getState().skippedVersion).toBe("0.1.7");
    expect(screen.queryByRole("button", { name: "Update available: 0.1.7" })).not.toBeInTheDocument();
    expect(mocks.toast.dismiss).toHaveBeenCalledWith("desktop-update");
  });
});
