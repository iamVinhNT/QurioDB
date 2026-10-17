"""smoke_knowledge_desktop.py — Isolated Linux native shell readiness and sidecar shutdown smoke.

All data and application HOME directories are temporary; no provider calls.
"""
import hashlib, json, os, subprocess, tempfile, time, urllib.request
from pathlib import Path
import psutil

def main():
    repo = Path(__file__).resolve().parents[3]
    bundle = max((repo / 'apps/desktop/src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/deb').glob('QurioDB_*_amd64.deb'), key=lambda path: path.stat().st_mtime_ns)
    with tempfile.TemporaryDirectory(prefix='quriodb-native-') as directory:
        root = Path(directory)
        subprocess.run(['dpkg-deb', '--extract', str(bundle), str(root / 'bundle')], check=True)
        packaged_api = root / 'bundle/usr/bin/api'
        expected_api = repo / 'apps/desktop/src-tauri/bin/api-x86_64-unknown-linux-gnu'
        assert hashlib.file_digest(packaged_api.open('rb'), 'sha256').digest() == hashlib.file_digest(expected_api.open('rb'), 'sha256').digest(), 'Package must contain the rebuilt sidecar'
        home = root / 'home'
        home.mkdir()
        env = {**os.environ, 'HOME': str(home), 'XDG_DATA_HOME': str(home / 'data'), 'XDG_CONFIG_HOME': str(home / 'config'), 'XDG_CACHE_HOME': str(home / 'cache'), 'WEBKIT_DISABLE_DMABUF_RENDERER': '1', 'GDK_BACKEND': 'x11'}
        exe = root / 'bundle/usr/bin/quriodb-desktop'
        log = open('/tmp/quriodb-native-knowledge.log', 'w')
        app = subprocess.Popen([str(exe)], cwd=exe.parent, env=env, stdout=log, stderr=log)
        observed = []
        ready = False
        port = None
        try:
            for _ in range(100):
                if app.poll() is not None:
                    raise RuntimeError(f'Native shell exited: {app.returncode}; inspect /tmp/quriodb-native-knowledge.log')
                observed = psutil.Process(app.pid).children(recursive=True)
                for child in observed:
                    try:
                        child_env = child.environ()
                        port = child_env.get('QURIODB_DESKTOP_PORT')
                        nonce = child_env.get('QURIODB_STARTUP_NONCE')
                        if port and nonce:
                            req = urllib.request.Request(f'http://127.0.0.1:{port}/api/desktop/health', headers={'X-QurioDB-Startup-Nonce': nonce})
                            with urllib.request.urlopen(req, timeout=1) as response:
                                ready = response.status == 200
                            if ready:
                                break
                    except (psutil.Error, OSError):
                        pass
                if ready:
                    break
                time.sleep(0.5)
            assert ready, 'Native shell sidecar readiness timeout'
            assert (home / '.quriodb/quriodb.db').exists()
            app.terminate()
            app.wait(timeout=20)
            for _ in range(30):
                alive = [p for p in observed if p.is_running() and p.status() != psutil.STATUS_ZOMBIE and ('api' in p.name())]
                if not alive:
                    break
                time.sleep(0.3)
            assert not alive, 'API outlived native shell'
            print(json.dumps({'nativeLinuxShell': 'PASS', 'bundle': bundle.name, 'rebuiltSidecarMatch': True, 'dynamicPort': int(port), 'nonceReadiness': True, 'sidecarShutdown': True, 'metadata': 'temporary HOME only'}))
        finally:
            if app.poll() is None:
                app.terminate()
                app.wait(timeout=20)
            for process in observed:
                try:
                    if process.is_running() and process.status() != psutil.STATUS_ZOMBIE:
                        process.terminate()
                except psutil.Error:
                    pass
            log.close()
if __name__ == '__main__':
    main()
