---
trigger: always_on
description: Mandatory quality gate for every code change, bug fix, refactor, or generated implementation.
---

# Code Change Quality Gate

This rule applies to every repository code change.

## Before Editing

- Read the required project context for the touched area:
  - `Project-Context.md`
  - `README.md`
  - Relevant `.agents/rules/*`
- Inspect existing code paths before choosing an implementation.
- Prefer existing patterns, helpers, schemas, and service boundaries over new abstractions.
- Identify the smallest safe change that fixes the requested behavior.

## Implementation Standards

- Keep code clean, explicit, and scoped.
- Do not hard-code product behavior, AI answers, user-facing business logic, or one-off examples when the correct solution is routing, prompt design, configuration, validation, parsing, or a reusable helper.
- Do not hide complexity in broad catch-all logic. Add narrow, named helpers when branching behavior matters.
- Preserve desktop compatibility for backend/API/frontend changes.
- Do not revert unrelated user changes.
- Add comments only when they explain non-obvious intent.

## AI And Conversation Changes

- Separate semantic data from presentation markup.
- Persist structured events or fields instead of UI tags when possible.
- Keep model prompts responsible for language generation; use code for routing, validation, safety, persistence, and deterministic protocol handling.
- Avoid expensive schema retrieval, feedback lookup, or database inspection for general chat unless the user request needs database context.

## Verification

- Run a relevant baseline test before risky bug fixes when feasible.
- Add or update regression tests for fixed bugs.
- Run the narrowest relevant test command after the change.
- Run broader tests when shared services, persistence, API contracts, or frontend state are touched.
- Report the exact commands and results in the final response.

## Final Review Checklist

- Does the implementation solve the root cause rather than the observed symptom only?
- Is the behavior covered by a regression test?
- Are timestamps, encodings, locale, and desktop sidecar impact considered where relevant?
- Did any response contract change require frontend/backward-compatibility handling?
- Are unrelated files untouched?
