"""smoke_knowledge_sidecar.py — Isolated Linux frozen-sidecar knowledge publication, restart and shutdown smoke.

All data and application HOME directories are temporary; no provider calls.
"""
import json, os, shutil, socket, sqlite3, subprocess, tempfile, time, urllib.request, urllib.error
from pathlib import Path
import psutil
import statistics

def main():
    binary = Path(__file__).resolve().parents[3] / 'apps/desktop/src-tauri/bin/api-x86_64-unknown-linux-gnu'
    with tempfile.TemporaryDirectory(prefix='quriodb-frozen-') as directory:
        root = Path(directory)
        exe = root / 'api'
        shutil.copy2(binary, exe)
        owner = subprocess.Popen(['sleep', '300'])
        with socket.socket() as socket_:
            socket_.bind(('127.0.0.1', 0))
            port = socket_.getsockname()[1]
        env = {**os.environ, 'HOME': str(root), 'DISABLE_AUTH': 'true', 'QURIODB_DESKTOP_PORT': str(port), 'QURIODB_STARTUP_NONCE': 'knowledge-smoke', 'QURIODB_DESKTOP_PARENT_PID': str(owner.pid)}
        (root / 'api.env').write_text('DISABLE_AUTH=true\n')
        log = open('/tmp/quriodb-frozen-knowledge.log', 'w')
        child = subprocess.Popen([str(exe)], cwd=root, env=env, stdout=log, stderr=log)
        base = f'http://127.0.0.1:{port}/api/'

        def request(path, body=None, method=None, nonce=None):
            headers = {'Content-Type': 'application/json'}
            if nonce:
                headers['X-QurioDB-Startup-Nonce'] = nonce
            req = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None, headers=headers, method=method)
            try:
                with urllib.request.urlopen(req, timeout=3) as response:
                    return (response.status, json.load(response))
            except urllib.error.HTTPError as error:
                return (error.code, json.load(error))
        try:
            for _ in range(120):
                if child.poll() is not None:
                    raise RuntimeError('Frozen backend exited; inspect /tmp/quriodb-frozen-knowledge.log')
                try:
                    if request('desktop/health', nonce='knowledge-smoke')[0] == 200:
                        break
                except (OSError, TimeoutError):
                    pass
                time.sleep(0.5)
            else:
                raise RuntimeError('Frozen readiness timeout')
            assert request('desktop/health')[0] == 403
            assert request('health')[0] == 200
            assert (root / '.quriodb/quriodb.db').exists(), 'metadata must be isolated under temporary HOME'
            target = root / 'sales.sqlite'
            db = sqlite3.connect(target)
            db.executescript('CREATE TABLE orders(id INT, amount REAL); CREATE INDEX orders_amount ON orders(amount); INSERT INTO orders VALUES(1,100)')
            db.close()
            metadata = sqlite3.connect(root / '.quriodb/quriodb.db')
            metadata.execute('INSERT INTO databases (id,type,databaseName,config) VALUES (?,?,?,?)', ('smoke-db', 'sqlite', 'smoke', json.dumps({'database': str(target)})))
            metadata.commit()
            metadata.close()
            status, kb = request('knowledge-bases', {'name': 'Frozen knowledge', 'databaseId': 'smoke-db', 'enabledForSql': True})
            assert status == 201, (status, kb)
            status, doc = request(f"knowledge-bases/{kb['id']}/documents", {'title': 'Doanh thu', 'bodyMarkdown': '# Doanh thu\nTổng orders.amount', 'definitionData': {'bindings': [{'schemaName': 'main', 'tableName': 'orders'}]}})
            assert status == 201, (status, doc)
            status, job = request(f"knowledge-documents/{doc['id']}/publish", {'expectedVersion': 1, 'lexicalOnly': True})
            assert status == 202, (status, job)
            for _ in range(60):
                status, job = request(f"knowledge-jobs/{job['id']}")
                if job['status'] in ('succeeded', 'failed'):
                    break
                time.sleep(0.2)
            assert job['status'] == 'succeeded', job
            def schema_chunks():
                with sqlite3.connect(root / '.quriodb/quriodb.db') as metadata:
                    return metadata.execute('SELECT id, content FROM rag_chunks WHERE sourceId=? ORDER BY id',
                                            ('database_schema:smoke-db:main',)).fetchall()
            before_chunks = schema_chunks()
            assert any('orders_amount' in content for _, content in before_chunks)
            status, indexed = request('rag/index/database/smoke-db?schema=main', {}, method='POST')
            assert status == 200 and indexed['status'] == 'indexed', (status, indexed)
            assert schema_chunks() == before_chunks, 'unchanged index must retain chunk IDs and index evidence'
            status, synced = request(f"knowledge-bases/{kb['id']}/sync-schema", {'schemaName': 'main'})
            assert status == 200 and synced['status'] == 'synced', (status, synced)
            assert schema_chunks() == before_chunks, 'graph sync must reuse the same schema chunks'
            status, preview = request(f"knowledge-bases/{kb['id']}/preview-context", {'query': 'Doanh thu orders', 'schemaName': 'main'})
            assert status == 200, (status, preview)
            assert preview['executesSql'] is False and any((i['sourceType'] == 'knowledge_document' for i in preview['items']))
            assert request(f"knowledge-documents/{doc['id']}/revisions/{job['revisionId']}")[0] == 200
            graph = request(f"rag/graph?databaseId=smoke-db&knowledgeBaseId={kb['id']}")[1]
            assert graph['nodes']
            latencies = []
            rss_samples = []
            for _ in range(10):
                started = time.perf_counter()
                status, sample = request(f"knowledge-bases/{kb['id']}/preview-context", {'query': 'Doanh thu orders', 'schemaName': 'main'})
                assert status == 200
                latencies.append((time.perf_counter() - started) * 1000)
                processes = [psutil.Process(child.pid), *psutil.Process(child.pid).children(recursive=True)]
                rss_samples.append(sum((process.memory_info().rss for process in processes)) / 2 ** 20)
            metrics = {'samples': 10, 'mode': 'offline lexical + graph HTTP preview', 'p50Ms': round(statistics.median(latencies), 2), 'p95Ms': round(sorted(latencies)[-1], 2), 'maxSampledProcessTreeRssMiB': round(max(rss_samples), 2), 'documents': 1, 'tables': 1, 'evidenceItems': len(preview['items'])}
            child.terminate()
            child.wait(timeout=20)
            metadata = sqlite3.connect(root / '.quriodb/quriodb.db')
            metadata.execute('UPDATE knowledge_index_jobs SET status=? WHERE id=?', ('running', job['id']))
            metadata.commit()
            metadata.close()
            child = subprocess.Popen([str(exe)], cwd=root, env=env, stdout=log, stderr=log)
            for _ in range(120):
                try:
                    status, recovered = request(f"knowledge-jobs/{job['id']}")
                    if status == 200 and recovered['status'] == 'succeeded':
                        break
                except (OSError, TimeoutError):
                    pass
                time.sleep(0.5)
            else:
                raise RuntimeError('Persisted job recovery timed out')
            assert request('desktop/health', nonce='knowledge-smoke')[0] == 200
            owner.terminate()
            owner.wait()
            child.wait(timeout=12)
            assert child.returncode == 0
            print(json.dumps({'result': 'PASS', 'dynamicPort': port, 'nonceHealth': True, 'publish': job['status'], 'graphNodes': len(graph['nodes']), 'previewEvidence': len(preview['items']), 'parentDeathExit': child.returncode, 'restartJobRecovery': True, 'sharedSchemaWriterStable': True, 'metadata': 'temporary HOME only', 'syntheticMetrics': metrics}))
        finally:
            if child.poll() is None:
                child.terminate()
                child.wait(timeout=20)
            if owner.poll() is None:
                owner.terminate()
                owner.wait()
            log.close()
if __name__ == '__main__':
    main()
