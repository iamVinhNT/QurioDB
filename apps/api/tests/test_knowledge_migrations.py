"""test_knowledge_migrations.py — Additive local migration and legacy preservation."""

from sqlalchemy import create_engine, inspect, text
from models import Base
from services.startup import migrate_knowledge_schema


def test_migration_twice_preserves_existing_source():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[table for name, table in Base.metadata.tables.items()
                                             if not name.startswith(("knowledge_", "rag_graph_"))])
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO rag_sources (id, sourceType, title, contentHash) VALUES ('legacy', 'document', 'Existing', 'hash')"))
    migrate_knowledge_schema(engine)
    migrate_knowledge_schema(engine)
    assert "knowledge_revisions" in inspect(engine).get_table_names()
    with engine.connect() as connection:
        assert connection.execute(text("SELECT title FROM rag_sources WHERE id='legacy'")).scalar() == "Existing"
