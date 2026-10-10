/**
 * @file useTableLod.ts
 * @description Shared boolean viewport subscription with per-flow zoom hysteresis.
 */
import { useCallback } from "react";
import { useStore, useStoreApi, type ReactFlowState } from "@xyflow/react";

export const LOD_COMPACT_BELOW = 0.3;
export const LOD_FULL_ABOVE = 0.36;

type LodState = { compact: boolean; ready: boolean };
const lodByStore = new WeakMap<object, LodState>();

function getLodState(store: object): LodState {
  let state = lodByStore.get(store);
  if (!state) {
    state = { compact: true, ready: false };
    lodByStore.set(store, state);
  }
  return state;
}

export function useTableLod() {
  const store = useStoreApi();
  // useStoreApi returns a per-caller wrapper; getState is the stable store identity.
  const lod = getLodState(store.getState);
  const selectCompact = useCallback(
    (state: ReactFlowState) => {
      if (
        !lod.ready &&
        (state.width === 0 || state.height === 0 || state.fitViewQueued)
      ) {
        return true;
      }
      lod.ready = true;
      const zoom = state.transform[2];
      if (zoom < LOD_COMPACT_BELOW) lod.compact = true;
      else if (zoom >= LOD_FULL_ABOVE) lod.compact = false;
      return lod.compact;
    },
    [lod],
  );
  return useStore(selectCompact);
}
