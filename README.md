# 🏭 Industrial Gateway

Phần mềm kết nối PLC/IoT tương tự Kepware — hỗ trợ **Modbus TCP/RTU, Siemens S7, MQTT, OPC-UA**.

---

## ✨ Tính năng

| Tính năng | Mô tả |
|-----------|-------|
| **Connection Manager** | Thêm/sửa/xóa kết nối đến thiết bị PLC, IoT |
| **Modbus TCP/RTU** | Đọc/ghi Coils (`CO:`), Holding Registers (`HR:`), Input Registers (`IR:`), Discrete Inputs (`DI:`) |
| **Siemens S7** | Đọc/ghi DB (`DB1.DBW0`), Memory (`M0.0`), I/O (`Q0.0`, `I0.0`) |
| **MQTT** | Subscribe/Publish topics, cache giá trị realtime |
| **OPC-UA** | Đọc/ghi NodeId (e.g. `ns=2;i=1001`) |
| **Tag Engine** | Polling bất đồng bộ, nhóm theo scan rate |
| **WebSocket** | Push giá trị realtime về Dashboard |
| **Forward Engine** | Tự động forward tags → MQTT Broker |
| **REST API** | Full CRUD cho connections & tags |
| **Web UI** | Dashboard realtime, quản lý connections & tags, event logs |

---

## 🚀 Khởi động nhanh

### 1. Backend (Python)

```powershell
cd backend

# Tạo virtual environment
python -m venv venv
venv\Scripts\activate

# Cài dependencies
pip install -r requirements.txt

# Khởi động server (port 8000)
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### 2. Frontend (React)

```powershell
cd frontend

# Cài dependencies (đã có node_modules nếu build rồi)
npm install

# Chạy dev server (port 5173)
npm run dev
```

Mở trình duyệt: **http://localhost:5173**

---

## 📡 Giao thức hỗ trợ

### Modbus TCP
```
Host: 192.168.1.10
Port: 502
Address format:
  HR:0    → Holding Register 0
  CO:5    → Coil 5
  IR:10   → Input Register 10
  DI:3    → Discrete Input 3
```

### Siemens S7 (Snap7)
```
Host: 192.168.1.20
Rack: 0, Slot: 1
Address format:
  DB1.DBW0   → Data Block 1, Word at offset 0
  DB1.DBD4   → Data Block 1, DWord at offset 4
  DB1.DBX0.0 → Data Block 1, Bit 0.0
  M0.0       → Memory bit 0.0
  Q0.0       → Output bit 0.0
  I0.0       → Input bit 0.0

> Yêu cầu snap7 native DLL:
> Windows: Tải snap7.dll từ https://snap7.sourceforge.net/
```

### MQTT
```
Broker: mqtt://broker.example.com
Port: 1883
Address = Topic: sensors/temperature
```

### OPC-UA
```
Endpoint: opc.tcp://192.168.1.30:4840
Address = NodeId: ns=2;i=1001
```

---

## 🔌 REST API

### Connections
| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/api/connections` | Danh sách connections |
| POST | `/api/connections` | Tạo connection mới |
| PUT | `/api/connections/{id}` | Cập nhật connection |
| DELETE | `/api/connections/{id}` | Xóa connection |
| POST | `/api/connections/{id}/reconnect` | Kết nối lại |

### Tags
| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/api/tags` | Danh sách tags (kèm giá trị realtime) |
| POST | `/api/tags` | Tạo tag mới |
| PUT | `/api/tags/{id}` | Cập nhật tag |
| DELETE | `/api/tags/{id}` | Xóa tag |
| POST | `/api/tags/{id}/write` | Ghi giá trị vào thiết bị |

### WebSocket
```
ws://localhost:8000/ws

Message format:
{
  "type": "tag_update",
  "data": {
    "tag_id": 1,
    "value": 23.5,
    "quality": "Good",
    "timestamp": "2026-11-17T14:30:00Z"
  }
}
```

---

## ⚙️ Forward Engine

Tạo file `backend/forward_config.json` để forward tự động:

```json
{
  "mqtt": {
    "enabled": true,
    "broker": "mqtt://localhost:1883",
    "username": "",
    "password": "",
    "topic_prefix": "gateway"
  }
}
```

Tags sẽ được publish theo pattern: `gateway/{connection_name}/{tag_name}`

---

## 🛠️ Cấu trúc dự án

```
industrial-gateway/
├── backend/
│   ├── main.py                  # FastAPI entry point
│   ├── requirements.txt
│   ├── gateway.db               # SQLite (tự tạo khi chạy lần đầu)
│   ├── core/
│   │   ├── driver_manager.py    # Quản lý drivers (Singleton)
│   │   ├── tag_engine.py        # Polling engine (Singleton)
│   │   └── forward_engine.py    # MQTT forward (Singleton)
│   ├── drivers/
│   │   ├── base_driver.py       # Abstract base class
│   │   ├── modbus_driver.py     # pymodbus
│   │   ├── s7_driver.py         # python-snap7
│   │   ├── mqtt_driver.py       # paho-mqtt
│   │   └── opcua_driver.py      # opcua-asyncio
│   ├── api/
│   │   ├── connections.py       # CRUD API
│   │   ├── tags.py              # CRUD + write API
│   │   ├── websocket.py         # WS endpoint
│   │   └── logs.py              # Event logs API
│   ├── models/
│   │   ├── connection.py        # Pydantic schemas
│   │   └── tag.py
│   └── db/
│       └── database.py          # aiosqlite setup
└── frontend/
    ├── src/
    │   ├── App.jsx
    │   ├── pages/               # Dashboard, Connections, Tags, Logs
    │   ├── components/          # Layout, Forms, Chart, Badges
    │   ├── api/                 # Axios calls
    │   ├── hooks/               # useWebSocket
    │   └── store/               # Zustand store
    └── package.json
```

---

## 📦 Dependencies

### Backend
- `fastapi` + `uvicorn` — Web framework
- `pymodbus` — Modbus TCP/RTU
- `python-snap7` — Siemens S7
- `paho-mqtt` — MQTT client
- `opcua` — OPC-UA client
- `aiosqlite` — Async SQLite

### Frontend
- `react` + `vite` — SPA framework
- `@tanstack/react-query` — Data fetching
- `zustand` — State management
- `recharts` — Realtime charts
- `axios` — HTTP client
- `lucide-react` — Icons
- `react-hot-toast` — Notifications
