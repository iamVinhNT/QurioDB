/**
 * @file desktop-update.ts
 * @description Typed wrappers for the desktop update check and release page commands.
 */

import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";

export type UpdateErrorCode =
  | "network"
  | "rateLimited"
  | "notFound"
  | "serverError"
  | "invalidResponse";

export interface UpdateCheck {
  current: string;
  latest: string;
  available: boolean;
  releaseUrl: string;
  publishedAt: string | null;
}

const ERROR_CODES: readonly UpdateErrorCode[] = [
  "network",
  "rateLimited",
  "notFound",
  "serverError",
  "invalidResponse",
];

function toUpdateErrorCode(error: unknown): UpdateErrorCode {
  return ERROR_CODES.includes(error as UpdateErrorCode) ? (error as UpdateErrorCode) : "network";
}

/** Rejects with an `UpdateErrorCode`. */
export async function checkForUpdate(): Promise<UpdateCheck> {
  try {
    return await invoke<UpdateCheck>("check_for_update");
  } catch (error) {
    throw toUpdateErrorCode(error);
  }
}

/** Opens the GitHub release page for `version`; Rust builds the URL. */
export function openReleasePage(version: string): Promise<void> {
  return invoke<void>("open_release_page", { version });
}

export function getInstalledVersion(): Promise<string> {
  return getVersion();
}
