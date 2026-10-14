"""
execution.py

Pydantic request and response schemas for query execution endpoints.
"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ExecuteQueryRequest(BaseModel):
    databaseId: str
    sql: str
    autoCommit: bool = True
    limit: int = Field(default=1000, ge=1)
    confirmationToken: Optional[str] = None


class ExplainQueryRequest(BaseModel):
    databaseId: str
    sql: str


class ExplainPlanGraphNode(BaseModel):
    id: str
    label: str
    operation: str
    relation: Optional[str] = None
    details: Dict[str, Any] = Field(default_factory=dict)
    warnings: List[str] = Field(default_factory=list)


class ExplainPlanGraphEdge(BaseModel):
    id: str
    source: str
    target: str
    label: Optional[str] = None


class ExplainPlanGraph(BaseModel):
    nodes: List[ExplainPlanGraphNode] = Field(default_factory=list)
    edges: List[ExplainPlanGraphEdge] = Field(default_factory=list)


class ExplainQueryResponse(BaseModel):
    plan: Any = None
    dialect: str
    graph: ExplainPlanGraph = Field(default_factory=ExplainPlanGraph)
    summary: Dict[str, Any] = Field(default_factory=dict)


class SaveQueryRequest(BaseModel):
    id: Optional[str] = None
    sql: str
    name: str
    databaseId: str
    description: Optional[str] = None
    userId: Optional[str] = None


class ExecuteQueryResponse(BaseModel):
    data: List[Dict[str, Any]]
    columns: List[str]
    executionTime: int
    error: Optional[str] = None


class SavedQueryResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    sql: Optional[str] = None
    databaseId: Optional[str] = None


class QueryHistoryResponse(BaseModel):
    id: str
    sql: str
    status: str
    executionTime: Optional[int] = None
    errorMessage: Optional[str] = None
    databaseId: Optional[str] = None
    executedAt: Optional[str] = None
    created_on: Optional[str] = None
    database: Dict[str, Any] = Field(default_factory=dict)


class QueryHistoryPageResponse(BaseModel):
    items: List[QueryHistoryResponse]
    hasMore: bool
    nextOffset: Optional[int] = None


class DeleteQueryHistoryResponse(BaseModel):
    deletedCount: int
