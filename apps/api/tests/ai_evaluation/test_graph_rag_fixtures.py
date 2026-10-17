"""test_graph_rag_fixtures.py — Deterministic evidence coverage and controlled SQL result checks, no model accuracy claims."""
import sqlite3
import time
import pytest
from services.ai.retrieval.evaluation import graph_evidence_coverage
from tests.knowledge_fixtures import knowledge, publish_document
pytestmark=pytest.mark.rag


@pytest.mark.parametrize('question',['customers refunds','Refund totals for customers','Tổng hoàn tiền theo khách hàng'])
def test_graph_adds_full_required_evidence_over_endpoint_baseline(knowledge,question):
    doc,_=publish_document(knowledge,definitions={'bindings':[{'schemaName':'main','tableName':t} for t in ['customers','refunds']]})
    baseline=[{'sourceType':'database_schema','chunkType':'table','schemaName':'main','objectName':t,'content':t} for t in ['customers','refunds']]
    baseline.append({'sourceType':'knowledge_document','metadata':{'revisionId':doc['activeRevisionId']},'content':'reviewed knowledge'})
    expected_tables=['main.customers','main.orders','main.refunds'];expected_pairs=[('customer_id','id'),('order_id','id')]
    before=graph_evidence_coverage(baseline,expected_tables,expected_pairs)
    started=time.perf_counter()
    expanded,trace=knowledge['retrieval'].expand(question,baseline,'db','main','owner')
    latency=(time.perf_counter()-started)*1000
    after=graph_evidence_coverage(expanded,expected_tables,expected_pairs)
    assert before['requiredTableCoverage']==pytest.approx(2/3)
    assert before['joinPairCoverage']==0
    assert after['allRequiredTables'] and after['allRequiredJoinPairs']
    assert not trace['gaps'] and latency<1500


def test_controlled_results_detect_fanout_and_composite_join_errors():
    db=sqlite3.connect(':memory:')
    db.executescript('''CREATE TABLE orders(tenant INT,id INT,amount INT);
        CREATE TABLE refunds(tenant INT,order_id INT,amount INT);
        INSERT INTO orders VALUES(1,1,100),(2,1,200);
        INSERT INTO refunds VALUES(1,1,10),(1,1,5),(2,1,20);''')
    # These hand-reviewed SQL fixtures validate expected data semantics only;
    # no SQL is injected into an LLM or reported as model-generated accuracy.
    correct=db.execute('''SELECT o.tenant,o.amount-COALESCE(r.total,0) FROM orders o
        LEFT JOIN (SELECT tenant,order_id,SUM(amount) total FROM refunds GROUP BY tenant,order_id) r
        ON r.tenant=o.tenant AND r.order_id=o.id ORDER BY o.tenant''').fetchall()
    wrong=db.execute('''SELECT o.tenant,SUM(o.amount)-SUM(r.amount) FROM orders o
        JOIN refunds r ON r.order_id=o.id GROUP BY o.tenant ORDER BY o.tenant''').fetchall()
    assert correct==[(1,85),(2,180)] and wrong!=correct
    db.close()
