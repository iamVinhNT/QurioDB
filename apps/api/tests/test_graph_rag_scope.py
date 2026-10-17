"""test_graph_rag_scope.py — Scope enforcement and authoritative removal before cleanup."""

import pytest
from schemas.knowledge import BasePatch
from services.ai.retrieval.retrieval_service import RagRetrievalService
from services.knowledge_access import KnowledgeError
from tests.knowledge_fixtures import knowledge, publish_document, OfflineGateway


def test_managed_retrieval_never_leaks_owner_or_connection(knowledge):
    doc, _ = publish_document(knowledge)
    retriever = RagRetrievalService(embedding_gateway=OfflineGateway())
    for user, database in [("other", "db"), (None, "db"), ("owner", "other-db")]:
        assert not retriever.retrieve("doanh thu", database_id=database, user_id=user)["items"]
    assert retriever.retrieve("doanh thu", database_id="db", user_id="owner")["items"]
    with pytest.raises(KnowledgeError):
        knowledge["service"].get_document(doc["id"], "other")


@pytest.mark.parametrize("action", ["unpublish", "archive", "disable", "archive_base", "legacy_delete"])
def test_removal_excludes_vectors_and_graph_before_cleanup(knowledge, action):
    doc, _ = publish_document(knowledge)
    retriever = RagRetrievalService(embedding_gateway=OfflineGateway())
    base_id = knowledge["base"]["id"]
    if action == "disable":
        knowledge["service"].patch_base(base_id, BasePatch(enabledForSql=False), "owner")
    elif action == "archive_base":
        knowledge["service"].archive_base(base_id, "owner")
    elif action == "legacy_delete":
        retriever.delete_source(f"knowledge:{doc['activeRevisionId']}", user_id="owner")
    else:
        knowledge["service"].remove_document(doc["id"], "owner", archive=action == "archive")
    assert not retriever.retrieve("doanh thu", database_id="db", user_id="owner")["items"]
    graph = knowledge["retrieval"].inspect("db", "owner")
    assert not [n for n in graph["nodes"] if n["revisionId"]]


def test_general_rag_endpoint_uses_owner_embedding_gateway_for_managed_content(knowledge,monkeypatch):
    publish_document(knowledge)
    observed=[]
    def owned_gateway(user_id):
        observed.append(user_id)
        return OfflineGateway()
    monkeypatch.setattr('services.ai.retrieval.embedding_gateway.GeminiEmbeddingGateway.for_user', lambda self, user_id: owned_gateway(user_id))
    retriever=RagRetrievalService()
    monkeypatch.setattr(retriever.embeddings,'is_available',lambda: (_ for _ in ()).throw(AssertionError('Shared gateway must not inspect managed content')))
    result=retriever.retrieve('doanh thu',database_id='db',user_id='owner')
    assert result['items'] and observed==['owner']
