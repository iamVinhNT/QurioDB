import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface SettingsState {
  // General
  theme: "light" | "dark" | "system";
  language: "en" | "vi";
  dynamicColorInjection: boolean;
  reducedMotion: boolean;
  enableBlurEffects: boolean;

  // Editor
  editorFontSize: number;
  editorFontFamily: string;
  editorTabSize: number;
  editorMinimap: boolean;
  editorWordWrap: "on" | "off" | "wordWrapColumn" | "bounded";
  editorLineNumbers: "on" | "off" | "relative" | "interval";
  editorFormatOnPaste: boolean;
  editorFormatOnSave: boolean;
  editorLigatures: boolean;
  editorInlineSuggestions: boolean;

  // Data
  defaultQueryLimit: number;
  queryTimeout: boolean;
  autoExplain: boolean;
  showNullAs: string;
  dateTimeFormat: string;
  csvDelimiter: "," | ";";
  resultEncoding: string;

  // Updates (desktop)
  autoCheckUpdates: boolean;

  // Actions
  setTheme: (theme: "light" | "dark" | "system") => void;
  setLanguage: (lang: "en" | "vi") => void;
  updateEditor: (settings: Partial<SettingsState>) => void;
  updateData: (settings: Partial<SettingsState>) => void;
  updateGeneral: (settings: Partial<SettingsState>) => void;
  resetDefaults: () => void;
}

const defaultSettings = {
  theme: "system" as const,
  language: "en" as const,
  dynamicColorInjection: true,
  reducedMotion: false,
  enableBlurEffects: true,

  editorFontSize: 14,
  editorFontFamily: "'Fira Code', 'JetBrains Mono', Consolas, monospace",
  editorTabSize: 2,
  editorMinimap: true,
  editorWordWrap: "on" as const,
  editorLineNumbers: "on" as const,
  editorFormatOnPaste: true,
  editorFormatOnSave: false,
  editorLigatures: true,
  editorInlineSuggestions: true,

  // Data
  defaultQueryLimit: 1000,
  queryTimeout: true,
  autoExplain: false,
  showNullAs: "(null)",
  dateTimeFormat: "YYYY-MM-DD HH:mm:ss",
  csvDelimiter: "," as const,
  resultEncoding: "UTF-8",

  autoCheckUpdates: true,
};

export function sanitizePersistedSettingsState(
  persistedState: unknown,
  currentState?: unknown,
): Record<string, unknown> {
  if (
    persistedState === null ||
    typeof persistedState !== "object" ||
    Array.isArray(persistedState)
  ) {
    return {};
  }

  const sanitizedState = { ...(persistedState as Record<string, unknown>) };
  delete sanitizedState.sqllabGitDirectoryEnabled;

  const currentStateRecord =
    currentState !== null &&
    typeof currentState === "object" &&
    !Array.isArray(currentState)
      ? (currentState as Record<string, unknown>)
      : undefined;

  for (const key of Object.keys(sanitizedState)) {
    if (
      typeof sanitizedState[key] === "function" ||
      typeof currentStateRecord?.[key] === "function"
    ) {
      delete sanitizedState[key];
    }
  }

  return sanitizedState;
}

export const useSettingsStore = create<SettingsState>()(
  persist<SettingsState, [], [], Record<string, unknown>>(
    (set) => ({
      ...defaultSettings,

      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => set({ language }),
      updateEditor: (settings) => set((state) => ({ ...state, ...settings })),
      updateData: (settings) => set((state) => ({ ...state, ...settings })),
      updateGeneral: (settings) => set((state) => ({ ...state, ...settings })),
      resetDefaults: () => set(defaultSettings),
    }),
    {
      name: "app-settings",
      version: 1,
      migrate: (persistedState) =>
        sanitizePersistedSettingsState(persistedState),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...sanitizePersistedSettingsState(persistedState, currentState),
      }),
      partialize: (state) => sanitizePersistedSettingsState(state),
    },
  ),
);
