"""
evaluation.py

Deterministic RAG evaluation helpers for recall, ranking, latency, and safety gates.
"""

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional


@dataclass(frozen=True)
class RagEvalCase:
    """One deterministic retrieval evaluation case."""

    name: str
    query: str
    expected_citations: List[str]
    database_id: Optional[str] = None
    source_types: Optional[List[str]] = None
    top_k: int = 8
    max_latency_ms: int = 1500


PROMPT_INJECTION_MARKERS = (
    "ignore previous instructions",
    "ignore all previous instructions",
    "disregard previous instructions",
    "reveal system prompt",
    "show system prompt",
    "developer message",
    "hidden instructions",
    "api key",
    "password",
)


def evaluate_retrieval_cases(cases: Iterable[RagEvalCase], retriever, user_id: Optional[str] = None) -> Dict[str, Any]:
    """Runs deterministic retrieval cases and returns aggregate quality metrics."""
    results = []
    for case in cases:
        retrieval = retriever.retrieve(
            case.query,
            database_id=case.database_id,
            user_id=user_id,
            source_types=case.source_types,
            top_k=case.top_k,
        )
        citations = [citation.get("id") for citation in retrieval.get("citations", [])]
        rank = first_expected_rank(citations, case.expected_citations)
        latency_ms = int((retrieval.get("retrievalTrace") or {}).get("latencyMs") or 0)
        results.append({
            "name": case.name,
            "passed": rank > 0 and latency_ms <= case.max_latency_ms,
            "rank": rank,
            "recall": rank > 0,
            "reciprocalRank": 1 / rank if rank else 0.0,
            "latencyMs": latency_ms,
            "latencyPassed": latency_ms <= case.max_latency_ms,
            "expectedCitations": case.expected_citations,
            "actualCitations": citations,
        })

    total = len(results) or 1
    return {
        "caseCount": len(results),
        "passed": all(result["passed"] for result in results),
        "recallAtK": sum(1 for result in results if result["recall"]) / total,
        "mrr": sum(result["reciprocalRank"] for result in results) / total,
        "latencyPassRate": sum(1 for result in results if result["latencyPassed"]) / total,
        "cases": results,
    }


def first_expected_rank(actual_citations: List[str], expected_citations: List[str]) -> int:
    """Returns the 1-based rank of the first expected citation, or 0 if missing."""
    expected = set(expected_citations)
    for index, citation_id in enumerate(actual_citations, start=1):
        if citation_id in expected:
            return index
    return 0


def contains_prompt_injection(text: str) -> bool:
    """Flags suspicious retrieved text that attempts to override instructions."""
    normalized = " ".join(str(text or "").lower().split())
    return any(marker in normalized for marker in PROMPT_INJECTION_MARKERS)


def graph_evidence_coverage(items, required_tables, required_column_pairs):
    """Measure full required-set coverage, independently from first-hit recall."""
    tables = {f"{item.get('schemaName')}.{item.get('objectName')}" for item in items
              if item.get("chunkType") == "table"}
    import re
    content = "\n".join(item.get("content", "") for item in items if item.get("sourceType") == "database_schema")
    covered_pairs = sum(1 for left, right in required_column_pairs
                        if repr((left, right)) in content or repr([left, right]) in content
                        or re.search(r"\." + re.escape(left) + r"\s*->\s*[^\s]+\." + re.escape(right) + r"\b", content))
    required = set(required_tables)
    return {"requiredTableCoverage": len(tables & required) / len(required) if required else 1.0,
            "joinPairCoverage": covered_pairs / len(required_column_pairs) if required_column_pairs else 1.0,
            "allRequiredTables": required <= tables,
            "allRequiredJoinPairs": covered_pairs == len(required_column_pairs)}
