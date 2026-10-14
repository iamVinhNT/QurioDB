"""
backend/tests/test_execution.py

Tests for query execution logic.
"""

from datetime import datetime, timedelta
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from deps import get_db
from models import Base, Db, QueryHistory, RagChunk, RagSource, SavedQuery
from routes.execution_routes import execution_bp
from services.execution import execution_service
from utils.auth_middleware import get_current_user

def test_execute_select(client, mock_session, mock_engine):
    """Test executing a SELECT query returns formatted results."""
    _, mock_conn = mock_engine
    
    # Mock DB retrieval
    db_mock = MagicMock()
    db_mock.type = "postgres"
    db_mock.config = {}
    mock_session.query.return_value.filter.return_value.first.return_value = db_mock
    
    # Mock execution result
    mock_result = MagicMock()
    mock_result.returns_rows = True
    mock_result.keys.return_value = ["cnt"]
    mock_result.__iter__.return_value = [{"cnt": 42}] # using dict for row simulation if zip is mocked
    
    # Wait, in the service we use zip(cols, row). So row should be list/tuple
    mock_result.__iter__.return_value = [(42,)]
    
    mock_conn.execution_options.return_value.execute.return_value = mock_result
    
    payload = {"databaseId": "1", "sql": "SELECT COUNT(*) as cnt FROM users"}
    response = client.post('/api/database/execute', json=payload)
    
    assert response.status_code == 200
    res = response.json
    assert res['error'] is None
    assert res['columns'] == ["cnt"]
    assert res['data'][0]['cnt'] == 42
    
    # Verify execution history saved
    # We need to spy on mock_session.add(QueryHistory(...))
    # It might be in a separate session instance in the service
    # So we mocking SessionLocal class in conftest is key.

def test_execute_rejects_multiple_sql_statements(client, mock_session, mock_engine):
    """Relational execution rejects a script before it reaches the driver."""
    _, mock_conn = mock_engine
    db_mock = MagicMock()
    db_mock.type = "postgres"
    db_mock.config = {}
    mock_session.query.return_value.filter.return_value.first.return_value = db_mock

    response = client.post("/api/database/execute", json={
        "databaseId": "1", "sql": "SELECT * FROM ab_user; SELECT * FROM ab_group;",
    })

    assert response.status_code == 422
    assert response.json["detail"]["code"] == "sql_execution_blocked"
    mock_conn.execution_options.assert_not_called()


def test_execute_update_requires_one_time_confirmation(client, mock_session, mock_engine):
    """Writes cannot reach the driver before server confirmation is consumed."""
    _, mock_conn = mock_engine
    db_mock = MagicMock()
    db_mock.type = "postgres"
    db_mock.config = {}
    mock_session.query.return_value.filter.return_value.first.return_value = db_mock
    mock_result = MagicMock()
    mock_result.returns_rows = False
    mock_conn.execution_options.return_value.execute.return_value = mock_result

    payload = {"databaseId": "1", "sql": "UPDATE users SET active=true"}
    first = client.post("/api/database/execute", json=payload)

    assert first.status_code == 409
    detail = first.json["detail"]
    assert detail["code"] == "sql_confirmation_required"
    mock_conn.execution_options.assert_not_called()

    confirmed = client.post("/api/database/execute", json={
        **payload, "confirmationToken": detail["confirmationToken"],
    })
    assert confirmed.status_code == 200
    assert confirmed.json["error"] is None

    replay = client.post("/api/database/execute", json={
        **payload, "confirmationToken": detail["confirmationToken"],
    })
    assert replay.status_code == 409

def test_prepare_sql_clamps_existing_read_limit():
    """A caller cannot bypass the server cap with a larger SQL LIMIT."""
    from services.execution.sql_executor import SqlExecutor

    prepared = SqlExecutor(MagicMock())._prepare_sql(
        "SELECT id FROM users LIMIT 5000",
        limit=100,
        dialect="postgresql",
    )

    assert prepared.endswith("LIMIT 100")


def test_explain_plan_returns_graph(client, mock_session, mock_engine):
    """Test EXPLAIN normalizes a PostgreSQL JSON plan into graph nodes."""
    _, mock_conn = mock_engine

    db_mock = MagicMock()
    db_mock.type = "postgres"
    mock_session.query.return_value.filter.return_value.first.return_value = db_mock
    mock_conn.engine.dialect.name = "postgresql"

    mock_result = MagicMock()
    mock_result.returns_rows = True
    mock_result.__iter__.return_value = [([
        {
            "Plan": {
                "Node Type": "Seq Scan",
                "Relation Name": "users",
                "Startup Cost": 0.0,
                "Total Cost": 1200.0,
                "Plan Rows": 10000,
                "Actual Total Time": 75.5,
            }
        }
    ],)]
    mock_conn.execute.return_value = mock_result

    response = client.post("/api/database/explain", json={"databaseId": "1", "sql": "SELECT * FROM users"})

    assert response.status_code == 200
    res = response.json
    assert res["dialect"] == "postgresql"
    assert res["graph"]["nodes"][0]["operation"] == "Seq Scan"
    assert res["graph"]["nodes"][0]["relation"] == "users"
    assert "Full scan" in res["graph"]["nodes"][0]["warnings"]
    assert res["summary"]["warningCount"] == 1


def test_explain_plan_parses_postgres_json_string(client, mock_session, mock_engine):
    """PostgreSQL JSON EXPLAIN may come back as text depending on the driver."""
    _, mock_conn = mock_engine

    db_mock = MagicMock()
    db_mock.type = "postgres"
    mock_session.query.return_value.filter.return_value.first.return_value = db_mock
    mock_conn.engine.dialect.name = "postgresql"

    mock_result = MagicMock()
    mock_result.returns_rows = True
    mock_result.__iter__.return_value = [(
        '[{"Plan":{"Node Type":"Aggregate","Plans":[{"Node Type":"Hash Join","Plans":[{"Node Type":"Seq Scan","Relation Name":"Booking"}]}]}}]',
    )]
    mock_conn.execute.return_value = mock_result

    response = client.post("/api/database/explain", json={"databaseId": "1", "sql": "SELECT 1"})

    assert response.status_code == 200
    res = response.json
    assert res["summary"]["nodeCount"] == 3
    assert res["graph"]["nodes"][0]["operation"] == "Aggregate"
    assert res["graph"]["nodes"][2]["relation"] == "Booking"


@pytest.fixture
def history_api():
    """Exercise the real router and service against isolated in-memory SQLite."""
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    session = Session(engine)
    session.add_all([
        Db(id="primary", type="sqlite", databaseName="Primary", config={}),
        Db(id="other", type="sqlite", databaseName="Other", config={}),
    ])
    session.commit()
    timestamp = datetime(2026, 1, 1, 12, 0, 0)

    def add_history(row_id, sql="SELECT 1", database_id="primary", created_on=timestamp):
        session.add(QueryHistory(
            id=row_id, sql=sql, status="SUCCESS", databaseId=database_id,
            created_on=created_on, executedAt=timestamp,
        ))
        session.commit()

    app = FastAPI()
    app.include_router(execution_bp, prefix="/api/database")
    app.dependency_overrides[get_db] = lambda: session
    app.dependency_overrides[get_current_user] = lambda: {"userId": "test-user-id"}
    with TestClient(app) as client:
        yield client, session, add_history
    session.close()
    engine.dispose()


def test_history_default_is_exact_legacy_array(history_api):
    client, session, add_history = history_api
    for index in range(55):
        add_history(f"h-{index:03}")
    session.execute(update(QueryHistory).where(QueryHistory.id == "h-054").values(executedAt=None))
    session.commit()

    response = client.get("/api/database/history")
    assert response.status_code == 200
    rows = response.json()
    assert isinstance(rows, list)
    assert len(rows) == 50
    assert [row["id"] for row in rows] == [f"h-{index:03}" for index in range(54, 4, -1)]
    assert rows[0] == {
        "id": "h-054", "sql": "SELECT 1", "status": "SUCCESS",
        "executionTime": None, "errorMessage": None, "databaseId": "primary",
        "executedAt": None, "created_on": "2026-01-01T12:00:00",
        "database": {"databaseName": "Primary"},
    }
    session.execute(update(QueryHistory).where(QueryHistory.id == "h-054").values(created_on=None))
    session.commit()
    null_timestamp = client.get("/api/database/history", params={"limit": 200}).json()[-1]
    assert null_timestamp["id"] == "h-054"
    assert null_timestamp["created_on"] is None


def test_history_search_reaches_beyond_latest_50(history_api):
    client, _, add_history = history_api
    for index in range(60):
        add_history(f"h-{index:03}", sql="SELECT Needle" if index < 3 else "SELECT 1")
    add_history("other-match", sql="SELECT Needle", database_id="other")

    response = client.get("/api/database/history", params={
        "databaseId": "primary", "q": "  nEeDlE  ", "limit": 1,
        "offset": 1, "paginated": True,
    })
    assert response.status_code == 200
    page = response.json()
    assert [row["id"] for row in page["items"]] == ["h-001"]
    assert page["hasMore"] is True
    assert page["nextOffset"] == 2
    legacy = client.get("/api/database/history", params={"databaseId": "primary", "q": "needle"}).json()
    assert [row["id"] for row in legacy] == ["h-002", "h-001", "h-000"]


@pytest.mark.parametrize("term", ["%", "_", "\\", "%_\\", "' OR 1=1 --"])
def test_history_search_treats_sql_wildcards_literally(history_api, term):
    client, _, add_history = history_api
    add_history("literal", sql=f"SELECT '{term}'")
    add_history("decoy", sql="SELECT 'anything'")
    response = client.get("/api/database/history", params={"q": term})
    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == ["literal"]


def test_history_search_matches_database_name_or_sql(history_api):
    client, session, add_history = history_api
    session.get(Db, "primary").databaseName = "Sales_100%\\Archive"
    add_history("name-match")
    add_history("sql-match", sql="SELECT 'sALES_100%\\archive'", database_id="other")
    add_history("decoy", database_id="other")

    response = client.get("/api/database/history", params={"q": "  SALES_100%\\ARCHIVE  "})
    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == ["sql-match", "name-match"]
    scoped = client.get("/api/database/history", params={"q": "Sales", "databaseId": "primary"}).json()
    assert [row["id"] for row in scoped] == ["name-match"]
    blank = client.get("/api/database/history", params={"q": " \t "}).json()
    assert len(blank) == 3


def test_history_search_preserves_sqlite_ascii_case_behavior(history_api):
    client, _, add_history = history_api
    add_history("unicode", sql="SELECT 'Ä'")
    assert client.get("/api/database/history", params={"q": "Ä"}).json()[0]["id"] == "unicode"
    response = client.get("/api/database/history", params={"q": "ä", "paginated": True}).json()
    assert response == {"items": [], "hasMore": False, "nextOffset": None}


def test_history_pagination_orders_timestamp_ties(history_api):
    client, _, add_history = history_api
    for index in range(6):
        add_history(f"h-{index}")
    add_history("newest", created_on=datetime(2026, 1, 1, 12) + timedelta(seconds=1))
    pages = []
    for offset in (0, 3, 6, 7):
        response = client.get("/api/database/history", params={"paginated": True, "limit": 3, "offset": offset})
        assert response.status_code == 200
        pages.append(response.json())
    assert [[row["id"] for row in page["items"]] for page in pages] == [
        ["newest", "h-5", "h-4"], ["h-3", "h-2", "h-1"], ["h-0"], [],
    ]
    assert [page["hasMore"] for page in pages] == [True, True, False, False]
    assert [page["nextOffset"] for page in pages] == [3, 6, None, None]
    assert set(pages[0]) == {"items", "hasMore", "nextOffset"}
    exact_page = client.get("/api/database/history", params={"paginated": True, "limit": 7}).json()
    assert exact_page["hasMore"] is False
    assert exact_page["nextOffset"] is None


@pytest.mark.parametrize("params", [
    {"limit": 0}, {"limit": -1}, {"limit": 201}, {"limit": "invalid"}, {"limit": "1.5"},
    {"offset": -1}, {"offset": "invalid"}, {"offset": "1.5"},
])
def test_history_rejects_invalid_paging(history_api, params):
    client, _, _ = history_api
    assert client.get("/api/database/history", params=params).status_code == 422


@pytest.mark.parametrize("limit", [1, 200])
def test_history_accepts_paging_boundaries(history_api, limit):
    client, _, add_history = history_api
    add_history("row")
    response = client.get("/api/database/history", params={"limit": limit, "offset": 0, "paginated": True})
    assert response.status_code == 200
    assert len(response.json()["items"]) == 1


def test_delete_history_is_physical_scoped_and_ignores_search(history_api, mocker):
    client, session, add_history = history_api
    for index in range(60):
        add_history(f"h-{index:03}")
    add_history("other-history", database_id="other")
    session.add(SavedQuery(id="saved", name="Saved", sql="SELECT 1", databaseId="primary"))
    session.add(RagSource(
        id="source", sourceType="query_history", databaseId="primary", title="History", contentHash="source-hash",
    ))
    session.commit()
    session.add(RagChunk(
        id="chunk", sourceId="source", chunkType="query_history", content="SELECT 1", contentHash="chunk-hash",
    ))
    session.commit()
    commit = mocker.spy(session, "commit")

    response = client.delete("/api/database/history", params={
        "databaseId": "primary", "q": "no match", "limit": 1, "offset": 100,
    })
    assert response.status_code == 200
    assert response.json() == {"deletedCount": 60}
    commit.assert_called_once()
    session.expire_all()
    assert [row.id for row in session.query(QueryHistory).all()] == ["other-history"]
    assert session.query(Db).count() == 2
    assert session.get(SavedQuery, "saved") is not None
    assert session.get(RagSource, "source") is not None
    assert session.get(RagChunk, "chunk") is not None
    assert client.get("/api/database/history", params={"databaseId": "primary"}).json() == []
    for database_id in ("primary", "nonexistent"):
        assert client.delete("/api/database/history", params={"databaseId": database_id}).json() == {"deletedCount": 0}


@pytest.mark.parametrize("params", [{}, {"databaseId": ""}, {"databaseId": " \t\n "}])
def test_delete_history_rejects_missing_or_blank_database_id(history_api, params):
    client, session, add_history = history_api
    add_history("preserved")
    response = client.delete("/api/database/history", params=params)
    assert response.status_code == 422
    if params:
        assert response.json()["detail"] == "Database ID must not be empty or whitespace-only."
    assert session.query(QueryHistory).count() == 1


@pytest.mark.parametrize("database_id", [None, "", " \t\n "])
def test_delete_history_service_rejects_unscoped_deletion(history_api, database_id):
    _, session, add_history = history_api
    add_history("preserved")
    with pytest.raises(ValueError, match="Database ID must not be empty or whitespace-only"):
        execution_service.delete_query_history(session, database_id)
    assert session.query(QueryHistory).count() == 1


def test_history_database_failure_returns_error(history_api, mocker):
    client, session, _ = history_api
    mocker.patch.object(session, "query", side_effect=SQLAlchemyError("history unavailable"))
    for params in ({}, {"paginated": True}):
        response = client.get("/api/database/history", params=params)
        assert response.status_code == 500
        assert response.json() == {"detail": "history unavailable"}


def test_delete_history_rolls_back_on_commit_failure(history_api, mocker):
    client, session, add_history = history_api
    add_history("preserved")
    commit = mocker.patch.object(session, "commit", side_effect=SQLAlchemyError("commit failed"))
    rollback = mocker.spy(session, "rollback")
    response = client.delete("/api/database/history", params={"databaseId": "primary"})
    assert response.status_code == 500
    assert response.json() == {"detail": "commit failed"}
    commit.assert_called_once()
    rollback.assert_called_once()
    assert session.query(QueryHistory).one().id == "preserved"


@pytest.mark.parametrize("method", ["get", "delete"])
def test_history_routes_require_authentication(history_api, monkeypatch, method):
    client, session, add_history = history_api
    add_history("preserved")
    client.app.dependency_overrides.pop(get_current_user)
    monkeypatch.setattr("utils.auth_middleware.DISABLE_AUTH", False)
    response = getattr(client, method)("/api/database/history", params={"databaseId": "primary"})
    assert response.status_code == 401
    assert session.query(QueryHistory).count() == 1
