"""
test_mongodb_integration.py

Opt-in real MongoDB coverage for the public read-only execution boundary.
"""

import os
import uuid
from unittest.mock import MagicMock

import pytest
from pymongo import MongoClient

from services.execution import ExecutionService


def test_public_mongodb_execution_reads_with_limit_and_rejects_writes(monkeypatch):
    uri = os.getenv("QURIODB_TEST_MONGODB_URI")
    if not uri:
        pytest.skip("UNVERIFIED: QURIODB_TEST_MONGODB_URI is not set")

    client = MongoClient(uri, serverSelectionTimeoutMS=5000)
    database_name = f"quriodb_cycle3_{uuid.uuid4().hex}"
    collection_name = f"orders_{uuid.uuid4().hex}"

    try:
        client.admin.command("ping")
        collection = client[database_name][collection_name]
        collection.insert_many(
            [
                {"status": "paid", "amount": 10},
                {"status": "pending", "amount": 20},
            ]
        )

        service = ExecutionService()
        service.get_db_config = MagicMock(
            return_value=("mongodb", {"database": database_name})
        )
        service.get_mongo_client = MagicMock(return_value=(client, database_name))
        service._save_history = MagicMock()
        monkeypatch.setattr(
            "services.execution.mongo_executor.SessionLocal",
            lambda: MagicMock(),
        )

        from services.metadata import metadata_service

        monkeypatch.setattr(
            metadata_service,
            "get_db_config",
            lambda *_args, **_kwargs: ("mongodb", {"database": database_name}),
        )
        monkeypatch.setattr(
            metadata_service.mongo_provider.service,
            "get_mongo_client",
            lambda *_args, **_kwargs: (client, database_name),
        )

        result = service.execute_query(
            "db1",
            f'db.getCollection("{collection_name}").find({{}})',
            MagicMock(),
            limit=1,
        )

        assert len(result["data"]) == 1
        assert result["columns"] == ["_id", "amount", "status"]

        collection.insert_one(
            {
                "status": "nested",
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
        )
        nested_result = service.execute_query(
            "db1",
            f'db.getCollection("{collection_name}").find({{"status":"nested"}})',
            MagicMock(),
            limit=1,
        )

        assert nested_result["data"] == [
            {
                "_id": nested_result["data"][0]["_id"],
                "profile": {
                    "displayName": "Ada",
                    "preferences": {"theme": "dark"},
                },
                "sessions": [
                    {"device": "laptop"},
                    {"device": "phone", "region": "EU"},
                ],
                "status": "nested",
            }
        ]
        assert "nested-secret" not in str(nested_result)
        assert "nested-token" not in str(nested_result)
        assert "nested-refresh-token" not in str(nested_result)

        with pytest.raises(ValueError, match="read-only"):
            service.execute_query(
                "db1",
                f'db.getCollection("{collection_name}").insertOne({{"status":"paid"}})',
                MagicMock(),
            )
    finally:
        client.drop_database(database_name)
        client.close()
