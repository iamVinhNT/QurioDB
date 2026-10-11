"""
sql_execution.py

Read-only preview execution helpers for AI-generated SQL verification and
repair loops.
"""

from dataclasses import asdict, dataclass, field
import logging
from typing import Any, Dict, List, Optional

from services.base_service import BaseDatabaseService
from services.execution.sql_executor import SqlExecutor
from services.execution.sql_policy import SqlExecutionPolicy


from .retrieval.metadata_source import SchemaMetadataSource
from .sql_safety import sql_safety_validator

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SqlPreviewResult:
    """Serializable result of a read-only AI SQL preview attempt."""

    ok: bool
    sql: str
    error: str = ""
    validation: Dict[str, Any] = field(default_factory=dict)
    columns: List[str] = field(default_factory=list)
    rowCount: int = 0
    data: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class SqlExecutionVerifier:
    """Validates and runs a bounded read-only preview of generated SQL."""

    def __init__(
        self,
        database_service: Optional[BaseDatabaseService] = None,
        metadata: Optional[SchemaMetadataSource] = None,
    ):
        self.database_service = database_service or BaseDatabaseService()
        self.sql_executor = SqlExecutor(self.database_service)
        self.metadata = metadata or SchemaMetadataSource()
        self.sql_policy = SqlExecutionPolicy()


    def preview(self, database_id: str, sql: str, max_rows: int = 50) -> SqlPreviewResult:
        """Runs one safe preview attempt without persisting query history."""
        dialect = self._dialect(database_id)
        decision = self.sql_policy.decide(sql, dialect, max_rows)
        validation = sql_safety_validator.validate(
            sql,
            dialect=dialect,
            allow_write=False,
            max_preview_rows=max_rows,
        )
        if decision.outcome != "allowed":
            return SqlPreviewResult(
                ok=False,
                sql=decision.normalized_sql or sql,
                error=decision.reason or validation.blockedReason,
                validation=validation.to_dict(),
            )
        if not validation.isAllowed:
            return SqlPreviewResult(
                ok=False,
                sql=validation.sanitizedSql or sql,
                error=validation.blockedReason,
                validation=validation.to_dict(),
            )

        try:
            data, columns = self.sql_executor.execute(
                database_id,
                decision.normalized_sql,
                limit=decision.effective_limit,
                auto_commit=False,
            )
            return SqlPreviewResult(
                ok=True,
                sql=decision.normalized_sql,
                validation=validation.to_dict(),
                columns=columns,
                rowCount=len(data),
                data=data,
            )
        except Exception as exc:
            logger.info("AI SQL preview failed for %s: %s", database_id, exc)
            return SqlPreviewResult(
                ok=False,
                sql=validation.sanitizedSql,
                error=str(exc),
                validation=validation.to_dict(),
            )

    def _dialect(self, database_id: str) -> Optional[str]:
        try:
            return self.metadata.get_db_type(database_id)
        except Exception:
            return None


sql_execution_verifier = SqlExecutionVerifier()
