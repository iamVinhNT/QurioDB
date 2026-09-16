# -*- mode: python ; coding: utf-8 -*-

from PyInstaller.utils.hooks import collect_dynamic_libs


def _filter_sensitive_bundle_data(entries):
    sensitive_markers = (".env", ".env.", ".pem", ".key", "credential", "secret", "password", "token")
    return [
        entry
        for entry in entries
        if not any(marker in str(entry).replace("\\", "/").lower() for marker in sensitive_markers)
    ]


a = Analysis(
    ['../app.py'],
    pathex=[],
    binaries=collect_dynamic_libs('sqlite_vec'),
    datas=[],
    hiddenimports=[
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
    noarchive=False,
)
datas = _filter_sensitive_bundle_data(datas)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='api-x86_64-pc-windows-gnu',
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
