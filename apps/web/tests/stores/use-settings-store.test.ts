import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  sanitizePersistedSettingsState,
  useSettingsStore,
} from "@/stores/use-settings-store";

const STORAGE_KEY = "app-settings";

describe("useSettingsStore", () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset store to default before each test
    useSettingsStore.getState().resetDefaults();
  });

  afterEach(() => {
    localStorage.clear();
    useSettingsStore.getState().resetDefaults();
  });

  it("should have default values", () => {
    const state = useSettingsStore.getState();
    expect(state.theme).toBe("system");
    expect(state.language).toBe("en");
    expect(state.editorFontSize).toBe(14);
    expect(state.autoCheckUpdates).toBe(true);
  });

  it("should update theme", () => {
    useSettingsStore.getState().setTheme("dark");
    expect(useSettingsStore.getState().theme).toBe("dark");
  });

  it("should update language", () => {
    useSettingsStore.getState().setLanguage("vi");
    expect(useSettingsStore.getState().language).toBe("vi");
  });

  it("should update editor settings", () => {
    useSettingsStore
      .getState()
      .updateEditor({ editorFontSize: 18, editorMinimap: false });
    expect(useSettingsStore.getState().editorFontSize).toBe(18);
    expect(useSettingsStore.getState().editorMinimap).toBe(false);
  });

  it("should reset to defaults", () => {
    useSettingsStore.getState().setTheme("light");
    useSettingsStore.getState().setLanguage("vi");

    useSettingsStore.getState().resetDefaults();

    const state = useSettingsStore.getState();
    expect(state.theme).toBe("system");
    expect(state.language).toBe("en");
  });

  it("should update data settings", () => {
    useSettingsStore
      .getState()
      .updateData({ defaultQueryLimit: 500, showNullAs: "NULL" });
    expect(useSettingsStore.getState().defaultQueryLimit).toBe(500);
    expect(useSettingsStore.getState().showNullAs).toBe("NULL");
  });
});

describe("useSettingsStore persistence migration", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    useSettingsStore.getState().resetDefaults();
  });

  it("removes the obsolete SQLLab Git flag and preserves other preferences", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          theme: "dark",
          language: "vi",
          editorFontSize: 18,
          defaultQueryLimit: 500,
          sqllabGitDirectoryEnabled: true,
        },
        version: 0,
      }),
    );

    await useSettingsStore.persist.rehydrate();

    const state = useSettingsStore.getState();
    expect(state.theme).toBe("dark");
    expect(state.language).toBe("vi");
    expect(state.editorFontSize).toBe(18);
    expect(state.defaultQueryLimit).toBe(500);
    expect("sqllabGitDirectoryEnabled" in state).toBe(false);
  });

  it("hydrates version 1 state without changing retained preferences", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: { theme: "light", editorFontSize: 20 },
        version: 1,
      }),
    );

    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState().theme).toBe("light");
    expect(useSettingsStore.getState().editorFontSize).toBe(20);
  });

  it("sanitizes an obsolete flag from version 1 state", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          theme: "dark",
          editorFontSize: 20,
          sqllabGitDirectoryEnabled: true,
        },
        version: 1,
      }),
    );

    await useSettingsStore.persist.rehydrate();

    const state = useSettingsStore.getState();
    expect(state.theme).toBe("dark");
    expect(state.editorFontSize).toBe(20);
    expect("sqllabGitDirectoryEnabled" in state).toBe(false);
  });

  it.each([
    ["null", null],
    ["a primitive", "stale state"],
    ["an array", ["stale state"]],
  ])("does not pollute the store when persisted state is %s", async (_label, persistedState) => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: persistedState, version: 1 }),
    );

    await useSettingsStore.persist.rehydrate();

    const state = useSettingsStore.getState();
    expect(state.theme).toBe("system");
    expect(state.editorFontSize).toBe(14);
    expect(Object.keys(state).some((key) => /^\d+$/.test(key))).toBe(false);

    state.setTheme("light");
    expect(useSettingsStore.getState().theme).toBe("light");
  });

  it("does not mutate the object supplied to the sanitizer", () => {
    const original = {
      theme: "dark",
      sqllabGitDirectoryEnabled: true,
    };

    const sanitized = sanitizePersistedSettingsState(original);

    expect(sanitized).not.toBe(original);
    expect(original).toEqual({
      theme: "dark",
      sqllabGitDirectoryEnabled: true,
    });
    expect(sanitized).toEqual({ theme: "dark" });
  });

  it("does not write the obsolete flag after updating a retained setting", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: { theme: "dark", sqllabGitDirectoryEnabled: true },
        version: 1,
      }),
    );

    await useSettingsStore.persist.rehydrate();
    useSettingsStore.getState().setTheme("light");

    const envelope = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(envelope.state.theme).toBe("light");
    expect("sqllabGitDirectoryEnabled" in envelope.state).toBe(false);
  });

  it("preserves actions when version 1 state contains malicious action values", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          theme: "dark",
          defaultQueryLimit: 500,
          setTheme: "not a function",
          updateData: null,
          resetDefaults: { malicious: true },
          sqllabGitDirectoryEnabled: true,
        },
        version: 1,
      }),
    );

    await useSettingsStore.persist.rehydrate();

    const state = useSettingsStore.getState();
    expect(state.theme).toBe("dark");
    expect(state.defaultQueryLimit).toBe(500);
    expect(typeof state.setTheme).toBe("function");
    expect(typeof state.updateData).toBe("function");
    expect(typeof state.resetDefaults).toBe("function");

    state.setTheme("light");
    state.updateData({ defaultQueryLimit: 250 });
    expect(useSettingsStore.getState().theme).toBe("light");
    expect(useSettingsStore.getState().defaultQueryLimit).toBe(250);

    const envelope = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(envelope.state).not.toHaveProperty("setTheme");
    expect(envelope.state).not.toHaveProperty("updateData");
    expect(envelope.state).not.toHaveProperty("resetDefaults");
    expect(envelope.state).not.toHaveProperty("sqllabGitDirectoryEnabled");
  });
});
