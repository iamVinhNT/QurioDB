/**
 * @file use-update-store.ts
 * @description Desktop update check result shared by the header indicator and Settings,
 * plus the persisted skipped and already-notified versions.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { checkForUpdate, type UpdateCheck, type UpdateErrorCode } from "@/lib/desktop-update";

export interface UpdateState {
  status: "idle" | "checking" | "done" | "error";
  result: UpdateCheck | null;
  error: UpdateErrorCode | null;
  lastCheckedAt: number | null;
  skippedVersion: string | null;
  notifiedVersion: string | null;

  check: () => Promise<void>;
  skip: (version: string) => void;
  markNotified: (version: string) => void;
}

export const useUpdateStore = create<UpdateState>()(
  persist(
    (set, get) => ({
      status: "idle",
      result: null,
      error: null,
      lastCheckedAt: null,
      skippedVersion: null,
      notifiedVersion: null,

      check: async () => {
        if (get().status === "checking") return;
        set({ status: "checking" });
        try {
          const result = await checkForUpdate();
          set({ status: "done", result, error: null, lastCheckedAt: Date.now() });
        } catch (error) {
          // A failed check keeps the last result so a known update stays visible.
          set({ status: "error", error: error as UpdateErrorCode, lastCheckedAt: Date.now() });
        }
      },
      skip: (version) => set({ skippedVersion: version }),
      markNotified: (version) => set({ notifiedVersion: version }),
    }),
    {
      name: "update-state",
      partialize: (state) => ({
        skippedVersion: state.skippedVersion,
        notifiedVersion: state.notifiedVersion,
      }),
    },
  ),
);

/** The update to show to the user: available and not skipped. */
export function selectVisibleUpdate(state: UpdateState): UpdateCheck | null {
  const { result, skippedVersion } = state;
  return result?.available && result.latest !== skippedVersion ? result : null;
}
