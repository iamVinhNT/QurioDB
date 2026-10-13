"""
execution_routes.py

API routes for query execution, history management, and saved queries.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from deps import get_db
from schemas.execution import (
    DeleteQueryHistoryResponse,
    ExecuteQueryRequest,
    ExecuteQueryResponse,
    ExplainQueryRequest,
    ExplainQueryResponse,
    QueryHistoryResponse,
    QueryHistoryPageResponse,
    SavedQueryResponse,
    SaveQueryRequest,
)
from services.execution import execution_service
from services.execution.execution_approval import (
    ExecutionApprovalInvalid,
    ExecutionApprovalRequired,
)
from services.execution.sql_policy import SqlExecutionBlocked

from utils.auth_middleware import get_current_user
from utils.http_errors import raise_http_error

execution_bp = APIRouter(dependencies=[Depends(get_current_user)])

@execution_bp.post('/execute', response_model=ExecuteQueryResponse)
def execute_query(
    data: ExecuteQueryRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Executes a SQL/MQL query against the specified database instance."""
    try:
        return execution_service.execute_query(
            data.databaseId,
            data.sql,
            db,
            data.autoCommit,
            data.limit,
            current_user["userId"],
            data.confirmationToken,
        )
    except ExecutionApprovalRequired as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "sql_confirmation_required",
                "confirmationToken": exc.approval.token,
                "expiresAt": exc.approval.expires_at.isoformat(),
                "risk": exc.decision.risk,
                "reason": exc.decision.reason,
            },
        ) from exc
    except ExecutionApprovalInvalid as exc:
        raise HTTPException(
            status_code=409,
            detail={"code": "sql_confirmation_invalid", "reason": str(exc)},
        ) from exc
    except SqlExecutionBlocked as exc:
        raise HTTPException(
            status_code=422,
            detail={"code": "sql_execution_blocked", "reason": str(exc)},
        ) from exc
    except Exception as exc:
        raise_http_error(exc)

@execution_bp.post('/explain', response_model=ExplainQueryResponse)
def explain_query(data: ExplainQueryRequest, db: Session = Depends(get_db)):
    """Generates an EXPLAIN plan for a given query and returns performance metrics."""
    try:
        return execution_service.get_explain_plan(data.databaseId, data.sql, db)
    except Exception as exc:
        raise_http_error(exc)

@execution_bp.get('/history', response_model=list[QueryHistoryResponse] | QueryHistoryPageResponse)
def get_history(
    databaseId: str | None = None,
    q: str = "",
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    paginated: bool = False,
    db: Session = Depends(get_db),
):
    """Searches history and optionally returns a page, preserving legacy arrays."""
    try:
        return execution_service.get_query_history(
            db, databaseId, limit, offset=offset, q=q, paginated=paginated,
        )
    except Exception as exc:
        raise_http_error(exc, allow_not_found=False)

@execution_bp.delete('/history', response_model=DeleteQueryHistoryResponse)
def delete_history(databaseId: str = Query(...), db: Session = Depends(get_db)):
    """Permanently deletes query history for one explicitly selected database."""
    if not databaseId.strip():
        raise HTTPException(status_code=422, detail="Database ID must not be empty or whitespace-only.")
    try:
        return execution_service.delete_query_history(db, databaseId)
    except Exception as exc:
        raise_http_error(exc, allow_not_found=False)

@execution_bp.post('/save-query', response_model=SavedQueryResponse)
def save_query(
    data: SaveQueryRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Saves a SQL query with a custom label for reuse or future reference."""
    try:
        payload = data.model_dump(exclude_none=True)
        payload["userId"] = current_user["userId"]
        return execution_service.save_query(payload, db)
    except Exception as exc:
        raise_http_error(exc, allow_not_found=False)

@execution_bp.get('/saved-queries', response_model=list[SavedQueryResponse])
def list_saved_queries(databaseId: str | None = None, userId: str | None = None, db: Session = Depends(get_db)):
    """Lists all saved queries filtered by database or user."""
    try:
        return execution_service.list_saved_queries(db, databaseId, userId)
    except Exception as exc:
        raise_http_error(exc, allow_not_found=False)
