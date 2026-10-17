"""test_knowledge_publish.py — Immutable revisions, failure safety and publication races."""

import pytest
from models import KnowledgeIndexJob, RagChunk
from schemas.knowledge import DocumentCreate, DocumentPatch, PublishRequest
from services.knowledge_access import KnowledgeError
from tests.knowledge_fixtures import knowledge, publish_document


def test_draft_never_indexed_and_original_markdown_preserved(knowledge):
    body = "# Tiếng Việt\n\n  Nội dung có dấu.\n"
    doc = knowledge["service"].create_document(knowledge["base"]["id"], DocumentCreate(title="Draft", bodyMarkdown=body), "owner")
    assert knowledge["service"].get_document(doc["id"], "owner")["bodyMarkdown"] == body
    with knowledge["sessions"]() as session:
        assert session.query(RagChunk).count() == 0


def test_failed_new_publication_keeps_previous_revision(knowledge):
    doc, _ = publish_document(knowledge)
    original = doc["activeRevisionId"]
    changed = knowledge["service"].save_document(doc["id"], DocumentPatch(
        title="Broken binding", bodyMarkdown="Changed", expectedVersion=1,
        definitionData={"bindings": [{"schemaName": "main", "tableName": "missing"}]}), "owner")
    job = knowledge["publisher"].publish(doc["id"], PublishRequest(expectedVersion=changed["version"], lexicalOnly=True), "owner")
    knowledge["publisher"].process_one()
    assert knowledge["publisher"].get_job(job["id"], "owner")["status"] == "failed"
    assert knowledge["service"].get_document(doc["id"], "owner")["activeRevisionId"] == original


def test_publish_idempotent_and_old_draft_cannot_activate(knowledge):
    service, publisher = knowledge["service"], knowledge["publisher"]
    doc = service.create_document(knowledge["base"]["id"], DocumentCreate(title="Draft", bodyMarkdown="Body"), "owner")
    request = PublishRequest(expectedVersion=1, lexicalOnly=True)
    job = publisher.publish(doc["id"], request, "owner")
    assert publisher.publish(doc["id"], request, "owner")["id"] == job["id"]
    service.save_document(doc["id"], DocumentPatch(title="Newer", bodyMarkdown="Newer", expectedVersion=1), "owner")
    publisher.process_one()
    assert service.get_document(doc["id"], "owner")["activeRevisionId"] is None
    assert publisher.get_job(job["id"], "owner")["status"] == "cancelled"


def test_archive_cancels_queued_publication_and_conflicts(knowledge):
    doc, _ = publish_document(knowledge)
    with pytest.raises(KnowledgeError) as error:
        knowledge["service"].save_document(doc["id"], DocumentPatch(title="x", expectedVersion=99), "owner")
    assert error.value.status == 409
    knowledge["service"].remove_document(doc["id"], "owner", archive=True)
    with pytest.raises(KnowledgeError):
        knowledge["publisher"].publish(doc["id"], PublishRequest(expectedVersion=1), "owner")


def test_worker_recovers_running_job(knowledge, monkeypatch):
    doc = knowledge["service"].create_document(knowledge["base"]["id"], DocumentCreate(title="Draft", bodyMarkdown="Body"), "owner")
    publisher = knowledge["publisher"]
    job = publisher.publish(doc["id"], PublishRequest(expectedVersion=1, lexicalOnly=True), "owner")
    with knowledge["sessions"]() as session:
        session.get(KnowledgeIndexJob, job["id"]).status = "running"
        session.commit()
    monkeypatch.setattr(publisher, "_run", lambda: None)
    publisher.start()
    publisher.stop()
    assert publisher.get_job(job["id"], "owner")["status"] == "queued"
