"""test_rag_schema_graph.py — Composite keys, snapshot freshness and qualified identities."""
import pytest
from models import GraphEdge, RagSource
from services.ai.retrieval.schema_graph import node_id
from services.knowledge_access import active_source_ids
from tests.knowledge_fixtures import knowledge, publish_document


def test_composite_key_pairs_and_cross_schema_identity(knowledge):
    graph = knowledge['graph']
    columns = {'orders': [{'name':'tenant','type':'INT'},{'name':'id','type':'INT'}]}
    graph.store_snapshot('db','a',columns,[], 'postgresql')
    graph.store_snapshot('db','b',{'items':[{'name':'tenant','type':'INT'},{'name':'order_id','type':'INT'}]},[
        {'table':'items','foreignTable':'orders','foreignSchema':'a','columnPairs':[('tenant','tenant'),('order_id','id')], 'column':'tenant,order_id','foreignColumn':'tenant,id'}], 'postgresql')
    result=knowledge['retrieval'].inspect('db','owner')
    edge=next(e for e in result['edges'] if e['relation']=='FOREIGN_KEY')
    assert edge['payloadJson']['columnPairs']==[['tenant','tenant'],['order_id','id']]
    assert edge['targetId']==node_id('db','a','orders')
    assert node_id('db','a','orders')!=node_id('db','b','orders')
    assert node_id('db','a','Orders')!=node_id('db','a','orders')


def test_drop_revokes_document_without_physical_cleanup(knowledge):
    doc,_=publish_document(knowledge,definitions={'bindings':[{'schemaName':'main','tableName':'orders','columnName':'customer_id'}]})
    with knowledge['sessions']() as session:
        assert active_source_ids(session,'owner','db')
    changed=dict(knowledge['columns']);changed['orders']=[{'name':'id','type':'INTEGER'}]
    knowledge['graph'].store_snapshot('db','main',changed,[], 'sqlite')
    with knowledge['sessions']() as session:
        assert active_source_ids(session,'owner','db')==set()
        assert session.get(RagSource,f"knowledge:{doc['activeRevisionId']}") is not None
    graph=knowledge['retrieval'].inspect('db','owner')
    assert not [n for n in graph['nodes'] if n['revisionId']]


def test_failed_reflection_does_not_replace_snapshot(knowledge):
    graph=knowledge['graph'];graph.sync('db','main')
    before=knowledge['retrieval'].inspect('db','owner')
    graph.reflect=lambda *_: (_ for _ in ()).throw(ConnectionError('offline'))
    with pytest.raises(ConnectionError):graph.sync('db','main')
    assert knowledge['retrieval'].inspect('db','owner')==before


def test_cross_schema_fk_target_remains_invisible_until_synced(knowledge):
    knowledge['graph'].store_snapshot('db','a',{'items':[{'name':'order_id','type':'INT'}]},[
        {'table':'items','foreignTable':'orders','foreignSchema':'b','columnPairs':[('order_id','id')], 'column':'order_id','foreignColumn':'id'}], 'postgresql')
    graph=knowledge['retrieval'].inspect('db','owner')
    assert not [e for e in graph['edges'] if e['relation']=='FOREIGN_KEY']
    knowledge['graph'].store_snapshot('db','b',{'orders':[{'name':'id','type':'INT'}]},[], 'postgresql')
    graph=knowledge['retrieval'].inspect('db','owner')
    assert len([e for e in graph['edges'] if e['relation']=='FOREIGN_KEY'])==1
