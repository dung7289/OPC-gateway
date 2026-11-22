import sys, asyncio
sys.path.insert(0, 'backend')

async def test_opcua_endpoint(endpoint):
    from opcua import Client
    print(f'\n=== CONNECTING OPC UA -> {endpoint} ===')
    try:
        import asyncio
        loop = asyncio.get_event_loop()
        c = Client(endpoint)
        c.session_timeout = 5000
        await loop.run_in_executor(None, c.connect)
        print('  OPC UA Connected!')
        objects = c.get_objects_node()
        children = await loop.run_in_executor(None, objects.get_children)
        for child in children[:5]:
            bname = child.get_browse_name().Name
            cid = child.nodeid.to_string()
            print(f'  Child: {bname} | NodeId: {cid}')
        await loop.run_in_executor(None, c.disconnect)
        return True
    except Exception as e:
        print(f'  FAIL: {e}')
        return False

async def main():
    # Test all open ports
    r1 = await test_opcua_endpoint('opc.tcp://localhost:4840')
    r2 = await test_opcua_endpoint('opc.tcp://localhost:49320')
    r3 = await test_opcua_endpoint('opc.tcp://localhost:8890')
    print(f'\n=== SUMMARY ===')
    print(f'  opc.tcp://localhost:4840  : {"OK" if r1 else "FAIL"}')
    print(f'  opc.tcp://localhost:49320 : {"OK" if r2 else "FAIL"}')
    print(f'  opc.tcp://localhost:8890  : {"OK" if r3 else "FAIL"}')

asyncio.run(main())
