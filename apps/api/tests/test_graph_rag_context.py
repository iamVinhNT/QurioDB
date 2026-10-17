"""test_graph_rag_context.py — Required bridge coverage, role ambiguity and reviewed conflicts."""
from collections import defaultdict
from types import SimpleNamespace
from services.ai.retrieval.graph_retrieval import find_paths
from services.ai.retrieval.schema_graph import node_id
from tests.knowledge_fixtures import knowledge, publish_document


def seeds(*tables):
    return [{'sourceType':'database_schema','chunkType':'table','objectName':t,'schemaName':'main','content':t} for t in tables]


def test_retrieval_adds_required_bridge_and_key_pairs(knowledge):
    publish_document(knowledge);knowledge['graph'].sync('db','main')
    items,trace=knowledge['retrieval'].expand('customers refunds',seeds('customers','refunds'),'db','main','owner')
    assert trace['gaps']==[]
    assert trace['tableCount']==3
    assert 'orders' in {i.get('objectName') for i in items}
    joins=' '.join(i['content'] for i in items if i.get('chunkType')=='join_path')
    assert 'customer_id' in joins and 'order_id' in joins


def test_equal_paths_are_ambiguous_unless_role_identifies_one(knowledge):
    publish_document(knowledge)
    knowledge['fks'].append({'table':'orders','foreignTable':'customers','columnPairs':[('id','id')],'column':'id','foreignColumn':'id','constraint':'billing'})
    knowledge['graph'].sync('db','main')
    _,trace=knowledge['retrieval'].expand('orders customers',seeds('orders','customers'),'db','main','owner')
    assert 'ambiguous_join_path' in trace['gaps']
    _,trace=knowledge['retrieval'].expand('billing orders customers',seeds('orders','customers'),'db','main','owner')
    assert 'ambiguous_join_path' not in trace['gaps']


def test_bounded_traversal_reports_exhaustion():
    adjacency=defaultdict(list)
    for i in range(80):
        adjacency['root'].append((str(i),SimpleNamespace(id=str(i))))
    paths,truncated=find_paths('root','missing',adjacency)
    assert paths==[] and truncated


def test_conflicting_published_metrics_are_not_silently_chosen(knowledge):
    for formula in ['SUM(amount)','SUM(amount)-SUM(refunds)']:
        publish_document(knowledge,definitions={'definitions':[{'kind':'metric','name':'Doanh thu','formula':formula,'grain':'order'}]})
    _,trace=knowledge['retrieval'].expand('doanh thu',[],'db','main','owner')
    assert 'conflicting_knowledge_definition:Doanh thu' in trace['gaps']


def test_longer_alternative_path_is_not_automatically_discarded():
    adjacency=defaultdict(list)
    for left,right,name in [('a','c','direct'),('a','b','role1'),('b','c','role2')]:
        edge=SimpleNamespace(id=name)
        adjacency[left].append((right,edge));adjacency[right].append((left,edge))
    paths,truncated=find_paths('a','c',adjacency)
    assert sorted(map(len,paths))==[1,2] and not truncated


def test_small_schema_fallback_is_complete_and_bounded(knowledge):
    publish_document(knowledge);knowledge['graph'].sync('db','main')
    items,trace=knowledge['retrieval'].expand('các đối tượng dữ liệu',[],'db','main','owner')
    assert trace['fallback']=='small_full_schema'
    assert {i.get('objectName') for i in items}=={'customers','orders','refunds'}
    assert trace['tableCount']<=40


def test_join_citation_does_not_displace_metric_text_and_points_to_reviewed_section(knowledge):
    from services.ai.retrieval.retrieval_service import RagRetrievalService
    from services.ai.rag_context import RagContextBuilder
    from tests.knowledge_fixtures import OfflineGateway
    definition={'bindings':[{'schemaName':'main','tableName':t} for t in ['orders','customers']],
        'definitions':[{'kind':'metric','name':'Revenue','formula':'SUM(amount)','grain':'order'}],
        'joins':[{'source':{'schemaName':'main','tableName':'orders'},'target':{'schemaName':'main','tableName':'customers'},
                  'columnPairs':[['customer_id','id']],'role':'business','confirmed':True}]}
    publish_document(knowledge,definitions=definition)
    original=RagRetrievalService(embedding_gateway=OfflineGateway()).retrieve('business orders customers Revenue',database_id='db',user_id='owner',top_k=20)['items']
    expanded,trace=knowledge['retrieval'].expand('business orders customers Revenue',original,'db','main','owner')
    joins=[i for i in expanded if i.get('chunkType')=='join_path']
    assert joins and joins[0]['citation']['section']=='section-1'
    assert joins[0]['citation']['id'] not in {i['citation']['id'] for i in original}
    builder=RagContextBuilder();builder._max_context_tokens=lambda _:10000
    selected=builder._budget_items(expanded,None)
    assert any('SUM(amount)' in i['content'] for i in selected)
