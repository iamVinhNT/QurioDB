"""knowledge.py — Validated contracts for Markdown knowledge and reviewed bindings."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Contract(BaseModel):
    @field_validator("*", mode="after")
    @classmethod
    def nonblank_labels(cls, value, info):
        if info.field_name in {"name", "title", "schemaName", "tableName", "role", "databaseId"} and isinstance(value, str) and not value.strip():
            raise ValueError("Value cannot be blank")
        return value

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)


class ObjectBinding(Contract):
    schemaName: str = Field(min_length=1, max_length=200)
    tableName: str = Field(min_length=1, max_length=240)
    columnName: str | None = Field(default=None, max_length=240)
    catalogName: str = Field(default="", max_length=200)


class LogicalJoin(Contract):
    source: ObjectBinding
    target: ObjectBinding
    columnPairs: list[tuple[str, str]] = Field(min_length=1, max_length=20)
    role: str = Field(min_length=1, max_length=200)
    cardinality: Literal["unknown", "one-to-one", "many-to-one", "one-to-many", "many-to-many"] = "unknown"
    confirmed: bool = False


class Definition(Contract):
    kind: Literal["concept", "metric", "rule", "example"] = "concept"
    name: str = Field(min_length=1, max_length=240)
    description: str = Field(default="", max_length=20000)
    aliases: list[str] = Field(default_factory=list, max_length=40)
    formula: str = Field(default="", max_length=4000)
    grain: str = Field(default="", max_length=2000)
    timeColumn: str = Field(default="", max_length=500)
    timezone: str = Field(default="", max_length=100)
    filters: str = Field(default="", max_length=4000)
    sql: str = Field(default="", max_length=20000)
    dialect: str = Field(default="", max_length=60)
    verified: bool = False


class DefinitionData(Contract):
    bindings: list[ObjectBinding] = Field(default_factory=list, max_length=100)
    definitions: list[Definition] = Field(default_factory=list, max_length=40)
    joins: list[LogicalJoin] = Field(default_factory=list, max_length=40)


class BaseCreate(Contract):
    name: str = Field(min_length=1, max_length=200)
    databaseId: str = Field(min_length=1)
    description: str = Field(default="", max_length=4000)
    enabledForSql: bool = False


class BasePatch(Contract):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    enabledForSql: bool | None = None


class DocumentCreate(Contract):
    title: str = Field(min_length=1, max_length=240)
    kind: Literal["design", "dictionary", "metric", "rule", "example", "note"] = "design"
    bodyMarkdown: str = Field(default="", max_length=2_000_000)
    definitionData: DefinitionData = Field(default_factory=DefinitionData)


class DocumentPatch(DocumentCreate):
    expectedVersion: int = Field(ge=1)


class PublishRequest(Contract):
    expectedVersion: int = Field(ge=1)
    lexicalOnly: bool = False


class PreviewRequest(Contract):
    query: str = Field(min_length=1, max_length=4000)
    schemaName: str = Field(default="public", min_length=1, max_length=200)


class Page(BaseModel):
    items: list[dict[str, Any]]
    total: int
    page: int
    pageSize: int


class JobOut(BaseModel):
    id: str
    revisionId: str
    status: str
    mode: str
    error: str | None = None


class ResourceOut(BaseModel):
    """Resource fields are additive while identity is always explicit."""
    model_config = ConfigDict(extra="allow")
    id: str


class SchemaSyncRequest(Contract):
    schemaName: str = Field(min_length=1, max_length=200)


class LegacyImportRequest(Contract):
    sourceId: str = Field(min_length=1, max_length=200)
