/**
 * @file ai-provider-config.test.tsx
 * @description Regression tests for custom AI provider base URL validation and save payloads.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "../../test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AISettings } from "@/app/settings/components/AISettings";
import { SettingsActionsProvider } from "@/app/settings/context/SettingsActionsContext";
import { aiApi } from "@/lib/api-client";

vi.mock("@/lib/api-client", () => ({
  aiApi: {
    getAIConfig: vi.fn(),
    getModels: vi.fn().mockResolvedValue([]),
    getAIStatus: vi.fn().mockResolvedValue({}),
    getTaskCatalog: vi.fn().mockResolvedValue([]),
    getTaskAssignments: vi.fn().mockResolvedValue([]),
    saveAIConfig: vi.fn().mockResolvedValue({}),
    addModel: vi.fn().mockResolvedValue({}),
    deleteModel: vi.fn().mockResolvedValue({}),
    saveTaskAssignments: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

const mockedAiApi = vi.mocked(aiApi);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

function renderAISettings(config: { apiKey: string; provider: string; baseUrl?: string }) {
  mockedAiApi.getAIConfig.mockResolvedValue(config);

  return render(
    <SettingsActionsProvider>
      <AISettings />
    </SettingsActionsProvider>,
  );
}

describe("AI provider configuration", () => {
  it("requires a base URL for Custom Provider and does not save without one", async () => {
    renderAISettings({ apiKey: "custom-key", provider: "Custom", baseUrl: "" });

    const saveButton = await screen.findByRole("button", { name: "Update Configuration" });
    const baseUrlInput = await screen.findByPlaceholderText("https://your-provider.example/v1");
    expect(baseUrlInput).toBeRequired();

    fireEvent.click(saveButton);

    expect(mockedAiApi.saveAIConfig).not.toHaveBeenCalled();
  });

  it("includes a valid custom base URL in the save payload", async () => {
    renderAISettings({
      apiKey: "custom-key",
      provider: "Custom",
      baseUrl: "https://provider.example/v1",
    });

    const baseUrlInput = await screen.findByDisplayValue("https://provider.example/v1");
    await waitFor(() => expect(baseUrlInput).toHaveValue("https://provider.example/v1"));
    fireEvent.click(await screen.findByRole("button", { name: "Update Configuration" }));

    await waitFor(() => {
      expect(mockedAiApi.saveAIConfig).toHaveBeenCalledWith({
        apiKey: "custom-key",
        provider: "Custom",
        baseUrl: "https://provider.example/v1",
      });
    });
  });
});
