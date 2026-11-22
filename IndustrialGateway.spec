# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['backend/main.py'],
    pathex=['backend'],
    binaries=[],
    datas=[('frontend/dist', 'frontend/dist')],
    hiddenimports=['uvicorn.protocols.http.auto', 'uvicorn.protocols.websockets.auto', 'uvicorn.lifespans.on', 'aiosqlite', 'cryptography', 'opcua', 'pymodbus', 'snap7', 'paho.mqtt', 'comtypes', 'comtypes.client', 'comtypes.automation'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='IndustrialGateway',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='IndustrialGateway',
)
