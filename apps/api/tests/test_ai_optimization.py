"""test_ai_optimization.py — Regressions for AI credentials, retrieval cost and snapshot stability."""
import gc
import pytest

pytestmark = pytest.mark.rag
import tracemalloc
from types import SimpleNamespace
from unittest.mock import Mock

from sqlalchemy import event
from models import RagSource, RagChunk, RagEmbedding, UserAIConfig, AIChatMessage
from tests.knowledge_fixtures import knowledge, publish_document
from services.ai.retrieval.index_service import RagIndexService
from services.ai.retrieval.retrieval_service import RagRetrievalService
from services.ai.retrieval.sqlite_vec_store import sqlite_vec_store
from services.ai.rag_context import RagContextBuilder

class VectorGateway:
    model = 'review-fake-embedding'
    def is_available(self): return True
    def embed_document(self, content): return [1.0, 0.0]
    def embed_query(self, content): return [1.0, 0.0]

class Metadata:
    def get_schema_snapshot(self, *args):
        return self.k["columns"], self.k["fks"], "sqlite", self.get_indexes_for_tables()
    def __init__(self, k): self.k = k
    def get_all_columns(self, *args): return self.k['columns']
    def get_db_type(self, *args): return 'sqlite'
    def get_all_foreign_keys(self, *args): return self.k['fks']
    def get_indexes_for_tables(self, *args):
        return {'orders': [{'indexname': 'review_orders_index', 'indexdef': 'CREATE INDEX review_orders_index ON orders(customer_id)'}]}

def test_schema_writers_preserve_fresh_embeddings(knowledge, monkeypatch):
    monkeypatch.setattr(sqlite_vec_store, '_available_cache', None)
    service = RagIndexService(Metadata(knowledge), VectorGateway())
    indexed = service.index_database_schema('db', 'main', user_id='owner')
    with knowledge['sessions']() as s:
        before = s.query(RagEmbedding).count()
        assert before == indexed['embeddingCount'] > 0
    knowledge['graph'].reflect = Metadata(knowledge).get_schema_snapshot
    knowledge['graph'].sync('db', 'main')
    with knowledge['sessions']() as s:
        after = s.query(RagEmbedding).count()
        assert after == before
        assert any('review_orders_index' in c.content for c in s.query(RagChunk))

def test_schema_writer_preserves_bound_knowledge(knowledge):
    from services.knowledge_access import eligible_revisions
    publish_document(knowledge, definitions={'bindings': [{'schemaName': 'main', 'tableName': 'orders'}]})
    with knowledge['sessions']() as s:
        assert len(eligible_revisions(s, 'owner', 'db')) == 1
    offline = SimpleNamespace(is_available=lambda: False)
    RagIndexService(Metadata(knowledge), offline).index_database_schema('db', 'main', user_id='owner')
    with knowledge['sessions']() as s:
        assert len(eligible_revisions(s, 'owner', 'db')) == 1

def test_inactive_vectors_starve_active_revision(knowledge, monkeypatch):
    monkeypatch.setattr(sqlite_vec_store, '_available_cache', None)
    doc, _ = publish_document(knowledge)
    obsolete_sources = []
    with knowledge['sessions']() as s:
        source = s.get(RagSource, f"knowledge:{doc['activeRevisionId']}")
        live = s.query(RagChunk).filter_by(sourceId=source.id).first()
        assert sqlite_vec_store.upsert_embedding(s, live, source, [0.8, 0.6])
        for i in range(40):
            old = RagSource(id=f'knowledge:inactive-{i}', sourceType='knowledge_document', databaseId='db', userId='owner', title='Inactive revision', contentHash='x', status='indexed')
            chunk = RagChunk(id=f'inactive-{i}', sourceId=old.id, chunkType='knowledge_document', content='Retired material', contentHash='x')
            s.add_all([old, chunk]); s.flush()
            sqlite_vec_store.upsert_embedding(s, chunk, old, [1.0, 0.0])
            obsolete_sources.append(old.id)
        s.commit()
    retriever = RagRetrievalService(VectorGateway())
    kwargs = dict(database_id='db', user_id='owner', source_types=['knowledge_document'], top_k=1, candidate_limit=32)
    blocked = retriever.retrieve('zqxsignal', **kwargs)
    assert blocked['items'][0]['semanticScore'] > 0
    with knowledge['sessions']() as s:
        for identity in obsolete_sources: sqlite_vec_store.delete_source(s, identity)
        s.commit()
    restored = retriever.retrieve('zqxsignal', **kwargs)
    assert restored['items'][0]['semanticScore'] > 0

def test_prompt_fetches_columns_once_per_schema():
    meta = SimpleNamespace(get_all_columns=Mock(return_value={f't{i}': [{'name':'id'}] for i in range(8)}))
    items = [{'sourceType':'database_schema', 'chunkType':'table', 'objectName':f't{i}', 'schemaName':'main'} for i in range(8)]
    RagContextBuilder(meta)._format_identifier_guard('sqlite', 'db', 'main', items)
    assert meta.get_all_columns.call_count == 1

def test_stream_batches_snapshot_commits(knowledge, monkeypatch):
    from routes import ai_stream
    from schemas.ai import StreamChatRequest
    from services.ai.streaming import new_response_parts
    counter = []
    @event.listens_for(knowledge['sessions'], 'after_commit')
    def committed(session): counter.append(1)
    monkeypatch.setattr(ai_stream, 'SessionLocal', knowledge['sessions'])
    monkeypatch.setattr(ai_stream.ai_service, 'stream_generate_response', lambda *a, **kw: iter([('message', 'x')] * 100))
    data = StreamChatRequest(text='Review', databaseId='db')
    events = list(ai_stream._stream_response(data, 'owner', 'Review', None, []))
    assert len(events) == 100 and len(counter) <= 3
    print(f"100 SSE fragments: {len(counter)} SQLite commits")
    with knowledge['sessions']() as s: assert s.query(AIChatMessage).count() == 1

def test_embedding_credentials_are_owner_scoped_and_follow_rotation(knowledge, monkeypatch):
    from routes.ai_config import cipher
    from services.ai.langchain_runtime import get_ai_api_key
    from services.ai.retrieval.embedding_gateway import GeminiEmbeddingGateway
    monkeypatch.setattr('services.ai.langchain_runtime.SessionLocal', knowledge['sessions'])
    with knowledge['sessions']() as s:
        s.add(UserAIConfig(id='review-google', userId='other', provider='Google', apiKey=cipher.encrypt(b'fake-review-key').decode()))
        s.commit()
    assert get_ai_api_key('owner', 'google') is None
    assert GeminiEmbeddingGateway()._get_api_key() is None
    assert GeminiEmbeddingGateway(user_id='owner')._get_api_key() is None
    gateway = GeminiEmbeddingGateway(user_id='other')
    assert gateway._get_api_key() == 'fake-review-key'
    with knowledge['sessions']() as s:
        config = s.get(UserAIConfig, 'review-google')
        config.apiKey = cipher.encrypt(b'rotated-fake-key').decode()
        s.commit()
    assert gateway._get_api_key() == 'rotated-fake-key'
    with knowledge['sessions']() as s:
        s.delete(s.get(UserAIConfig, 'review-google')); s.commit()
    assert gateway._get_api_key() is None

def test_candidate_load_does_not_deserialize_unused_vectors(knowledge):
    with knowledge['sessions']() as s:
        source = RagSource(id='review-source', sourceType='document', databaseId='db', userId='owner', title='Review', status='indexed', contentHash='x')
        s.add(source); s.flush()
        for i in range(1000):
            s.add(RagChunk(id=f'review-{i}', sourceId=source.id, chunkType='document', content='Document', contentHash='x'))
            s.add(RagEmbedding(id=f'emb-{i}', chunkId=f'review-{i}', embeddingModel='fake', embeddingProvider='fake', dimensions=1536, vectorJson=[0.1]*1536))
        s.commit()
    gc.collect(); tracemalloc.start()
    with knowledge['sessions']() as s:
        rows = RagRetrievalService(VectorGateway())._load_candidate_rows(s, 'db', 'owner', None)
        _, peak = tracemalloc.get_traced_memory()
        assert len(rows) == 1000 and len(rows[0]) == 2
        assert not any(isinstance(obj, RagEmbedding) for obj in s.identity_map.values())
        assert peak < 20 * 1024**2
    tracemalloc.stop()
    print(f"1000 candidates x 1536 vector dimensions: {peak / 1024**2:.2f} MiB peak")

def test_disabled_rag_skips_graph_and_metadata(knowledge, monkeypatch):
    from services.ai.query_understanding import QueryUnderstanding
    publish_document(knowledge, definitions={'bindings': [{'schemaName': 'main', 'tableName': 'orders'}]})
    monkeypatch.setenv('QURIODB_RAG_ENABLED', 'false')
    monkeypatch.setattr('services.ai.retrieval.graph_retrieval.graph_retrieval_service', knowledge['retrieval'])
    monkeypatch.setattr('services.ai.rag_context.rag_index_service.index_database_schema', lambda *a, **kw: {})
    builder = RagContextBuilder(Metadata(knowledge))
    understanding = QueryUnderstanding(intent='text_to_sql', retrieval_query='unmatched question', needs_retrieval=True, source_types=['database_schema', 'knowledge_document'], database_id='db', schema='main')
    package = builder.build(understanding, user_id='owner')
    assert package.retrieval_trace['retrievalMode'] == 'disabled'
    assert package.citations == []
    assert not package.retrieval_trace.get('graph', {}).get('enabled')


def test_schema_sync_reuses_chunk_ids_and_only_embeds_changed_chunks(knowledge):
    gateway = VectorGateway()
    gateway.embed_document = Mock(return_value=[1.0, 0.0])
    metadata = Metadata(knowledge)
    service = RagIndexService(metadata, gateway)
    service.index_database_schema('db', 'main', user_id='owner')
    with knowledge['sessions']() as session:
        before = {c.objectName: c.id for c in session.query(RagChunk)}
    calls = gateway.embed_document.call_count
    service.index_database_schema('db', 'main', user_id='owner')
    assert gateway.embed_document.call_count == calls
    with knowledge['sessions']() as session:
        assert {c.objectName: c.id for c in session.query(RagChunk)} == before
    knowledge['columns']['orders'].append({'name': 'total', 'type': 'REAL'})
    service.index_database_schema('db', 'main', user_id='owner')
    assert gateway.embed_document.call_count == calls + 1
    with knowledge['sessions']() as session:
        assert session.get(RagChunk, before['customers']) is not None
        assert session.get(RagChunk, before['orders']) is None


def test_identifier_contract_reuses_cross_schema_metadata():
    meta = SimpleNamespace(get_all_columns=Mock(return_value={'Orders': [{'name': 'OrderId'}]}))
    items = [{'sourceType': 'database_schema', 'chunkType': 'table', 'objectName': 'Orders',
              'schemaName': schema} for schema in ('main', 'archive', 'archive')]
    result = RagContextBuilder(meta)._format_identifier_guard('postgresql', 'db', 'main', items)
    assert meta.get_all_columns.call_count == 2
    assert any('"archive"."Orders"."OrderId"' in line for line in result)
    assert sum(line.count('archive.Orders') for line in result) == 1


def test_stream_disconnect_flushes_pending_events(knowledge, monkeypatch):
    import json
    from routes import ai_stream
    from schemas.ai import StreamChatRequest
    monkeypatch.setattr(ai_stream, 'SessionLocal', knowledge['sessions'])
    monkeypatch.setattr(ai_stream.ai_service, 'stream_generate_response',
                        lambda *a, **kw: iter([('message', 'first'), ('message', ' last'), ('message', ' unseen')]))
    stream = ai_stream._stream_response(StreamChatRequest(text='Review', databaseId='db'), 'owner', 'Review', None, [])
    next(stream)
    next(stream)
    stream.close()
    with knowledge['sessions']() as session:
        payload = json.loads(session.query(AIChatMessage).one().content)
    assert payload['content'] == 'first last'


def test_autocomplete_uses_owner_scoped_graph_context_without_triage(monkeypatch):
    from services.ai_service import AIService
    from services.ai.retrieval.pipeline import rag_pipeline_service
    build = Mock(return_value=SimpleNamespace(context='Reviewed revenue definition'))
    monkeypatch.setattr(rag_pipeline_service, 'build_context_for_understanding', build)
    monkeypatch.setattr(rag_pipeline_service, 'understand_query', Mock(side_effect=AssertionError('No classifier needed')))
    monkeypatch.setattr('services.ai_service.SchemaMetadataSource.get_db_type', lambda *_: 'sqlite')
    invoke = Mock(return_value='amount')
    monkeypatch.setattr('services.ai_service.langchain_runtime.invoke_text', invoke)
    monkeypatch.setattr('services.ai_service.langchain_runtime.resolve_provider', lambda **_: 'google')
    monkeypatch.setattr('services.ai_service.task_model_router.resolve_model_id', lambda *args: 'fake')
    result = AIService().autocomplete_sql('db', 'main', 'SELECT SUM(', ') FROM orders', user_id='owner')
    assert result == {'completion': 'amount'}
    understanding = build.call_args.args[0]
    assert 'knowledge_document' in understanding.source_types
    assert understanding.rag_mode == 'shallow'
    assert build.call_args.kwargs['user_id'] == 'owner'
    assert 'Reviewed revenue definition' in invoke.call_args.kwargs['system_prompt']
    assert invoke.call_args.kwargs['max_tokens'] == 128


def test_relational_agent_uses_common_context_in_graph_and_legacy(monkeypatch):
    from services.ai.agent import AgentAIService
    context = SimpleNamespace(context='Reviewed definition', retrieval_trace={'graph': {'enabled': True}}, citations=[{'id': 'kb:revision'}])
    build = Mock(return_value=context)
    monkeypatch.setattr('services.ai.agent.rag_pipeline_service.build_sql_context', build)
    service = AgentAIService()
    monkeypatch.setattr(service._context_mgr, 'build_context_for_agent', lambda *_: '')
    state = service._agent_prepare_node({'db_id': 'db', 'schema': 'main', 'prompt': 'Revenue', 'user_id': 'owner'})
    assert state['citations'] == context.citations
    assert 'Reviewed definition' in state['system_prompt']
    monkeypatch.setattr(service, '_generate_response', lambda *a, **kw: '{"type":"error","message":"Stop"}')
    service._execute_agent_legacy('Revenue', 'db', 'main', user_id='owner')
    assert build.call_count == 2
    assert all(call.kwargs['user_id'] == 'owner' and call.kwargs['deep'] for call in build.call_args_list)


def test_real_schema_reflection_retains_indexes_vectors_and_hash(knowledge, monkeypatch):
    from sqlalchemy import create_engine
    from services.ai.retrieval.schema_graph import SchemaGraphService
    engine = create_engine('sqlite://')
    with engine.begin() as connection:
        connection.exec_driver_sql('CREATE TABLE customers(id INT PRIMARY KEY)')
        connection.exec_driver_sql('CREATE TABLE orders(id INT, customer_id INT REFERENCES customers(id))')
        connection.exec_driver_sql('CREATE INDEX orders_customer ON orders(customer_id)')
        monkeypatch.setattr('services.ai.retrieval.schema_graph.BaseDatabaseService.run_dynamic_query',
                            lambda self, db, operation: operation(connection))
        indexer = RagIndexService(embedding_gateway=VectorGateway())
        result = indexer.index_database_schema('db', 'main', user_id='owner')
        with knowledge['sessions']() as session:
            before = [(c.id, c.content) for c in session.query(RagChunk).order_by(RagChunk.id)]
            embedding_count = session.query(RagEmbedding).count()
        synced = SchemaGraphService(knowledge['sessions']).sync('db', 'main')
        assert result['snapshotHash'] == synced['snapshotHash']
        with knowledge['sessions']() as session:
            assert [(c.id, c.content) for c in session.query(RagChunk).order_by(RagChunk.id)] == before
            assert session.query(RagEmbedding).count() == embedding_count > 0
        assert any('orders_customer' in content for _, content in before)


@pytest.mark.parametrize('action', [None, 'Explain', 'Optimize'])
def test_stream_flushes_on_size_time_and_completion(knowledge, monkeypatch, action):
    import json
    from routes import ai_stream
    from schemas.ai import StreamChatRequest
    commits = []
    event.listen(knowledge['sessions'], 'after_commit', lambda session: commits.append(1))
    monkeypatch.setattr(ai_stream, 'SessionLocal', knowledge['sessions'])
    monkeypatch.setattr(ai_stream, 'time', SimpleNamespace(monotonic=Mock(side_effect=[0, 0, .1, 1.2, 1.3])))
    fragments = [('message', 'a'), ('message', 'b' * 4096), ('message', 'c'), ('message', 'd')]
    monkeypatch.setattr(ai_stream.ai_service, 'stream_generate_response', lambda *a, **kw: iter(fragments))
    data = StreamChatRequest(text='Review', databaseId='db')
    stream = ai_stream._stream_response(data, 'owner', 'Review', None, []) if action is None else ai_stream._stream_action_response(data, 'owner', 'Review', None, [], action)
    assert len(list(stream)) == 4
    assert len(commits) == 4  # Initial, size, elapsed time, final.
    with knowledge['sessions']() as session:
        assert json.loads(session.query(AIChatMessage).one().content)['content'] == 'a' + 'b' * 4096 + 'cd'


@pytest.mark.parametrize('scope', ['base', 'schema'])
def test_vector_top_k_applies_base_and_schema_scope_first(knowledge, monkeypatch, scope):
    from schemas.knowledge import BaseCreate
    monkeypatch.setattr(sqlite_vec_store, '_available_cache', None)
    doc, _ = publish_document(knowledge)
    other_base = knowledge['service'].create_base(BaseCreate(name='Other', databaseId='db', enabledForSql=True), 'owner')
    other_doc, _ = publish_document({**knowledge, 'base': other_base})
    with knowledge['sessions']() as session:
        live_source = session.get(RagSource, f"knowledge:{doc['activeRevisionId']}")
        live_chunk = session.query(RagChunk).filter_by(sourceId=live_source.id).one()
        sqlite_vec_store.upsert_embedding(session, live_chunk, live_source, [0.8, 0.6])
        other_source = session.get(RagSource, f"knowledge:{other_doc['activeRevisionId']}")
        for i in range(40):
            chunk = RagChunk(id=f'other-scope-{i}', sourceId=other_source.id, chunkType='knowledge_document',
                             content='Other context', contentHash=f'other-{i}', metadataJson={'schemas': ['archive']})
            session.add(chunk); session.flush()
            sqlite_vec_store.upsert_embedding(session, chunk, other_source, [1.0, 0.0])
        session.commit()
    filters = {'knowledge_base_id': knowledge['base']['id']} if scope == 'base' else {'schema_name': 'main'}
    result = RagRetrievalService(VectorGateway()).retrieve('zqxsignal', database_id='db', user_id='owner',
                        source_types=['knowledge_document'], top_k=1, candidate_limit=32, **filters)
    assert result['items'][0]['sourceId'] == f"knowledge:{doc['activeRevisionId']}"
    assert result['items'][0]['semanticScore'] > 0
