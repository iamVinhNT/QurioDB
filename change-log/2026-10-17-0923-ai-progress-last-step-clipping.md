# AI progress final-step clipping

## Summary and why

The expanded activity timeline ended exactly at the final progress card's bottom edge. Its ancestor uses `overflow-hidden` for the collapse animation, which clipped that card's bottom shadow. Browser measurements confirmed zero clearance below and to the right of the card.

Add 4px top, bottom and right padding inside the timeline to leave room for the card shadows while keeping the existing collapse behavior.

## Files changed

- `apps/web/src/app/sqllab/components/ai/ReasoningSection.tsx`: timeline padding.
- `apps/web/tests/browser/reasoning-section-layout.js`: browser regression check using the actual component and CSS, including single and multiple steps, streaming and completed activity, light and dark themes, narrow and wide viewports, multiline content and collapse.
- `docs/modules/04-ai-assistant.md`: document the timeline spacing.
- `CHANGELOG.md`: Unreleased fix entry.

## Impact

- UI: the last progress card's shadow is visible instead of clipped.
- Desktop: shared frontend change; the next packaged web build includes it. The packaged desktop app was not built or launched. No Python sidecar rebuild is needed.
- API and data: no changes.

## Verification

- Baseline: `cd apps/web && bunx vitest run tests/components/sqllab/ai-message.test.tsx tests/components/sqllab/ai-chat-messages-performance.test.tsx`: 18 tests passed before the change and again after it.
- `cd apps/web && bunx tsc --noEmit`: passed.
- Playwright `browser_run_code_unsafe` with `filename` set to the absolute path of `apps/web/tests/browser/reasoning-section-layout.js`, against the existing Vite server on `127.0.0.1:3001`: failed with the original CSS (zero bottom clearance); passed all 16 layout cases after the fix, plus the collapsed-height check. Streaming cards now have approximately 4px clearance below and to the right, with no horizontal overflow.
- Actual component screenshots before and after the change were inspected in Chromium. Tauri/WebView rendering was not checked.
