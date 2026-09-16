# -*- mode: python ; coding: utf-8 -*-

from PyInstaller.utils.hooks import collect_dynamic_libs


def _filter_sensitive_bundle_data(entries):
    sensitive_markers = (".env", ".env.", ".pem", ".key", "credential", "secret", "password", "token")
    return [
        entry
        for entry in entries
        if not any(marker in str(entry).replace("\\", "/").lower() for marker in sensitive_markers)
    ]


block_cipher = None


a = Analysis(
    ['../app.py'],
    pathex=[],
    binaries=collect_dynamic_libs('sqlite_vec'),
    datas=[],
    hiddenimports=[
        'uvicorn.logging',
        'uvicorn.loops.auto',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan.on',
        'passlib.handlers.bcrypt',
        'bcrypt',
        'jwt',
        'psycopg2',
        'pymongo',
        'pymysql',
        'redis',
        'cloudinary',
        'langchain',
        'langchain_core',
        'langchain_openai',
        'langchain_anthropic',
        'langchain_google_genai',
        'langgraph',
        'langsmith',
        'sqlite_vec',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
datas = _filter_sensitive_bundle_data(datas)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='api-x86_64-pc-windows-msvc',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
