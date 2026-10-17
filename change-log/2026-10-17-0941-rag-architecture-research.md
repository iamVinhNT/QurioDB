# AI SQL RAG architecture research

## Summary and rationale

Assessed QurioDB's current retrieval paths and primary research for the user's AI SQL priority. The report recommends retaining hybrid retrieval, adding typed schema/FK join-path completion and reviewed business semantics, and evaluating a full-schema baseline before adopting Microsoft GraphRAG. The assessment separates inspected behavior, architectural hypotheses and proposed changes; it claims no measured model-quality improvement.

## Files

- `docs/reports/Đánh giá RAG cho QurioDB.md`: Vietnamese research assessment and controlled evaluation proposal.
- `docs/research_notes/Đánh giá RAG cho QurioDB/current_rag.md`: source inspection and verification notes.
- `docs/research_notes/Đánh giá RAG cho QurioDB/graphrag_evidence.md`: Microsoft GraphRAG primary-source evidence.
- `docs/research_notes/Đánh giá RAG cho QurioDB/rag_alternatives.md`: schema-focused alternatives and evaluation evidence.
- `CHANGELOG.md`: Unreleased entry.

`docs/` is gitignored; the report and notes are local research artifacts. No application code was changed.

## Impact

Desktop, API, UI and data behavior: none. No schema migration, dependency installation, sidecar rebuild or runtime configuration change.

## Verification

Read the three research notes, inspected the repository instructions and changelog format, and checked report length and local links. Primary sources were researched upstream and are cited inline in the report.

Research-stage commands from `apps/api` were blocked before test collection:

- `python -m pytest tests/test_rag_index.py tests/test_rag_phase3.py tests/test_schema_retriever.py tests/ai_evaluation/test_rag_quality_gate.py -q`: exit 127, `pyenv: python: command not found`.
- `../../.venv/bin/python -m pytest tests/test_rag_index.py tests/test_rag_phase3.py tests/test_schema_retriever.py tests/ai_evaluation/test_rag_quality_gate.py -q`: exit 4, conftest import error `ModuleNotFoundError: No module named 'fastapi'`.

No product tests executed; no live-model evaluation, desktop launch or sidecar build was performed for this documentation-only change.
