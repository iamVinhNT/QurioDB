"""
ai_generation.py

Routes for AI SQL generation, agent execution, autocomplete, and streaming chat.
"""

from fastapi import APIRouter, Depends, HTTPException

from schemas.ai import (
    CompleteSqlRequest,
    ExecuteAgentRequest,
    ExplainPlanRequest,
    ExplainSqlRequest,
    FixSqlRequest,
    GenerateSqlRequest,
    OptimizeSqlRequest,
    ValidateSqlRequest,
)
from services.ai.conversation_store import conversation_store
from services.ai.mongodb_query import redact_mongo_sensitive_text
from services.ai.retrieval.metadata_source import SchemaMetadataSource
from services.ai.sql_safety import sql_safety_validator
from services.ai_service import ai_service
from utils.auth_middleware import get_current_user

router = APIRouter()


@router.post("/generate-sql")
def generate_sql(data: GenerateSqlRequest, current_user: dict = Depends(get_current_user)):
    return _raise_or_return(ai_service.generate_sql(
        data.prompt,
        data.databaseId,
        data.schema_name,
        user_id=current_user.get("userId"),
        model_id=data.modelId,
    ))


@router.post("/explain-sql")
def explain_sql(data: ExplainSqlRequest, current_user: dict = Depends(get_current_user)):
    return _raise_or_return(ai_service.explain_sql(
        data.sql,
        user_id=current_user.get("userId"),
        model_id=data.modelId,
    ))


@router.post("/explain-plan")
def explain_plan(data: ExplainPlanRequest, current_user: dict = Depends(get_current_user)):
    return _raise_or_return(ai_service.explain_execution_plan(
        data.sql,
        data.dialect,
        data.plan or {},
        data.graph or {},
        data.summary or {},
        user_id=current_user.get("userId"),
        db_id=data.databaseId,
        model_id=data.modelId,
    ))


@router.post("/optimize-sql")
def optimize_sql(data: OptimizeSqlRequest, current_user: dict = Depends(get_current_user)):
    return _raise_or_return(ai_service.optimize_sql(
        data.sql,
        data.databaseId,
        data.schema_name,
        user_id=current_user.get("userId"),
        model_id=data.modelId,
    ))


@router.post("/fix-sql")
def fix_sql(data: FixSqlRequest, current_user: dict = Depends(get_current_user)):
    return _raise_or_return(ai_service.fix_sql(
        data.sql,
        data.error,
        data.databaseId,
        data.schema_name,
        user_id=current_user.get("userId"),
        model_id=data.modelId,
    ))


@router.post("/complete")
def autocomplete_sql(data: CompleteSqlRequest, current_user: dict = Depends(get_current_user)):
    if not data.prefix:
        return {"completion": ""}
    try:
        return ai_service.autocomplete_sql(
            db_id=data.databaseId,
            schema=data.schema_name,
            prefix=data.prefix,
            suffix=data.suffix,
            user_id=current_user.get("userId"),
            model_id=data.modelId,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/validate-sql")
def validate_sql(data: ValidateSqlRequest, current_user: dict = Depends(get_current_user)):
    dialect = data.dialect
    if not dialect and data.databaseId:
        dialect = SchemaMetadataSource().get_db_type(data.databaseId)
    return sql_safety_validator.validate(
        data.sql,
        dialect=dialect,
        allow_write=data.allowWrite,
        max_preview_rows=data.maxPreviewRows,
    ).to_dict()


@router.post("/agent")
def execute_agent(data: ExecuteAgentRequest, current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("userId")
    title_prompt = redact_mongo_sensitive_text(data.prompt)
    conversation_id = conversation_store.ensure_conversation(
        user_id,
        data.databaseId,
        title_prompt,
        data.conversationId,
    )
    result = ai_service.execute_agent(
        data.prompt,
        data.databaseId,
        data.schema_name,
        user_id=user_id,
        model_id=data.modelId,
        conv_id=conversation_id,
    )
    if isinstance(result, dict):
        result["conversationId"] = conversation_id
    if result.get("type") == "error":
        detail = {"message": result.get("message") or "Unknown error"}
        if result.get("queryLanguage") == "mongodb":
            for key in ("queryLanguage", "retryCount", "maxRetries", "lastQueryText", "last_sql"):
                if key in result:
                    detail[key] = result[key]
        raise HTTPException(status_code=400, detail=detail)
    return result


def _raise_or_return(result: dict):
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result
