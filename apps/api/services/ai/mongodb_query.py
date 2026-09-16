"""
mongodb_query.py

Structured, read-only MongoDB query parsing, policy validation, and rendering
for the autonomous AI agent.
"""

from __future__ import annotations

from dataclasses import dataclass, field as dataclass_field, replace
import hashlib
import json
import re
from typing import Any, Collection, Mapping


SUPPORTED_OPERATIONS = ("find", "findOne", "aggregate", "countDocuments", "distinct")
DEFAULT_LIMIT = 100
MAX_LIMIT = 1000
DEFAULT_MAX_TIME_MS = 30000
MAX_MAX_TIME_MS = 30000
MAX_PIPELINE_STAGES = 20
MAX_NESTING_DEPTH = 20
ALLOWED_OPTIONS = frozenset({"limit", "maxTimeMS", "sort"})
PROTOTYPE_KEYS = frozenset({"__proto__", "prototype", "constructor"})
SENSITIVE_KEYS = frozenset(
    {
        "access_token",
        "apikey",
        "api_key",
        "authorization",
        "client_secret",
        "connection_string",
        "connectionstring",
        "credential",
        "credentials",
        "password",
        "passwd",
        "private_key",
        "pwd",
        "refresh_token",
        "secret",
        "token",
        "uri",
    }
)
CROSS_COLLECTION_STAGES = frozenset({"$lookup", "$graphLookup", "$unionWith"})
ALLOWED_FILTER_OPERATORS = frozenset(
    {
        "$all",
        "$and",
        "$elemMatch",
        "$eq",
        "$exists",
        "$gt",
        "$gte",
        "$in",
        "$lt",
        "$lte",
        "$ne",
        "$nin",
        "$nor",
        "$not",
        "$options",
        "$or",
        "$regex",
        "$size",
        "$type",
    }
)
ALLOWED_EXPRESSION_OPERATORS = frozenset(
    {
        "$add",
        "$addToSet",
        "$and",
        "$avg",
        "$cond",
        "$concat",
        "$divide",
        "$eq",
        "$first",
        "$gt",
        "$gte",
        "$ifNull",
        "$in",
        "$last",
        "$literal",
        "$lt",
        "$lte",
        "$max",
        "$min",
        "$mod",
        "$multiply",
        "$ne",
        "$nin",
        "$not",
        "$push",
        "$size",
        "$subtract",
        "$sum",
        "$toString",
        "$type",
    }
)
ALLOWED_PIPELINE_STAGES = frozenset(
    {
        "$addFields",
        "$count",
        "$group",
        "$limit",
        "$match",
        "$project",
        "$replaceRoot",
        "$replaceWith",
        "$set",
        "$skip",
        "$sort",
        "$unset",
        "$unwind",
    }
)
MAX_SKIP = 100_000
_CONNECTION_URI_PATTERN = re.compile(
    r"(?i)\b(?:mongodb(?:\+srv)?|redis(?:s)?|postgres(?:ql)?|mysql|mssql|oracle|sqlite|duckdb)://[^\s\"']+"
)
_USERINFO_PATTERN = re.compile(r"(?i)(?<![\w/:])[^\s:@/]+:[^\s@/]+@")
_SECRET_ASSIGNMENT_PATTERN = re.compile(
    r"(?i)(?<![a-z0-9_])(?P<quote>[\"']?)"
    r"(?P<key>(?:access[_-]?key|api[_-]?key|authorization|connection[_-]?string|"
    r"client[_-]?secret|credential|credit[_-]?card|password|passwd|private[_-]?key|pwd|"
    r"refresh[_-]?token|secret|social[_-]?security|ssn|token|uri))"
    r"(?P=quote)(?P<separator>\s*[:=]\s*)"
    r"(?P<value>[\"'](?:\\.|[^\"'])*[\"']|[^,\s;}]+)"
)
_SENSITIVE_FIELD_PATTERN = re.compile(
    r"(?i)(?:^|_)(?:access[_-]?key|api[_-]?key|authorization|connection[_-]?string|credential|credit[_-]?card|password|passwd|private[_-]?key|pwd|refresh[_-]?token|secret|social[_-]?security|ssn|token|uri)(?:$|_)"
)


class MongoQueryPolicyError(ValueError):
    """Raised when a structured MongoDB query violates the read-only policy."""


@dataclass
class _MongoFieldState:
    """Track fields available after each aggregation stage."""

    fields: set[str]

    @classmethod
    def from_fields(cls, fields: Collection[str]) -> "_MongoFieldState":
        return cls({str(field) for field in fields if str(field)})

    def with_fields(self, fields: Collection[str]) -> "_MongoFieldState":
        return _MongoFieldState.from_fields(fields)


@dataclass(frozen=True)
class MongoQuerySpec:
    """Immutable semantic representation of one read-only MongoDB operation."""

    operation: str
    collection: str
    database: str | None = None
    filter: dict[str, Any] = dataclass_field(default_factory=dict)
    projection: dict[str, Any] | None = None
    pipeline: list[dict[str, Any]] = dataclass_field(default_factory=list)
    field: str | None = None
    options: dict[str, Any] = dataclass_field(default_factory=dict)
    output_projection: dict[str, int] | None = None
    distinct_is_array: bool = False

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> "MongoQuerySpec":
        """Parse a model payload without accepting executable MQL text."""
        if not isinstance(payload, Mapping):
            raise ValueError("MongoDB query spec must be a JSON object.")

        operation = payload.get("operation")
        if operation not in SUPPORTED_OPERATIONS:
            raise ValueError("Unsupported MongoDB operation.")

        collection = payload.get("collection")
        if not isinstance(collection, str) or not collection.strip():
            raise ValueError("MongoDB query spec requires a collection.")

        database = payload.get("database")
        if database is not None and (not isinstance(database, str) or not database.strip()):
            raise ValueError("MongoDB database must be a non-empty string when provided.")

        query_filter = payload.get("filter", {})
        if not isinstance(query_filter, dict):
            raise ValueError("MongoDB filter must be an object.")

        projection = payload.get("projection")
        if projection is not None and not isinstance(projection, dict):
            raise ValueError("MongoDB projection must be an object.")

        pipeline = payload.get("pipeline", [])
        if not isinstance(pipeline, list) or any(not isinstance(stage, dict) for stage in pipeline):
            raise ValueError("MongoDB pipeline must be an array of objects.")

        field_name = payload.get("field")
        if field_name is not None and (not isinstance(field_name, str) or not field_name.strip()):
            raise ValueError("MongoDB distinct field must be a non-empty string.")

        options = payload.get("options", {})
        if not isinstance(options, dict):
            raise ValueError("MongoDB options must be an object.")

        if operation == "distinct" and not field_name:
            raise ValueError("MongoDB distinct requires a field.")

        return cls(
            operation=operation,
            collection=collection.strip(),
            database=database.strip() if database else None,
            filter=_copy_json(query_filter),
            projection=_copy_json(projection) if projection is not None else None,
            pipeline=_copy_json(pipeline),
            field=field_name.strip() if field_name else None,
            options=_copy_json(options),
        )

    def with_options(self, options: Mapping[str, Any]) -> "MongoQuerySpec":
        """Return a copy with policy-normalized execution options."""
        return replace(self, options=_copy_json(dict(options)))

    def to_payload(self) -> dict[str, Any]:
        """Return a JSON-safe semantic payload for API responses and repair."""
        payload: dict[str, Any] = {
            "operation": self.operation,
            "collection": self.collection,
            "filter": _copy_json(self.filter),
            "options": _copy_json(self.options),
        }
        if self.database:
            payload["database"] = self.database
        if self.projection is not None:
            payload["projection"] = _copy_json(self.projection)
        if self.pipeline:
            payload["pipeline"] = _copy_json(self.pipeline)
        if self.field:
            payload["field"] = self.field
        return payload


def normalize_mongo_field_path(field_path: str) -> str:
    """Normalize metadata-only array markers to executable Mongo dot paths."""
    return field_path.replace("[]", "")


def is_sensitive_mongo_field(field_path: str) -> bool:
    """Return whether any field segment has credential or PII semantics."""
    return any(_is_sensitive_field_segment(segment) for segment in field_path.split("."))


def _is_sensitive_field_segment(segment: str) -> bool:
    normalized = re.sub(r"(?<=[a-z])(?=[A-Z])", "_", segment).replace("-", "_")
    return normalized.lower() in SENSITIVE_KEYS or bool(_SENSITIVE_FIELD_PATTERN.search(normalized))


def build_mongodb_field_allowlist(
    collection_metadata: Mapping[str, Collection[Mapping[str, Any]]],
) -> dict[str, tuple[str, ...]]:
    """Build executable field paths from authoritative collection metadata."""
    allowlist: dict[str, tuple[str, ...]] = {}
    for collection, fields in collection_metadata.items():
        raw_paths = set()
        for field in fields:
            raw_name = field.get("name") if isinstance(field, Mapping) else None
            if not isinstance(raw_name, str) or not raw_name.strip():
                continue
            path = normalize_mongo_field_path(raw_name.strip())
            if path and "[]" not in path:
                raw_paths.add(path)
        array_parents = {
            normalize_mongo_field_path(field["name"].strip())
            for field in fields
            if isinstance(field, Mapping)
            and field.get("isArray") is True
            and isinstance(field.get("name"), str)
            and field["name"].strip()
        }
        paths = {
            path
            for path in raw_paths
            if not is_sensitive_mongo_field(path)
            and (
                not any(
                    other != path and other.startswith(f"{path}.")
                    for other in raw_paths
                )
                or path in array_parents
                and not any(
                    is_sensitive_mongo_field(other)
                    for other in raw_paths
                    if other != path and other.startswith(f"{path}.")
                )
            )
        }
        paths.add("_id")
        allowlist[str(collection)] = tuple(sorted(paths))
    return allowlist


def build_mongodb_array_field_allowlist(
    collection_metadata: Mapping[str, Collection[Mapping[str, Any]]],
) -> dict[str, tuple[str, ...]]:
    """Build array-capable field paths from authoritative collection metadata."""
    allowlist: dict[str, tuple[str, ...]] = {}
    for collection, fields in collection_metadata.items():
        paths = set()
        for field in fields:
            if not isinstance(field, Mapping) or field.get("isArray") is not True:
                continue
            raw_name = field.get("name")
            if not isinstance(raw_name, str) or not raw_name.strip():
                continue
            path = normalize_mongo_field_path(raw_name.strip())
            if path and "[]" not in path and not is_sensitive_mongo_field(path):
                paths.add(path)
        allowlist[str(collection)] = tuple(sorted(paths))
    return allowlist


def build_mongodb_authorized_projection(
    field_allowlist: Mapping[str, Collection[str]],
    collection: str,
) -> dict[str, int]:
    """Build a collision-free inclusion projection from authoritative fields."""
    fields = {
        normalize_mongo_field_path(str(path))
        for path in field_allowlist.get(collection, ())
        if isinstance(path, str) and path
    }
    return _build_leaf_projection(fields)


def _build_leaf_projection(fields: Collection[str]) -> dict[str, int]:
    normalized_fields = {str(field) for field in fields if str(field)}
    leaf_fields = {
        path
        for path in normalized_fields
        if not any(other != path and other.startswith(f"{path}.") for other in normalized_fields)
    }
    return {path: 1 for path in sorted(leaf_fields)}


def filter_mongodb_result_documents(
    documents: list[dict[str, Any]],
    projection: Mapping[str, int] | None,
) -> list[dict[str, Any]]:
    """Filter serialized result documents to an inclusion projection."""
    if projection is None:
        return documents
    paths = tuple(path for path, value in projection.items() if value == 1)
    return [_project_document(document, paths) for document in documents]


def _project_document(document: Mapping[str, Any], paths: Collection[str]) -> dict[str, Any]:
    projected: dict[str, Any] = {}
    for path in paths:
        _copy_projected_path(document, projected, path.split("."))
    return projected


def _copy_projected_path(source: Any, target: dict[str, Any], segments: list[str]) -> None:
    if not segments or not isinstance(source, Mapping):
        return
    key = segments[0]
    if key not in source:
        return
    value = source[key]
    if len(segments) == 1:
        target[key] = value
        return
    if isinstance(value, list):
        nested_items = []
        for item in value:
            if not isinstance(item, Mapping):
                continue
            nested_target: dict[str, Any] = {}
            _copy_projected_path(item, nested_target, segments[1:])
            if nested_target:
                nested_items.append(nested_target)
        if nested_items:
            target[key] = nested_items
        return
    if isinstance(value, Mapping):
        nested_target = target.setdefault(key, {})
        _copy_projected_path(value, nested_target, segments[1:])
        if not nested_target:
            target.pop(key, None)


def _is_path_excluded(path: str, exclusions: Collection[str]) -> bool:
    return any(path == excluded or path.startswith(f"{excluded}.") for excluded in exclusions)


def _build_aggregate_output_projection(
    pipeline: list[dict[str, Any]],
    collection: str,
    field_state: _MongoFieldState,
) -> dict[str, int]:
    """Derive safe output fields from tracked aggregate state."""
    del pipeline, collection
    return _build_leaf_projection(field_state.fields)


class MongoQueryPolicy:
    """Enforces read-only MongoDB operations and bounded resource usage."""

    def __init__(
        self,
        known_collections: Collection[str] | None = None,
        trusted_database: str | None = None,
        field_allowlist: Mapping[str, Collection[str]] | None = None,
        array_field_allowlist: Mapping[str, Collection[str]] | None = None,
    ):
        self._known_collections = set(known_collections) if known_collections is not None else None
        self._trusted_database = trusted_database
        self._field_allowlist = (
            {
                str(collection): frozenset(str(path) for path in paths)
                for collection, paths in field_allowlist.items()
            }
            if field_allowlist is not None
            else None
        )
        self._array_field_allowlist = (
            {
                str(collection): frozenset(
                    normalize_mongo_field_path(str(path)) for path in paths
                )
                for collection, paths in array_field_allowlist.items()
            }
            if array_field_allowlist is not None
            else None
        )

    def validate(self, spec: MongoQuerySpec) -> MongoQuerySpec:
        """Validate and normalize one query before a PyMongo call."""
        if not isinstance(spec, MongoQuerySpec):
            raise MongoQueryPolicyError("MongoDB query must use MongoQuerySpec.")
        if spec.operation not in SUPPORTED_OPERATIONS:
            raise MongoQueryPolicyError("Unsupported MongoDB operation.")
        collection = _validate_identifier(spec.collection, "collection")
        if collection.lower().startswith("system."):
            raise MongoQueryPolicyError("system collections are not allowed")
        if self._known_collections is not None and collection not in self._known_collections:
            raise MongoQueryPolicyError("unknown collection")
        if len(spec.pipeline) > MAX_PIPELINE_STAGES:
            raise MongoQueryPolicyError(f"pipeline exceeds {MAX_PIPELINE_STAGES} stages")

        pipeline_state = None
        if spec.operation == "aggregate":
            if spec.filter:
                raise MongoQueryPolicyError("filter is only supported for non-aggregate operations")
            pipeline_state = self._validate_pipeline(spec.pipeline, collection)
        elif spec.pipeline:
            raise MongoQueryPolicyError("pipeline is only supported for aggregate")

        self._validate_filter(spec.filter, collection)
        projection = spec.projection
        if projection is not None:
            if spec.operation not in {"find", "findOne"}:
                raise MongoQueryPolicyError("projection is only supported for find and findOne")
            self._validate_projection(spec.projection, collection)
        elif self._field_allowlist is not None and spec.operation in {"find", "findOne"}:
            projection = build_mongodb_authorized_projection(self._field_allowlist, collection)
            self._validate_projection(projection, collection)
        if spec.field is not None:
            if spec.operation != "distinct":
                raise MongoQueryPolicyError("field is only supported for distinct")
            self._validate_field_reference(spec.field, collection, "distinct field")
            distinct_is_array = spec.distinct_is_array or self._is_array_field(collection, spec.field)
        else:
            distinct_is_array = False
        self._validate_options(spec.options, collection, spec.operation)

        database = spec.database
        if self._trusted_database is not None:
            trusted_database = _validate_identifier(self._trusted_database, "database")
            if database is not None and database != trusted_database:
                raise MongoQueryPolicyError("query database does not match trusted database")
            database = trusted_database
        elif database is not None:
            database = _validate_identifier(database, "database")

        unknown_options = set(spec.options) - ALLOWED_OPTIONS
        if unknown_options:
            raise MongoQueryPolicyError(f"unsupported option: {sorted(unknown_options)[0]}")

        limit = _bounded_integer(spec.options.get("limit", DEFAULT_LIMIT), "limit", MAX_LIMIT)
        max_time_ms = _bounded_integer(
            spec.options.get("maxTimeMS", DEFAULT_MAX_TIME_MS),
            "maxTimeMS",
            MAX_MAX_TIME_MS,
        )
        output_projection = None
        pipeline = spec.pipeline
        if self._field_allowlist is not None:
            if spec.operation in {"find", "findOne"}:
                output_projection = self._build_find_output_projection(projection or {}, collection)
                projection = output_projection
            elif spec.operation == "aggregate":
                output_projection = _build_aggregate_output_projection(
                    spec.pipeline,
                    collection,
                    pipeline_state or _MongoFieldState.from_fields(()),
                )
                if len(spec.pipeline) >= MAX_PIPELINE_STAGES:
                    raise MongoQueryPolicyError(
                        f"pipeline exceeds {MAX_PIPELINE_STAGES - 1} stages before authorization projection"
                    )
                pipeline = [*spec.pipeline, {"$project": output_projection}]

        return replace(
            spec,
            collection=collection,
            database=database,
            projection=projection,
            pipeline=pipeline,
            options={
                "limit": limit,
                "maxTimeMS": max_time_ms,
                **({"sort": _copy_json(spec.options["sort"])} if "sort" in spec.options else {}),
            },
            output_projection=output_projection,
            distinct_is_array=distinct_is_array,
        )

    def _is_array_field(self, collection: str, field: str) -> bool:
        if self._array_field_allowlist is None:
            return False
        return normalize_mongo_field_path(field) in self._array_field_allowlist.get(
            collection,
            frozenset(),
        )

    def _build_find_output_projection(
        self,
        projection: dict[str, Any],
        collection: str,
    ) -> dict[str, int]:
        """Convert a validated find projection into a final inclusion filter."""
        if not projection:
            return build_mongodb_authorized_projection(self._field_allowlist or {}, collection)
        if any(value == 1 for value in projection.values()):
            output = {str(key): 1 for key, value in projection.items() if value == 1}
            if projection.get("_id", 1) != 0:
                output.setdefault("_id", 1)
            return {key: output[key] for key in sorted(output)}
        exclusions = {str(key) for key in projection}
        base = build_mongodb_authorized_projection(self._field_allowlist or {}, collection)
        return {
            key: value for key, value in base.items() if not _is_path_excluded(key, exclusions)
        }

    def _validate_options(self, options: dict[str, Any], collection: str, operation: str) -> None:
        unknown_options = set(options) - ALLOWED_OPTIONS
        if unknown_options:
            raise MongoQueryPolicyError(f"unsupported option: {sorted(unknown_options)[0]}")
        for key, value in options.items():
            if key == "sort":
                if operation not in {"find", "findOne"}:
                    raise MongoQueryPolicyError("sort option is only supported for find and findOne")
                if not isinstance(value, dict):
                    raise MongoQueryPolicyError("sort option must be an object")
                for field_name, direction in value.items():
                    self._validate_field_reference(field_name, collection, "sort field")
                    if isinstance(direction, bool) or direction not in {-1, 1}:
                        raise MongoQueryPolicyError("sort directions must be 1 or -1")
            else:
                self._validate_value(value)

    def _validate_filter(
        self,
        value: Any,
        collection: str,
        depth: int = 0,
        path_prefix: str = "",
    ) -> None:
        if not isinstance(value, dict):
            raise MongoQueryPolicyError("MongoDB filter must be an object.")
        if depth > MAX_NESTING_DEPTH:
            raise MongoQueryPolicyError(f"query exceeds nesting depth {MAX_NESTING_DEPTH}")
        for key, nested in value.items():
            if key.startswith("$"):
                self._validate_key(key)
                if key not in ALLOWED_FILTER_OPERATORS:
                    raise MongoQueryPolicyError(f"unsupported MongoDB operator: {key}")
                if key in {"$and", "$nor", "$or"}:
                    if not isinstance(nested, list):
                        raise MongoQueryPolicyError(f"{key} must be an array")
                    for item in nested:
                        self._validate_filter(item, collection, depth + 1, path_prefix)
                elif key in {"$elemMatch", "$not"}:
                    if not isinstance(nested, dict):
                        raise MongoQueryPolicyError(f"{key} must be an object")
                    if key == "$elemMatch":
                        self._validate_filter(nested, collection, depth + 1, path_prefix)
                    else:
                        self._validate_filter_operator_value(
                            key,
                            nested,
                            collection,
                            depth + 1,
                            path_prefix,
                        )
                elif key == "$all":
                    self._validate_filter_operator_value(
                        key,
                        nested,
                        collection,
                        depth + 1,
                        path_prefix,
                    )
                else:
                    self._validate_document(nested, ALLOWED_FILTER_OPERATORS, depth + 1)
                continue

            field_path = f"{path_prefix}.{key}" if path_prefix else key
            self._validate_field_reference(field_path, collection, "filter field")
            if isinstance(nested, dict):
                self._validate_filter_value(nested, collection, depth + 1, field_path)
            else:
                self._validate_document(nested, ALLOWED_FILTER_OPERATORS, depth + 1)

    def _validate_filter_value(
        self,
        value: dict[str, Any],
        collection: str,
        depth: int,
        path_prefix: str,
    ) -> None:
        if depth > MAX_NESTING_DEPTH:
            raise MongoQueryPolicyError(f"query exceeds nesting depth {MAX_NESTING_DEPTH}")
        for key, nested in value.items():
            if key.startswith("$"):
                self._validate_key(key)
                if key not in ALLOWED_FILTER_OPERATORS:
                    raise MongoQueryPolicyError(f"unsupported MongoDB operator: {key}")
                if key == "$elemMatch":
                    if not isinstance(nested, dict):
                        raise MongoQueryPolicyError("$elemMatch must be an object")
                    self._validate_filter(nested, collection, depth + 1, path_prefix)
                elif key == "$not":
                    if not isinstance(nested, dict):
                        raise MongoQueryPolicyError("$not must be an object")
                    self._validate_filter_operator_value(
                        key,
                        nested,
                        collection,
                        depth + 1,
                        path_prefix,
                    )
                elif key == "$all":
                    self._validate_filter_operator_value(
                        key,
                        nested,
                        collection,
                        depth + 1,
                        path_prefix,
                    )
                else:
                    self._validate_document(nested, ALLOWED_FILTER_OPERATORS, depth + 1)
            else:
                field_path = f"{path_prefix}.{key}" if path_prefix else key
                self._validate_field_reference(field_path, collection, "filter field")
                if isinstance(nested, dict):
                    self._validate_filter_value(nested, collection, depth + 1, field_path)
                else:
                    self._validate_document(nested, ALLOWED_FILTER_OPERATORS, depth + 1)

    def _validate_filter_operator_value(
        self,
        operator: str,
        value: Any,
        collection: str,
        depth: int,
        path_prefix: str,
    ) -> None:
        """Validate field-bearing filter operators without treating them as values."""
        if operator == "$all":
            if not isinstance(value, list):
                raise MongoQueryPolicyError("$all must be an array")
            for item in value:
                if isinstance(item, dict) and "$elemMatch" in item:
                    if set(item) != {"$elemMatch"} or not isinstance(item["$elemMatch"], dict):
                        raise MongoQueryPolicyError("$all $elemMatch must be an object")
                    self._validate_filter(item["$elemMatch"], collection, depth + 1, path_prefix)
                else:
                    self._validate_document(item, ALLOWED_FILTER_OPERATORS, depth + 1)
            return
        if operator == "$not" and isinstance(value, dict) and "$elemMatch" in value:
            if set(value) != {"$elemMatch"} or not isinstance(value["$elemMatch"], dict):
                raise MongoQueryPolicyError("$not $elemMatch must be an object")
            self._validate_filter(value["$elemMatch"], collection, depth + 1, path_prefix)
            return
        self._validate_document(value, ALLOWED_FILTER_OPERATORS, depth + 1)

    def _validate_projection(self, value: dict[str, Any], collection: str, depth: int = 0) -> None:
        if depth > MAX_NESTING_DEPTH:
            raise MongoQueryPolicyError(f"query exceeds nesting depth {MAX_NESTING_DEPTH}")
        for key, nested in value.items():
            self._validate_projection_field(key, nested, collection)
            if isinstance(nested, bool) or not isinstance(nested, int) or nested not in {0, 1}:
                raise MongoQueryPolicyError("projection values must be 0 or 1")

    def _validate_projection_field(self, value: Any, projection: Any, collection: str) -> None:
        field_path = self._validate_field_reference(value, collection, "projection field")
        if projection != 1 or field_path == "_id" or self._field_allowlist is None:
            return
        allowed_fields = self._field_allowlist.get(collection, frozenset())
        if any(field.startswith(f"{field_path}.") for field in allowed_fields):
            raise MongoQueryPolicyError(
                f"parent projection requires an authoritative leaf projection: {field_path}"
            )

    def _validate_pipeline(
        self,
        pipeline: list[dict[str, Any]],
        collection: str,
        depth: int = 0,
    ) -> _MongoFieldState | None:
        field_state = (
            _MongoFieldState.from_fields(self._field_allowlist.get(collection, ()))
            if self._field_allowlist is not None
            else None
        )
        for stage in pipeline:
            if len(stage) != 1:
                raise MongoQueryPolicyError("each aggregate stage must contain one operator")
            stage_name, stage_value = next(iter(stage.items()))
            self._validate_key(stage_name)
            if stage_name in CROSS_COLLECTION_STAGES:
                raise MongoQueryPolicyError("cross-collection aggregation stages are not allowed")
            if stage_name not in ALLOWED_PIPELINE_STAGES:
                raise MongoQueryPolicyError(f"unsupported MongoDB aggregation stage: {stage_name}")

            stage_policy = self._pipeline_stage_policy(collection, field_state)
            if stage_name == "$match":
                stage_policy._validate_filter(stage_value, collection, depth + 1)
            elif stage_name == "$project":
                stage_policy._validate_projection_expression(stage_value, collection, depth + 1)
                if field_state is not None:
                    field_state = self._state_after_project(stage_value, field_state)
            elif stage_name in {"$addFields", "$set"}:
                if not isinstance(stage_value, dict):
                    raise MongoQueryPolicyError(f"{stage_name} stage must be an object")
                stage_policy._validate_expression_document(stage_value, collection, depth + 1)
                if field_state is not None:
                    field_state = field_state.with_fields(
                        {
                            *field_state.fields,
                            *self._derived_stage_fields(stage_value, field_state),
                        }
                    )
            elif stage_name == "$group":
                if not isinstance(stage_value, dict):
                    raise MongoQueryPolicyError("$group stage must be an object")
                stage_policy._validate_expression_document(stage_value, collection, depth + 1)
                if field_state is not None:
                    field_state = field_state.with_fields(
                        self._derived_stage_fields(stage_value, field_state)
                    )
            elif stage_name == "$replaceRoot":
                if not isinstance(stage_value, dict) or set(stage_value) != {"newRoot"}:
                    raise MongoQueryPolicyError("$replaceRoot stage requires a newRoot expression")
                stage_policy._validate_expression(stage_value["newRoot"], collection, depth + 1)
                if field_state is not None:
                    field_state = self._state_after_replace(stage_value["newRoot"], field_state)
            elif stage_name == "$replaceWith":
                stage_policy._validate_expression(stage_value, collection, depth + 1)
                if field_state is not None:
                    field_state = self._state_after_replace(stage_value, field_state)
            elif stage_name == "$unset":
                stage_policy._validate_unset(stage_value, collection, depth + 1)
                if field_state is not None:
                    fields = stage_value if isinstance(stage_value, list) else [stage_value]
                    field_state = field_state.with_fields(
                        field
                        for field in field_state.fields
                        if not _is_path_excluded(field, fields)
                    )
            elif stage_name == "$sort":
                if not isinstance(stage_value, dict):
                    raise MongoQueryPolicyError("$sort stage must be an object")
                for key, direction in stage_value.items():
                    stage_policy._validate_field_reference(key, collection, "sort field")
                    if isinstance(direction, bool) or direction not in {-1, 1}:
                        raise MongoQueryPolicyError("$sort directions must be 1 or -1")
            elif stage_name == "$unwind":
                if not isinstance(stage_value, (str, dict)):
                    raise MongoQueryPolicyError("$unwind stage must be a string or object")
                stage_policy._validate_unwind(stage_value, collection, depth + 1)
                if field_state is not None and isinstance(stage_value, dict):
                    index_field = stage_value.get("includeArrayIndex")
                    if isinstance(index_field, str) and index_field:
                        field_state = field_state.with_fields(
                            {*field_state.fields, index_field}
                        )
            elif stage_name == "$count":
                stage_policy._validate_output_identifier(stage_value, "$count field")
                if field_state is not None:
                    field_state = field_state.with_fields({str(stage_value)})
            elif stage_name in {"$limit", "$skip"}:
                maximum = MAX_LIMIT if stage_name == "$limit" else MAX_SKIP
                _bounded_integer(stage_value, stage_name, maximum, allow_zero=stage_name == "$skip")
        return field_state

    def _pipeline_stage_policy(
        self,
        collection: str,
        field_state: _MongoFieldState | None,
    ) -> "MongoQueryPolicy":
        if field_state is None:
            return self
        return MongoQueryPolicy(
            known_collections=self._known_collections,
            trusted_database=self._trusted_database,
            field_allowlist={collection: tuple(sorted(field_state.fields))},
        )

    @staticmethod
    def _state_after_project(
        value: Any,
        field_state: _MongoFieldState,
    ) -> _MongoFieldState:
        if not isinstance(value, dict):
            return field_state
        included = {
            str(key)
            for key, nested in value.items()
            if nested != 0 and (isinstance(nested, bool) or isinstance(nested, int))
        }
        included.update(
            MongoQueryPolicy._derived_stage_fields(value, field_state, include_numeric=False)
        )
        if included:
            if value.get("_id", 1) != 0:
                included.add("_id")
            return field_state.with_fields(included)
        exclusions = {str(key) for key in value}
        return field_state.with_fields(
            field for field in field_state.fields if not _is_path_excluded(field, exclusions)
        )

    @staticmethod
    def _state_after_replace(
        expression: Any,
        field_state: _MongoFieldState,
    ) -> _MongoFieldState:
        fields = MongoQueryPolicy._derive_expression_fields("", expression, field_state)
        return _MongoFieldState.from_fields({"_id", *fields})

    @staticmethod
    def _derived_stage_fields(
        value: Mapping[str, Any],
        field_state: _MongoFieldState,
        include_numeric: bool = True,
    ) -> set[str]:
        fields = set()
        for key, nested in value.items():
            if not include_numeric and (
                isinstance(nested, bool) or (isinstance(nested, int) and nested in {0, 1})
            ):
                continue
            fields.update(MongoQueryPolicy._derive_expression_fields(str(key), nested, field_state))
        return fields

    @staticmethod
    def _derive_expression_fields(
        output_path: str,
        expression: Any,
        field_state: _MongoFieldState,
    ) -> set[str]:
        if isinstance(expression, str) and expression.startswith("$") and not expression.startswith("$$"):
            source = expression[1:]
            descendants = {
                field[len(source) + 1:]
                for field in field_state.fields
                if field.startswith(f"{source}.")
            }
            if descendants:
                return {
                    f"{output_path}.{field}" if output_path else field
                    for field in descendants
                }
            return {output_path or source} if source in field_state.fields else {output_path}

        if isinstance(expression, dict):
            literal = expression.get("$literal")
            if isinstance(literal, Mapping) and set(expression) == {"$literal"}:
                return MongoQueryPolicy._literal_leaf_fields(literal, output_path)
            if any(str(key).startswith("$") for key in expression):
                referenced_fields = set()
                for nested in expression.values():
                    referenced_fields.update(
                        MongoQueryPolicy._derive_expression_fields(
                            output_path,
                            nested,
                            field_state,
                        )
                    )
                return referenced_fields or ({output_path} if output_path else {"_id"})
            nested_fields = set()
            for key, nested in expression.items():
                nested_fields.update(
                    MongoQueryPolicy._derive_expression_fields(
                        f"{output_path}.{key}" if output_path else str(key),
                        nested,
                        field_state,
                    )
                )
            return nested_fields or ({output_path} if output_path else {"_id"})

        if isinstance(expression, list):
            nested_fields = set()
            for nested in expression:
                nested_fields.update(
                    MongoQueryPolicy._derive_expression_fields(
                        output_path,
                        nested,
                        field_state,
                    )
                )
            return nested_fields or ({output_path} if output_path else {"_id"})

        return {output_path} if output_path else {"_id"}

    @staticmethod
    def _literal_leaf_fields(value: Mapping[str, Any], output_path: str) -> set[str]:
        fields = set()
        for key, nested in value.items():
            path = f"{output_path}.{key}" if output_path else str(key)
            if isinstance(nested, Mapping):
                fields.update(MongoQueryPolicy._literal_leaf_fields(nested, path))
            else:
                fields.add(path)
        return fields

    def _validate_projection_expression(self, value: Any, collection: str, depth: int) -> None:
        if not isinstance(value, dict):
            raise MongoQueryPolicyError("$project stage must be an object")
        for key, nested in value.items():
            if isinstance(nested, bool) or (isinstance(nested, int) and nested in {0, 1}):
                self._validate_projection_field(key, nested, collection)
                continue
            self._validate_output_identifier(key, "$project field")
            self._validate_expression(nested, collection, depth + 1)

    def _validate_expression_document(self, value: dict[str, Any], collection: str, depth: int) -> None:
        for key, nested in value.items():
            self._validate_output_identifier(key, "aggregation output field")
            self._validate_expression(nested, collection, depth + 1)

    def _validate_expression(self, value: Any, collection: str, depth: int) -> None:
        if depth > MAX_NESTING_DEPTH:
            raise MongoQueryPolicyError(f"query exceeds nesting depth {MAX_NESTING_DEPTH}")
        if isinstance(value, dict):
            for key, nested in value.items():
                if not key.startswith("$"):
                    self._validate_output_identifier(key, "aggregation output field")
                self._validate_key(key)
                if key.startswith("$"):
                    if key not in ALLOWED_EXPRESSION_OPERATORS:
                        raise MongoQueryPolicyError(f"unsupported MongoDB aggregation expression: {key}")
                    if key == "$literal":
                        self._validate_value(nested, depth + 1)
                    else:
                        self._validate_expression(nested, collection, depth + 1)
                else:
                    self._validate_expression(nested, collection, depth + 1)
        elif isinstance(value, list):
            for nested in value:
                self._validate_expression(nested, collection, depth + 1)
        elif isinstance(value, str):
            if value.startswith("$$"):
                raise MongoQueryPolicyError("unsupported MongoDB aggregation variable")
            if value.startswith("$"):
                self._validate_field_reference(
                    value[1:],
                    collection,
                    "aggregation field",
                    allow_authoritative_parent=True,
                )
            elif _looks_sensitive(value):
                raise MongoQueryPolicyError("query contains URI or credential-like value")

    def _validate_unset(self, value: Any, collection: str, depth: int) -> None:
        fields = value if isinstance(value, list) else [value]
        if not all(isinstance(field, str) for field in fields):
            raise MongoQueryPolicyError("$unset fields must be strings")
        for field in fields:
            self._validate_field_reference(
                field,
                collection,
                "$unset field",
                allow_authoritative_parent=True,
            )

    def _validate_unwind(self, value: str | dict[str, Any], collection: str, depth: int) -> None:
        if isinstance(value, str):
            path = value
        else:
            allowed_keys = {"path", "includeArrayIndex", "preserveNullAndEmptyArrays"}
            unknown_keys = set(value) - allowed_keys
            if unknown_keys:
                raise MongoQueryPolicyError(f"unsupported $unwind option: {sorted(unknown_keys)[0]}")
            path = value.get("path")
            if "includeArrayIndex" in value:
                self._validate_output_identifier(value["includeArrayIndex"], "$unwind index field")
        if not isinstance(path, str) or not path.startswith("$"):
            raise MongoQueryPolicyError("$unwind path must be an aggregation field reference")
        self._validate_field_reference(
            path[1:],
            collection,
            "$unwind field",
            allow_authoritative_parent=True,
        )

    def _validate_document(
        self,
        value: Any,
        allowed_operators: frozenset[str],
        depth: int = 0,
    ) -> None:
        if depth > MAX_NESTING_DEPTH:
            raise MongoQueryPolicyError(f"query exceeds nesting depth {MAX_NESTING_DEPTH}")
        if isinstance(value, dict):
            for key, nested in value.items():
                self._validate_key(key)
                if key.startswith("$") and key not in allowed_operators:
                    raise MongoQueryPolicyError(f"unsupported MongoDB operator: {key}")
                if key == "$options" and not isinstance(nested, str):
                    raise MongoQueryPolicyError("$options must be a string")
                self._validate_document(nested, allowed_operators, depth + 1)
        elif isinstance(value, list):
            for nested in value:
                self._validate_document(nested, allowed_operators, depth + 1)
        elif isinstance(value, str) and _looks_sensitive(value):
            raise MongoQueryPolicyError("query contains URI or credential-like value")

    def _validate_value(self, value: Any, depth: int = 0) -> None:
        if depth > MAX_NESTING_DEPTH:
            raise MongoQueryPolicyError(f"query exceeds nesting depth {MAX_NESTING_DEPTH}")
        if isinstance(value, dict):
            for key, nested in value.items():
                self._validate_key(key)
                self._validate_value(nested, depth + 1)
        elif isinstance(value, list):
            for nested in value:
                self._validate_value(nested, depth + 1)
        elif isinstance(value, str) and _looks_sensitive(value):
            raise MongoQueryPolicyError("query contains URI or credential-like value")

    def _validate_field_reference(
        self,
        value: Any,
        collection: str,
        name: str,
        allow_authoritative_parent: bool = False,
    ) -> str:
        field_path = _validate_identifier(value, name)
        if field_path.lower() in PROTOTYPE_KEYS:
            raise MongoQueryPolicyError("prototype-like key is not allowed")
        if "[]" in field_path:
            raise MongoQueryPolicyError(f"{name} must use MongoDB dot notation, not array brackets")
        if is_sensitive_mongo_field(field_path):
            raise MongoQueryPolicyError(f"sensitive field is not allowed: {field_path}")
        if self._field_allowlist is not None:
            allowed_fields = self._field_allowlist.get(collection, frozenset())
            is_authoritative_parent = any(
                field.startswith(f"{field_path}.") for field in allowed_fields
            )
            if (
                field_path != "_id"
                and field_path not in allowed_fields
                and not (allow_authoritative_parent and is_authoritative_parent)
            ):
                raise MongoQueryPolicyError(f"unknown field: {field_path}")
        return field_path

    @staticmethod
    def _validate_output_identifier(value: Any, name: str) -> str:
        identifier = _validate_identifier(value, name)
        if "[]" in identifier:
            raise MongoQueryPolicyError(f"{name} must use MongoDB dot notation, not array brackets")
        if is_sensitive_mongo_field(identifier):
            raise MongoQueryPolicyError(f"sensitive field is not allowed: {identifier}")
        return identifier

    @staticmethod
    def _validate_key(key: Any) -> None:
        if not isinstance(key, str):
            raise MongoQueryPolicyError("MongoDB query keys must be strings")
        normalized = key.lower().replace("-", "_")
        if key.lower() in PROTOTYPE_KEYS:
            raise MongoQueryPolicyError("prototype-like key is not allowed")
        if normalized in SENSITIVE_KEYS or is_sensitive_mongo_field(key):
            raise MongoQueryPolicyError("credential-sensitive key is not allowed")


class MongoQueryRenderer:
    """Renders a validated query spec as canonical Mongo shell presentation text."""

    @staticmethod
    def render(spec: MongoQuerySpec) -> str:
        """Render a spec without parsing or executing JavaScript/MQL text."""
        database = _json_dumps(spec.database or "test")
        collection = json.dumps(spec.collection, ensure_ascii=False)
        operation = spec.operation
        query_filter = _json_dumps(spec.filter)
        limit = spec.options.get("limit", DEFAULT_LIMIT)
        prefix = f"db.getSiblingDB({database}).getCollection({collection})"
        max_time_ms = spec.options.get("maxTimeMS", DEFAULT_MAX_TIME_MS)
        custom_options = {}
        if max_time_ms != DEFAULT_MAX_TIME_MS:
            custom_options["maxTimeMS"] = max_time_ms

        if operation == "find":
            expression = f"{prefix}.find({query_filter}"
            if spec.projection is not None:
                expression += f",{_json_dumps(spec.projection)}"
            expression += ")"
            if spec.options.get("sort"):
                expression += f".sort({_json_dumps(spec.options['sort'])})"
            expression += f".limit({limit})"
            if custom_options:
                expression += f".maxTimeMS({max_time_ms})"
            return expression
        if operation == "findOne":
            expression = f"{prefix}.findOne({query_filter}"
            if spec.projection is not None:
                expression += f",{_json_dumps(spec.projection)}"
            elif spec.options.get("sort") or custom_options:
                expression += ",{}"
            if spec.options.get("sort"):
                custom_options["sort"] = spec.options["sort"]
            if custom_options:
                expression += f",{_json_dumps(custom_options)}"
            return expression + ")"
        if operation == "aggregate":
            expression = f"{prefix}.aggregate({_json_dumps(spec.pipeline)}"
            if custom_options:
                expression += f",{_json_dumps(custom_options)}"
            return f"{expression}).limit({limit})"
        if operation == "countDocuments":
            expression = f"{prefix}.countDocuments({query_filter}"
            if custom_options:
                expression += f",{_json_dumps(custom_options)}"
            return expression + ")"
        if operation == "distinct":
            expression = f"{prefix}.distinct({_json_dumps(spec.field)},{query_filter}"
            if custom_options:
                expression += f",{_json_dumps(custom_options)}"
            return expression + ")"
        raise MongoQueryPolicyError(f"Unsupported MongoDB operation: {operation}")


def _bounded_integer(value: Any, name: str, maximum: int, allow_zero: bool = False) -> int:
    minimum = 0 if allow_zero else 1
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum or value > maximum:
        raise MongoQueryPolicyError(f"{name} must be an integer between {minimum} and {maximum}")
    return value


def _validate_identifier(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise MongoQueryPolicyError(f"MongoDB {name} must be a non-empty identifier")
    identifier = value.strip()
    if len(identifier) > 255 or any(char.isspace() or ord(char) < 32 for char in identifier):
        raise MongoQueryPolicyError(f"MongoDB {name} contains unsupported characters")
    if identifier.startswith("$") or "://" in identifier or _looks_sensitive(identifier):
        raise MongoQueryPolicyError(f"MongoDB {name} contains URI or credential-like value")
    return identifier


def _looks_sensitive(value: str) -> bool:
    return bool(
        _CONNECTION_URI_PATTERN.search(value)
        or _USERINFO_PATTERN.search(value)
        or any(
            is_sensitive_mongo_field(match.group("key"))
            for match in _SECRET_ASSIGNMENT_PATTERN.finditer(value)
        )
    )


def redact_mongo_sensitive_text(value: Any) -> str:
    """Redact connection strings and credential-like assignments from text."""
    text = str(value or "")
    text = _CONNECTION_URI_PATTERN.sub("[redacted-uri]", text)
    text = _USERINFO_PATTERN.sub("[redacted-userinfo]", text)
    text = _SECRET_ASSIGNMENT_PATTERN.sub(_redact_secret_assignment, text)
    return re.sub(
        r"(?i)(?<![a-z0-9])((?:refresh|client)[_-]?(?:token|secret))(?=\s*[:=])",
        lambda match: match.group(1),
        text,
    )



def sanitize_mongodb_retrieval_trace(trace: Any, query_text: Any = "") -> dict[str, Any]:
    """Keep retrieval diagnostics while hashing user intent instead of storing it."""
    raw_trace = trace if isinstance(trace, dict) else {}
    safe_trace = redact_mongo_sensitive_payload(raw_trace)
    if not isinstance(safe_trace, dict):
        return {}
    safe_trace.pop("intent", None)
    if query_text:
        safe_trace["intentHash"] = hashlib.sha256(
            str(query_text).encode("utf-8")
        ).hexdigest()
    return safe_trace


def _redact_secret_assignment(match: re.Match[str]) -> str:
    key = match.group("key")
    if not is_sensitive_mongo_field(key):
        return match.group(0)
    return f"{match.group('quote')}{key}{match.group('quote')}{match.group('separator')}[redacted]"


def redact_mongo_sensitive_payload(value: Any, key: str | None = None) -> Any:
    """Return a JSON-like payload safe for repair prompts and persistence."""
    if isinstance(value, dict):
        result = {}
        for raw_key, nested in value.items():
            safe_key = "[redacted-key]" if _is_sensitive_key(raw_key) else str(raw_key)
            result[safe_key] = "[redacted]" if _is_sensitive_key(raw_key) else redact_mongo_sensitive_payload(nested, raw_key)
        return result
    if isinstance(value, list):
        return [redact_mongo_sensitive_payload(item, key) for item in value]
    if isinstance(value, str) and _looks_sensitive(value):
        return "[redacted-credential]"
    return value


def _is_sensitive_key(key: Any) -> bool:
    if not isinstance(key, str):
        return False
    normalized = key.lower().replace("-", "_")
    return key.lower() in PROTOTYPE_KEYS or normalized in SENSITIVE_KEYS or is_sensitive_mongo_field(key)


def _copy_json(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _copy_json(nested) for key, nested in value.items()}
    if isinstance(value, list):
        return [_copy_json(nested) for nested in value]
    return value


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
