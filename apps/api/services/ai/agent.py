"""
agent.py

Autonomous SQL Agent service handling generation, execution, and self-correction.
"""
import json
import logging
from typing import Dict, Any, Optional, TypedDict

from pymongo.errors import (
    AutoReconnect,
    ConfigurationError,
    ConnectionFailure,
    InvalidDocument,
    NetworkTimeout,
    OperationFailure,
    ServerSelectionTimeoutError,
)
from models import SessionLocal

from .base import BaseAIService
from .context import normalize_database_type, schema_context_service
from .langchain_runtime import END, START, StateGraph, langchain_runtime
from .mongodb_query import (
    MongoQueryPolicy,
    MongoQueryPolicyError,
    MongoQueryRenderer,
    MongoQuerySpec,
    filter_mongodb_result_documents,
    redact_mongo_sensitive_payload,
    redact_mongo_sensitive_text,
    sanitize_mongodb_retrieval_trace,
)
from .sql_safety import sql_safety_validator
from ..execution.mongo_executor import MongoExecutor
from ..prompts import escape_untrusted_text, get_agent_prompt, get_mongodb_agent_prompt
from ..base_service import BaseDatabaseService
from sqlalchemy import text
from services.execution.sql_policy import SqlExecutionPolicy


logger = logging.getLogger(__name__)

SUPPORTED_AGENT_DATABASE_TYPES = frozenset(
    {
        "clickhouse",
        "duckdb",
        "mariadb",
        "mssql",
        "mysql",
        "oracle",
        "postgres",
        "redis",
        "sqlite",
        "sqlserver",
    }
)

class AgentGraphState(TypedDict, total=False):
    """State carried between LangGraph nodes for autonomous SQL execution."""

    prompt: str
    db_id: str
    schema: str
    user_id: Optional[str]
    model_id: Optional[str]
    conv_id: Optional[str]
    system_prompt: str
    retrieval_trace: Dict[str, Any]
    citations: list[Dict[str, Any]]
    current_prompt: str
    raw_response: str
    agent_res: Dict[str, Any]
    error: str
    sql: str
    retries: int
    max_retries: int


class AgentAIService(BaseAIService):
    """Handles autonomous Text-to-SQL logic with loops and retries."""

    def execute_agent(self, prompt: str, db_id: str, schema: str = "public", user_id: Optional[str] = None, model_id: Optional[str] = None, conv_id: Optional[str] = None) -> Dict[str, Any]:
        """Autonomous SQL Agent powered by LangGraph, with legacy loop fallback."""
        try:
            database_type = normalize_database_type(self._get_database_type(db_id))
        except Exception:
            logger.warning("Database type lookup failed before agent dispatch for %s", db_id)
            return {"type": "error", "message": "Unable to determine database type."}

        if database_type == "mongodb":
            return self._execute_mongodb_agent(prompt, db_id, schema, user_id, model_id, conv_id)
        if database_type not in SUPPORTED_AGENT_DATABASE_TYPES:
            return {"type": "error", "message": "Unsupported database type for agent execution."}

        if langchain_runtime.is_graph_available:
            try:
                return self._execute_agent_graph(prompt, db_id, schema, user_id, model_id, conv_id)
            except Exception as e:
                logger.warning("LangGraph agent failed; falling back to legacy loop: %s", e)

        return self._execute_agent_legacy(prompt, db_id, schema, user_id, model_id, conv_id)

    def _get_database_type(self, db_id: str) -> str:
        """Read database type before choosing a dialect-specific agent path."""
        session = SessionLocal()
        try:
            database_type = BaseDatabaseService().get_db_config(db_id, session)[0]
            if not database_type:
                raise ValueError("Database type is missing.")
            return normalize_database_type(database_type)
        finally:
            session.close()

    def _execute_mongodb_agent(
        self,
        prompt: str,
        db_id: str,
        schema: str = "public",
        user_id: Optional[str] = None,
        model_id: Optional[str] = None,
        conv_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Run the bounded MongoDB JSON-spec generation and repair loop."""
        safe_prompt = redact_mongo_sensitive_text(prompt)
        try:
            context_result = schema_context_service.build_schema_context(
                db_id,
                schema,
                intent=safe_prompt,
                database_type="mongodb",
            )
        except Exception as exc:
            return self._mongodb_error_response(_sanitize_mongo_error(exc), "", 0, 2)
        safe_retrieval_trace = sanitize_mongodb_retrieval_trace(
            context_result.retrieval_trace,
            safe_prompt,
        )
        safe_citations = redact_mongo_sensitive_payload(context_result.citations)
        system_prompt = get_mongodb_agent_prompt(context_result.context)
        conv_context = self._context_mgr.build_context_for_agent(
            conv_id,
            safe_prompt,
            redact_sensitive=True,
        )
        conv_context = redact_mongo_sensitive_text(conv_context)
        if conv_context:
            system_prompt += f"\n\n## CONVERSATION HISTORY\n{conv_context}\n\n## CURRENT REQUEST"

        known_collections = tuple(getattr(context_result, "collections", ()) or ())
        if not known_collections:
            return {
                "type": "error",
                "queryLanguage": "mongodb",
                "message": "MongoDB collection metadata is unavailable; refresh the database schema first.",
                "retryCount": 0,
                "maxRetries": 2,
                "retrievalTrace": safe_retrieval_trace,
                "citations": safe_citations,
            }
        trusted_database = getattr(context_result, "database", None)
        if not trusted_database and schema and schema.strip().lower() != "public":
            trusted_database = schema.strip()
        if not trusted_database:
            return {
                "type": "error",
                "queryLanguage": "mongodb",
                "message": "MongoDB database metadata is unavailable; refresh the database schema first.",
                "retryCount": 0,
                "maxRetries": 2,
                "retrievalTrace": safe_retrieval_trace,
                "citations": safe_citations,
            }
        current_prompt = f"Natural Request: {safe_prompt}"
        retries = 0
        max_retries = 2
        last_query_text = ""
        last_error = ""
        executor = MongoExecutor(BaseDatabaseService())

        while retries <= max_retries:
            response = self._generate_response(
                f"{system_prompt}\n\n{current_prompt}",
                model_id=model_id,
                user_id=user_id,
                task_key="agent.mongodb_readonly",
                db_id=db_id,
                database_type="mongodb",
            )
            if not response or response.startswith("AI Error:"):
                return self._mongodb_error_response(
                    _sanitize_mongo_error(response or "AI Failed"),
                    last_query_text,
                    retries,
                    max_retries,
                )

            try:
                agent_res = json.loads(self._clean_json_output(response))
                if not isinstance(agent_res, dict):
                    raise ValueError("MongoDB agent response must be a JSON object.")
            except Exception as exc:
                last_error = _sanitize_mongo_error(f"MongoDB JSON response is invalid: {exc}")
                retries += 1
                if retries > max_retries:
                    return self._mongodb_error_response(last_error, last_query_text, retries, max_retries)
                current_prompt = self._mongodb_repair_prompt(last_error, None, last_query_text)
                continue

            query_payload = agent_res.get("query")
            agent_type = agent_res.get("type")
            agent_res["confidence"] = _normalize_confidence(agent_res.get("confidence"))
            if agent_type in {"error", "clarification"}:
                agent_res = _sanitize_declared_mongodb_response(agent_res)
                agent_res["retrievalTrace"] = safe_retrieval_trace
                agent_res["citations"] = safe_citations
                agent_res["queryLanguage"] = "mongodb"
                agent_res["retryCount"] = retries
                agent_res["maxRetries"] = max_retries
                if agent_type == "error":
                    agent_res["message"] = _sanitize_mongo_error(agent_res.get("message", "MongoDB agent error."))
                agent_res.setdefault("retryCount", retries)
                agent_res.setdefault("maxRetries", max_retries)
                return agent_res
            if agent_res["confidence"] <= 2:
                return self._finalize_meta_tool(
                    {
                        "type": "clarification",
                        "summary": "Tôi chưa chắc ý của bạn. Bạn có thể nói rõ hơn không?",
                        "confidence": agent_res["confidence"],
                        "retrievalTrace": safe_retrieval_trace,
                        "citations": safe_citations,
                        "queryLanguage": "mongodb",
                        "retryCount": retries,
                        "maxRetries": max_retries,
                    },
                    safe_prompt,
                    user_id,
                    db_id,
                    conv_id,
                    database_type="mongodb",
                )
            if query_payload is None and agent_type == "success":

                safe_meta_response = _sanitize_mongodb_model_response(agent_res)
                safe_meta_response["retrievalTrace"] = safe_retrieval_trace
                safe_meta_response["citations"] = safe_citations
                safe_meta_response["queryLanguage"] = "mongodb"
                return self._finalize_meta_tool(
                    safe_meta_response,
                    safe_prompt,
                    user_id,
                    db_id,
                    conv_id,
                    database_type="mongodb",
                )


            try:
                spec = MongoQuerySpec.from_payload(query_payload)
                spec = MongoQueryPolicy(
                    known_collections=known_collections,
                    trusted_database=trusted_database,
                    field_allowlist=getattr(context_result, "field_allowlist", None),
                    array_field_allowlist=getattr(context_result, "array_field_allowlist", None),
                ).validate(spec)
                query_text = MongoQueryRenderer.render(spec)
                last_query_text = query_text
            except (MongoQueryPolicyError, ValueError) as exc:
                last_error = _sanitize_mongo_error(exc)
                retries += 1
                if retries > max_retries:
                    return self._mongodb_error_response(last_error, last_query_text, retries, max_retries)
                current_prompt = self._mongodb_repair_prompt(last_error, query_payload, last_query_text)
                continue

            try:
                data, columns = executor.execute_spec(
                    db_id,
                    spec,
                    trusted_database=trusted_database,
                    allowed_databases=getattr(context_result, "accessible_databases", None) or None,
                )
            except Exception as exc:
                last_error = _sanitize_mongo_error(exc)
                if not _is_retryable_mongo_query_error(exc):
                    return self._mongodb_error_response(last_error, last_query_text, retries, max_retries)
                retries += 1
                if retries > max_retries:
                    return self._mongodb_error_response(last_error, last_query_text, retries, max_retries)
                current_prompt = self._mongodb_repair_prompt(last_error, spec.to_payload(), last_query_text)
                continue

            safe_response = _sanitize_mongodb_success_response(
                agent_res,
                spec,
                query_text,
                columns,
                data,
                safe_retrieval_trace,
                safe_citations,
            )
            self._save_chat(
                "user",
                safe_prompt,
                user_id,
                db_id,
                conv_id=conv_id,
                database_type="mongodb",
            )

            message_id = self._save_chat(
                "assistant",
                json.dumps(safe_response),
                user_id,
                db_id,
                conv_id=conv_id,
            )
            self._save_retrieval_event(
                safe_retrieval_trace,
                safe_prompt,
                db_id,
                message_id=message_id,
                conv_id=conv_id,
            )
            self._save_generated_query(
                query_text,
                safe_prompt,
                safe_response.get("summary"),
                user_id,
                db_id,
                database_type="mongodb",
            )
            safe_response["messageId"] = message_id
            return safe_response

        return self._mongodb_error_response(last_error or "MongoDB agent retries exhausted.", last_query_text, retries, max_retries)

    def _mongodb_repair_prompt(
        self,
        error: str,
        query_payload: Optional[Dict[str, Any]],
        query_text: str,
    ) -> str:
        """Build a repair request that remains inside the MongoDB JSON contract."""
        safe_payload = redact_mongo_sensitive_payload(query_payload) if query_payload else {}
        previous_spec = json.dumps(safe_payload, ensure_ascii=False, sort_keys=True, default=str)
        safe_error = _sanitize_mongo_error(error)
        safe_query_text = redact_mongo_sensitive_text(query_text)
        return (
            "The previous MongoDB JSON query spec failed validation or execution. "
            "Return one corrected MongoDB JSON query spec only. Do not return free-form MQL text, JavaScript, or code.\n"
            f"ERROR: {escape_untrusted_text(safe_error)}\n"
            f"FAILED SPEC: {escape_untrusted_text(previous_spec)}\n"
            f"FAILED QUERY TEXT: {escape_untrusted_text(safe_query_text)}\n"
            "Keep the operation read-only and use only the supplied collection and field context."
        )

    def _mongodb_error_response(
        self,
        message: str,
        last_query_text: str,
        retry_count: int = 0,
        max_retries: int = 2,
    ) -> Dict[str, Any]:
        """Return a safe exhausted/error response with the compatibility alias."""
        result = {
            "type": "error",
            "queryLanguage": "mongodb",
            "message": _sanitize_mongo_error(message),
            "retryCount": max(0, int(retry_count)),
            "maxRetries": max(0, int(max_retries)),
        }
        safe_query_text = redact_mongo_sensitive_text(last_query_text)
        if safe_query_text:
            result["lastQueryText"] = safe_query_text
            result["last_sql"] = safe_query_text
        return result

    def _execute_agent_graph(self, prompt: str, db_id: str, schema: str = "public", user_id: Optional[str] = None, model_id: Optional[str] = None, conv_id: Optional[str] = None) -> Dict[str, Any]:
        """Runs the agent state machine with LangGraph conditional retries."""
        graph = StateGraph(AgentGraphState)
        graph.add_node("prepare", self._agent_prepare_node)
        graph.add_node("generate", self._agent_generate_node)
        graph.add_node("execute", self._agent_execute_node)
        graph.add_node("repair", self._agent_repair_node)
        graph.add_edge(START, "prepare")
        graph.add_edge("prepare", "generate")
        graph.add_conditional_edges(
            "generate",
            self._route_after_generate,
            {"execute": "execute", "done": END},
        )
        graph.add_conditional_edges(
            "execute",
            self._route_after_execute,
            {"repair": "repair", "done": END},
        )
        graph.add_edge("repair", "generate")

        app = graph.compile()
        state = app.invoke({
            "prompt": prompt,
            "db_id": db_id,
            "schema": schema or "public",
            "user_id": user_id,
            "model_id": model_id,
            "conv_id": conv_id,
            "retries": 0,
            "max_retries": 2,
        })

        if state.get("error"):
            return {"type": "error", "message": state["error"], "last_sql": state.get("sql")}

        agent_res = state.get("agent_res") or {}
        if state.get("retrieval_trace"):
            agent_res["retrievalTrace"] = state["retrieval_trace"]
        if state.get("citations"):
            agent_res["citations"] = state["citations"]
        if not agent_res.get("sql"):
            return self._finalize_meta_tool(agent_res, prompt, user_id, db_id, conv_id)

        self._save_chat("user", prompt, user_id, db_id, conv_id=conv_id)
        aid = self._save_chat("assistant", json.dumps(agent_res), user_id, db_id, conv_id=conv_id)
        self._save_retrieval_event(state.get("retrieval_trace"), prompt, db_id, message_id=aid, conv_id=conv_id)
        self._save_generated_query(agent_res.get("sql"), prompt, agent_res.get("summary"), user_id, db_id)
        agent_res["messageId"] = aid
        return agent_res

    def _agent_prepare_node(self, state: AgentGraphState) -> AgentGraphState:
        context_result = schema_context_service.build_schema_context(state["db_id"], state.get("schema") or "public", intent=state["prompt"])
        system_prompt = get_agent_prompt(context_result.context)
        conv_context = self._context_mgr.build_context_for_agent(state.get("conv_id"), state["prompt"])
        if conv_context:
            system_prompt += f"\n\n## CONVERSATION HISTORY\n{conv_context}\n\n## CURRENT REQUEST"

        return {
            **state,
            "system_prompt": system_prompt,
            "retrieval_trace": context_result.retrieval_trace,
            "citations": context_result.citations,
            "current_prompt": f"Natural Request: {state['prompt']}",
        }

    def _agent_generate_node(self, state: AgentGraphState) -> AgentGraphState:
        response = self._generate_response(
            f"{state['system_prompt']}\n\n{state['current_prompt']}",
            model_id=state.get("model_id"),
            user_id=state.get("user_id"),
            task_key="agent.sql_readonly",
            db_id=state.get("db_id"),
        )
        if not response or response.startswith("AI Error:"):
            return {**state, "error": response or "AI Failed"}

        try:
            agent_res = json.loads(self._clean_json_output(response))
        except Exception as e:
            logger.error("Agent JSON parse failed: %s", e)
            return {**state, "error": f"Internal crash: {str(e)}"}

        if agent_res.get("type") == "error":
            return {**state, "error": agent_res.get("message", "AI returned an error")}

        return {
            **state,
            "raw_response": response,
            "agent_res": agent_res,
            "sql": agent_res.get("sql") or "",
        }

    def _agent_execute_node(self, state: AgentGraphState) -> AgentGraphState:
        sql = state.get("sql") or ""
        safety = sql_safety_validator.validate(sql)
        decision = SqlExecutionPolicy().decide(sql, None, 50)
        if not safety.isAllowed or decision.outcome != "allowed":
            retries = int(state.get("retries") or 0) + 1
            agent_res = dict(state.get("agent_res") or {})
            agent_res.update({
                "type": "error",
                "message": decision.reason or safety.blockedReason,
                "sql": "",
                "validation": safety.to_dict(),
            })
            return {**state, "agent_res": agent_res, "error": agent_res["message"], "retries": retries}
        state = {**state, "sql": decision.normalized_sql}
        try:
            exec_res = self._execute_sql_internal(state["db_id"], decision.normalized_sql)
            agent_res = dict(state.get("agent_res") or {})
            agent_res.update(exec_res)
            agent_res["sql"] = decision.normalized_sql
            agent_res["validation"] = safety.to_dict()
            return {**state, "agent_res": agent_res, "error": ""}
        except Exception as e:
            retries = int(state.get("retries") or 0) + 1
            if retries > int(state.get("max_retries") or 2):
                return {
                    **state,
                    "retries": retries,
                    "error": f"Execution failed after {state.get('max_retries', 2)} retries: {str(e)}",
                }
            return {
                **state,
                "retries": retries,
                "error": str(e),
            }

    def _agent_repair_node(self, state: AgentGraphState) -> AgentGraphState:
        logger.warning("LangGraph agent correction triggered (Retry %s/%s)", state.get("retries"), state.get("max_retries"))
        return {
            **state,
            "current_prompt": f"SQL failed validation or execution with error: {state.get('error')}\nFAILED SQL: {state.get('sql')}\nPlease FIX and retry with one safe read-only SQL statement.",
            "error": "",
        }

    def _route_after_generate(self, state: AgentGraphState) -> str:
        if state.get("error") or not state.get("sql"):
            return "done"
        return "execute"

    def _route_after_execute(self, state: AgentGraphState) -> str:
        if state.get("error") and int(state.get("retries") or 0) <= int(state.get("max_retries") or 2):
            return "repair"
        return "done"

    def _execute_agent_legacy(self, prompt: str, db_id: str, schema: str = "public", user_id: Optional[str] = None, model_id: Optional[str] = None, conv_id: Optional[str] = None) -> Dict[str, Any]:
        """Legacy loop used when LangGraph is unavailable or graph execution fails."""
        context_result = schema_context_service.build_schema_context(db_id, schema, intent=prompt)
        system_prompt = get_agent_prompt(context_result.context)
        
        # Load conversation history for context awareness
        conv_context = self._context_mgr.build_context_for_agent(conv_id, prompt)
        if conv_context:
            system_prompt += f"\n\n## CONVERSATION HISTORY\n{conv_context}\n\n## CURRENT REQUEST"
        current_prompt = f"Natural Request: {prompt}"

        retries = 0
        max_retries = 2
        
        while retries <= max_retries:
            response = self._generate_response(
                f"{system_prompt}\n\n{current_prompt}",
                model_id=model_id,
                user_id=user_id,
                task_key="agent.sql_readonly",
                db_id=db_id,
            )
            if not response or response.startswith("AI Error:"):
                return {"type": "error", "message": response or "AI Failed"}
            
            try:
                # Clean JSON markdown if present
                clean_raw = self._clean_json_output(response)
                agent_res = json.loads(clean_raw)
                
                if agent_res.get("type") == "error": return agent_res
                
                sql = agent_res.get("sql")
                if not sql:
                    agent_res["retrievalTrace"] = context_result.retrieval_trace
                    agent_res["citations"] = context_result.citations
                    return self._finalize_meta_tool(agent_res, prompt, user_id, db_id, conv_id)
                safety = sql_safety_validator.validate(sql)
                if not safety.isAllowed:
                    agent_res.update({
                        "type": "error",
                        "message": safety.blockedReason,
                        "sql": "",
                        "validation": safety.to_dict(),
                    })
                    return agent_res
                sql = safety.sanitizedSql
                agent_res["sql"] = sql
                agent_res["validation"] = safety.to_dict()
                
                # Try execution
                try:
                    exec_res = self._execute_sql_internal(db_id, sql)
                    agent_res.update(exec_res)
                    
                    self._save_chat("user", prompt, user_id, db_id, conv_id=conv_id)
                    aid = self._save_chat("assistant", json.dumps(agent_res), user_id, db_id, conv_id=conv_id)
                    self._save_retrieval_event(context_result.retrieval_trace, prompt, db_id, message_id=aid, conv_id=conv_id)
                    self._save_generated_query(sql, prompt, agent_res.get("summary"), user_id, db_id)
                    
                    agent_res["messageId"] = aid
                    agent_res["retrievalTrace"] = context_result.retrieval_trace
                    agent_res["citations"] = context_result.citations
                    return agent_res
                    
                except Exception as e:
                    retries += 1
                    if retries > max_retries:
                        return {"type": "error", "message": f"Execution failed after {max_retries} retries: {str(e)}", "last_sql": sql}
                    
                    current_prompt = f"SQL failed with error: {str(e)}\nFAILED SQL: {sql}\nPlease FIX and retry."
                    logger.warning(f"Agent correction triggered (Retry {retries}/{max_retries})")
                    
            except Exception as e:
                logger.error(f"Agent crash: {e}")
                return {"type": "error", "message": f"Internal crash: {str(e)}"}
        
        return {"type": "error", "message": "Max retries exceeded"}

    def _execute_sql_internal(self, db_id: str, sql: str) -> Dict:
        """Helper to run agent query."""
        db_service = BaseDatabaseService()
        def _run(conn):
            query = text(sql).execution_options(max_row_buffer=50)
            res = conn.execute(query)
            cols = list(res.keys())
            data = [dict(zip(cols, row)) for row in res.fetchmany(50)]
            return {"columns": cols, "data": data}
        return db_service.run_dynamic_query(db_id, _run)

    def _finalize_meta_tool(
        self,
        agent_res: Dict,
        prompt: str,
        user_id: str,
        db_id: str,
        conv_id: str,
        database_type: Optional[str] = None,
    ) -> Dict:
        """Handles non-SQL responses (thinking, summaries)."""
        agent_res["confidence"] = _normalize_confidence(agent_res.get("confidence"))
        agent_res["type"] = "clarification" if agent_res["confidence"] <= 2 else "success"
        if agent_res["type"] == "clarification":
            agent_res["summary"] = "Tôi chưa chắc ý của bạn. Bạn có thể nói rõ hơn không?"
        self._save_chat(
            "user",
            prompt,
            user_id,
            db_id,
            conv_id=conv_id,
            database_type=database_type,
        )
        cid = self._save_chat(
            "assistant",
            json.dumps(agent_res),
            user_id,
            db_id,
            conv_id=conv_id,
            database_type=database_type,
        )
        self._save_retrieval_event(agent_res.get("retrievalTrace"), prompt, db_id, message_id=cid, conv_id=conv_id)
        agent_res["messageId"] = cid
        return agent_res

    def _clean_json_output(self, text: str) -> str:
        """Strips markdown code blocks."""
        clean = text.strip()
        if clean.startswith("```json"): clean = clean[7:-3].strip()
        elif clean.startswith("```"): clean = clean[3:-3].strip()
        return clean


def _is_retryable_mongo_query_error(error: Exception) -> bool:
    """Allow model repair only for errors plausibly caused by query shape."""
    if isinstance(error, (ConnectionFailure, NetworkTimeout, ServerSelectionTimeoutError, AutoReconnect, ConfigurationError)):
        return False
    if isinstance(error, OperationFailure):
        return error.code in {2, 9, 14, 16872}
    return isinstance(error, InvalidDocument)


def _normalize_confidence(value: Any) -> int:
    """Coerce model confidence to a bounded, conservative integer."""
    default_confidence = 3
    if isinstance(value, bool):
        return default_confidence
    try:
        normalized = int(value)
    except (TypeError, ValueError):
        return default_confidence
    return max(1, min(5, normalized))


def _sanitize_declared_mongodb_response(response: Dict[str, Any]) -> Dict[str, Any]:
    """Preserve declared response type while removing sensitive model output."""
    sanitized = redact_mongo_sensitive_payload(response)
    if not isinstance(sanitized, dict):
        return {
            "type": "error",
            "message": "Invalid MongoDB agent response.",
            "queryLanguage": "mongodb",
            "retryCount": 0,
            "maxRetries": 2,
        }
    sanitized["queryLanguage"] = "mongodb"

    for field_name in ("message", "summary", "error", "lastQuery", "lastQueryText", "lastSql", "last_sql"):
        if field_name in sanitized:
            sanitized[field_name] = _sanitize_mongo_error(sanitized[field_name])
    return sanitized


def _sanitize_mongodb_model_response(response: Dict[str, Any]) -> Dict[str, Any]:
    """Recursively redact all model-provided fields before return or persistence."""
    sanitized = redact_mongo_sensitive_payload(response)
    return sanitized if isinstance(sanitized, dict) else {}


def _sanitize_mongodb_success_response(
    model_response: Dict[str, Any],
    spec: MongoQuerySpec,
    query_text: str,
    columns: list[str],
    data: list[Dict[str, Any]],
    retrieval_trace: Dict[str, Any],
    citations: list[Dict[str, Any]],
) -> Dict[str, Any]:
    """Keep safe model commentary while replacing all query-controlled fields."""
    reserved_fields = {
        "type",
        "queryLanguage",
        "query",
        "queryText",
        "sql",
        "columns",
        "data",
        "validation",
        "retrievalTrace",
        "citations",
        "messageId",
    }
    safe_model = _sanitize_mongodb_model_response(model_response)
    safe_response = {
        key: value for key, value in safe_model.items() if key not in reserved_fields
    }
    safe_data = redact_mongo_sensitive_payload(
        filter_mongodb_result_documents(data, spec.output_projection)
    )
    safe_response.update(
        {
            "type": "query_result",
            "queryLanguage": "mongodb",
            "query": redact_mongo_sensitive_payload(spec.to_payload()),
            "queryText": redact_mongo_sensitive_text(query_text),
            "sql": redact_mongo_sensitive_text(query_text),
            "columns": _mongodb_response_columns(safe_data),
            "data": safe_data,
            "validation": {"allowed": True, "operation": spec.operation},
            "retrievalTrace": redact_mongo_sensitive_payload(retrieval_trace),
            "citations": redact_mongo_sensitive_payload(citations),
        }
    )
    return safe_response


def _mongodb_response_columns(data: Any) -> list[str]:
    """Derive response columns from sanitized rows, not executor metadata."""
    if not isinstance(data, list):
        return []
    return sorted(
        {
            str(column)
            for row in data
            if isinstance(row, dict)
            for column in row
        }
    )


def _sanitize_mongo_error(error: Exception | str) -> str:
    """Keep repair/error text bounded and free of MongoDB credentials or URIs."""
    return redact_mongo_sensitive_text(error)[:500]
