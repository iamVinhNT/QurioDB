"""
test_nosql_execution.py

Regression tests for MongoDB and Redis execution helpers.
"""

from unittest.mock import MagicMock

import pytest

from services.execution.mongo_executor import MongoExecutor
from services.execution.redis_executor import RedisExecutor
from services.execution import ExecutionService
from services.ai.mongodb_query import (
    MongoQueryPolicy,
    MongoQueryPolicyError,
    MongoQueryRenderer,
    MongoQuerySpec,
)


def _patch_mongodb_metadata(monkeypatch, metadata=None):
    monkeypatch.setattr(
        "services.metadata.metadata_service.get_all_columns",
        lambda *_args: metadata
        or {"orders": [{"name": "_id"}, {"name": "status"}]},
    )


def test_mongo_executor_supports_get_collection_aggregate(monkeypatch):
    service = MagicMock()
    service.get_db_config.return_value = ("mongodb", {"database": "analytics"})
    collection = MagicMock()
    collection.aggregate.return_value = [{"_id": "paid", "count": 3}]
    db = {"orders-2026": collection}
    client = {"analytics": db}
    service.get_mongo_client.return_value = (client, "analytics")

    session = MagicMock()
    monkeypatch.setattr("services.execution.mongo_executor.SessionLocal", lambda: session)
    _patch_mongodb_metadata(
        monkeypatch,
        {"orders-2026": [{"name": "_id"}, {"name": "status"}]},
    )

    data, columns = MongoExecutor(service).execute(
        "db1",
        'db.getCollection("orders-2026").aggregate([{"$group":{"_id":"$status","count":{"$sum":1}}}])',
        100,
    )

    assert data == [{"_id": "paid", "count": 3}]
    assert columns == ["_id", "count"]
    collection.aggregate.assert_called_once()
    session.close.assert_called_once()


def test_mongo_executor_requires_aggregate_pipeline_array():
    executor = MongoExecutor(MagicMock())
    method = MagicMock()

    with pytest.raises(Exception, match="pipeline array"):
        executor._run_operation(method, "aggregate", "aggregate", [{"$match": {}}], 100, MagicMock(), "db")


@pytest.mark.parametrize(
    "query",
    [
        'db.getCollection("orders").insertOne({"status":"paid"})',
        'db.getCollection("orders").insertMany([{"status":"paid"}])',
        'db.getCollection("orders").updateOne({}, {"$set":{"status":"paid"}})',
        'db.getCollection("orders").updateMany({}, {"$set":{"status":"paid"}})',
        'db.getCollection("orders").deleteOne({})',
        'db.getCollection("orders").deleteMany({})',
        'db.getCollection("orders").replaceOne({}, {"status":"paid"})',
        'db.getCollection("orders").createView("archive", "orders", [])',
    ],
)
def test_legacy_mongodb_executor_rejects_write_operations_before_connection(query, monkeypatch):
    service = MagicMock()
    service.get_db_config.return_value = ("mongodb", {"database": "analytics"})
    service.get_mongo_client.return_value = (MagicMock(), "analytics")
    session = MagicMock()
    monkeypatch.setattr("services.execution.mongo_executor.SessionLocal", lambda: session)

    with pytest.raises(ValueError, match="read-only"):
        MongoExecutor(service).execute("db1", query, 100)

    service.get_mongo_client.assert_not_called()


def test_execution_service_rejects_mongodb_write_operations_before_executor(monkeypatch):
    service = ExecutionService()
    session = MagicMock()
    monkeypatch.setattr(
        service,
        "get_db_config",
        lambda *_args, **_kwargs: ("mongodb", {"database": "analytics"}),
    )
    service.mongo_executor.execute = MagicMock(return_value=([], []))

    with pytest.raises(ValueError, match="read-only"):
        service.execute_query(
            "db1",
            'db.getCollection("orders").insertOne({"status":"paid"})',
            session,
        )

    service.mongo_executor.execute.assert_not_called()


def test_legacy_mongodb_replay_bounds_all_read_operations_with_timeout_and_limits(monkeypatch):
    class StrictCursor:
        def __init__(self, documents):
            self.documents = documents
            self.limit_value = None

        def limit(self, value):
            self.limit_value = value
            return self

        def __iter__(self):
            documents = self.documents if self.limit_value is None else self.documents[: self.limit_value]
            return iter(documents)

    class StrictCollection:
        def __init__(self):
            self.find_calls = []
            self.find_one_calls = []
            self.aggregate_calls = []
            self.count_calls = []

        def find(self, filter, projection=None, *, max_time_ms):
            self.find_calls.append((filter, projection, max_time_ms))
            return StrictCursor([{"status": "paid"}])

        def find_one(self, filter, projection=None, *, max_time_ms):
            self.find_one_calls.append((filter, projection, max_time_ms))
            return {"status": "paid"}

        def aggregate(self, pipeline, *, maxTimeMS):
            self.aggregate_calls.append((pipeline, maxTimeMS))
            return StrictCursor([{"status": "paid"}, {"value": "paid"}])

        def count_documents(self, filter, *, maxTimeMS):
            self.count_calls.append((filter, maxTimeMS))
            return 250

    service = MagicMock()
    service.get_db_config.return_value = ("mongodb", {"database": "analytics"})
    collection = StrictCollection()
    service.get_mongo_client.return_value = ({"analytics": {"orders": collection}}, "analytics")
    session = MagicMock()
    monkeypatch.setattr("services.execution.mongo_executor.SessionLocal", lambda: session)
    _patch_mongodb_metadata(monkeypatch)
    executor = MongoExecutor(service)

    payloads = [
        {"operation": "find", "collection": "orders"},
        {"operation": "findOne", "collection": "orders"},
        {"operation": "aggregate", "collection": "orders", "pipeline": [{"$match": {}}]},
        {"operation": "countDocuments", "collection": "orders"},
        {"operation": "distinct", "collection": "orders", "field": "status"},
    ]
    for payload in payloads:
        spec = MongoQueryPolicy(trusted_database="analytics").validate(
            MongoQuerySpec.from_payload(payload)
        )
        executor.execute("db1", MongoQueryRenderer.render(spec), 5000)

    assert collection.find_calls == [({}, {"_id": 1, "status": 1}, 30000)]
    assert collection.find_one_calls == [({}, {"_id": 1, "status": 1}, 30000)]
    assert collection.count_calls == [({}, 30000)]
    assert collection.aggregate_calls == [
        ([{"$match": {}}, {"$project": {"_id": 1, "status": 1}}, {"$limit": 100}], 30000),
        (
            [
                {"$match": {}},
                {"$limit": 100},
                {"$group": {"_id": "$status"}},
                {"$limit": 100},
                {"$project": {"_id": 0, "value": "$_id"}},
            ],
            30000,
        ),
    ]


def test_legacy_mongodb_replay_preserves_custom_timeout_for_every_read_operation(monkeypatch):
    class Cursor:
        def limit(self, _value):
            return self

        def __iter__(self):
            return iter([{"status": "paid"}])

    class Collection:
        def __init__(self):
            self.calls = []

        def find(self, *_args, **kwargs):
            self.calls.append(("find", kwargs))
            return Cursor()

        def find_one(self, *_args, **kwargs):
            self.calls.append(("find_one", kwargs))
            return {"status": "paid"}

        def aggregate(self, *_args, **kwargs):
            self.calls.append(("aggregate", kwargs))
            return Cursor()

        def count_documents(self, *_args, **kwargs):
            self.calls.append(("count_documents", kwargs))
            return 1

    service = MagicMock()
    service.get_db_config.return_value = ("mongodb", {"database": "analytics"})
    collection = Collection()
    service.get_mongo_client.return_value = ({"analytics": {"orders": collection}}, "analytics")
    session = MagicMock()
    monkeypatch.setattr("services.execution.mongo_executor.SessionLocal", lambda: session)
    _patch_mongodb_metadata(monkeypatch)
    executor = MongoExecutor(service)
    timeout = 1200
    queries = [
        'db.getSiblingDB("analytics").getCollection("orders").find({}).limit(100).maxTimeMS(1200)',
        'db.getSiblingDB("analytics").getCollection("orders").findOne({}, {}, {"maxTimeMS":1200})',
        'db.getSiblingDB("analytics").getCollection("orders").aggregate([], {"maxTimeMS":1200})',
        'db.getSiblingDB("analytics").getCollection("orders").countDocuments({}, {"maxTimeMS":1200})',
        'db.getSiblingDB("analytics").getCollection("orders").distinct("status", {}, {"maxTimeMS":1200})',
    ]

    for query in queries:
        executor.execute("db1", query, 100)

    assert [kwargs.get("max_time_ms", kwargs.get("maxTimeMS")) for _, kwargs in collection.calls] == [timeout] * 5


def test_legacy_mongodb_executor_rejects_non_positive_result_limits(monkeypatch):
    service = MagicMock()
    service.get_db_config.return_value = ("mongodb", {"database": "analytics"})
    service.get_mongo_client.return_value = (MagicMock(), "analytics")
    session = MagicMock()
    monkeypatch.setattr("services.execution.mongo_executor.SessionLocal", lambda: session)
    _patch_mongodb_metadata(monkeypatch)

    with pytest.raises(ValueError, match="positive integer"):
        MongoExecutor(service).execute(
            "db1",
            'db.getCollection("orders").find({})',
            0,
        )

    service.get_mongo_client.assert_not_called()


def test_mongo_executor_structured_find_enforces_limit_and_timeout(monkeypatch):
    service = MagicMock()
    service.get_db_config.return_value = ("mongodb", {"database": "analytics"})
    collection = MagicMock()
    cursor = MagicMock()
    cursor.limit.return_value = [{"_id": "1", "status": "paid"}]
    collection.find.return_value = cursor
    service.get_mongo_client.return_value = ({"analytics": {"orders": collection}}, "analytics")
    session = MagicMock()
    monkeypatch.setattr("services.execution.mongo_executor.SessionLocal", lambda: session)

    spec = MongoQueryPolicy().validate(
        MongoQuerySpec.from_payload(
            {
                "operation": "find",
                "collection": "orders",
                "filter": {"status": "paid"},
            }
        )
    )

    data, columns = MongoExecutor(service).execute_spec("db1", spec)

    assert data == [{"_id": "1", "status": "paid"}]
    assert columns == ["_id", "status"]
    collection.find.assert_called_once_with({"status": "paid"}, max_time_ms=30000)
    cursor.limit.assert_called_once_with(100)
    session.close.assert_called_once()


def test_mongo_executor_structured_find_applies_authorized_leaf_projection(monkeypatch):
    service = MagicMock()
    service.get_db_config.return_value = ("mongodb", {"database": "analytics"})
    collection = MagicMock()
    cursor = MagicMock()
    cursor.limit.return_value = [{"status": "paid", "unlisted": "value"}]
    collection.find.return_value = cursor
    service.get_mongo_client.return_value = ({"analytics": {"orders": collection}}, "analytics")
    session = MagicMock()
    monkeypatch.setattr("services.execution.mongo_executor.SessionLocal", lambda: session)

    spec = MongoQueryPolicy(
        known_collections={"orders"},
        trusted_database="analytics",
        field_allowlist={"orders": {"_id", "status"}},
    ).validate(MongoQuerySpec.from_payload({"operation": "find", "collection": "orders"}))

    MongoExecutor(service).execute_spec("db1", spec)

    collection.find.assert_called_once_with(
        {},
        {"_id": 1, "status": 1},
        max_time_ms=30000,
    )


def test_mongo_executor_structured_dispatch_supports_all_read_operations(monkeypatch):
    class StrictCursor:
        def __init__(self, documents):
            self.documents = documents
            self.limit_value = None

        def limit(self, value):
            self.limit_value = value
            return self

        def __iter__(self):
            documents = self.documents if self.limit_value is None else self.documents[: self.limit_value]
            return iter(documents)

    class StrictCollection:
        def __init__(self):
            self.find_calls = []
            self.find_one_calls = []
            self.aggregate_calls = []
            self.count_calls = []

        def find(self, filter, projection=None, *, max_time_ms):
            self.find_calls.append((filter, projection, max_time_ms))
            return StrictCursor([{"status": "paid"}])

        def find_one(self, filter, projection=None, *, max_time_ms):
            self.find_one_calls.append((filter, projection, max_time_ms))
            return {"status": "paid"}

        def aggregate(self, pipeline, *, maxTimeMS):
            self.aggregate_calls.append((pipeline, maxTimeMS))
            if any("$group" in stage for stage in pipeline):
                return [{"value": "paid"}, {"value": "pending"}]
            return [{"status": "paid"}]

        def count_documents(self, filter, *, maxTimeMS):
            self.count_calls.append((filter, maxTimeMS))
            return 250

    service = MagicMock()
    service.get_db_config.return_value = ("mongodb", {"database": "analytics"})
    collection = StrictCollection()
    service.get_mongo_client.return_value = ({"analytics": {"orders": collection}}, "analytics")
    session = MagicMock()
    monkeypatch.setattr("services.execution.mongo_executor.SessionLocal", lambda: session)
    executor = MongoExecutor(service)

    results = [
        executor.execute_spec(
            "db1",
            MongoQueryPolicy().validate(
                MongoQuerySpec.from_payload({"operation": "find", "collection": "orders"})
            ),
        ),
        executor.execute_spec(
            "db1",
            MongoQueryPolicy().validate(
                MongoQuerySpec.from_payload({"operation": "findOne", "collection": "orders"})
            ),
        ),
        executor.execute_spec(
            "db1",
            MongoQueryPolicy().validate(
                MongoQuerySpec.from_payload(
                    {"operation": "aggregate", "collection": "orders", "pipeline": [{"$match": {}}]}
                )
            ),
        ),
        executor.execute_spec(
            "db1",
            MongoQueryPolicy().validate(
                MongoQuerySpec.from_payload({"operation": "countDocuments", "collection": "orders"})
            ),
        ),
        executor.execute_spec(
            "db1",
            MongoQueryPolicy().validate(
                MongoQuerySpec.from_payload(
                    {"operation": "distinct", "collection": "orders", "field": "status"}
                )
            ),
        ),
    ]

    assert results[0][0] == [{"status": "paid"}]
    assert results[1][0] == [{"status": "paid"}]
    assert results[2][0] == [{"status": "paid"}]
    assert results[3] == ([{"count": 250}], ["count"])
    assert results[4] == ([{"value": "paid"}, {"value": "pending"}], ["value"])
    assert collection.find_calls == [({}, None, 30000)]
    assert collection.find_one_calls == [({}, None, 30000)]
    assert collection.count_calls == [({}, 30000)]
    assert collection.aggregate_calls == [
        ([{"$match": {}}, {"$limit": 100}], 30000),
        (
            [
                {"$match": {}},
                {"$limit": 100},
                {"$group": {"_id": "$status"}},
                {"$limit": 100},
                {"$project": {"_id": 0, "value": "$_id"}},
            ],
            30000,
        ),
    ]


def test_mongo_executor_structured_distinct_uses_bounded_aggregate(monkeypatch):
    class StrictCollection:
        def __init__(self):
            self.aggregate_call = None

        def aggregate(self, pipeline, *, maxTimeMS):
            self.aggregate_call = (pipeline, maxTimeMS)
            return [{"value": "paid"}]

    service = MagicMock()
    service.get_db_config.return_value = ("mongodb", {"database": "analytics"})
    collection = StrictCollection()
    service.get_mongo_client.return_value = ({"analytics": {"orders": collection}}, "analytics")
    session = MagicMock()
    monkeypatch.setattr("services.execution.mongo_executor.SessionLocal", lambda: session)

    spec = MongoQueryPolicy().validate(
        MongoQuerySpec.from_payload(
            {"operation": "distinct", "collection": "orders", "field": "status"}
        )
    )

    data, columns = MongoExecutor(service).execute_spec("db1", spec)

    assert data == [{"value": "paid"}]
    assert columns == ["value"]
    assert collection.aggregate_call == (
        [
            {"$match": {}},
            {"$limit": 100},
            {"$group": {"_id": "$status"}},
            {"$limit": 100},
            {"$project": {"_id": 0, "value": "$_id"}},
        ],
        30000,
    )


def test_mongo_executor_structured_array_distinct_unwinds_before_group(monkeypatch):
    class StrictCollection:
        def __init__(self):
            self.aggregate_call = None

        def aggregate(self, pipeline, *, maxTimeMS):
            self.aggregate_call = (pipeline, maxTimeMS)
            return [{"value": "A-1"}]

    service = MagicMock()
    service.get_db_config.return_value = ("mongodb", {"database": "analytics"})
    collection = StrictCollection()
    service.get_mongo_client.return_value = ({"analytics": {"orders": collection}}, "analytics")
    session = MagicMock()
    monkeypatch.setattr("services.execution.mongo_executor.SessionLocal", lambda: session)

    spec = MongoQueryPolicy(
        trusted_database="analytics",
        field_allowlist={"orders": {"_id", "items.sku"}},
        array_field_allowlist={"orders": {"items.sku"}},
    ).validate(
        MongoQuerySpec.from_payload(
            {"operation": "distinct", "collection": "orders", "field": "items.sku"}
        )
    )

    data, columns = MongoExecutor(service).execute_spec("db1", spec)

    assert data == [{"value": "A-1"}]
    assert columns == ["value"]
    assert collection.aggregate_call == (
        [
            {"$match": {}},
            {"$limit": 100},
            {"$unwind": "$items.sku"},
            {"$group": {"_id": "$items.sku"}},
            {"$limit": 100},
            {"$project": {"_id": 0, "value": "$_id"}},
        ],
        30000,
    )


def test_mongo_executor_structured_count_uses_supported_timeout_and_returns_full_count(monkeypatch):
    class StrictCollection:
        def count_documents(self, filter, *, maxTimeMS):
            assert filter == {}
            assert maxTimeMS == 30000
            return 250

    service = MagicMock()
    service.get_db_config.return_value = ("mongodb", {"database": "analytics"})
    service.get_mongo_client.return_value = ({"analytics": {"orders": StrictCollection()}}, "analytics")
    session = MagicMock()
    monkeypatch.setattr("services.execution.mongo_executor.SessionLocal", lambda: session)

    spec = MongoQueryPolicy().validate(
        MongoQuerySpec.from_payload({"operation": "countDocuments", "collection": "orders"})
    )

    data, columns = MongoExecutor(service).execute_spec("db1", spec)

    assert data == [{"count": 250}]
    assert columns == ["count"]


def test_mongo_executor_structured_count_does_not_apply_preview_limit(monkeypatch):
    class StrictCollection:
        def count_documents(self, filter, *, maxTimeMS):
            assert filter == {}
            assert maxTimeMS == 30000
            return 251

    service = MagicMock()
    service.get_db_config.return_value = ("mongodb", {"database": "analytics"})
    service.get_mongo_client.return_value = ({"analytics": {"orders": StrictCollection()}}, "analytics")
    session = MagicMock()
    monkeypatch.setattr("services.execution.mongo_executor.SessionLocal", lambda: session)

    spec = MongoQueryPolicy().validate(
        MongoQuerySpec.from_payload(
            {"operation": "countDocuments", "collection": "orders", "options": {"limit": 1}}
        )
    )

    data, _ = MongoExecutor(service).execute_spec("db1", spec)

    assert data == [{"count": 251}]


def test_mongo_executor_resolves_db_collection_prefix_to_configured_database(monkeypatch):
    service = MagicMock()
    service.get_db_config.return_value = ("mongodb", {"database": "analytics"})
    collection = MagicMock()
    cursor = MagicMock()
    cursor.limit.return_value = [{"status": "paid"}]
    collection.find.return_value = cursor
    service.get_mongo_client.return_value = ({"analytics": {"orders": collection}}, "analytics")
    session = MagicMock()
    monkeypatch.setattr("services.execution.mongo_executor.SessionLocal", lambda: session)
    _patch_mongodb_metadata(monkeypatch)

    data, _ = MongoExecutor(service).execute("db1", "db.orders.find({})", 10)

    assert data == [{"status": "paid"}]
    collection.find.assert_called_once_with(
        {}, {"_id": 1, "status": 1}, max_time_ms=30000
    )
    cursor.limit.assert_called_once_with(10)
    session.close.assert_called_once()


@pytest.mark.parametrize(
    "payload, expected_data",
    [
        (
            {"operation": "find", "collection": "orders", "database": "analytics", "filter": {"status": "paid"}},
            [{"status": "paid"}],
        ),
        (
            {"operation": "findOne", "collection": "orders", "database": "analytics", "filter": {"status": "paid"}},
            [{"status": "paid"}],
        ),
        (
            {
                "operation": "aggregate",
                "collection": "orders",
                "database": "analytics",
                "pipeline": [{"$match": {"status": "paid"}}],
            },
            [{"status": "paid"}],
        ),
        (
            {"operation": "countDocuments", "collection": "orders", "database": "analytics", "filter": {"status": "paid"}},
            [{"count": 250}],
        ),
        (
            {
                "operation": "distinct",
                "collection": "orders",
                "database": "analytics",
                "filter": {"status": "paid"},
                "field": "status",
            },
            [{"value": "paid"}],
        ),
    ],
)
def test_rendered_mongodb_query_round_trips_through_legacy_executor(
    monkeypatch, payload, expected_data
):
    class StrictCursor:
        def __init__(self, documents):
            self.documents = documents

        def sort(self, _sort):
            return self

        def limit(self, _limit):
            return self

        def __iter__(self):
            return iter(self.documents)

    class StrictCollection:
        def find(self, _filter, _projection=None, *, max_time_ms):
            assert max_time_ms == 30000
            return StrictCursor([{"status": "paid"}])

        def find_one(self, _filter, _projection=None, *, max_time_ms):
            assert max_time_ms == 30000
            return {"status": "paid"}

        def aggregate(self, _pipeline, *, maxTimeMS):
            assert maxTimeMS == 30000
            if any("$group" in stage for stage in _pipeline):
                return [{"value": "paid"}]
            return [{"status": "paid"}]

        def count_documents(self, _filter, *, maxTimeMS):
            assert maxTimeMS == 30000
            return 250

        def distinct(self, _field, _filter):
            return ["paid"]

    service = MagicMock()
    service.get_db_config.return_value = ("mongodb", {"database": "analytics"})
    service.get_mongo_client.return_value = (
        {"analytics": {"orders": StrictCollection()}},
        "analytics",
    )
    session = MagicMock()
    monkeypatch.setattr("services.execution.mongo_executor.SessionLocal", lambda: session)
    _patch_mongodb_metadata(monkeypatch)
    spec = MongoQueryPolicy(trusted_database="analytics").validate(
        MongoQuerySpec.from_payload(payload)
    )
    rendered = MongoQueryRenderer.render(spec)

    data, _ = MongoExecutor(service).execute("db1", rendered, 100)

    assert data == expected_data
    assert 'db.getSiblingDB("analytics").getCollection("orders")' in rendered
    session.close.assert_called_once()


def test_legacy_mongodb_executor_rejects_canonical_query_for_untrusted_database(monkeypatch):
    service = MagicMock()
    service.get_db_config.return_value = ("mongodb", {"database": "analytics"})
    service.get_mongo_client.return_value = (None, "analytics")
    session = MagicMock()
    monkeypatch.setattr("services.execution.mongo_executor.SessionLocal", lambda: session)

    with pytest.raises(ValueError, match="database"):
        MongoExecutor(service).execute(
            "db1",
            'db.getSiblingDB("other").getCollection("orders").find({}).limit(100)',
            100,
        )


def test_redis_executor_formats_scan_results_as_key_rows():
    executor = RedisExecutor(MagicMock())

    data, columns = executor._process_result("SCAN", ("0", ["user:1", "user:2"]), 1)

    assert columns == ["cursor", "key"]
    assert data == [{"cursor": "0", "key": "user:1"}]


def test_public_mongodb_execution_applies_authoritative_collection_and_field_policy(monkeypatch):
    service = MagicMock()
    service.get_db_config.return_value = ("mongodb", {"database": "analytics"})
    collection = MagicMock()
    cursor = MagicMock()
    cursor.limit.return_value = [{"status": "paid"}]
    collection.find.return_value = cursor
    service.get_mongo_client.return_value = ({"analytics": {"orders": collection}}, "analytics")
    session = MagicMock()
    monkeypatch.setattr("services.execution.mongo_executor.SessionLocal", lambda: session)
    monkeypatch.setattr(
        "services.metadata.metadata_service.get_all_columns",
        lambda *_args: {
            "orders": [
                {"name": "_id", "type": "str"},
                {"name": "status", "type": "str"},
            ]
        },
    )

    data, columns = MongoExecutor(service).execute(
        "db1",
        'db.getCollection("orders").find({"status":"paid"})',
        10,
    )

    assert data == [{"status": "paid"}]
    assert columns == ["status"]
    collection.find.assert_called_once_with(
        {"status": "paid"},
        {"_id": 1, "status": 1},
        max_time_ms=30000,
    )


def test_public_mongodb_execution_rejects_unknown_collection_before_connection(monkeypatch):
    service = MagicMock()
    service.get_db_config.return_value = ("mongodb", {"database": "analytics"})
    service.get_mongo_client.return_value = (None, "analytics")
    session = MagicMock()
    monkeypatch.setattr("services.execution.mongo_executor.SessionLocal", lambda: session)
    monkeypatch.setattr(
        "services.metadata.metadata_service.get_all_columns",
        lambda *_args: {"orders": [{"name": "status", "type": "str"}]},
    )

    with pytest.raises(MongoQueryPolicyError, match="unknown collection"):
        MongoExecutor(service).execute(
            "db1",
            'db.getCollection("users").find({})',
            10,
        )

    service.get_mongo_client.assert_not_called()


def test_public_mongodb_execution_rejects_sensitive_projection_before_connection(monkeypatch):
    service = MagicMock()
    service.get_db_config.return_value = ("mongodb", {"database": "analytics"})
    service.get_mongo_client.return_value = (None, "analytics")
    session = MagicMock()
    monkeypatch.setattr("services.execution.mongo_executor.SessionLocal", lambda: session)
    monkeypatch.setattr(
        "services.metadata.metadata_service.get_all_columns",
        lambda *_args: {
            "orders": [
                {"name": "status", "type": "str"},
                {"name": "password", "type": "str"},
            ]
        },
    )

    with pytest.raises(MongoQueryPolicyError, match="field"):
        MongoExecutor(service).execute(
            "db1",
            'db.getCollection("orders").find({}, {"password":1})',
            10,
        )

    service.get_mongo_client.assert_not_called()


def test_public_mongodb_execution_rejects_unsafe_aggregate_expression_before_connection(monkeypatch):
    service = MagicMock()
    service.get_db_config.return_value = ("mongodb", {"database": "analytics"})
    service.get_mongo_client.return_value = (None, "analytics")
    session = MagicMock()
    monkeypatch.setattr("services.execution.mongo_executor.SessionLocal", lambda: session)
    monkeypatch.setattr(
        "services.metadata.metadata_service.get_all_columns",
        lambda *_args: {"orders": [{"name": "status", "type": "str"}]},
    )

    with pytest.raises(MongoQueryPolicyError, match=r"\$function"):
        MongoExecutor(service).execute(
            "db1",
            'db.getCollection("orders").aggregate([{"$project":{"value":{"$function":{"body":"return 1"}}}}])',
            10,
        )

    service.get_mongo_client.assert_not_called()


def test_execution_service_routes_public_mongodb_reads_through_authoritative_policy(monkeypatch):
    service = ExecutionService()
    session = MagicMock()
    service.get_db_config = MagicMock(return_value=("mongodb", {"database": "analytics"}))
    service._save_history = MagicMock()
    collection = MagicMock()
    cursor = MagicMock()
    cursor.limit.return_value = [{"status": "paid"}]
    collection.find.return_value = cursor
    service.get_mongo_client = MagicMock(
        return_value=({"analytics": {"orders": collection}}, "analytics")
    )
    monkeypatch.setattr("services.execution.mongo_executor.SessionLocal", lambda: MagicMock())
    monkeypatch.setattr(
        "services.metadata.metadata_service.get_all_columns",
        lambda *_args: {"orders": [{"name": "_id"}, {"name": "status"}]},
    )

    result = service.execute_query(
        "db1",
        'db.getCollection("orders").find({"status":"paid"})',
        session,
        limit=10,
    )

    assert result["data"] == [{"status": "paid"}]
    service._save_history.assert_called_once()


def test_public_mongodb_execution_recursively_omits_nested_sensitive_response_fields(monkeypatch):
    service = ExecutionService()
    service.get_db_config = MagicMock(return_value=("mongodb", {"database": "analytics"}))
    collection = MagicMock()
    cursor = MagicMock()
    cursor.limit.return_value = [
        {
            "password": "top-level-secret",
            "profile": {
                "displayName": "Ada",
                "password": "nested-secret",
                "preferences": {"theme": "dark", "apiToken": "nested-token"},
            },
            "sessions": [
                {"device": "laptop", "refresh_token": "nested-refresh-token"},
                {"device": "phone", "region": "EU"},
            ],
        }
    ]
    collection.find.return_value = cursor
    service.get_mongo_client = MagicMock(return_value=({"analytics": {"orders": collection}}, "analytics"))
    service._save_history = MagicMock()
    session = MagicMock()
    monkeypatch.setattr("services.execution.mongo_executor.SessionLocal", lambda: session)
    monkeypatch.setattr(
        "services.metadata.metadata_service.get_all_columns",
        lambda *_args: {
            "orders": [
                {"name": "profile"},
                {"name": "sessions", "isArray": True},
            ]
        },
    )

    result = service.execute_query(
        "db1",
        'db.getCollection("orders").find({})',
        session,
        limit=10,
    )

    assert result["data"] == [
        {
            "profile": {
                "displayName": "Ada",
                "preferences": {"theme": "dark"},
            },
            "sessions": [
                {"device": "laptop"},
                {"device": "phone", "region": "EU"},
            ],
        }
    ]
    assert result["columns"] == ["profile", "sessions"]
    assert "nested-secret" not in str(result)
    assert "nested-token" not in str(result)
    assert "nested-refresh-token" not in str(result)
