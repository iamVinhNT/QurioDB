"""
test_ai_mongodb_context.py

Regression tests for MongoDB-aware schema inference and prompt context.
"""

from unittest.mock import MagicMock

import pytest
from pymongo.errors import ExecutionTimeout

from services.ai.context import SchemaContextService
from services.metadata.mongo_provider import MongoMetadataProvider


def test_mongo_metadata_provider_flattens_nested_and_array_object_fields():
    service = MagicMock()
    collection = MagicMock()
    collection.aggregate.return_value = [
        {
            "_id": "1",
            "customer": {"id": 7, "name": "A"},
            "items": [{"sku": "A-1", "quantity": 2}],
        },
        {
            "_id": "2",
            "customer": {"id": "8"},
            "items": [{"sku": None}],
        },
    ]
    service.get_mongo_client.return_value = ({"analytics": {"orders": collection}}, "analytics")

    columns = MongoMetadataProvider(service).get_columns("db1", "public", "orders", MagicMock())

    assert [column["name"] for column in columns] == [
        "_id",
        "customer",
        "customer.id",
        "customer.name",
        "items",
        "items.sku",
        "items.quantity",
    ]
    assert next(column for column in columns if column["name"] == "customer.id")["type"] == "int | str"
    items_sku = next(column for column in columns if column["name"] == "items.sku")
    assert items_sku["type"] == "NoneType | str"
    assert items_sku["isArray"] is True


def test_schema_context_uses_mongodb_collection_vocabulary(monkeypatch):
    service = SchemaContextService()
    monkeypatch.setattr(
        "services.ai.context.metadata_service.get_all_columns",
        lambda *_: {
            "orders": [
                {"name": "items[]", "type": "list", "nullable": True},
                {"name": "items.sku", "type": "str", "nullable": True, "isArray": True},
            ],
        },
    )
    monkeypatch.setattr("services.ai.context.metadata_service.get_all_foreign_keys", lambda *_: [])
    monkeypatch.setattr("services.ai.context.metadata_service.get_schemas", lambda *_: ["analytics"])
    monkeypatch.setattr(
        "services.ai.context.BaseDatabaseService.get_db_config",
        lambda *_: ("mongodb", {"database": "analytics"}),
    )

    result = service.build_schema_context("db1", "analytics")

    assert "DATABASE DIALECT: MONGODB" in result.context
    assert "COLLECTION: orders" in result.context
    assert "items.sku: str (array element)" in result.context
    assert "CREATE TABLE" not in result.context
    assert "FOREIGN KEY" not in result.context
    assert result.collections == ("orders",)
    assert result.field_allowlist == {"orders": ("_id", "items.sku")}
    assert result.array_field_allowlist == {"orders": ("items.sku",)}


def test_schema_context_rejects_database_not_reported_by_mongodb_server(monkeypatch):
    service = SchemaContextService()
    monkeypatch.setattr(
        "services.ai.context.metadata_service.get_all_columns",
        lambda *_: {"orders": [{"name": "status", "type": "str", "nullable": True}]},
    )
    monkeypatch.setattr("services.ai.context.metadata_service.get_schemas", lambda *_: ["analytics"])

    with pytest.raises(ValueError, match="accessible"):
        service.build_schema_context("db1", "reporting", database_type="mongodb")


def test_authoritative_mongodb_type_skips_failed_secondary_type_lookup(monkeypatch):
    service = SchemaContextService()
    monkeypatch.setattr(
        service,
        "_get_db_type",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("secondary lookup unavailable")),
    )
    monkeypatch.setattr(
        "services.ai.context.metadata_service.get_all_columns",
        lambda *_: {"orders": [{"name": "status", "type": "str", "nullable": True}]},
    )
    monkeypatch.setattr("services.ai.context.metadata_service.get_indexes", lambda *_: [])
    monkeypatch.setattr("services.ai.context.metadata_service.get_schemas", lambda *_: ["analytics"])
    monkeypatch.setattr(
        "services.ai.context.BaseDatabaseService.run_dynamic_query",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("SQL sample path used")),
    )

    result = service.build_schema_context("db1", "analytics", database_type="mongodb")

    assert "DATABASE DIALECT: MONGODB" in result.context
    assert "CREATE TABLE" not in result.context
    assert result.collections == ("orders",)


def test_schema_context_rejects_unknown_authoritative_database_type(monkeypatch):
    service = SchemaContextService()
    monkeypatch.setattr(
        "services.ai.context.metadata_service.get_all_columns",
        lambda *_: {"orders": [{"name": "status", "type": "str", "nullable": True}]},
    )

    with pytest.raises(ValueError, match="database type"):
        service.build_schema_context("db1", "analytics", database_type="unknown-driver")


def test_mongo_metadata_provider_does_not_fallback_to_unbounded_find_after_sample_timeout():
    class StrictCollection:
        def aggregate(self, pipeline, *, maxTimeMS):
            assert pipeline == [{"$sample": {"size": 20}}]
            assert maxTimeMS == 30000
            raise ExecutionTimeout("sampling timed out")

        def find(self, *_args, **_kwargs):
            raise AssertionError("unbounded sample fallback used")

    service = MagicMock()
    service.get_mongo_client.return_value = ({"analytics": {"orders": StrictCollection()}}, "analytics")

    columns = MongoMetadataProvider(service).get_columns("db1", "analytics", "orders", MagicMock())

    assert columns == []


def test_mongo_metadata_provider_bounds_collection_listing_on_timeout():
    class StrictDatabase:
        def list_collection_names(self, *, maxTimeMS):
            assert maxTimeMS == 30000
            raise ExecutionTimeout("collection listing timed out")

    service = MagicMock()
    service.get_mongo_client.return_value = ({"analytics": StrictDatabase()}, "analytics")

    tables = MongoMetadataProvider(service).get_tables("db1", "analytics", MagicMock())

    assert tables == []


def test_mongo_metadata_provider_bounds_index_listing_and_collstats_on_timeout():
    class StrictCollection:
        def list_indexes(self):
            raise ExecutionTimeout("index listing timed out")

    class StrictDatabase:
        def __getitem__(self, _name):
            return StrictCollection()

        def command(self, command, collection, *, maxTimeMS):
            assert command == "collstats"
            assert collection == "orders"
            assert maxTimeMS == 30000
            raise ExecutionTimeout("collstats timed out")

    service = MagicMock()
    service.get_mongo_client.return_value = ({"analytics": StrictDatabase()}, "analytics")
    provider = MongoMetadataProvider(service)

    assert provider.get_indexes("db1", "analytics", "orders", MagicMock()) == []
    assert provider.get_table_info("db1", "analytics", "orders", MagicMock()) == {}


def test_mongo_metadata_provider_consumes_lazy_cursors_inside_timeout(monkeypatch):
    timeout_state = {"active": False}

    class Timeout:
        def __enter__(self):
            timeout_state["active"] = True

        def __exit__(self, *_args):
            timeout_state["active"] = False

    class Cursor:
        def __iter__(self):
            assert timeout_state["active"] is True
            return iter([{"name": "orders", "type": "view"}])

    class EmptyCursor(Cursor):
        def __iter__(self):
            assert timeout_state["active"] is True
            return iter([])

    class Collection:
        def aggregate(self, _pipeline, *, maxTimeMS):
            assert maxTimeMS == 30000
            return EmptyCursor()

        def list_indexes(self):
            return Cursor()

    class Database:
        def list_collections(self, *, maxTimeMS):
            assert maxTimeMS == 30000
            return Cursor()

        def __getitem__(self, _name):
            return Collection()

    monkeypatch.setattr("services.metadata.mongo_provider.pymongo.timeout", lambda _seconds: Timeout())
    service = MagicMock()
    service.get_mongo_client.return_value = ({"analytics": Database()}, "analytics")
    provider = MongoMetadataProvider(service)

    assert provider.get_views("db1", "analytics", MagicMock()) == ["orders"]
    assert provider.get_columns("db1", "analytics", "orders", MagicMock()) == []
    assert provider.get_indexes("db1", "analytics", "orders", MagicMock()) == [
        {"indexname": "orders", "indexdef": "None"}
    ]


def test_mongo_metadata_provider_redacts_credentials_from_captured_logs(caplog):
    service = MagicMock()
    service.get_mongo_client.side_effect = RuntimeError(
        "failed mongodb://user:secret@example.test/analytics password=secret token=secret"
    )
    provider = MongoMetadataProvider(service)

    with caplog.at_level("ERROR", logger="services.metadata.mongo_provider"):
        assert provider.get_schemas("db1", MagicMock()) == []

    assert "Error listing MongoDB databases" in caplog.text
    assert "secret" not in caplog.text
    assert "[redacted-uri]" in caplog.text


@pytest.mark.parametrize(
    ("method_name", "args", "expected_result", "message"),
    [
        ("get_tables", ("db1", "analytics", MagicMock()), [], "Error listing MongoDB collections"),
        ("get_views", ("db1", "analytics", MagicMock()), [], "Error listing MongoDB views"),
        ("get_columns", ("db1", "analytics", "orders", MagicMock()), [], "Error inferring MongoDB columns"),
        ("get_indexes", ("db1", "analytics", "orders", MagicMock()), [], "Error listing MongoDB indexes"),
        ("get_table_info", ("db1", "analytics", "orders", MagicMock()), {}, "Error fetching MongoDB table info"),
    ],
)
def test_mongo_metadata_provider_redacts_connection_acquisition_errors(
    caplog, method_name, args, expected_result, message
):
    service = MagicMock()
    service.get_mongo_client.side_effect = RuntimeError(
        "failed mongodb://user:secret@example.test/analytics password=secret token=secret"
    )
    provider = MongoMetadataProvider(service)

    with caplog.at_level("ERROR", logger="services.metadata.mongo_provider"):
        assert getattr(provider, method_name)(*args) == expected_result

    assert message in caplog.text
    assert "secret" not in caplog.text
    assert "[redacted-uri]" in caplog.text
