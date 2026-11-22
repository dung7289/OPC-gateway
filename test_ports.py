import socket

print("=== Checking common OPC UA ports on localhost ===")
for port in [4840, 4841, 4842, 4843, 49320, 49330, 49340, 7890, 8890]:
    try:
        s = socket.create_connection(("127.0.0.1", port), timeout=1)
        s.close()
        print(f"  Port {port}: OPEN -> opc.tcp://localhost:{port}")
    except:
        print(f"  Port {port}: closed")
