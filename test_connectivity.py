import sys, asyncio, logging
sys.path.insert(0, 'backend')
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')

async def test_opcda_kepware():
    from drivers.opc_da_driver import OpcDaDriver
    cfg = {
        'id': 999,
        'name': 'TestKepware',
        'server_prog_id': 'Kepware.KEPServerEX.V6',
        'protocol': 'opc_da',
        'host': 'Kepware.KEPServerEX.V6',
        'update_rate_ms': 1000,
    }
    d = OpcDaDriver(cfg)
    print('\n=== CONNECTING OPC DA -> Kepware.KEPServerEX.V6 ===')
    ok = await d.connect()
    print(f'Connected: {ok}')
    if ok:
        print('\n=== BROWSING ROOT ===')
        result = await d.browse(None)
        print(f"  Branches: {result.get('branches', [])}")
        print(f"  Leaves:   {result.get('leaves', [])[:3]}")
        await d.disconnect()
    return ok

async def test_opcda_phoenix():
    from drivers.opc_da_driver import OpcDaDriver
    cfg = {
        'id': 998,
        'name': 'TestPhoenix',
        'server_prog_id': 'PhoenixContact.AX-Server.21',
        'protocol': 'opc_da',
        'host': 'PhoenixContact.AX-Server.21',
        'update_rate_ms': 1000,
    }
    d = OpcDaDriver(cfg)
    print('\n=== CONNECTING OPC DA -> PhoenixContact.AX-Server.21 ===')
    ok = await d.connect()
    print(f'Connected: {ok}')
    if ok:
        print('\n=== BROWSING ROOT ===')
        result = await d.browse(None)
        print(f"  Branches: {result.get('branches', [])}")
        print(f"  Leaves:   {result.get('leaves', [])[:3]}")
        await d.disconnect()
    return ok

async def test_opcua():
    from opcua import Client
    endpoint = 'opc.tcp://tangapphova.cameraddns.net:4843'
    print(f'\n=== CONNECTING OPC UA -> {endpoint} ===')
    try:
        c = Client(endpoint)
        c.connect()
        print('  OPC UA Connected!')
        root = c.get_root_node()
        objects = c.get_objects_node()
        for child in objects.get_children()[:5]:
            bname = child.get_browse_name().Name
            print(f'  Child: {bname} | NodeId: {child.nodeid.to_string()}')
        c.disconnect()
        return True
    except Exception as e:
        print(f'  OPC UA Error: {e}')
        return False

async def main():
    r1 = await test_opcda_kepware()
    r2 = await test_opcda_phoenix()
    r3 = await test_opcua()
    print(f'\n=== SUMMARY ===')
    print(f'  Kepware OPC DA : {"OK" if r1 else "FAIL"}')
    print(f'  Phoenix OPC DA : {"OK" if r2 else "FAIL"}')
    print(f'  OPC UA         : {"OK" if r3 else "FAIL"}')

asyncio.run(main())
