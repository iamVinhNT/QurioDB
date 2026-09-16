"""
mongo_executor.py

Specialized executor for MongoDB queries (MQL and SQL-like).
"""

from dataclasses import dataclass
import ast
import logging
import re
from typing import Any, Collection, Dict, List, Tuple

from bson import json_util
from models import SessionLocal
from services.ai.mongodb_query import (
    DEFAULT_LIMIT,
    DEFAULT_MAX_TIME_MS,
    MAX_LIMIT,
    MongoQueryPolicy,
    MongoQuerySpec,
    build_mongodb_array_field_allowlist,
    build_mongodb_field_allowlist,
    is_sensitive_mongo_field,
)
from services.metadata import metadata_service

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _LegacyMongoQuery:
    """Parsed legacy Mongo shell expression with optional bounded modifiers."""

    collection: str
    operation: str
    args: List[Any]
    database: str | None = None
    limit: int | None = None
    sort: Dict[str, int] | None = None
    max_time_ms: int | None = None


class MongoExecutor:
    """Handles structured MongoDB reads and compatibility shell expressions."""

    _READ_OPERATIONS = "findOne|find|aggregate|countDocuments|distinct"
    _READ_OPERATION_NAMES = frozenset(
        {"findone", "find", "aggregate", "countdocuments", "distinct"}
    )
    _ALL_OPERATIONS = (
        "findOne|find|aggregate|countDocuments|distinct|insertOne|insertMany|"
        "updateOne|updateMany|deleteOne|deleteMany|replaceOne|createView"
    )

    def __init__(self, service):
        self.service = service

    def validate_read_only(self, sql: str) -> None:
        """Validate legacy Mongo syntax without opening a client connection."""
        self._parse_query(sql)

    def execute(self, db_id: str, sql: str, limit: int) -> Tuple[List[Dict[str, Any]], List[str]]:
        """Parse and execute a legacy Mongo shell expression through metadata policy."""
        session = SessionLocal()
        try:
            db_type, config = self.service.get_db_config(db_id, session)
            if db_type != "mongodb":
                raise ValueError(f"Expected mongodb type, got {db_type}")
            if isinstance(limit, bool) or not isinstance(limit, int) or limit <= 0:
                raise ValueError("MongoDB result limit must be a positive integer.")

            parsed_query = self._parse_query(sql)
            target_db, collection_name = self._resolve_target(
                parsed_query.collection,
                config,
                parsed_query.database,
            )
            spec = self._build_authoritative_spec(
                db_id,
                parsed_query,
                collection_name,
                target_db,
            )

            client, _ = self.service.get_mongo_client(db_id, session)
            if not client:
                raise ConnectionError("Failed to connect to MongoDB cluster")

            effective_limit = min(spec.options["limit"], limit)
            return self._run_structured_operation(
                client[target_db][collection_name],
                spec,
                effective_limit,
                spec.options["maxTimeMS"],
            )
        finally:
            session.close()

    def _build_authoritative_spec(
        self,
        db_id: str,
        parsed_query: _LegacyMongoQuery,
        collection_name: str,
        target_db: str,
    ) -> MongoQuerySpec:
        """Convert compatibility syntax into a metadata-bound semantic spec."""
        collection_metadata = metadata_service.get_all_columns(db_id, target_db)
        if not isinstance(collection_metadata, dict) or not collection_metadata:
            raise ValueError("MongoDB collection metadata is unavailable.")

        payload = self._legacy_query_payload(parsed_query, collection_name)
        return MongoQueryPolicy(
            known_collections=tuple(collection_metadata),
            trusted_database=target_db,
            field_allowlist=build_mongodb_field_allowlist(collection_metadata),
            array_field_allowlist=build_mongodb_array_field_allowlist(collection_metadata),
        ).validate(MongoQuerySpec.from_payload(payload))

    @staticmethod
    def _legacy_query_payload(
        parsed_query: _LegacyMongoQuery,
        collection_name: str,
    ) -> dict[str, Any]:
        """Map parsed legacy arguments onto the structured query contract."""
        operation = {
            "findone": "findOne",
            "countdocuments": "countDocuments",
        }.get(parsed_query.operation.lower(), parsed_query.operation.lower())
        args = parsed_query.args
        payload: dict[str, Any] = {
            "operation": operation,
            "collection": collection_name,
            "database": parsed_query.database,
            "options": {
                "limit": parsed_query.limit or DEFAULT_LIMIT,
                "maxTimeMS": DEFAULT_MAX_TIME_MS,
            },
        }
        if parsed_query.sort:
            payload["options"]["sort"] = parsed_query.sort
        max_time_ms = parsed_query.max_time_ms
        if max_time_ms is not None and (
            isinstance(max_time_ms, bool) or not 1 <= max_time_ms <= DEFAULT_MAX_TIME_MS
        ):
            raise ValueError("MongoDB maxTimeMS must be between 1 and 30000.")

        operation_options = None
        if operation == "find" and len(args) > 2 and isinstance(args[2], dict):
            operation_options = args[2]
        elif operation == "findOne" and len(args) > 2 and isinstance(args[2], dict):
            operation_options = args[2]
        elif operation == "aggregate" and len(args) > 1 and isinstance(args[1], dict):
            operation_options = args[1]
        elif operation == "countDocuments" and len(args) > 1 and isinstance(args[1], dict):
            operation_options = args[1]
        elif operation == "distinct" and len(args) > 2 and isinstance(args[2], dict):
            operation_options = args[2]
        if operation_options:
            if max_time_ms is None and isinstance(operation_options.get("maxTimeMS"), int):
                max_time_ms = operation_options["maxTimeMS"]
            if max_time_ms is not None and (
                isinstance(max_time_ms, bool) or not 1 <= max_time_ms <= DEFAULT_MAX_TIME_MS
            ):
                raise ValueError("MongoDB maxTimeMS must be between 1 and 30000.")
            if operation == "findOne" and isinstance(operation_options.get("sort"), dict):
                payload["options"]["sort"] = operation_options["sort"]

        if operation in {"find", "findOne", "countDocuments"}:
            payload["filter"] = args[0] if args else {}
            if operation in {"find", "findOne"} and len(args) > 1:
                payload["projection"] = args[1]
            if operation == "findOne" and len(args) > 2 and isinstance(args[2], dict):
                payload["options"].update(
                    {
                        key: value
                        for key, value in args[2].items()
                        if key == "sort"
                    }
                )
        elif operation == "aggregate":
            payload["pipeline"] = args[0] if args else []
        elif operation == "distinct":
            payload["field"] = args[0] if args else None
            payload["filter"] = args[1] if len(args) > 1 else {}
        if max_time_ms is not None:
            payload["options"]["maxTimeMS"] = max_time_ms
        return payload

    def execute_spec(
        self,
        db_id: str,
        spec: MongoQuerySpec,
        limit: int | None = None,
        trusted_database: str | None = None,
        allowed_databases: Collection[str] | None = None,
    ) -> Tuple[List[Dict[str, Any]], List[str]]:
        """Execute a validated semantic query directly through PyMongo."""
        session = SessionLocal()
        try:
            db_type, config = self.service.get_db_config(db_id, session)
            if db_type != "mongodb":
                raise ValueError(f"Expected mongodb type, got {db_type}")

            configured_database = config.get("database", "test")
            target_db = trusted_database or configured_database
            if allowed_databases is not None and target_db not in {
                str(database) for database in allowed_databases
            }:
                raise ValueError("MongoDB query database is not reported as accessible.")
            normalized = MongoQueryPolicy(trusted_database=str(target_db)).validate(spec)
            effective_limit = normalized.options["limit"]
            if limit is not None:
                if isinstance(limit, bool) or not isinstance(limit, int) or limit <= 0:
                    raise ValueError("MongoDB result limit must be a positive integer.")
                effective_limit = min(effective_limit, limit)

            client, _ = self.service.get_mongo_client(db_id, session)
            if not client:
                raise ConnectionError("Failed to connect to MongoDB cluster")

            collection = client[target_db][normalized.collection]
            max_time_ms = normalized.options["maxTimeMS"]
            return self._run_structured_operation(
                collection,
                normalized,
                effective_limit,
                max_time_ms,
            )
        finally:
            session.close()

    def _parse_query(self, sql: str) -> _LegacyMongoQuery:
        """Parse canonical read syntax and preserve older Mongo compatibility forms."""
        expression = sql.strip()
        canonical_match = re.match(
            rf'^db\.getSiblingDB\((?P<database>"(?:\\.|[^"])*"|\'(?:\\.|[^\'])*\')\)'
            rf'\.getCollection\((?P<collection>"(?:\\.|[^"])*"|\'(?:\\.|[^\'])*\')\)'
            rf'\.(?P<operation>{self._READ_OPERATIONS})\s*\(',
            expression,
            re.IGNORECASE,
        )
        if canonical_match:
            return self._parse_call(
                expression,
                canonical_match.end() - 1,
                self._parse_string_literal(canonical_match.group("collection")),
                canonical_match.group("operation"),
                self._parse_string_literal(canonical_match.group("database")),
            )

        collection_match = re.match(
            rf'^db\.getCollection\((?P<collection>"(?:\\.|[^"])*"|\'(?:\\.|[^\'])*\')\)'
            rf'\.(?P<operation>{self._ALL_OPERATIONS})\s*\(',
            expression,
            re.IGNORECASE,
        )
        if collection_match:
            return self._parse_call(
                expression,
                collection_match.end() - 1,
                self._parse_string_literal(collection_match.group("collection")),
                collection_match.group("operation"),
            )

        method_match = re.match(
            rf'^(?P<collection>db\.[\w.-]+|[\w.-]+)\.(?P<operation>{self._ALL_OPERATIONS})\s*\(',
            expression,
            re.IGNORECASE,
        )
        if method_match:
            return self._parse_call(
                expression,
                method_match.end() - 1,
                method_match.group("collection"),
                method_match.group("operation"),
            )

        sql_match = re.search(r'FROM\s+["\']?([\w.-]+)["\']?', expression, re.IGNORECASE)
        if sql_match:
            return _LegacyMongoQuery(collection=sql_match.group(1), operation="find", args=[{}])
        raise ValueError(
            "Unsupported format. Use 'db.getSiblingDB(\"database\").getCollection(\"collection\").find({...})'."
        )

    def _parse_call(
        self,
        expression: str,
        open_index: int,
        collection: str,
        operation: str,
        database: str | None = None,
    ) -> _LegacyMongoQuery:
        if operation.lower() not in self._READ_OPERATION_NAMES:
            raise ValueError("MongoDB generic execution is read-only.")
        args_text, close_index = self._extract_parenthesized(expression, open_index)
        try:
            args = json_util.loads(f"[{args_text}]") if args_text.strip() else []
        except Exception as exc:
            raise ValueError(f"MQL Parse Error: {exc}. Use valid JSON with double quotes.") from exc
        limit, sort, max_time_ms = self._parse_suffix(expression[close_index:])
        return _LegacyMongoQuery(
            collection=collection,
            operation=operation,
            args=args,
            database=database,
            limit=limit,
            sort=sort,
            max_time_ms=max_time_ms,
        )

    @staticmethod
    def _extract_parenthesized(expression: str, open_index: int) -> Tuple[str, int]:
        """Extract one balanced call argument while respecting JSON strings."""
        depth = 0
        quote: str | None = None
        escaped = False
        for index in range(open_index, len(expression)):
            character = expression[index]
            if quote:
                if escaped:
                    escaped = False
                elif character == "\\":
                    escaped = True
                elif character == quote:
                    quote = None
                continue
            if character in {'"', "'"}:
                quote = character
            elif character == "(":
                depth += 1
            elif character == ")":
                depth -= 1
                if depth == 0:
                    return expression[open_index + 1:index], index + 1
        raise ValueError("MQL Parse Error: unclosed call parentheses.")

    def _parse_suffix(
        self,
        suffix: str,
    ) -> Tuple[int | None, Dict[str, int] | None, int | None]:
        """Parse bounded canonical cursor modifiers without evaluating JavaScript."""
        remaining = suffix.strip()
        limit = None
        sort = None
        max_time_ms = None
        while remaining:
            modifier_match = re.match(r'^\.(?P<modifier>limit|sort|maxTimeMS)\s*\(', remaining, re.IGNORECASE)
            if not modifier_match:
                raise ValueError("Unsupported MongoDB cursor modifier.")
            args_text, close_index = self._extract_parenthesized(
                remaining,
                modifier_match.end() - 1,
            )
            try:
                parsed = json_util.loads(args_text)
            except Exception as exc:
                raise ValueError(f"Invalid MongoDB cursor modifier: {exc}") from exc
            modifier = modifier_match.group("modifier").lower()
            if modifier == "limit":
                if isinstance(parsed, bool) or not isinstance(parsed, int) or not 1 <= parsed <= 1000:
                    raise ValueError("MongoDB cursor limit must be between 1 and 1000.")
                limit = parsed
            elif modifier == "maxtimems":
                if isinstance(parsed, bool) or not isinstance(parsed, int) or not 1 <= parsed <= DEFAULT_MAX_TIME_MS:
                    raise ValueError("MongoDB cursor maxTimeMS must be between 1 and 30000.")
                max_time_ms = parsed
            else:
                if not isinstance(parsed, dict):
                    raise ValueError("MongoDB cursor sort must be an object.")
                sort = parsed
            remaining = remaining[close_index:].strip()
        return limit, sort, max_time_ms

    @staticmethod
    def _parse_string_literal(value: str) -> str:
        try:
            return json_util.loads(value)
        except Exception:
            try:
                parsed = ast.literal_eval(value)
            except (SyntaxError, ValueError) as exc:
                raise ValueError("MongoDB string literal is invalid.") from exc
            if not isinstance(parsed, str):
                raise ValueError("MongoDB string literal is invalid.")
            return parsed

    def _resolve_target(
        self,
        coll_name: str,
        config: Dict[str, Any],
        explicit_database: str | None = None,
    ) -> Tuple[str, str]:
        """Resolve collection and enforce configured database binding."""
        default_db = str(config.get("database", "test"))
        target_db = explicit_database or default_db
        if coll_name == "db":
            collection_name = coll_name
        elif coll_name.startswith("db."):
            collection_name = coll_name[3:]
        else:
            parts = coll_name.split(".")
            collection_name = coll_name
            if explicit_database is None and len(parts) > 1:
                target_db = parts[0]
                collection_name = ".".join(parts[1:])
        if target_db != default_db:
            raise ValueError("MongoDB query database does not match configured trusted database.")
        return target_db, collection_name

    @staticmethod
    def _get_method_name(query_type: str) -> str:
        """Translate Mongo shell method names to PyMongo method names."""
        method_map = {
            "find": "find",
            "findone": "find_one",
            "aggregate": "aggregate",
            "countdocuments": "count_documents",
            "distinct": "distinct",
            "insertone": "insert_one",
            "insertmany": "insert_many",
            "updateone": "update_one",
            "updatemany": "update_many",
            "deleteone": "delete_one",
            "deletemany": "delete_many",
            "replaceone": "replace_one",
            "createview": "command",
        }
        return method_map.get(query_type.lower(), query_type)

    def _run_operation(
        self,
        method,
        py_name: str,
        orig_name: str,
        args: List[Any],
        limit: int,
        client,
        db_name: str,
        parsed_query: _LegacyMongoQuery | None = None,
    ) -> Tuple[List[Dict[str, Any]], List[str]]:
        """Execute a parsed compatibility expression and format the result."""
        parsed_query = parsed_query or _LegacyMongoQuery(
            collection="",
            operation=orig_name,
            args=args,
        )
        if isinstance(limit, bool) or not isinstance(limit, int) or limit <= 0:
            raise ValueError("MongoDB result limit must be a positive integer.")
        effective_limit = min(MAX_LIMIT, limit, parsed_query.limit or DEFAULT_LIMIT)
        if py_name == "find":
            find_args = args[:2]
            find_options = args[2] if len(args) > 2 and isinstance(args[2], dict) else {}
            cursor = method(*find_args, max_time_ms=parsed_query.max_time_ms or find_options.get("maxTimeMS") or DEFAULT_MAX_TIME_MS)
            if parsed_query.sort:
                cursor = cursor.sort(list(parsed_query.sort.items()))
            return self._process_documents(list(cursor.limit(effective_limit)))
        if py_name == "find_one":
            if len(args) >= 3 and isinstance(args[2], dict):
                options = args[2]
                kwargs = {"max_time_ms": parsed_query.max_time_ms or DEFAULT_MAX_TIME_MS}
                if options.get("sort"):
                    kwargs["sort"] = list(options["sort"].items())
                document = method(args[0], args[1], **kwargs)
            else:
                document = method(
                    *args[:2],
                    max_time_ms=parsed_query.max_time_ms or DEFAULT_MAX_TIME_MS,
                )
            return self._process_documents([document] if document else [])
        if py_name == "aggregate":
            if not args or not isinstance(args[0], list):
                raise ValueError(
                    "MongoDB aggregate requires a pipeline array, for example collection.aggregate([{'$match': {}}])."
                )
            pipeline = list(args[0])
            pipeline.append({"$limit": effective_limit})
            cursor = method(pipeline, maxTimeMS=parsed_query.max_time_ms or DEFAULT_MAX_TIME_MS)
            documents = [doc for index, doc in enumerate(cursor) if index < effective_limit]
            return self._process_documents(documents)
        if py_name == "count_documents":
            return [{"count": int(method(*args[:1], maxTimeMS=parsed_query.max_time_ms or DEFAULT_MAX_TIME_MS))}], ["count"]
        if py_name == "distinct":
            if not args or not isinstance(args[0], str):
                raise ValueError("MongoDB distinct requires a field name.")
            query_filter = args[1] if len(args) > 1 else {}
            if not isinstance(query_filter, dict):
                raise ValueError("MongoDB distinct filter must be an object.")
            documents = method(
                [
                    {"$match": query_filter},
                    {"$limit": effective_limit},
                    {"$group": {"_id": f"${args[0]}"}},
                    {"$limit": effective_limit},
                    {"$project": {"_id": 0, "value": "$_id"}},
                ],
                maxTimeMS=parsed_query.max_time_ms or DEFAULT_MAX_TIME_MS,
            )
            return self._process_documents(list(documents))
        raise ValueError("MongoDB generic execution is read-only.")

    def _run_structured_operation(
        self,
        collection,
        spec: MongoQuerySpec,
        limit: int,
        max_time_ms: int,
    ) -> Tuple[List[Dict[str, Any]], List[str]]:
        """Dispatch a policy-validated spec without MQL parsing or JavaScript."""
        if spec.operation == "find":
            kwargs = {"max_time_ms": max_time_ms}
            if spec.projection is not None:
                cursor = collection.find(spec.filter, spec.projection, **kwargs)
            else:
                cursor = collection.find(spec.filter, **kwargs)
            if spec.options.get("sort"):
                cursor = cursor.sort(list(spec.options["sort"].items()))
            return self._process_documents(list(cursor.limit(limit)))

        if spec.operation == "findOne":
            kwargs = {"max_time_ms": max_time_ms}
            if spec.options.get("sort"):
                kwargs["sort"] = list(spec.options["sort"].items())
            if spec.projection is not None:
                document = collection.find_one(spec.filter, spec.projection, **kwargs)
            else:
                document = collection.find_one(spec.filter, **kwargs)
            return self._process_documents([document] if document else [])

        if spec.operation == "aggregate":
            pipeline = list(spec.pipeline)
            pipeline.append({"$limit": limit})
            documents = collection.aggregate(pipeline, maxTimeMS=max_time_ms)
            return self._process_documents(list(documents))

        if spec.operation == "countDocuments":
            count = collection.count_documents(spec.filter, maxTimeMS=max_time_ms)
            return [{"count": int(count)}], ["count"]

        if spec.operation == "distinct":
            # Distinct is intentionally a bounded preview: only the first
            # `limit` matched documents and first `limit` grouped values count.
            pipeline = [
                {"$match": spec.filter},
                {"$limit": limit},
            ]
            if spec.distinct_is_array:
                pipeline.append({"$unwind": f"${spec.field}"})
            pipeline.extend(
                [
                    {"$group": {"_id": f"${spec.field}"}},
                    {"$limit": limit},
                    {"$project": {"_id": 0, "value": "$_id"}},
                ]
            )
            documents = collection.aggregate(
                pipeline,
                maxTimeMS=max_time_ms,
            )
            return self._process_documents(list(documents))

        raise ValueError(f"Unsupported MongoDB operation: {spec.operation}")

    def _sanitize_bson(self, val: Any) -> Any:
        """Recursively sanitize BSON types to be JSON serializable."""
        if isinstance(val, (str, int, float, bool, type(None))):
            return val
        if isinstance(val, dict):
            return {
                key: self._sanitize_bson(value)
                for key, value in val.items()
                if not is_sensitive_mongo_field(str(key))
            }
        if isinstance(val, list):
            return [self._sanitize_bson(value) for value in val]
        return str(val)

    def _process_documents(self, docs: List[Dict]) -> Tuple[List[Dict], List[str]]:
        """Serialize BSON documents to standard JSON-compatible formats."""
        processed, columns = [], set()
        for doc in docs:
            processed_doc = {}
            for key, value in doc.items():
                if is_sensitive_mongo_field(str(key)):
                    continue
                processed_doc[key] = str(value) if key == "_id" else self._sanitize_bson(value)
            processed.append(processed_doc)
            columns.update(processed_doc.keys())
        return processed, sorted(list(columns))

    @staticmethod
    def _format_result(info: Dict) -> Tuple[List[Dict], List[str]]:
        """Format a single operation info dict as a row/column response."""
        return [info], sorted(list(info.keys()))

    @staticmethod
    def _build_info(result: Any, cmd_type: str) -> Dict[str, Any]:
        """Extract metadata from PyMongo result objects."""
        info: Dict[str, Any] = {"status": "success", "command": cmd_type}
        for attr in [
            "inserted_id",
            "inserted_ids",
            "matched_count",
            "modified_count",
            "deleted_count",
            "acknowledged",
        ]:
            value = getattr(result, attr, None)
            if value is not None:
                if isinstance(value, list):
                    info[attr] = [str(item) for item in value]
                elif attr.endswith("id"):
                    info[attr] = str(value)
                else:
                    info[attr] = value
        return info
