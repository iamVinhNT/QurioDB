"""test_knowledge_routes.py — Authenticated API contracts and immutable citation resolution."""
import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from routes import knowledge as routes, rag_graph
from services.knowledge_access import KnowledgeError
from tests.knowledge_fixtures import knowledge, publish_document


@pytest.fixture
def api(knowledge,monkeypatch):
    app=FastAPI()
    app.include_router(routes.router,prefix='/api');app.include_router(rag_graph.router,prefix='/api')
    @app.exception_handler(KnowledgeError)
    async def knowledge_error(_,exc): return JSONResponse(status_code=exc.status,content={'detail':exc.detail})
    monkeypatch.setattr(routes,'knowledge_service',knowledge['service'])
    monkeypatch.setattr(routes,'knowledge_publisher',knowledge['publisher'])
    monkeypatch.setattr(rag_graph,'knowledge_service',knowledge['service'])
    monkeypatch.setattr(rag_graph,'graph_retrieval_service',knowledge['retrieval'])
    monkeypatch.setattr(rag_graph,'schema_graph_service',knowledge['graph'])
    app.dependency_overrides[routes.principal]=lambda:'owner'
    return app,TestClient(app)


def test_api_draft_save_conflict_publish_and_immutable_citation(api,knowledge):
    app,client=api
    base=knowledge['base']['id']
    response=client.post(f'/api/knowledge-bases/{base}/documents',json={'title':'Tiếng Việt','bodyMarkdown':'# Doanh thu\nGiữ nguyên dấu.'})
    assert response.status_code==201
    doc=response.json()
    assert client.patch(f"/api/knowledge-documents/{doc['id']}",json={'title':'x','expectedVersion':99}).status_code==409
    job=client.post(f"/api/knowledge-documents/{doc['id']}/publish",json={'expectedVersion':1,'lexicalOnly':True})
    assert job.status_code==202
    knowledge['publisher'].process_one()
    revision_id=job.json()['revisionId']
    revision=client.get(f"/api/knowledge-documents/{doc['id']}/revisions/{revision_id}")
    assert revision.status_code==200 and revision.json()['sections'][0]['id']=='section-0'
    assert revision.json()['bodyMarkdown']==doc['bodyMarkdown']
    assert client.patch(f"/api/knowledge-documents/{doc['id']}",json={'title':'changed','bodyMarkdown':'new','expectedVersion':1}).status_code==200
    assert client.get(f"/api/knowledge-documents/{doc['id']}/revisions/{revision_id}").json()['title']=='Tiếng Việt'
    app.dependency_overrides[routes.principal]=lambda:'other'
    assert client.get(f"/api/knowledge-documents/{doc['id']}/revisions/{revision_id}").status_code==404
    assert client.get('/api/knowledge-bases').json()['items']==[]
    assert client.get('/api/rag/graph',params={'databaseId':'db','knowledgeBaseId':base}).status_code==404


def test_api_sync_has_no_dummy_query_and_rejects_other_connection(api,knowledge):
    _,client=api;base=knowledge['base']['id']
    assert client.post(f'/api/knowledge-bases/{base}/sync-schema',json={'schemaName':'main'}).status_code==200
    assert client.get('/api/rag/graph',params={'databaseId':'other-db','knowledgeBaseId':base}).status_code==404
    assert client.post('/api/knowledge-bases',json={'name':'  ','databaseId':'db'}).status_code==422
    assert client.post(f'/api/knowledge-bases/{base}/sync-schema',json={'schemaName':'main','query':'extra'}).status_code==422


def test_legacy_import_is_idempotent_draft_and_requires_matching_connection(knowledge,monkeypatch):
    from models import RagSource,RagChunk
    from services.knowledge_service import import_legacy_source
    monkeypatch.setattr('services.knowledge_service.knowledge_service',knowledge['service'])
    with knowledge['sessions']() as session:
        session.add(RagSource(id='legacy',sourceType='document',databaseId='db',userId='owner',title='Legacy',contentHash='h',status='indexed'))
        session.flush()
        session.add(RagChunk(id='legacy-c',sourceId='legacy',chunkType='paragraph',content='Indexed original',ordinal=0,contentHash='h',tokenCount=2))
        session.commit()
    first=import_legacy_source(knowledge['base']['id'],'legacy','owner')
    assert first['activeRevisionId'] is None and 'Indexed original' in first['bodyMarkdown']
    assert import_legacy_source(knowledge['base']['id'],'legacy','owner')['id']==first['id']
    with pytest.raises(KnowledgeError): import_legacy_source(knowledge['base']['id'],'legacy','other')
