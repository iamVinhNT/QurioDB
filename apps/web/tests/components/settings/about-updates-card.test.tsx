import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "../../test-utils";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), getVersion: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: mocks.getVersion }));

import { AboutUpdatesCard } from "@/app/settings/components/general-settings/AboutUpdatesCard";
import { useUpdateStore } from "@/stores/use-update-store";

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

async function renderCard(onAutoCheckChange = vi.fn()) {
  render(<AboutUpdatesCard autoCheckUpdates onAutoCheckChange={onAutoCheckChange} />);
  // The installed version loads asynchronously; wait for it so later updates stay inside act.
  await screen.findByText("0.1.6");
  return { onAutoCheckChange };
}

async function checkNow() {
  await userEvent.click(screen.getByRole("button", { name: "Check for updates" }));
}

describe("AboutUpdatesCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.__TAURI_INTERNALS__ = {};
    resetUpdateStore();
    mocks.getVersion.mockResolvedValue("0.1.6");
  });

  afterEach(() => {
    delete window.__TAURI_INTERNALS__;
    resetUpdateStore();
  });

  it("shows the installed version", async () => {
    await renderCard();

    expect(screen.getByText("Not checked yet")).toBeInTheDocument();
  });

  it("reports that the app is up to date", async () => {
    mocks.invoke.mockResolvedValue(release("0.1.6", false));
    await renderCard();

    await checkNow();

    expect(await screen.findByText("You are on the latest version (0.1.6).")).toBeInTheDocument();
  });

  it("shows an available update and opens its release page", async () => {
    mocks.invoke.mockResolvedValueOnce(release("0.1.7")).mockResolvedValueOnce(undefined);
    await renderCard();

    await checkNow();
    expect(await screen.findByText("QurioDB 0.1.7 is available")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Download from GitHub" }));

    expect(mocks.invoke).toHaveBeenCalledWith("open_release_page", { version: "0.1.7" });
  });

  it.each([
    ["network", "Could not reach GitHub. Check your internet connection and try again."],
    ["rateLimited", "GitHub limited update checks for now. Try again in an hour."],
    ["notFound", "Could not check for updates right now. Try again later."],
    ["serverError", "GitHub is not responding right now. Try again later."],
    ["invalidResponse", "Could not check for updates right now. Try again later."],
  ])("explains a %s failure after a manual check", async (code, message) => {
    mocks.invoke.mockRejectedValue(code);
    await renderCard();

    await checkNow();

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(message);
  });

  it("announces results through a status region that exists before the check", async () => {
    mocks.invoke.mockResolvedValue(release("0.1.7"));
    await renderCard();
    const status = screen.getByRole("status");

    await checkNow();

    expect(await screen.findByText("QurioDB 0.1.7 is available")).toBeInTheDocument();
    expect(status).toHaveTextContent("QurioDB 0.1.7 is available");
  });

  it("keeps the check button focusable while a check runs", async () => {
    let resolve!: (value: unknown) => void;
    mocks.invoke.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    await renderCard();
    const button = screen.getByRole("button", { name: "Check for updates" });

    await checkNow();

    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    await userEvent.click(button);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    resolve(release("0.1.6", false));
    expect(await screen.findByText("You are on the latest version (0.1.6).")).toBeInTheDocument();
  });

  it("does not show an error from an automatic check", async () => {
    useUpdateStore.setState({ status: "error", error: "network", lastCheckedAt: Date.now() });

    await renderCard();

    expect(
      screen.queryByText("Could not reach GitHub. Check your internet connection and try again."),
    ).not.toBeInTheDocument();
  });

  it("turns automatic checks off", async () => {
    const { onAutoCheckChange } = await renderCard();

    await userEvent.click(screen.getByRole("switch", { name: "Check for updates automatically" }));

    expect(onAutoCheckChange).toHaveBeenCalledWith(false);
  });

  it("renders nothing outside the desktop app", () => {
    delete window.__TAURI_INTERNALS__;

    render(<AboutUpdatesCard autoCheckUpdates onAutoCheckChange={vi.fn()} />);

    expect(screen.queryByText("About and updates")).not.toBeInTheDocument();
    expect(mocks.getVersion).not.toHaveBeenCalled();
  });
});
