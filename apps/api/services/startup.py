"""
startup.py

Database startup helpers for schema creation, local migrations, and default
seed data used by the FastAPI application.
"""

import json
import uuid


DEFAULT_ROLES = [
    {"name": "Admin", "description": "Full system access"},
    {"name": "Creator", "description": "Can create and manage resources"},
    {"name": "Viewer", "description": "Can view shared resources"},
    {"name": "Default", "description": "Basic access"},
]


def setup_database():
    """Ensure the system database is ready with schema and default seeds."""
    from models import Base, Role, SessionLocal, User, engine

    if not engine:
        return

    session = None
    try:
        print("Backend: Checking and initializing database schema...")
        Base.metadata.create_all(engine)
        migrate_user_ai_configs_for_provider_keys(engine)
        migrate_legacy_gateway_provider(engine)
        migrate_remove_workspace_git_metadata(engine)

        session = SessionLocal()
        seed_roles(session, Role)
        seed_default_admin(session, Role, User)
        reclaim_desktop_admin_owned_rows(session, User)
        seed_ai_router_terms(session)
        session.commit()
        print("Backend: Database setup complete.")
    except Exception as exc:
        print(f"Backend Error: Automated setup failed: {exc}")
        if session:
            session.rollback()
    finally:
        if session:
            session.close()


def seed_roles(session, role_model):
    """Create built-in roles when they do not exist yet."""
    for role_data in DEFAULT_ROLES:
        if session.query(role_model).filter(role_model.name == role_data["name"]).first():
            continue

        role_id = "default" if role_data["name"] == "Default" else str(uuid.uuid4())
        session.add(role_model(id=role_id, **role_data))


def seed_default_admin(session, role_model, user_model):
    """Create the local default admin account for first-run zero setup."""
    if session.query(user_model).count() > 0:
        return

    admin_role = session.query(role_model).filter(role_model.name == "Admin").first()
    if not admin_role:
        return

    from .auth_service import auth_service

    admin_user = user_model(
        id=str(uuid.uuid4()),
        email="admin@quriodb.local",
        username="admin",
        password=auth_service.get_password_hash("password123"),
        name="System Admin",
        roleId=admin_role.id,
    )
    session.add(admin_user)
    print("Backend: Default admin user created (admin / password123)")


LEGACY_DESKTOP_ADMIN_ID = "desktop-admin-id"


def reclaim_desktop_admin_owned_rows(session, user_model):
    """Re-point rows saved under the legacy fictional desktop-admin id.

    Early DISABLE_AUTH builds attributed user-owned rows (AI provider keys) to a
    constant 'desktop-admin-id' that never existed in the users table, so those
    rows became invisible once auth resolved the real admin. Move them onto the
    actual admin/first user so a single re-point heals existing desktop installs.
    """
    from models import UserAIConfig

    admin = (
        session.query(user_model).filter(user_model.username == "admin").first()
        or session.query(user_model).order_by(user_model.created_on.asc()).first()
    )
    if not admin or admin.id == LEGACY_DESKTOP_ADMIN_ID:
        return

    orphans = (
        session.query(UserAIConfig)
        .filter(UserAIConfig.userId == LEGACY_DESKTOP_ADMIN_ID)
        .all()
    )
    for config in orphans:
        existing = (
            session.query(UserAIConfig)
            .filter(
                UserAIConfig.userId == admin.id,
                UserAIConfig.provider == config.provider,
            )
            .first()
        )
        # Avoid violating the (userId, provider) unique index: drop the legacy
        # duplicate when the real admin already configured the same provider.
        if existing:
            session.delete(config)
        else:
            config.userId = admin.id

    if orphans:
        print(f"Backend: Reclaimed {len(orphans)} desktop AI config row(s) for admin.")


def seed_ai_router_terms(session):
    """Create configurable AI router keyword defaults for first-run routing."""
    from services.ai.router_terms import router_term_service

    router_term_service.seed_defaults(session)


def migrate_user_ai_configs_for_provider_keys(engine):
    """Allow one encrypted AI key per provider for existing SQLite metadata DBs."""
    if not engine or engine.dialect.name != "sqlite":
        return

    with engine.begin() as connection:
        if not _sqlite_table_exists(connection, "user_ai_configs"):
            return

        _ensure_user_ai_configs_base_url_column(connection)

        index_columns = _sqlite_unique_index_columns(connection, "user_ai_configs")
        has_user_only_unique = ["userId"] in index_columns
        has_user_provider_unique = ["userId", "provider"] in index_columns

        if has_user_only_unique:
            _rebuild_user_ai_configs_without_user_unique(connection)
            has_user_provider_unique = False

        if not has_user_provider_unique:
            connection.exec_driver_sql(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS uq_user_ai_configs_user_provider
                ON user_ai_configs ("userId", provider)
                """
            )


def migrate_legacy_gateway_provider(engine):
    """Move legacy gateway keys and registered models to Custom Provider."""
    if not engine or engine.dialect.name != "sqlite":
        return

    with engine.begin() as connection:
        if _sqlite_table_exists(connection, "user_ai_configs"):
            connection.exec_driver_sql(
                '''
                UPDATE user_ai_configs
                SET provider = 'Custom'
                WHERE LOWER(provider) = '9router'
                  AND NOT EXISTS (
                      SELECT 1 FROM user_ai_configs AS existing
                      WHERE existing."userId" = user_ai_configs."userId"
                        AND LOWER(existing.provider) = 'custom'
                  )
                '''
            )
            connection.exec_driver_sql(
                '''
                DELETE FROM user_ai_configs
                WHERE LOWER(provider) = '9router'
                  AND EXISTS (
                      SELECT 1 FROM user_ai_configs AS existing
                      WHERE existing."userId" = user_ai_configs."userId"
                        AND LOWER(existing.provider) = 'custom'
                  )
                '''
            )
        if _sqlite_table_exists(connection, "ai_models"):
            connection.exec_driver_sql(
                "UPDATE ai_models SET provider = 'Custom' WHERE LOWER(provider) = '9router'"
            )


def migrate_remove_workspace_git_metadata(engine) -> None:
    """Remove internal SQLLab Git workspace metadata without touching user files."""
    if not engine or engine.dialect.name != "sqlite":
        return

    with engine.begin() as connection:
        connection.exec_driver_sql("DROP TABLE IF EXISTS workspace_git_worktrees")
        if not _sqlite_table_exists(connection, "user_settings"):
            return

        rows = connection.exec_driver_sql(
            "SELECT id, settings FROM user_settings"
        ).fetchall()
        for setting_id, raw_settings in rows:
            if raw_settings is None:
                continue
            try:
                settings = (
                    json.loads(raw_settings)
                    if isinstance(raw_settings, str)
                    else raw_settings
                )
            except (TypeError, ValueError):
                continue
            if not isinstance(settings, dict):
                continue

            has_workspace = "workspace" in settings
            has_flag = "sqllabGitDirectoryEnabled" in settings
            settings.pop("workspace", None)
            settings.pop("sqllabGitDirectoryEnabled", None)
            if not has_workspace and not has_flag:
                continue

            connection.exec_driver_sql(
                "UPDATE user_settings SET settings = ? WHERE id = ?",
                (json.dumps(settings, ensure_ascii=False), setting_id),
            )


def _ensure_user_ai_configs_base_url_column(connection):
    """Add the optional baseUrl column to legacy SQLite metadata DBs."""
    columns = [
        row[1]
        for row in connection.exec_driver_sql("PRAGMA table_info('user_ai_configs')").fetchall()
    ]
    if "baseUrl" not in columns:
        connection.exec_driver_sql('ALTER TABLE user_ai_configs ADD COLUMN "baseUrl" VARCHAR')


def _sqlite_table_exists(connection, table_name: str) -> bool:
    row = connection.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (table_name,),
    ).fetchone()
    return bool(row)


def _sqlite_unique_index_columns(connection, table_name: str):
    columns_by_index = []
    for index in connection.exec_driver_sql(f"PRAGMA index_list('{table_name}')").fetchall():
        index_name = index[1]
        is_unique = bool(index[2])
        if not is_unique:
            continue

        columns = [
            row[2]
            for row in connection.exec_driver_sql(f"PRAGMA index_info('{index_name}')").fetchall()
        ]
        columns_by_index.append(columns)
    return columns_by_index


def _rebuild_user_ai_configs_without_user_unique(connection):
    connection.exec_driver_sql("ALTER TABLE user_ai_configs RENAME TO user_ai_configs_legacy")
    connection.exec_driver_sql(
        """
        CREATE TABLE user_ai_configs (
            id VARCHAR NOT NULL,
            "userId" VARCHAR NOT NULL,
            "apiKey" VARCHAR NOT NULL,
            provider VARCHAR,
            "baseUrl" VARCHAR,
            created_on DATETIME,
            changed_on DATETIME,
            PRIMARY KEY (id),
            FOREIGN KEY("userId") REFERENCES users (id) ON DELETE CASCADE
        )
        """
    )
    connection.exec_driver_sql(
        """
        INSERT INTO user_ai_configs (id, "userId", "apiKey", provider, "baseUrl", created_on, changed_on)
        SELECT id, "userId", "apiKey", COALESCE(provider, 'Google'), "baseUrl", created_on, changed_on
        FROM user_ai_configs_legacy
        """
    )
    connection.exec_driver_sql("DROP TABLE user_ai_configs_legacy")
