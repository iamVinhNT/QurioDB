"""knowledge_fixtures.py — Isolated metadata, schema and services for knowledge regression tests."""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from models import Base, Db, User, Role
from schemas.knowledge import BaseCreate, DocumentCreate, PublishRequest
from services.knowledge_service import KnowledgeService
from services.knowledge_publish import KnowledgePublisher
from services.ai.retrieval.schema_graph import SchemaGraphService
from services.ai.retrieval.graph_retrieval import GraphRetrievalService


class OfflineGateway:
    model = "offline"
    def __init__(self, user_id=None):
        pass
    def is_available(self):
        return False


@pytest.fixture
def knowledge(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    with sessions() as session:
        session.add(Role(id="role", name="Creator"))
        session.add_all([User(id=u, username=u, email=f"{u}@test", password="test", roleId="role") for u in ("owner", "other")])
        session.add_all([Db(id=d, type="sqlite", databaseName=d, config={}) for d in ("db", "other-db")])
        session.commit()
    for module in ("models", "services.knowledge_service", "services.knowledge_publish",
                   "services.ai.retrieval.retrieval_service", "services.ai.retrieval.index_service"):
        monkeypatch.setattr(f"{module}.SessionLocal", sessions)
    columns = {
        "customers": [{"name": "id", "type": "INTEGER"}],
        "orders": [{"name": "id", "type": "INTEGER"}, {"name": "customer_id", "type": "INTEGER"}],
        "refunds": [{"name": "order_id", "type": "INTEGER"}, {"name": "amount", "type": "REAL"}],
    }
    fks = [{"table": "orders", "foreignTable": "customers", "columnPairs": [("customer_id", "id")],
            "column": "customer_id", "foreignColumn": "id"},
           {"table": "refunds", "foreignTable": "orders", "columnPairs": [("order_id", "id")],
            "column": "order_id", "foreignColumn": "id"}]
    graph = SchemaGraphService(sessions, lambda *_: (columns, fks, "sqlite"))
    service = KnowledgeService(sessions)
    publisher = KnowledgePublisher(sessions, OfflineGateway, graph)
    base = service.create_base(BaseCreate(name="Sales", databaseId="db", enabledForSql=True), "owner")
    return {"sessions": sessions, "service": service, "publisher": publisher, "graph": graph,
            "retrieval": GraphRetrievalService(sessions), "base": base, "columns": columns, "fks": fks}


def publish_document(knowledge, body="# Doanh thu\nDoanh thu thuần loại trừ hoàn tiền.", definitions=None):
    service = knowledge["service"]
    document = service.create_document(knowledge["base"]["id"], DocumentCreate(
        title="Revenue", bodyMarkdown=body, definitionData=definitions or {}), "owner")
    job = knowledge["publisher"].publish(document["id"], PublishRequest(expectedVersion=1, lexicalOnly=True), "owner")
    knowledge["publisher"].process_one()
    assert knowledge["publisher"].get_job(job["id"], "owner")["status"] == "succeeded"
    return service.get_document(document["id"], "owner"), job
