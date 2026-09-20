"""
test_database_health_service.py

Unit tests for target database probing, query reliability calculation,
host headroom measurement, and dashboard health score/status mapping.
"""

import concurrent.futures
import datetime
import multiprocessing as mp
import pickle
import socket
import threading
import time
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from models.base import Base
from models import Db, QueryHistory
from services.database_health_service import DatabaseHealthService, InFlightReliability, ProbePayload, _spawn_probe_worker


@pytest.fixture
def health_service():
    return DatabaseHealthService()


@pytest.fixture
def sample_db_config():
    return SimpleNamespace(
        id="test-db-1",
        type="sqlite",
        databaseName="test_db",
        config={"database": ":memory:"},
    )


@pytest.fixture
def mock_session(mocker):
    mock_session_cls = mocker.patch("services.database_health_service.SessionLocal")
    mock_session_inst = MagicMock()
    mock_session_cls.return_value = mock_session_inst
    return mock_session_inst


@pytest.fixture
def real_metadata_session(tmp_path, monkeypatch):
    """Isolated real metadata SQLite fixture for persistence and query proof."""
    db_path = tmp_path / "test_metadata.db"
    engine = create_engine(f"sqlite:///{db_path}")
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine)
    monkeypatch.setattr("services.database_health_service.SessionLocal", TestingSession)
    session = TestingSession()
    yield session
    session.close()
    engine.dispose()


@pytest.fixture
def silent_tcp_server():
    """Local TCP listener that accepts connections and never sends a response."""
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", 0))
    port = srv.getsockname()[1]
    srv.listen(10)
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
    yield ("127.0.0.1", port)

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


class TestTargetProbe:
    def test_spawn_worker_emits_started_marker_before_probe_result(self):
        """Spawn protocol exposes worker start before target probe completion."""
        class RecordingConnection:
            def __init__(self):
                self.messages = []

            def send(self, message):
                self.messages.append(message)

            def close(self):
                pass

        conn = RecordingConnection()
        payload = ProbePayload(
            database_id="protocol-db",
            database_type="sqlite",
            connection_fields={"database": ":memory:"},
        )
        _spawn_probe_worker(payload, conn)

        assert conn.messages[0] == ("started",)
        assert conn.messages[-1][0] == "result"

    def test_probe_timeout_configuration(self, health_service):
        """Probe must enforce a timeout <= 2 seconds."""
        assert hasattr(health_service, "PROBE_TIMEOUT_SECONDS")
        assert health_service.PROBE_TIMEOUT_SECONDS <= 2

    def test_real_sqlite_probe_succeeds(self, health_service, sample_db_config):
        """Real SQLite :memory: database probe executes SELECT 1 successfully."""
        reachable = health_service._probe_target(sample_db_config)
        assert reachable is True

    def test_memory_sqlite_probe_keeps_uri_out_of_timeout_configuration(self, health_service):
        """In-memory SQLite must remain spawn-isolated instead of becoming a URI database."""
        configured = health_service._configure_probe_timeout(
            "sqlite", {"database": ":memory:"}
        )

        assert configured.get("uri") is None
        assert configured.get("useUri") is None

    def test_probe_failure_returns_false_and_no_secrets(self, health_service):
        """Probe failure safely returns False without raising or exposing secrets."""
        bad_config = SimpleNamespace(
            id="bad-db",
            type="postgres",
            databaseName="production",
            config={
                "host": "192.0.2.1",  # Non-routable TEST-NET-1 IP
                "port": 5432,
                "user": "secret_user",
                "password": "super_secret_password_123",
                "database": "sensitive_db",
            },
        )
        with patch.object(health_service, "_execute_db_probe", side_effect=Exception("Driver connection failed to secret_user:super_secret_password_123@192.0.2.1")):
            reachable = health_service._probe_target(bad_config)
            assert reachable is False

    def test_hung_probe_saturation_eight_operations_past_deadline_allows_healthy_sqlite(
        self, health_service, sample_db_config
    ):
        """
        Regression (Blocker B): Hold 8 probe operations past deadline.
        Proves independent healthy SQLite probe succeeds within 2 seconds without
        capacity starvation or falsely returning Unreachable.
        """
        def _hung_probe(*args, **kwargs):
            time.sleep(5.0)
            return True

        # Run 8 hung probes simultaneously that sleep past the probe deadline
        with patch.object(health_service, "_execute_db_probe", side_effect=_hung_probe):
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
                futures = [
                    ex.submit(health_service._probe_target, sample_db_config)
                    for _ in range(8)
                ]
                results = [f.result() for f in futures]
                assert all(r is False for r in results)

        # Immediately after 8 hung probes exceed deadline, independent healthy SQLite probe must succeed in <= 2.0s
        t0 = time.monotonic()
        reachable = health_service._probe_target(sample_db_config)
        elapsed = time.monotonic() - t0

        assert reachable is True
        assert elapsed <= 2.0, f"Healthy SQLite probe took {elapsed}s > 2.0s after saturation"

    def test_failing_probe_log_capture_does_not_emit_secrets_or_raw_driver_text(
        self, health_service, caplog
    ):
        """
        Regression (Blocker D): Real failing probe with secret credentials in config/driver
        asserts neither password, URI, nor raw driver exception text appears in logs.
        """
        import logging

        secret_password = "very_secret_health_password_xyz987"
        secret_host = "192.0.2.55"
        bad_config = SimpleNamespace(
            id="failing-leak-test-db",
            type="postgres",
            databaseName="confidential_db",
            config={
                "host": secret_host,
                "port": 5432,
                "user": "db_admin_user",
                "password": secret_password,
                "database": "confidential_db",
            },
        )

        with caplog.at_level(logging.DEBUG):
            snapshot = health_service.get_snapshot(bad_config)

        assert snapshot["status"] == "Unreachable"
        assert snapshot["score"] < 50

        # Neither password, host IP, URI, nor raw driver exception string may leak into logs
        assert secret_password not in caplog.text
        assert secret_host not in caplog.text
        assert "password" not in caplog.text.lower()
        assert "confidential_db" not in caplog.text
        assert "FATAL" not in caplog.text

        # Secondary check: driver exception containing password in error text must be suppressed
        caplog.clear()
        with patch.object(
            health_service,
            "_execute_db_probe",
            side_effect=Exception(f"Driver connection failed: password={secret_password} at {secret_host}")
        ):
            with caplog.at_level(logging.DEBUG):
                snapshot2 = health_service.get_snapshot(bad_config)
            assert snapshot2["status"] == "Unreachable"
            assert secret_password not in caplog.text
            assert secret_host not in caplog.text

    def test_connector_aliases_normalize_before_probe_creation(self, health_service):
        """
        Regression (Blocker E): Connector aliases postgresql/postgres, mariadb/mysql,
        and sqlserver/mssql normalize to canonical dialects before probe/engine creation
        and do not immediately fail as unsupported dialects.
        """
        probed_types = []

        def _recording_run(db_type, probe_config, timeout):
            probed_types.append(db_type)
            return True

        assert health_service.normalize_db_type("postgresql") == "postgres"
        assert health_service.normalize_db_type("postgres") == "postgres"
        assert health_service.normalize_db_type("mariadb") == "mysql"
        assert health_service.normalize_db_type("mysql") == "mysql"
        assert health_service.normalize_db_type("sqlserver") == "mssql"
        assert health_service.normalize_db_type("mssql") == "mssql"

        with patch.object(health_service, "_run_isolated_probe", side_effect=_recording_run):
            # 1. postgresql vs postgres
            cfg_postgresql = SimpleNamespace(
                id="pg-1", type="postgresql", config={"host": "127.0.0.1", "port": 5432}
            )
            cfg_postgres = SimpleNamespace(
                id="pg-2", type="postgres", config={"host": "127.0.0.1", "port": 5432}
            )
            assert health_service._probe_target(cfg_postgresql) is True
            assert health_service._probe_target(cfg_postgres) is True
            assert probed_types[-2:] == ["postgres", "postgres"]

            # 2. mariadb vs mysql
            cfg_mariadb = SimpleNamespace(
                id="maria-1", type="mariadb", config={"host": "127.0.0.1", "port": 3306}
            )
            cfg_mysql = SimpleNamespace(
                id="mysql-1", type="mysql", config={"host": "127.0.0.1", "port": 3306}
            )
            assert health_service._probe_target(cfg_mariadb) is True
            assert health_service._probe_target(cfg_mysql) is True
            assert probed_types[-2:] == ["mysql", "mysql"]

            # 3. sqlserver vs mssql
            cfg_sqlserver = SimpleNamespace(
                id="mssql-1", type="sqlserver", config={"host": "127.0.0.1", "port": 1433}
            )
            cfg_mssql = SimpleNamespace(
                id="mssql-2", type="mssql", config={"host": "127.0.0.1", "port": 1433}
            )
            assert health_service._probe_target(cfg_sqlserver) is True
            assert health_service._probe_target(cfg_mssql) is True
            assert probed_types[-2:] == ["mssql", "mssql"]

    def test_probe_timeout_returns_false(self, health_service, sample_db_config):
        """Probe execution exceeding timeout returns False safely."""
        import concurrent.futures

        with patch.object(
            health_service,
            "_execute_db_probe",
            side_effect=concurrent.futures.TimeoutError("Probe timed out"),
        ):
            reachable = health_service._probe_target(sample_db_config)
            assert reachable is False

    def test_blocking_hung_probe_returns_within_deadline(self, health_service, sample_db_config):
        """Real hung probe (not immediate TimeoutError injection) returns False within <= 2.0s."""
        def _hung_probe(*args, **kwargs):
            time.sleep(5.0)
            return True

        with patch.object(health_service, "_execute_db_probe", side_effect=_hung_probe):
            t0 = time.monotonic()
            reachable = health_service._probe_target(sample_db_config)
            elapsed = time.monotonic() - t0

            assert reachable is False
            assert elapsed <= 2.0, f"Hung probe waited too long: {elapsed}s"

    def test_spawn_worker_timeout_returns_degraded_not_unreachable(
        self, health_service, sample_db_config
    ):
        """A child that exceeds its join deadline is local overload, not target failure."""
        def timed_out_worker(*args, **kwargs):
            kwargs["in_flight"].worker_start_timed_out = True
            return False

        with patch.object(health_service, "_run_isolated_probe", side_effect=timed_out_worker):
            snapshot = health_service.get_snapshot(sample_db_config, deadline=time.monotonic() + 1.0)

        assert snapshot["status"] == "Degraded"
        assert 50 <= snapshot["score"] <= 89

    def test_silent_tcp_listener_deadline_and_score_below_50_with_max_components(
        self, health_service, silent_tcp_server, caplog
    ):
        """
        Regression: Local TCP listener that accepts then never responds returns
        endpoint-observable snapshot in <= 2.0s, redact secrets, and scores < 50
        even when all other components (reliability=30, headroom=20) are at maximum.
        """
        host, port = silent_tcp_server
        silent_cfg = SimpleNamespace(
            id="silent-target-db",
            type="postgres",
            databaseName="silent_db",
            config={
                "host": host,
                "port": port,
                "user": "super_secret_user",
                "password": "super_secret_password_456",
                "database": "silent_db",
            },
        )

        with patch.object(health_service, "_query_reliability_points", return_value=30), \
             patch.object(health_service, "_host_headroom_points", return_value=20):
            t0 = time.monotonic()
            snapshot = health_service.get_snapshot(silent_cfg)
            elapsed = time.monotonic() - t0

        # Deadline verification
        assert elapsed <= 2.0, f"Endpoint-observable result took {elapsed}s > 2.0s"
        # Score and status verification
        assert snapshot["status"] == "Unreachable"
        assert snapshot["score"] < 50, f"Unreachable score must be strictly < 50, got {snapshot['score']}"
        assert 0 <= snapshot["score"] <= 49

        # Redaction verification: neither snapshot nor logs contain raw secret/password
        assert "super_secret_password_456" not in str(snapshot)
        assert "super_secret_password_456" not in caplog.text



class TestQueryReliability:
    def test_reliability_timeout_caps_background_workers(self, health_service):
        """Timed-out reliability calls must not create an unbounded worker backlog."""
        started = 0
        started_lock = threading.Lock()
        release = threading.Event()

        def _blocked_reliability(*args, **kwargs):
            nonlocal started
            with started_lock:
                started += 1
            release.wait(timeout=2.0)
            return 30

        with patch.object(health_service, "_query_reliability_points", side_effect=_blocked_reliability):
            try:
                with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
                    futures = [
                        executor.submit(
                            health_service._query_reliability_with_timeout,
                            f"db-{index}",
                            time.monotonic() + 1.0,
                            0.01,
                        )
                        for index in range(8)
                    ]
                    assert all(future.result() == 30 for future in futures)

                assert started <= health_service.MAX_RELIABILITY_WORKERS
            finally:
                release.set()

    def test_reliability_admission_does_not_hold_lock_while_slots_are_busy(self, health_service):
        """Busy reliability workers must not block their completion path on the coordination lock."""
        db_ids = [f"existing-db-{index}" for index in range(health_service.MAX_RELIABILITY_WORKERS)]
        for db_id in db_ids:
            assert health_service._reliability_slots.acquire(blocking=False)
            with health_service._reliability_lock:
                health_service._in_flight_reliability[db_id] = InFlightReliability()

        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(
                    health_service._query_reliability_with_timeout,
                    "new-db",
                    time.monotonic() + 0.05,
                    0.05,
                )
                assert future.result(timeout=0.2) == 30

            for db_id in db_ids:
                with health_service._reliability_lock:
                    reliability = health_service._in_flight_reliability.pop(db_id)
                reliability.done_event.set()
                health_service._reliability_slots.release()

            assert health_service._reliability_slots.acquire(blocking=False)
            health_service._reliability_slots.release()
        finally:
            health_service._in_flight_reliability.clear()

    def test_empty_history_yields_neutral_30_points(self, health_service, mock_session):
        """No query history records yield the neutral 30 points."""
        mock_session.query.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = []

        points = health_service._query_reliability_points("empty-db")
        assert points == 30

    def test_all_successful_history_yields_30_points(self, health_service, mock_session):
        """100% SUCCESS history yields 30 points."""
        mock_session.query.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = [
            SimpleNamespace(status="SUCCESS") for _ in range(20)
        ]

        points = health_service._query_reliability_points("good-db")
        assert points == 30

    def test_all_failed_history_yields_0_points(self, health_service, mock_session):
        """100% FAILED history yields 0 points."""
        mock_session.query.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = [
            SimpleNamespace(status="FAILED") for _ in range(10)
        ]

        points = health_service._query_reliability_points("failed-db")
        assert points == 0

    def test_mixed_history_calculates_ratio(self, health_service, mock_session):
        """Mixed SUCCESS and FAILED calculates correct rounded ratio."""
        # 15 SUCCESS, 5 FAILED -> 15/20 = 75% -> round(30 * 0.75) = 23 (or 22.5 -> 22/23)
        mock_session.query.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = (
            [SimpleNamespace(status="SUCCESS") for _ in range(15)]
            + [SimpleNamespace(status="FAILED") for _ in range(5)]
        )

        points = health_service._query_reliability_points("mixed-db")
        assert points in (22, 23)

    def test_unknown_statuses_excluded_from_denominator(self, health_service, mock_session):
        """Statuses other than SUCCESS and FAILED are ignored."""
        # 10 SUCCESS, 0 FAILED, 10 CANCELLED -> recognized=10, successes=10 -> 30 points
        mock_session.query.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = (
            [SimpleNamespace(status="SUCCESS") for _ in range(10)]
            + [SimpleNamespace(status="CANCELLED") for _ in range(10)]
            + [SimpleNamespace(status="PENDING") for _ in range(5)]
        )

        points = health_service._query_reliability_points("cancelled-db")
        assert points == 30

    def test_only_unknown_statuses_yields_neutral_30_points(self, health_service, mock_session):
        """If only unknown statuses exist, recognized count is 0, yielding neutral 30 points."""
        mock_session.query.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = [
            SimpleNamespace(status="UNKNOWN"),
            SimpleNamespace(status=None),
        ]

        points = health_service._query_reliability_points("unknown-db")
        assert points == 30

    def test_query_history_filters_by_database_id_and_limits_50(self, health_service, mock_session):
        """Query history must filter by QueryHistory.databaseId and limit to 50."""
        mock_query = mock_session.query.return_value
        mock_filter = mock_query.filter.return_value
        mock_order = mock_filter.order_by.return_value
        mock_limit = mock_order.limit.return_value
        mock_limit.all.return_value = [SimpleNamespace(status="SUCCESS")]

        health_service._query_reliability_points("target-db-id")

        mock_session.query.assert_called_with(QueryHistory)
        # Check filter call was made
        assert mock_query.filter.called
        # Check limit(50) was called
        mock_order.limit.assert_called_with(50)

    def test_real_metadata_sqlite_history_isolation_and_limit(
        self, health_service, real_metadata_session
    ):
        """
        Real metadata SQLite proof:
        - Persist histories for at least two database IDs with distinct timestamps
        - More than 50 target records spanning SUCCESS/FAILED and ignored statuses
        - Assert only target DB's newest 50 recognized records impact points
        - Unknown statuses excluded from denominator
        - Database isolation: second database's failures do not affect target DB
        """
        now = datetime.datetime.utcnow()

        # Target DB and Other DB records
        target_db = Db(id="db-target", type="sqlite", databaseName="target", config={})
        other_db = Db(id="db-other", type="postgres", databaseName="other", config={})
        real_metadata_session.add_all([target_db, other_db])
        real_metadata_session.commit()

        # Add 30 FAILED records for other_db to prove DB isolation
        other_records = [
            QueryHistory(
                id=f"other-{i}",
                sql="SELECT * FROM other",
                status="FAILED",
                databaseId="db-other",
                executedAt=now - datetime.timedelta(seconds=i),
            )
            for i in range(30)
        ]
        real_metadata_session.add_all(other_records)

        # For target DB, construct:
        # 1) Newest 50 physical records: 32 SUCCESS, 10 ignored, 8 FAILED
        #    (32/40 recognized = 80% -> round(30 * 0.8) = 24 points)
        # 2) 15 older records: all FAILED (if limit 50 fails, score drops)
        # 3) Ignored records (CANCELLED, PENDING, UNKNOWN, etc.) excluded from denominator
        target_records = []

        # 32 SUCCESS (minutes 1..32)
        for i in range(32):
            target_records.append(
                QueryHistory(
                    id=f"target-success-{i}",
                    sql=f"SELECT {i}",
                    status="SUCCESS",
                    databaseId="db-target",
                    executedAt=now - datetime.timedelta(minutes=i + 1),
                )
            )

        # 10 ignored status records (minutes 33..42)
        ignored_statuses = ["CANCELLED", "PENDING", "UNKNOWN", "ERROR", "UNKNOWN_STATUS"]
        for i, st in enumerate(ignored_statuses * 2):
            target_records.append(
                QueryHistory(
                    id=f"target-ignored-{i}",
                    sql=f"SELECT ignored {i}",
                    status=st,
                    databaseId="db-target",
                    executedAt=now - datetime.timedelta(minutes=i + 33),
                )
            )

        # 8 FAILED (minutes 43..50)
        for i in range(8):
            target_records.append(
                QueryHistory(
                    id=f"target-failed-{i}",
                    sql=f"SELECT error {i}",
                    status="FAILED",
                    databaseId="db-target",
                    executedAt=now - datetime.timedelta(minutes=i + 43),
                )
            )

        # 15 older records (> 50 recognized records ago, e.g. 2 days ago): all FAILED
        for i in range(15):
            target_records.append(
                QueryHistory(
                    id=f"target-old-failed-{i}",
                    sql=f"SELECT old error {i}",
                    status="FAILED",
                    databaseId="db-target",
                    executedAt=now - datetime.timedelta(days=2, minutes=i),
                )
            )

        real_metadata_session.add_all(target_records)
        real_metadata_session.commit()

        # Evaluate target DB query reliability
        points = health_service._query_reliability_points("db-target")
        assert points == 24, f"Expected 24 points (40/50 recognized), got {points}"

        # Evaluate other DB query reliability (all FAILED)
        other_points = health_service._query_reliability_points("db-other")
        assert other_points == 0, f"Expected 0 points for other DB, got {other_points}"

    def test_real_metadata_sqlite_empty_and_ignored_history_neutral_30(
        self, health_service, real_metadata_session
    ):
        """Empty or ignored-only target history in real SQLite returns neutral 30 points."""
        empty_db = Db(id="db-empty", type="sqlite", databaseName="empty", config={})
        ignored_db = Db(id="db-ignored", type="sqlite", databaseName="ignored", config={})
        real_metadata_session.add_all([empty_db, ignored_db])
        real_metadata_session.commit()

        now = datetime.datetime.utcnow()
        ignored_records = [
            QueryHistory(
                id=f"ign-{i}",
                sql="SELECT 1",
                status=st,
                databaseId="db-ignored",
                executedAt=now - datetime.timedelta(minutes=i),
            )
            for i, st in enumerate(["CANCELLED", "PENDING", "UNKNOWN", "ABORTED"])
        ]
        real_metadata_session.add_all(ignored_records)
        real_metadata_session.commit()

        assert health_service._query_reliability_points("db-empty") == 30
        assert health_service._query_reliability_points("db-ignored") == 30

    def test_real_metadata_sqlite_latest_50_physical_window_regression(
        self, health_service, real_metadata_session
    ):
        """
        Regression (Blocker A):
        For a db_id, query/order/limit the newest 50 physical QueryHistory rows first,
        then ignore all statuses except SUCCESS/FAILED for denominator.
        Older recognized failures must not displace CANCELLED/PENDING/unknown rows inside
        the newest physical window.
        Setup:
          - Target DB: newest 40 SUCCESS + 10 CANCELLED, then older FAILED.
            Must yield 30 reliability points (40 SUCCESS / 40 recognized).
          - Cross-DB: second DB with FAILED history has 0 points and doesn't affect target DB.
          - Ignored-only DB: third DB with only CANCELLED/PENDING yields neutral 30 points.
        """
        now = datetime.datetime.utcnow()

        db_target = Db(id="db-target-phys", type="sqlite", databaseName="target_phys", config={})
        db_cross = Db(id="db-cross", type="postgres", databaseName="cross", config={})
        db_ignored = Db(id="db-ignored-only", type="sqlite", databaseName="ignored_only", config={})
        real_metadata_session.add_all([db_target, db_cross, db_ignored])
        real_metadata_session.commit()

        # Cross-db: 20 FAILED records for db-cross
        cross_records = [
            QueryHistory(
                id=f"cross-{i}",
                sql="SELECT * FROM cross_db",
                status="FAILED",
                databaseId="db-cross",
                executedAt=now - datetime.timedelta(seconds=i),
            )
            for i in range(20)
        ]
        real_metadata_session.add_all(cross_records)

        # Ignored-only db: 10 CANCELLED/PENDING records
        ignored_records = [
            QueryHistory(
                id=f"ign-only-{i}",
                sql=f"SELECT ignored {i}",
                status="CANCELLED" if i % 2 == 0 else "PENDING",
                databaseId="db-ignored-only",
                executedAt=now - datetime.timedelta(minutes=i),
            )
            for i in range(10)
        ]
        real_metadata_session.add_all(ignored_records)

        # Target DB:
        # 1. Newest 40 rows: SUCCESS (minutes 1..40)
        # 2. Next 10 rows: CANCELLED (minutes 41..50) -> completes newest 50 physical window!
        # 3. Older 20 rows: FAILED (minutes 51..70) -> outside newest 50 physical window!
        target_records = []
        for i in range(40):
            target_records.append(
                QueryHistory(
                    id=f"target-success-{i}",
                    sql=f"SELECT {i}",
                    status="SUCCESS",
                    databaseId="db-target-phys",
                    executedAt=now - datetime.timedelta(minutes=i + 1),
                )
            )
        for i in range(10):
            target_records.append(
                QueryHistory(
                    id=f"target-cancelled-{i}",
                    sql=f"SELECT cancelled {i}",
                    status="CANCELLED",
                    databaseId="db-target-phys",
                    executedAt=now - datetime.timedelta(minutes=41 + i),
                )
            )
        for i in range(20):
            target_records.append(
                QueryHistory(
                    id=f"target-old-failed-{i}",
                    sql=f"SELECT old failed {i}",
                    status="FAILED",
                    databaseId="db-target-phys",
                    executedAt=now - datetime.timedelta(minutes=60 + i),
                )
            )
        real_metadata_session.add_all(target_records)
        real_metadata_session.commit()

        # Target DB evaluation:
        # Physical 50 window = 40 SUCCESS + 10 CANCELLED.
        # Recognized inside window = 40 SUCCESS.
        # Older FAILED must NOT displace the 10 CANCELLED rows.
        # Score must be 30 * (40/40) = 30 points!
        target_pts = health_service._query_reliability_points("db-target-phys")
        assert target_pts == 30, f"Expected 30 points for latest 50 physical window, got {target_pts}"

        # Cross DB evaluation:
        assert health_service._query_reliability_points("db-cross") == 0

        # Ignored-only DB evaluation:
        assert health_service._query_reliability_points("db-ignored-only") == 30


class TestHostHeadroom:
    @patch("services.database_health_service.psutil.disk_usage")
    @patch("services.database_health_service.psutil.virtual_memory")
    @patch("services.database_health_service.psutil.cpu_percent")
    def test_ample_headroom_yields_full_20_points(
        self, cpu_mock, mem_mock, disk_mock, health_service
    ):
        cpu_mock.return_value = 15.0
        mem_mock.return_value = SimpleNamespace(percent=25.0)
        disk_mock.return_value = SimpleNamespace(percent=30.0)

        points = health_service._host_headroom_points()
        assert points == 20

    @patch("services.database_health_service.psutil.disk_usage")
    @patch("services.database_health_service.psutil.virtual_memory")
    @patch("services.database_health_service.psutil.cpu_percent")
    def test_exhausted_headroom_yields_0_points(
        self, cpu_mock, mem_mock, disk_mock, health_service
    ):
        cpu_mock.return_value = 99.0
        mem_mock.return_value = SimpleNamespace(percent=98.0)
        disk_mock.return_value = SimpleNamespace(percent=97.0)

        points = health_service._host_headroom_points()
        assert points == 0

    @patch("services.database_health_service.psutil.disk_usage")
    @patch("services.database_health_service.psutil.virtual_memory")
    @patch("services.database_health_service.psutil.cpu_percent")
    def test_partial_headroom_bounds(
        self, cpu_mock, mem_mock, disk_mock, health_service
    ):
        cpu_mock.return_value = 75.0
        mem_mock.return_value = SimpleNamespace(percent=75.0)
        disk_mock.return_value = SimpleNamespace(percent=75.0)

        points = health_service._host_headroom_points()
        assert 0 <= points <= 20

    @patch("services.database_health_service.psutil.disk_usage")
    @patch("services.database_health_service.psutil.virtual_memory")
    @patch("services.database_health_service.psutil.cpu_percent")
    def test_psutil_exception_does_not_raise(
        self, cpu_mock, mem_mock, disk_mock, health_service
    ):
        cpu_mock.side_effect = Exception("CPU access error")
        mem_mock.side_effect = Exception("Mem access error")
        disk_mock.side_effect = Exception("Disk access error")

        # Must not raise and must not return 0 unless headroom is actually exhausted
        points = health_service._host_headroom_points()
        assert points > 0

    @pytest.mark.parametrize(
        "cpu,mem,disk,expected",
        [
            # CPU boundaries (mem=10, disk=10 -> mem=7, disk=6 -> +13)
            (50.0, 10.0, 10.0, 7 + 7 + 6),
            (50.1, 10.0, 10.0, 5 + 7 + 6),
            (70.0, 10.0, 10.0, 5 + 7 + 6),
            (70.1, 10.0, 10.0, 3 + 7 + 6),
            (85.0, 10.0, 10.0, 3 + 7 + 6),
            (85.1, 10.0, 10.0, 1 + 7 + 6),
            (94.9, 10.0, 10.0, 1 + 7 + 6),
            (95.0, 10.0, 10.0, 0 + 7 + 6),
            # Mem boundaries (cpu=10, disk=10 -> cpu=7, disk=6 -> +13)
            (10.0, 50.0, 10.0, 7 + 7 + 6),
            (10.0, 50.1, 10.0, 7 + 5 + 6),
            (10.0, 70.0, 10.0, 7 + 5 + 6),
            (10.0, 70.1, 10.0, 7 + 3 + 6),
            (10.0, 85.0, 10.0, 7 + 3 + 6),
            (10.0, 85.1, 10.0, 7 + 1 + 6),
            (10.0, 94.9, 10.0, 7 + 1 + 6),
            (10.0, 95.0, 10.0, 7 + 0 + 6),
            # Disk boundaries (cpu=10, mem=10 -> cpu=7, mem=7 -> +14)
            (10.0, 10.0, 60.0, 7 + 7 + 6),
            (10.0, 10.0, 60.1, 7 + 7 + 4),
            (10.0, 10.0, 80.0, 7 + 7 + 4),
            (10.0, 10.0, 80.1, 7 + 7 + 2),
            (10.0, 10.0, 90.0, 7 + 7 + 2),
            (10.0, 10.0, 90.1, 7 + 7 + 1),
            (10.0, 10.0, 94.9, 7 + 7 + 1),
            (10.0, 10.0, 95.0, 7 + 7 + 0),
        ],
    )
    def test_host_headroom_threshold_edges(
        self, health_service, cpu, mem, disk, expected
    ):
        with patch("services.database_health_service.psutil.cpu_percent", return_value=cpu), \
             patch("services.database_health_service.psutil.virtual_memory", return_value=SimpleNamespace(percent=mem)), \
             patch("services.database_health_service.psutil.disk_usage", return_value=SimpleNamespace(percent=disk)):
            pts = health_service._host_headroom_points()
            assert pts == min(20, expected)

    def test_host_headroom_clamped_between_0_and_20(self, health_service):
        """Host headroom cannot exceed 20 or drop below 0."""
        with patch("services.database_health_service.psutil.cpu_percent", return_value=0.0), \
             patch("services.database_health_service.psutil.virtual_memory", return_value=SimpleNamespace(percent=0.0)), \
             patch("services.database_health_service.psutil.disk_usage", return_value=SimpleNamespace(percent=0.0)):
            pts = health_service._host_headroom_points()
            assert pts == 20

        with patch("services.database_health_service.psutil.cpu_percent", return_value=100.0), \
             patch("services.database_health_service.psutil.virtual_memory", return_value=SimpleNamespace(percent=100.0)), \
             patch("services.database_health_service.psutil.disk_usage", return_value=SimpleNamespace(percent=100.0)):
            pts = health_service._host_headroom_points()
            assert pts == 0


class TestScoreClamping:
    def test_unreachable_score_strictly_less_than_50_with_max_components(
        self, health_service, sample_db_config
    ):
        """Every unreachable target must score strictly < 50, even with max reliability (30) and headroom (20)."""
        with patch.object(health_service, "_probe_target", return_value=False), \
             patch.object(health_service, "_query_reliability_points", return_value=30), \
             patch.object(health_service, "_host_headroom_points", return_value=20):
            snapshot = health_service.get_snapshot(sample_db_config)
            assert snapshot["score"] < 50
            assert snapshot["score"] == 49
            assert snapshot["status"] == "Unreachable"

    def test_reachable_score_clamped_to_100(self, health_service, sample_db_config):
        """Reachable target with max points must clamp to 100."""
        with patch.object(health_service, "_probe_target", return_value=True), \
             patch.object(health_service, "_query_reliability_points", return_value=30), \
             patch.object(health_service, "_host_headroom_points", return_value=20):
            snapshot = health_service.get_snapshot(sample_db_config)
            assert snapshot["score"] == 100
            assert snapshot["status"] == "Healthy"

    def test_score_never_exceeds_100_or_negative(self, health_service, sample_db_config):
        """Score must always be within [0, 100]."""
        with patch.object(health_service, "_probe_target", return_value=True), \
             patch.object(health_service, "_query_reliability_points", return_value=50), \
             patch.object(health_service, "_host_headroom_points", return_value=30):
            snapshot = health_service.get_snapshot(sample_db_config)
            assert 0 <= snapshot["score"] <= 100


class TestStatusMapping:
    @pytest.mark.parametrize(
        "score,reachable,expected_status",
        [
            (100, True, "Healthy"),
            (95, True, "Healthy"),
            (90, True, "Healthy"),
            (89, True, "Degraded"),
            (70, True, "Degraded"),
            (50, True, "Degraded"),
            (49, True, "Critical"),
            (25, True, "Critical"),
            (0, True, "Critical"),
            (100, False, "Unreachable"),
            (50, False, "Unreachable"),
            (30, False, "Unreachable"),
            (0, False, "Unreachable"),
        ],
    )
    def test_status_for_thresholds(self, health_service, score, reachable, expected_status):
        status = health_service._status_for(score, reachable)
        assert status == expected_status


class TestSnapshotIntegration:
    @patch("services.database_health_service.psutil.disk_usage")
    @patch("services.database_health_service.psutil.virtual_memory")
    @patch("services.database_health_service.psutil.cpu_percent")
    def test_real_snapshot_service_healthy(
        self, cpu_mock, mem_mock, disk_mock, health_service, sample_db_config, mock_session
    ):
        """Criterion 1: Real probe + successful history + ample headroom = 90-100 Healthy."""
        cpu_mock.return_value = 10.0
        mem_mock.return_value = SimpleNamespace(percent=10.0)
        disk_mock.return_value = SimpleNamespace(percent=10.0)

        mock_session.query.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = [
            SimpleNamespace(status="SUCCESS") for _ in range(5)
        ]

        snapshot = health_service.get_snapshot(sample_db_config)
        assert snapshot["score"] == 100
        assert snapshot["status"] == "Healthy"

    @patch.object(DatabaseHealthService, "_probe_target", return_value=False)
    def test_unreachable_target_returns_safe_unreachable_snapshot(
        self, probe_mock, health_service, sample_db_config, mock_session
    ):
        """Criterion 2: Unreachable probe yields score < 50, status Unreachable, no leaked secrets."""
        mock_session.query.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = [
            SimpleNamespace(status="SUCCESS")
        ]
        sample_db_config.config = {
            "password": "supersecretpassword",
            "uri": "postgresql://admin:secret123@db.example.com:5432/mydb",
        }

        snapshot = health_service.get_snapshot(sample_db_config)
        assert snapshot["status"] == "Unreachable"
        assert 0 <= snapshot["score"] < 50
        snapshot_str = str(snapshot).lower()
        assert "password" not in snapshot_str
        assert "supersecretpassword" not in snapshot_str
        assert "secret123" not in snapshot_str
        assert "postgresql://" not in snapshot_str


class ConfigWrapper:
    """Wrapper matching Db configuration interface with type switching."""
    def __init__(self, raw_type: str, db_id: str = "test-alias-db"):
        self.id = db_id
        self.type = raw_type
        self.databaseName = "test_alias_db"
        self.config = {
            "host": "127.0.0.1",
            "port": 5432 if "postgres" in raw_type else (3306 if "maria" in raw_type or "mysql" in raw_type else 1433),
            "user": "test_user",
            "password": "secret_password_789",
            "database": "alias_db",
        }

    def with_type(self, new_type: str) -> "ConfigWrapper":
        return ConfigWrapper(new_type, db_id=f"test-alias-{new_type}")


class TestHardenedProbeCoordinator:
    """Tests for coalescing, capacity bounds, spawn safety, redaction, and alias configuration."""

    def test_spawn_probe_payload_is_picklable_and_contains_no_service_or_lock(self, sample_db_config):
        """Probe payload must be picklable and free of service instances, semaphores, or locks."""
        payload = DatabaseHealthService.build_probe_payload(sample_db_config)
        unpickled = pickle.loads(pickle.dumps(payload))
        assert unpickled == payload
        assert "Semaphore" not in repr(payload)
        assert "DatabaseHealthService" not in repr(payload)
        assert "lock" not in repr(payload).lower()

    def test_probe_uses_spawn_context_exclusively(self):
        """Probe isolation must use spawn context exclusively, never unsafe fork."""
        from services.database_health_service import _mp_context
        assert _mp_context.get_start_method() == "spawn"

    def test_seventeen_concurrent_same_db_requests_coalesce_to_single_probe(
        self, health_service, sample_db_config
    ):
        """
        17+ concurrent snapshot requests for the same database ID cause at most one
        target worker/probe start, and all complete within 2.0 seconds.
        """
        t0 = time.monotonic()
        with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
            futures = [
                executor.submit(
                    health_service.get_snapshot,
                    sample_db_config,
                    deadline=time.monotonic() + 1.9,
                )
                for _ in range(17)
            ]
            results = [f.result() for f in futures]
        elapsed = time.monotonic() - t0

        assert elapsed <= 2.0, f"Concurrent requests took too long: {elapsed}s"
        assert len(results) == 17
        assert all(r["status"] == "Healthy" for r in results), {
            "statuses": [(r["score"], r["status"]) for r in results],
            "results": results,
            "probe_starts": health_service._probe_start_count,
            "in_flight": list(health_service._in_flight_probes),
            "elapsed": elapsed,
        }
        assert all(r["score"] >= 90 for r in results), results
        # Probe start count must be at most 1
        assert getattr(health_service, "_probe_start_count", 0) <= 1

    def test_probe_slot_exhaustion_returns_degraded_not_unreachable(
        self, health_service, sample_db_config
    ):
        """Process-slot exhaustion is local overload, not target database failure."""
        held_slots = [
            health_service._probe_slots.acquire(blocking=False)
            for _ in range(health_service.MAX_CONCURRENT_PROBE_PROCESSES)
        ]
        assert all(held_slots)
        try:
            snapshot = health_service.get_snapshot(
                SimpleNamespace(
                    id="slot-exhausted-db",
                    type="sqlite",
                    databaseName="test_db",
                    config={"database": ":memory:"},
                ),
                deadline=time.monotonic() + 1.0,
            )
        finally:
            for held in held_slots:
                if held:
                    health_service._probe_slots.release()

        assert snapshot["status"] == "Degraded"
        assert 50 <= snapshot["score"] <= 89

    def test_distinct_probe_requests_share_process_capacity(self, health_service):
        """Requests beyond process capacity overload without starting excess probes."""
        configs = [
            SimpleNamespace(
                id=f"capacity-db-{index}",
                type="sqlite",
                databaseName="test_db",
                config={"_test_hang": 0.2, "database": ":memory:"},
            )
            for index in range(8)
        ]
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            snapshots = [
                future.result()
                for future in [executor.submit(health_service.get_snapshot, config) for config in configs]
            ]

        assert all(snapshot["status"] != "Unreachable" for snapshot in snapshots), {
            "snapshots": snapshots,
            "probe_starts": health_service._probe_start_count,
            "in_flight": list(health_service._in_flight_probes),
        }
        assert health_service._probe_start_count <= health_service.MAX_CONCURRENT_PROBE_PROCESSES

    def test_capacity_exhaustion_does_not_mark_healthy_target_unreachable(
        self, health_service, sample_db_config
    ):
        """
        Local capacity exhaustion must return a valid Degraded snapshot (50-89),
        never Unreachable.
        """
        # Artificially saturate coordinator probe capacity
        max_slots = getattr(health_service, "_max_concurrent_probes", 8)
        dummy_probes = {}
        for i in range(max_slots):
            dummy_id = f"saturated-db-{i}"
            mock_probe = MagicMock()
            mock_probe.done_event.is_set.return_value = False
            dummy_probes[dummy_id] = mock_probe

        with patch.object(health_service, "_in_flight_probes", dummy_probes):
            snapshot = health_service.get_snapshot(
                sample_db_config, deadline=time.monotonic() + 1.9
            )

        assert snapshot["status"] == "Degraded"
        assert 50 <= snapshot["score"] <= 89
        assert snapshot["status"] != "Unreachable"

    def test_concurrent_probe_without_completed_result_returns_degraded(
        self, health_service, sample_db_config
    ):
        """
        A concurrent request whose deadline expires while an in-flight probe is still running
        must return Degraded, never Unreachable.
        """
        # Set an in-flight probe for this db_id that never finishes before caller's tiny deadline
        mock_in_flight = MagicMock()
        mock_in_flight.done_event.wait.return_value = False
        mock_in_flight.outcome = None

        with patch.object(
            health_service,
            "_in_flight_probes",
            {sample_db_config.id: mock_in_flight},
        ):
            snapshot = health_service.get_snapshot(
                sample_db_config, deadline=time.monotonic() + 0.05
            )

        assert snapshot["status"] == "Degraded"
        assert 50 <= snapshot["score"] <= 89
        assert snapshot["status"] != "Unreachable"

    def test_healthy_sqlite_probe_succeeds_after_capacity_saturation(
        self, health_service, sample_db_config
    ):
        """
        After fully saturating capacity, an independent healthy SQLite probe succeeds within 2s.
        """
        # Simulate hung probes saturating capacity
        hung_configs = [
            SimpleNamespace(
                id=f"hung-db-{i}",
                type="sqlite",
                databaseName="test_db",
                config={"_test_hang": 0.5, "database": ":memory:"},
            )
            for i in range(8)
        ]

        # Saturate capacity
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
            futs = [ex.submit(health_service.get_snapshot, cfg) for cfg in hung_configs]
            _ = [f.result() for f in futs]

        # Immediately after, healthy SQLite probe must succeed in <= 2.0s
        t0 = time.monotonic()
        snapshot = health_service.get_snapshot(sample_db_config)
        elapsed = time.monotonic() - t0

        assert elapsed <= 2.0
        assert snapshot["status"] == "Healthy"
        assert snapshot["score"] >= 90

    def test_shutdown_rejects_work_and_returns_promptly_with_hung_child(self, sample_db_config):
        """
        shutdown() terminates child processes promptly and causes subsequent work to return Degraded.
        """
        service = DatabaseHealthService()
        hung_config = SimpleNamespace(
            id="hung-child-db",
            type="sqlite",
            databaseName="test_db",
            config={"_test_hang": 10.0, "database": ":memory:"},
        )

        # Start hung probe in background thread
        ex = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        fut = ex.submit(service.get_snapshot, hung_config)
        time.sleep(0.1)  # Allow process to start

        # Shutdown must complete promptly (well under 2s) despite hung child
        t0 = time.monotonic()
        service.shutdown()
        shutdown_elapsed = time.monotonic() - t0

        assert shutdown_elapsed <= 1.0, f"shutdown() took too long: {shutdown_elapsed}s"

        # Hung probe future should finish promptly
        res = fut.result(timeout=1.0)
        assert res["status"] in ("Degraded", "Unreachable")

        # Subsequent requests after shutdown return Degraded immediately
        post_snap = service.get_snapshot(sample_db_config)
        assert post_snap["status"] == "Degraded"
        ex.shutdown(wait=False)

    def test_worker_failure_logs_neither_uri_nor_secret_nor_raw_error(self, health_service, caplog):
        """
        Captured logs and snapshot result never contain passwords, URIs, or raw driver error text.
        """
        import logging

        secret_pw = "my_super_secret_db_pass_999"
        raw_err = f"OperationalError: connection to 192.0.2.99:5432 failed, password={secret_pw}"
        bad_config = SimpleNamespace(
            id="leak-test-db-id",
            type="postgres",
            databaseName="leak_test_db",
            config={
                "host": "192.0.2.99",
                "port": 5432,
                "user": "admin",
                "password": secret_pw,
                "uri": f"postgresql://admin:{secret_pw}@192.0.2.99:5432/leak_test_db",
                "_test_fail": raw_err,
            },
        )

        with caplog.at_level(logging.DEBUG):
            snapshot = health_service.get_snapshot(bad_config)

        assert snapshot["status"] == "Unreachable"
        assert snapshot["score"] < 50

        # Verify secrecy
        assert secret_pw not in caplog.text
        assert "192.0.2.99" not in caplog.text
        assert "password" not in caplog.text.lower()
        assert raw_err not in caplog.text
        assert secret_pw not in str(snapshot)
        assert "192.0.2.99" not in str(snapshot)

    @pytest.mark.parametrize(
        "raw,canonical",
        [
            ("postgresql", "postgres"),
            ("mariadb", "mysql"),
            ("sqlserver", "mssql"),
        ],
    )
    def test_alias_builds_canonical_probe_uri_and_timeout(self, raw, canonical):
        """
        Connector aliases normalize before URI/engine configuration and enforce timeout <= 2s.
        """
        config = ConfigWrapper("sqlite").with_type(raw)
        payload = DatabaseHealthService.build_probe_payload(config)
        options = DatabaseHealthService.probe_connect_options(payload)

        assert payload.database_type == canonical
        assert options["timeout_seconds"] <= 2.0
        assert options["database_type"] == canonical
        # Ensure URI uses canonical/compatible driver
        uri = options.get("uri", "")
        if canonical == "postgres":
            assert "postgresql" in uri or "postgres" in uri
        elif canonical == "mysql":
            assert "mysql" in uri or "pymysql" in uri
        elif canonical == "mssql":
            assert "mssql" in uri

        # Test engine creation uses NullPool without external calls
        engine = DatabaseHealthService()._create_probe_engine(raw, config.config)
        if engine is not None:
            try:
                from sqlalchemy.pool import NullPool
                assert isinstance(engine.pool, NullPool)
            finally:
                engine.dispose()
