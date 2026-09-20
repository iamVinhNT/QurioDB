"""
test_dashboard_routes.py

Integration tests for the dashboard stats route, verifying response compatibility
and resilient health reporting during target database outages.
"""

import concurrent.futures
import socket
import threading
import time
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
import pytest

from models import Db


@pytest.fixture(autouse=True)
def patch_dashboard_session(mocker, mock_session):
    mocker.patch("services.dashboard_service.SessionLocal", return_value=mock_session)


def test_dashboard_stats_success_with_reachable_database(client, mock_session):
    """Reachable database returns HTTP 200 with healthy score and status."""
    fake_db = Db(
        id="db-healthy",
        type="sqlite",
        databaseName="main_db",
        config={"database": ":memory:"},
    )
    mock_session.query.return_value.filter.return_value.first.return_value = fake_db

    with patch(
        "services.dashboard_service.database_health_service.get_snapshot",
        return_value={"score": 98, "status": "Healthy"},
    ):
        response = client.get("/api/database/dashboard/stats?db_id=db-healthy")
        assert response.status_code == 200
        data = response.json
        assert "health" in data
        assert data["health"]["score"] == 98
        assert data["health"]["status"] == "Healthy"


def test_dashboard_stats_returns_http_200_during_target_outage(client, mock_session):
    """Criterion 6: Dashboard route returns HTTP 200 with compatible health object during target outage."""
    fake_db = Db(
        id="db-outage",
        type="postgres",
        databaseName="prod_db",
        config={
            "host": "10.255.255.1",
            "port": 5432,
            "user": "prod_user",
            "password": "prod_password_secret",
            "database": "prod_db",
        },
    )
    mock_session.query.return_value.filter.return_value.first.return_value = fake_db

    with patch(
        "services.dashboard_service.database_health_service.get_snapshot",
        return_value={"score": 35, "status": "Unreachable"},
    ):
        response = client.get("/api/database/dashboard/stats?db_id=db-outage")
        assert response.status_code == 200
        data = response.json
        assert "health" in data
        assert data["health"]["score"] == 35
        assert data["health"]["status"] == "Unreachable"
        # Ensure no raw connection secrets leak in response
        resp_text = str(data).lower()
        assert "prod_password_secret" not in resp_text


def test_dashboard_stats_e2e_route_with_unreachable_target(client, mock_session):
    """End-to-end integration: real health service probe failure still returns HTTP 200."""
    fake_db = Db(
        id="db-unreachable-e2e",
        type="postgres",
        databaseName="unreachable_db",
        config={
            "host": "192.0.2.1",
            "port": 5432,
            "user": "outage_user",
            "password": "outage_secret_password",
            "database": "outage_db",
        },
    )
    mock_session.query.return_value.filter.return_value.first.return_value = fake_db

    response = client.get("/api/database/dashboard/stats?db_id=db-unreachable-e2e")
    assert response.status_code == 200
    data = response.json
    assert "health" in data
    assert data["health"]["status"] == "Unreachable"
    assert 0 <= data["health"]["score"] < 50
    assert "outage_secret_password" not in str(data)


def test_dashboard_stats_route_deadline_with_silent_listener(client, mock_session):
    """
    Endpoint-observable verification: GET /api/database/dashboard/stats returns
    HTTP 200 within <= 2.0s against a local silent TCP listener, reporting
    Unreachable with score strictly < 50 and no secret leakage.
    """
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", 0))
    port = srv.getsockname()[1]
    srv.listen(5)
    stop_event = threading.Event()
    conns = []

    def _accept_loop():
        while not stop_event.is_set():
            srv.settimeout(0.2)
            try:
                conn, _ = srv.accept()
                conns.append(conn)
            except socket.timeout:
                continue
            except Exception:
                break

    th = threading.Thread(target=_accept_loop, daemon=True)
    th.start()

    fake_db = Db(
        id="db-silent-listener",
        type="postgres",
        databaseName="silent_db",
        config={
            "host": "127.0.0.1",
            "port": port,
            "user": "silent_user",
            "password": "super_secret_silent_pass_789",
            "database": "silent_db",
        },
    )
    mock_session.query.return_value.filter.return_value.first.return_value = fake_db

    try:
        t0 = time.monotonic()
        response = client.get("/api/database/dashboard/stats?db_id=db-silent-listener")
        elapsed = time.monotonic() - t0

        assert response.status_code == 200
        assert elapsed <= 2.0, f"Endpoint observable elapsed {elapsed}s > 2.0s"

        data = response.json
        assert "health" in data
        assert data["health"]["status"] == "Unreachable"
        assert data["health"]["score"] < 50
        assert "super_secret_silent_pass_789" not in str(data)
    finally:
        stop_event.set()
        try:
            srv.close()
        except Exception:
            pass
        for c in conns:
            try:
                c.close()
            except Exception:
                pass
        th.join(timeout=1.0)


def test_dashboard_stats_deadline_with_slow_analytics_and_reliability(client, mock_session):
    """
    Regression (Blocker C):
    With deliberately slow analytics and/or reliability calls, the dashboard stats route
    stays strictly <= 2.0s and returns a valid compatible health object.
    """
    fake_db = Db(
        id="db-slow-analytics",
        type="sqlite",
        databaseName="test_slow",
        config={"database": ":memory:"},
    )
    mock_session.query.return_value.filter.return_value.first.return_value = fake_db

    def _slow_analytics(*args, **kwargs):
        time.sleep(2.5)
        return [{"time": "12:00", "cpu": 10, "memory": 20, "tps": 100}]

    def _slow_reliability(*args, **kwargs):
        time.sleep(2.5)
        return 30

    with patch("services.analytics_service.analytics_service.get_query_performance_trends", side_effect=_slow_analytics), \
         patch("services.database_health_service.database_health_service._query_reliability_points", side_effect=_slow_reliability):
        t0 = time.monotonic()
        response = client.get("/api/database/dashboard/stats?db_id=db-slow-analytics")
        elapsed = time.monotonic() - t0

    assert response.status_code == 200
    assert elapsed <= 2.0, f"Dashboard route exceeded 2.0s deadline: {elapsed}s"

    data = response.json
    assert "health" in data
    assert "score" in data["health"]
    assert "status" in data["health"]
    assert 0 <= data["health"]["score"] <= 100
    assert data["health"]["status"] in ("Healthy", "Degraded", "Critical", "Unreachable")
    assert "performance" in data
    assert isinstance(data["performance"], list)
    assert "status_counts" in data
    assert isinstance(data["status_counts"], list)


def test_dashboard_analytics_timeout_caps_background_workers():
    """Timed-out analytics calls must not create an unbounded worker backlog."""
    from services.dashboard_service import DashboardService

    service = DashboardService()
    started = 0
    started_lock = threading.Lock()
    release = threading.Event()

    def _blocked_analytics():
        nonlocal started
        with started_lock:
            started += 1
        release.wait(timeout=2.0)
        return [], []

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            futures = [
                executor.submit(service._fetch_analytics_with_timeout, _blocked_analytics, 0.01)
                for _ in range(8)
            ]
            for future in futures:
                with pytest.raises(TimeoutError):
                    future.result()

        assert started <= service.MAX_ANALYTICS_WORKERS
    finally:
        release.set()


def test_dashboard_stats_exhausted_budget_returns_compatible_fallback_not_error(client, mock_session):
    """
    When deadline/budget is exhausted, returns HTTP 200 with safe compatible
    fallback performance, status_counts, and health instead of HTTP 500 error.
    """
    from services.dashboard_service import dashboard_service

    fake_db = Db(
        id="db-exhausted",
        type="sqlite",
        databaseName="test_exhausted",
        config={"database": ":memory:"},
    )
    mock_session.query.return_value.filter.return_value.first.return_value = fake_db

    # Force immediate deadline exhaustion via zero/negative budget
    with patch.object(dashboard_service, "TOTAL_DEADLINE_SECONDS", -1.0):
        response = client.get("/api/database/dashboard/stats?db_id=db-exhausted")

    assert response.status_code == 200
    data = response.json
    assert "error" not in data
    assert "health" in data
    assert data["health"]["status"] == "Unreachable"
    assert data["health"]["score"] < 50
    assert "performance" in data
    assert data["performance"] == []
    assert "status_counts" in data
    assert data["status_counts"] == []



