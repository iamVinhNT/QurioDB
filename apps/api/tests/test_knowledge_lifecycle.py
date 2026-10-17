"""test_knowledge_lifecycle.py — Shutdown, owner credentials and staging without a write transaction."""
from unittest.mock import MagicMock, patch
from models import KnowledgeIndexJob
from schemas.knowledge import DocumentCreate, DocumentPatch, PublishRequest
from services.knowledge_embeddings import KnowledgeEmbeddingGateway
from tests.knowledge_fixtures import knowledge, publish_document


def test_embedding_has_one_attempt_and_timeout_without_real_network(monkeypatch):
    monkeypatch.setattr('services.ai.langchain_runtime.get_ai_api_key',lambda **kwargs: 'owner-key' if kwargs['user_id']=='owner' else None)
    gateway=KnowledgeEmbeddingGateway('owner')
    with patch('google.genai.Client') as client:
        client.return_value.__enter__.return_value.models.embed_content.return_value.embeddings=[MagicMock(values=[.1,.2])]
        assert gateway.embed_document('redacted evidence')==[.1,.2]
        options=client.call_args.kwargs['http_options']
        assert options.timeout==10000 and options.retry_options.attempts==1
        assert client.call_args.kwargs['api_key']=='owner-key'
        assert KnowledgeEmbeddingGateway('other').embed_query('private question')==[]
        assert KnowledgeEmbeddingGateway(None).embed_query('private question')==[]
        assert client.call_count==1


def test_edit_during_embedding_cannot_activate_stale_revision(knowledge):
    service,publisher=knowledge['service'],knowledge['publisher']
    document=service.create_document(knowledge['base']['id'],DocumentCreate(title='Draft',bodyMarkdown='Content'), 'owner')
    class EditingGateway:
        model='test'
        def __init__(self,_):pass
        def is_available(self):return True
        def embed_document(self,_):
            service.save_document(document['id'],DocumentPatch(title='New',bodyMarkdown='New',expectedVersion=1),'owner')
            return [.1,.2]
    publisher.gateway=EditingGateway
    job=publisher.publish(document['id'],PublishRequest(expectedVersion=1),'owner')
    publisher.process_one()
    assert publisher.get_job(job['id'],'owner')['status']=='cancelled'
    assert service.get_document(document['id'],'owner')['activeRevisionId'] is None


def test_shutdown_interrupts_before_projection_and_worker_stops(knowledge):
    doc,_=publish_document(knowledge)
    publisher,service=knowledge['publisher'],knowledge['service']
    old=doc['activeRevisionId']
    changed=service.save_document(doc['id'],DocumentPatch(title='New',bodyMarkdown='new',expectedVersion=1),'owner')
    job=publisher.publish(doc['id'],PublishRequest(expectedVersion=changed['version'],lexicalOnly=True),'owner')
    publisher.stop_event.set();publisher.process_one()
    assert service.get_document(doc['id'],'owner')['activeRevisionId']==old
    assert publisher.get_job(job['id'],'owner')['status']=='failed'
    publisher.start();publisher.stop()
    assert not publisher.thread.is_alive()
