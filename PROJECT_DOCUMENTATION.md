# TÀI LIỆU TỔNG HỢP TOÀN BỘ DỰ ÁN: INDUSTRIAL GATEWAY

> **Phiên bản:** 1.0.0 (Portable)  
> **Kiến trúc:** FastAPI (Python 3.12) + React (Vite / Tailwind CSS) + SQLite + OPC-UA / OPC-DA Embedded  
> **Mục tiêu:** Hệ thống Gateway trung gian thu thập dữ liệu công nghiệp đa giao thức (PLC Siemens S7, Modbus TCP, MQTT IoT, OPC DA Server, OPC UA Client) và tái xuất bản (Publish) toàn bộ dữ liệu qua OPC-UA Server nội bộ chuẩn cấu trúc Kepware cho các phần mềm SCADA/HMI.

---

## 1. TỔNG QUAN HỆ THỐNG VÀ KIẾN TRÚC

```
                      +---------------------------------------+
                      |       NGUỒN DỮ LIỆU CÔNG NGHIỆP       |
                      |  - PLC Siemens (S7-200/300/1200/1500) |
                      |  - Modbus TCP Devices                 |
                      |  - MQTT Brokers (JSON Payload)        |
                      |  - OPC-DA (Phoenix Contact / Kepware) |
                      |  - OPC-UA Servers từ xa               |
                      +-------------------+-------------------+
                                          |
                                          v
+---------------------------------------------------------------------------------+
|                       INDUSTRIAL GATEWAY (ỨNG DỤNG LÕI)                         |
|                                                                                 |
|  [Drivers Manager] -> Quản lý kết nối & lấy dữ liệu định kỳ (Scan Engine)       |
|  [Tag Engine]      -> Bộ nhớ đệm thời gian thực (In-Memory Cache, 100ms cycle)  |
|  [REST & WebSocket]-> API điều khiển & Cập nhật dữ liệu Live lên giao diện Web   |
|  [SQLite Database] -> Lưu trữ cấu hình kênh kết nối, cây thư mục, thẻ tags      |
|  [OPC-UA Server]   -> Xuất bản cây Tag chuẩn Kepware (opc.tcp://0.0.0.0:4841)   |
+-----------------------------------------+---------------------------------------+
                                          |
                     +--------------------+--------------------+
                     |                                         |
                     v                                         v
       +----------------------------+            +----------------------------+
       |   GIAO DIỆN WEB QUẢN TRỊ   |            |     SCADA / HMI CLIENTS    |
       |  - React + Tailwind CSS    |            |  - WinCC, iFix, InTouch    |
       |  - Quản lý cây thư mục     |            |  - Ignition, Kepware Client|
       |  - Scan & Import Tags      |            |  - UaExpert, Mobile SCADA  |
       +----------------------------+            +----------------------------+
```

---

## 2. CÁC GIAO THỨC & TÍNH NĂNG ĐÃ XÂY DỰNG

### 2.1. Bộ điều khiển kết nối (Protocol Drivers)
1. **Siemens S7 Driver (`snap7`)**:
   - Kết nối S7-200, S7-300, S7-400, S7-1200, S7-1500 qua TCP port 102.
   - Hỗ trợ cú pháp địa chỉ công nghiệp: `DB1.DBD0`, `DB1.DBX0.0`, `M0.0`, `MW10`, `IW0`, `Q0.0`.
2. **Modbus TCP Driver (`pymodbus`)**:
   - Hỗ trợ Holding Registers (4x), Input Registers (3x), Coils (0x), Discrete Inputs (1x).
   - Xử lý các kiểu dữ liệu hoán đổi byte/word: `int16`, `uint16`, `int32`, `int32_swap`, `float32`, `float32_swap`, `float32_be`, `float32_le`.
3. **MQTT IoT Driver (`paho-mqtt`)**:
   - Subscribe topic từ Broker (EMQX, Mosquitto, HiveMQ...).
   - Tính năng **Auto Tag (JSON)**: Tự động phân tích cây cấu trúc JSON payload thành danh sách Tag và tạo thư mục tương ứng chỉ bằng 1 cú click.
4. **OPC-DA Client Driver (`pywin32` / Windows COM)**:
   - Kết nối trực tiếp với các OPC-DA Server 32-bit/64-bit chạy trên Windows.
   - Tương thích tốt với **Phoenix Contact AX-Server** (`PhoenixContact.AX-Server.21`) và **Kepware EX** (`Kepware.KEPServerEX.V6`).
   - Cung cấp giao diện **Tag Browser**: Quét duyệt toàn bộ cây phân cấp của OPC DA Server và nhập hàng loạt (Batch Import) vào hệ thống.
5. **OPC-UA Client Driver (`opcua`)**:
   - Kết nối tới các OPC UA Endpoint từ xa (hỗ trợ cả kết nối qua mạng LAN, Internet, DDNS).
   - Tự động duyệt đệ quy toàn bộ Namespace và các nhánh thư mục để import tag nhanh chóng.

---

### 2.2. Hệ thống Quản lý Tag theo Cây Phân Cấp (Kepware Tree Structure)
- **Cấu trúc phân cấp đa tầng (Hierarchical Subfolders)**:
  - Cho phép tạo thư mục con không giới hạn cấp độ bên trong các kênh kết nối (ví dụ: `DAIPHUC/TRAM_2/BOM_1`).
  - Hỗ trợ mở rộng/thu gọn thư mục dạng cây với các biểu tượng chevron và số lượng tag tổng/trực tiếp.
- **Thanh công cụ cố định (Sticky Toolbar)**:
  - Thanh công cụ thêm mới, import/export Excel, scan OPC luôn được cố định ở đầu trang khi cuộn danh sách tag dài.
- **Thao tác thư mục trực quan**:
  - Tạo thư mục con trực tiếp từ menu của từng thư mục cha.
  - **Đổi tên thư mục liên hoàn (Cascade Rename)**: Khi đổi tên thư mục cha, toàn bộ đường dẫn của các thư mục con và tiền tố `scada_name` của các tag bên trong tự động cập nhật đồng bộ.
  - **Xóa thư mục (Cascade Delete)**: Cho phép chọn xóa kèm toàn bộ tag con hoặc giải phóng tag về cấp kênh.
  - **Xóa triệt để thư mục `default`**: Đã gỡ bỏ toàn bộ cơ chế ép cứng `default` của hệ thống; người dùng có thể xóa sạch hoặc đổi tên thư mục mặc định này.
- **Chu kỳ quét linh hoạt (Scan Rate)**:
  - Mặc định đặt **100ms** cho các tag scan từ OPC để đảm bảo chất lượng truyền thông luôn ở trạng thái `Good` (khắc phục hiện tượng chu kỳ 500ms bị `Unknown`).
- **Chống trùng lặp Tag & Xuất nhập Excel**:
  - Database áp dụng ràng buộc duy nhất `UNIQUE(connection_id, tag_group, name)`.
  - Nhập file Excel tự động bỏ qua tag đã tồn tại, tự động tạo cấu trúc thư mục nếu chưa có.
  - Xuất Excel đầy đủ thuộc tính SCADA, đường dẫn Kepware Path và OPC-UA NodeId (`ns=2;s=...`).

---

### 2.3. Trạm máy chủ OPC-UA Cho SCADA (Internal OPC-UA Server)
- **Địa chỉ Endpoint**: `opc.tcp://0.0.0.0:<PORT>/freeopcua/server/`
- **Mô phỏng chính xác cấu trúc Kepware**:
  - Tự động phản chiếu cây dữ liệu từ Gateway sang không gian địa chỉ OPC UA:
    ```
    Objects/
      └── [Tên Kênh - Ví dụ: plc, MQTT1, opcda]
            └── [Thư Mục Cha]
                  └── [Thư Mục Con]
                        └── [Tên Thẻ - Tag Variable]
    ```
  - SCADA có thể kết nối tới NodeId: `ns=2;s=ConnectionName.GroupName.TagName`.
  - Cho phép SCADA đọc và ghi giá trị hai chiều (Read/Write Writable Node).
- **Cơ chế Tự Động Chuyển Cổng (Auto-Fallback)**:
  - Tự động phát hiện nếu cổng mặc định `4840` bị Kepware, OPC Local Discovery Server (LDS) hoặc dịch vụ Windows khác chiếm dụng ([WinError 10048]).
  - Tự động chuyển mượt sang cổng kế tiếp (`4841`, `4842`...) và khởi động online thành công mà không bị crash.
  - Giao diện có nút đổi cổng nhanh sang `4841`, `4845`, `49320` và nút Bật/Tắt Server thủ công.
- **Bảo mật**: Hỗ trợ chế độ mở (`None - Anonymous`) cho mạng công nghiệp nội bộ và chế độ Ký số / Mã hóa (`Sign / SignAndEncrypt` với Basic256Sha256).

---

## 3. CÁC VẤN ĐỀ ĐÃ ĐƯỢC GIẢI QUYẾT TRONG QUÁ TRÌNH PHÁT TRIỂN

| STT | Vấn Đề Gặp Phải | Nguyên Nhân | Cách Xử Lý |
|---|---|---|---|
| 1 | **Không tìm thấy Phoenix Contact OPC DA** | Driver OPC DA trước chỉ liệt kê một số GUID/ProgID cứng | Bổ sung cơ chế duyệt Windows Registry động (`HKEY_CLASSES_ROOT`) qua COM, hỗ trợ đầy đủ `PhoenixContact.AX-Server.21` |
| 2 | **Trang Tags bị trắng (Crash)** | Frontend truy cập thuộc tính của node cây khi dữ liệu `tag_group` trả về null | Bổ sung hàm kiểm tra rỗng, fallback an toàn và render cây đệ quy chống lỗi undefined |
| 3 | **Mất thanh công cụ khi cuộn trang** | Layout danh sách tag dạng tĩnh thông thường | Thiết kế lại layout thành Dashboard cố định với `sticky top-0 z-20`, bảng dữ liệu cuộn độc lập |
| 4 | **Tag OPC hiển thị `Unknown` khi để 500ms** | Tần số polling 500ms lệch pha với chu kỳ phát của thiết bị | Chuyển toàn bộ chu kỳ quét mặc định khi scan/thêm tag thành **100ms**, dữ liệu lập tức chuyển sang `Good` |
| 5 | **Scan OPC không giữ cấu trúc thư mục con** | Driver tách chuỗi đường dẫn bằng `.split('/')[-1]` làm mất tên thư mục cha | Sửa driver bảo toàn full path (`PARENT/CHILD`), backend tự động ghi danh các cấp thư mục tổ tiên vào `tag_groups` |
| 6 | **Không thể xoá thư mục `default`** | Frontend hardcode `ensureNode('default')` và `new Set(['default'])` trong bộ nhớ cây; backend ép gán `default` khi import | Gỡ bỏ toàn bộ code hardcode `default` ở frontend và backend; cho phép xoá sạch thư mục `default` nếu không có tag |
| 7 | **OPC-UA Server bị `Stopped` trên máy khác** | Cổng chuẩn `4840` bị phần mềm Kepware / Windows LDS trên máy đó chiếm dụng ([WinError 10048]) | Viết module socket kiểm tra cổng, tự động kích hoạt chế độ **Auto-fallback sang cổng 4841** và thêm cảnh báo trực quan trên Web |

---

## 4. CẤU TRÚC MÃ NGUỒN CỦA DỰ ÁN

```
industrial-gateway/
├── backend/
│   ├── api/
│   │   ├── connections.py      # CRUD các kênh kết nối thiết bị
│   │   ├── logs.py             # Hệ thống ghi nhật ký hoạt động
│   │   ├── opcua_api.py        # API điều khiển & cấu hình OPC-UA Server
│   │   ├── tags.py             # CRUD tags, cây thư mục, Excel import/export
│   │   └── websocket.py        # Kênh truyền dữ liệu realtime lên Web
│   ├── core/
│   │   ├── driver_manager.py   # Quản lý các kết nối PLC, MQTT, OPC
│   │   ├── forward_engine.py   # Chuyển tiếp dữ liệu ra Sink ngoài
│   │   ├── opcua_server.py     # Lõi OPC-UA Server nhúng (Auto-fallback)
│   │   └── tag_engine.py       # Bộ thu thập dữ liệu đa chu kỳ quét
│   ├── db/
│   │   └── database.py         # Kết nối SQLite bất đồng bộ (aiosqlite)
│   ├── drivers/
│   │   ├── base_driver.py      # Lớp cơ sở driver công nghiệp
│   │   ├── modbus_driver.py    # Driver Modbus TCP
│   │   ├── mqtt_driver.py      # Driver MQTT + JSON parser
│   │   ├── opc_da_driver.py    # Driver OPC-DA (COM / OpenOPC / Phoenix)
│   │   ├── opcua_driver.py     # Driver OPC-UA Client (Browser & Polling)
│   │   └── s7_driver.py        # Driver Siemens S7 (snap7)
│   ├── models/
│   │   ├── connection.py       # Pydantic schemas cho Connection
│   │   └── tag.py              # Pydantic schemas cho Tag & Group
│   ├── gateway.db              # Database SQLite lưu cấu hình & tags
│   ├── main.py                 # File khởi động chính của FastAPI backend
│   ├── opcua_config.json       # File cấu hình OPC-UA Server
│   └── requirements.txt        # Thư viện Python phụ thuộc
│
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   │   └── client.js       # Cấu hình Axios gọi REST API
│   │   ├── components/
│   │   │   ├── OpcDaBrowserModal.jsx   # Modal quét Tag OPC-DA
│   │   │   ├── OpcUaBrowserModal.jsx   # Modal quét Tag OPC-UA
│   │   │   ├── Sidebar.jsx             # Menu điều hướng ứng dụng
│   │   │   └── TagForm.jsx             # Form thêm/sửa Tag
│   │   ├── pages/
│   │   │   ├── Connections.jsx # Trang quản trị các kênh kết nối
│   │   │   ├── Dashboard.jsx   # Trang tổng quan trạng thái hệ thống
│   │   │   ├── Logs.jsx        # Trang xem nhật ký hoạt động
│   │   │   ├── OpcUaSettings.jsx # Trang cấu hình OPC-UA Server cho SCADA
│   │   │   └── Tags.jsx        # Trang quản trị Cây thư mục & Tags chuẩn Kepware
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── package.json
│   └── vite.config.js
│
├── IndustrialGateway.spec      # File cấu hình đóng gói PyInstaller
└── IndustrialGateway_Portable.zip # Gói ứng dụng chạy độc lập (Portable)
```

---

## 5. HƯỚNG DẪN TRIỂN KHAI HOẶC CHUYỂN SANG FOLDER/PROJECT MỚI

### Cách 1: Sử dụng Bản Portable (Khuyên Dùng Cho Vận Hành Thực Tế)
1. Copy file `IndustrialGateway_Portable.zip` sang thư mục mới hoặc máy tính mới.
2. Giải nén file `.zip`.
3. Chạy file `IndustrialGateway.exe`.
4. Mở trình duyệt web truy cập: `http://localhost:8000`.
5. Ứng dụng sẽ tự động tải giao diện quản trị, khởi động các kết nối đã lưu trong database và kích hoạt OPC-UA Server (cổng `4840` hoặc tự chuyển `4841` nếu cổng `4840` bị Kepware chiếm).

### Cách 2: Triển Khai Từ Mã Nguồn (Dành Cho Phát Triển / Tùy Biến)
1. **Chuẩn bị môi trường**:
   - Python 3.12 (64-bit) trên Windows.
   - Node.js 18+ và npm.
2. **Cài đặt Backend**:
   ```powershell
   cd backend
   python -m venv venv
   .\venv\Scripts\activate
   pip install -r requirements.txt
   ```
3. **Cài đặt & Build Frontend**:
   ```powershell
   cd frontend
   npm install
   npm run build
   ```
4. **Chạy ứng dụng trong chế độ Development**:
   - Backend:
     ```powershell
     cd backend
     .\venv\Scripts\activate
     python main.py
     ```
   - Frontend:
     ```powershell
     cd frontend
     npm run dev
     ```
5. **Đóng gói lại thành file exe**:
   ```powershell
   cd industrial-gateway
   .\backend\venv\Scripts\pyinstaller.exe IndustrialGateway.spec --noconfirm
   ```
   Kết quả biên dịch sẽ nằm trong thư mục `dist/IndustrialGateway/`.
