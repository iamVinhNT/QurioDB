"""
execution/__init__.py

Service for executing queries on various database engines and managing history.
Delegates heavy database-specific execution to specialized executors.
"""

from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime
import uuid
import logging

from ..base_service import BaseDatabaseService
from sqlalchemy.orm import Session

from models import Db, QueryHistory, SavedQuery
from .sql_executor import SqlExecutor
from .mongo_executor import MongoExecutor
from .redis_executor import RedisExecutor
from .explain_executor import ExplainExecutor
from .execution_approval import (
    ExecutionApprovalInvalid,
    ExecutionApprovalRequired,
    ExecutionApprovalStore,
)
from .sql_policy import SqlExecutionBlocked, SqlExecutionPolicy


logger = logging.getLogger(__name__)

class ExecutionService(BaseDatabaseService):
    """
    Handles query routing, execution, and history persistence.
    Acts as a facade for SqlExecutor, MongoExecutor, and RedisExecutor.
    """

    def __init__(self):
        super().__init__()
        self.sql_executor = SqlExecutor(self)
        self.mongo_executor = MongoExecutor(self)
        self.redis_executor = RedisExecutor(self)
        self.explain_executor = ExplainExecutor(self)
        self.sql_policy = SqlExecutionPolicy()
        self.approval_store = ExecutionApprovalStore()

    def execute_query(
        self,
        database_id: str,
        sql: str,
        session: Session,
        auto_commit: bool = True,
        limit: int = 1000,
        user_id: str = "",
        confirmation_token: str | None = None,
    ) -> Dict[str, Any]:
        """Routes queries through policy before relational driver access."""
        start_time = datetime.now()
        status = "SUCCESS"
        error_message = None
        data, columns = [], []

        if not database_id or not sql:
            raise ValueError("Database ID and SQL query are required.")

        db_type, _ = self.get_db_config(database_id, session)
        if db_type == "mongodb":
            self.mongo_executor.validate_read_only(sql)
            data, columns = self.mongo_executor.execute(database_id, sql, limit)
        elif db_type == "redis":
            data, columns = self.redis_executor.execute(database_id, sql, limit)
        else:
            decision = self.sql_policy.decide(sql, db_type, limit)
            if decision.outcome == "blocked":
                raise SqlExecutionBlocked(decision)
            if decision.outcome == "confirmation_required":
                if confirmation_token:
                    self.approval_store.consume(
                        confirmation_token,
                        user_id=user_id,
                        database_id=database_id,
                        sql_fingerprint=decision.fingerprint,
                        effective_limit=decision.effective_limit,
                        auto_commit=auto_commit,
                    )
                else:
                    approval = self.approval_store.create(
                        user_id=user_id,
                        database_id=database_id,
                        sql_fingerprint=decision.fingerprint,
                        effective_limit=decision.effective_limit,
                        auto_commit=auto_commit,
                    )
                    raise ExecutionApprovalRequired(approval, decision)
            try:
                data, columns = self.sql_executor.execute(
                    database_id,
                    decision.normalized_sql,
                    decision.effective_limit,
                    auto_commit,
                )
            except Exception as exc:
                status = "FAILED"
                error_message = str(exc)
                logger.error("Execution failed for %s: %s - %s", database_id, status, error_message)

        execution_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)
        self._save_history(database_id, sql, status, execution_time_ms, error_message, session)
        return {
            "data": data,
            "columns": columns,
            "executionTime": execution_time_ms,
            "error": error_message,
        }

    def get_explain_plan(self, database_id: str, sql: str, session: Session) -> Dict[str, Any]:
        """Routes an EXPLAIN request to the ExplainExecutor."""
        if not database_id or not sql:
            raise ValueError("Database ID and SQL query are required.")

        db_type, _ = self.get_db_config(database_id, session)

        # We only support EXPLAIN for SQL relational DBs for now
        if db_type in ['mongodb', 'redis']:
             raise ValueError("Performance Insights (EXPLAIN) is currently only supported for SQL databases.")

        return self.explain_executor.execute(database_id, sql)

    def _save_history(self, db_id: str, sql: str, status: str, time_ms: int, error: Optional[str], session: Session):
        """Persists the outcome of a query execution for later analysis."""
        try:
             history = QueryHistory(
                 id=str(uuid.uuid4()),
                 sql=sql,
                 status=status,
                 executionTime=time_ms,
                 errorMessage=error[:500] if error else None,
                 databaseId=db_id
             )
             session.add(history)
             session.commit()
        except Exception as ex:
             logger.error(f"Failed to save history: {ex}")

    def save_query(self, data: Dict[str, Any], session: Session) -> Dict[str, str]:
        """Creates or updates a named query in the user's library."""
        try:
            query_id = data.get("id")
            if query_id:
                q = session.get(SavedQuery, query_id)
                if not q:
                    raise ValueError("Saved query not found")
                if q.userId and data.get("userId") and q.userId != data["userId"]:
                    raise ValueError("Saved query does not belong to the current user")

                q.name = data.get("name") or q.name
                if "description" in data:
                    q.description = data.get("description")
                q.sql = data["sql"]
                q.databaseId = data["databaseId"]
                if data.get("userId") and not q.userId:
                    q.userId = data["userId"]
                session.commit()
                return {
                    "id": q.id,
                    "name": q.name,
                    "description": q.description,
                    "sql": q.sql,
                    "databaseId": q.databaseId,
                }

            q = SavedQuery(
                id=str(uuid.uuid4()),
                name=data['name'],
                description=data.get('description'),
                sql=data['sql'],
                databaseId=data['databaseId'],
                userId=data.get('userId')
            )
            session.add(q)
            session.commit()
            return {
                "id": q.id,
                "name": q.name,
                "description": q.description,
                "sql": q.sql,
                "databaseId": q.databaseId,
            }
        except Exception as e:
            logger.error(f"Failed to save query: {e}")
            raise

    def get_query_history(self, session: Session, database_id: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
        """Retrieves and serializes query execution history, optionally filtered by database."""
        try:
            query = session.query(QueryHistory).order_by(QueryHistory.created_on.desc())
            if database_id:
                query = query.filter(QueryHistory.databaseId == database_id)
            
            history = query.limit(limit).all()
            
            # Efficiently map database names for the front-end display
            db_ids = list(set(h.databaseId for h in history if h.databaseId))
            db_map = {db.id: db.databaseName for db in session.query(Db).filter(Db.id.in_(db_ids)).all()} if db_ids else {}
            
            return [{
                "id": h.id, "sql": h.sql, "status": h.status,
                "executionTime": h.executionTime, "errorMessage": h.errorMessage,
                "databaseId": h.databaseId, "executedAt": h.executedAt.isoformat() if h.executedAt else None,
                "created_on": h.created_on.isoformat() if h.created_on else None,
                "database": {"databaseName": db_map.get(h.databaseId, "Unknown")}
            } for h in history]
        except Exception as e:
            logger.error(f"Failed to retrieve history: {e}")
            return []
            
    def list_saved_queries(self, session: Session, database_id: Optional[str] = None, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Lists saved queries, optionally filtered by database or user ownership."""
        try:
            query = session.query(SavedQuery).order_by(SavedQuery.changed_on.desc())
            if database_id: query = query.filter(SavedQuery.databaseId == database_id)
            if user_id: query = query.filter(SavedQuery.userId == user_id)
                
            return [{
                "id": q.id, "name": q.name, "description": q.description,
                "sql": q.sql, "databaseId": q.databaseId
            } for q in query.all()]
        except Exception as e:
            logger.error(f"Failed to list saved queries: {e}")
            return []

execution_service = ExecutionService()
