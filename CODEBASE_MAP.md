# BẢN ĐỒ MÃ NGUỒN & NHẬT KÝ SỬA ĐỔI DỰ ÁN (CODEBASE MAP & CHANGELOG)

> ⚠️ **DÀNH CHO AI / DEVELOPER MỖI KHI BẮT ĐẦU PHIÊN LÀM VIỆC MỚI:**  
> **Không cần quét lại toàn bộ thư mục code.** Hãy đọc file này trước để biết chính xác file nào, hàm nào, component nào đảm nhiệm chức năng bạn cần sửa.

---

## 1. BẢNG TRA CỨU NHANH THEO TÁC VỤ (QUICK LOOKUP)

| Bạn muốn sửa chức năng gì? | File chính cần mở | Vị trí / Component / Hàm cần chú ý |
|---|---|---|
| **Cây thư mục Tags (Kepware Tree, Subfolders)** | `frontend/src/pages/Tags.jsx` | `buildFolderTree()` (dòng ~460), `TreeNode()` (dòng ~500), `treeData` (dòng ~740) |
| **Xóa / Đổi tên thư mục Tags** | `frontend/src/pages/Tags.jsx`<br>`backend/api/tags.py` | `DeleteGroupConfirmModal` (Tags.jsx)<br>`delete_tag_group_by_name()` & `rename_tag_group()` (tags.py) |
| **Form thêm / sửa 1 Tag** | `frontend/src/components/TagForm.jsx` | State `form`, xử lý `tag_group`, chu kỳ `scan_rate_ms` |
| **Import / Export Excel Tags** | `frontend/src/pages/Tags.jsx`<br>`backend/api/tags.py` | `handleExportExcel()`, `handleImportExcel()` (Tags.jsx)<br>`create_tags_batch()` (tags.py) |
| **Quét & Nhập Tag từ OPC-DA (Phoenix Contact / Kepware)** | `frontend/src/components/OpcDaBrowserModal.jsx`<br>`backend/drivers/opc_da_driver.py`<br>`backend/api/connections.py` | `OpcDaBrowserModal.jsx`<br>`browse()` & `_list_servers()` trong `opc_da_driver.py`<br>Endpoint `/browse-opc-da` trong `connections.py` |
| **Quét & Nhập Tag từ OPC-UA từ xa** | `frontend/src/components/OpcUaBrowserModal.jsx`<br>`backend/drivers/opcua_driver.py`<br>`backend/api/connections.py` | `OpcUaBrowserModal.jsx`<br>`browse()` & `_sync_scan_all()` trong `opcua_driver.py`<br>Endpoint `/browse-opcua` trong `connections.py` |
| **OPC-UA Server cho SCADA (Cổng mạng, bảo mật, auto-fallback)** | `backend/core/opcua_server.py`<br>`backend/api/opcua_api.py`<br>`frontend/src/pages/OpcUaSettings.jsx` | `OpcUaServerService`: `start()`, `stop()`, `_is_port_in_use()`<br>`opcua_api.py`: `/config`, `/start`, `/stop`<br>`OpcUaSettings.jsx`: UI cài đặt, cảnh báo cổng |
| **Khởi động Gateway khi mở ứng dụng** | `backend/main.py` | `lifespan()`: khởi tạo DB, DriverManager, TagEngine, ForwardEngine, OpcUaServerService |
| **Driver Modbus TCP** | `backend/drivers/modbus_driver.py` | `ModbusDriver`: hàm `read_tag()`, `write_tag()` |
| **Driver Siemens S7 (S7-300/1200/1500)** | `backend/drivers/s7_driver.py` | `S7Driver`: hàm `read_tag()`, parse địa chỉ DB/M/I/Q |
| **Driver MQTT & Parse JSON Auto-Tag** | `backend/drivers/mqtt_driver.py`<br>`backend/api/tags.py` | `MQTTDriver`<br>`auto_create_tags_from_json()` & `_extract_tags_from_json()` |
| **Database SQLite & Schema** | `backend/db/database.py` | `init_db()`: bảng `connections`, `tags`, `tag_groups`, `logs` |

---

## 2. NHẬT KÝ CHI TIẾT CÁC ĐỢT CHỈNH SỬA (CHANGELOG & MODIFICATION LOG)

### Đợt 1: Hỗ trợ OPC-DA Phoenix Contact AX-Server & Quét động Registry
- **File sửa:** `backend/drivers/opc_da_driver.py`, `backend/api/connections.py`
- **Nội dung:**
  - Thay vì danh sách GUID cứng, bổ sung hàm duyệt Windows Registry (`winreg`) tại nhánh `HKEY_CLASSES_ROOT` tìm tất cả ProgID có khóa con `OPC`.
  - Hỗ trợ kết nối cả 32-bit và 64-bit cho `PhoenixContact.AX-Server.21` và `Kepware.KEPServerEX.V6`.

### Đợt 2: Thêm Modal Quét & Nhập Tag cho OPC-DA và OPC-UA
- **File sửa:**
  - `frontend/src/components/OpcDaBrowserModal.jsx`
  - `frontend/src/components/OpcUaBrowserModal.jsx`
  - `frontend/src/pages/Tags.jsx`
- **Nội dung:**
  - Bổ sung 2 nút bấm màu xanh ngọc/tím trên thanh công cụ Tags: `Scan OPC DA` và `Scan OPC UA`.
  - Cửa sổ duyệt cây Tag trực tiếp: chọn tag muốn import, chọn thư mục đích (Target Folder) và gán hàng loạt.

### Đợt 3: Khắc phục lỗi trang Tag bị trắng (Blank Page Crash)
- **File sửa:** `frontend/src/pages/Tags.jsx`
- **Nội dung:**
  - Nguyên nhân: Thuộc tính `tag_group` trả về null hoặc chuỗi rỗng gây lỗi khi gọi hàm xử lý cây phân cấp.
  - Sửa: Bổ sung fallback `(t.tag_group || '').trim()` trong mọi logic lọc và phân nhóm cây.

### Đợt 4: Cố định thanh công cụ (Sticky Toolbar) & Nâng cấp Cây Thư Mục Đa Tầng Kepware
- **File sửa:** `frontend/src/pages/Tags.jsx`
- **Nội dung:**
  - Cố định thanh Header `Tag Management` và thanh Breadcrumb bằng `sticky top-0 z-20`, giúp cuộn trang mà không mất nút chức năng.
  - Cải tiến cây thư mục:
    - Hỗ trợ thư mục con đệ quy: `TRAM_1/BOM_1/VALVE_1`.
    - Component `TreeNode`: Đóng/mở thư mục con bằng chevron (`ChevronRight`/`ChevronDown`).
    - Nút thao tác nhanh trên từng thư mục: Tạo thư mục con (`FolderPlus`), Đổi tên (`Edit2`), Xóa (`Trash2`).
    - Đổi tên liên hoàn (Cascade Rename): Sửa đường dẫn mọi thư mục con và tag bên trong.

### Đợt 5: Chu kỳ quét mặc định 100ms cho Tag scan từ OPC
- **File sửa:**
  - `backend/models/tag.py` (dòng `scan_rate_ms: int = Field(default=100)`)
  - `frontend/src/components/TagForm.jsx`
  - `frontend/src/components/OpcDaBrowserModal.jsx`
  - `frontend/src/components/OpcUaBrowserModal.jsx`
- **Nội dung:**
  - Khắc phục hiện tượng chu kỳ quét 500ms bị lệch pha dẫn đến tag hiển thị trạng thái `Unknown`. Khi đổi sang `100ms`, chất lượng truyền thông lập tức chuyển sang `Good`.

### Đợt 6: Giữ nguyên đường dẫn thư mục con khi Scan OPC-DA & OPC-UA
- **File sửa:**
  - `backend/drivers/opcua_driver.py` (hàm `browse` và `_sync_scan_all`)
  - `backend/drivers/opc_da_driver.py` (hàm `browse`)
  - `backend/api/tags.py` (hàm `create_tags_batch`)
- **Nội dung:**
  - Thay vì cắt lấy phần tử cuối `.split('/')[-1]`, driver giữ nguyên toàn bộ chuỗi đường dẫn phân cấp (ví dụ: `UA_PHOVA/DAIPHUC`).
  - Hàm `create_tags_batch` tự động duyệt và ghi các cấp thư mục cha/ông vào bảng `tag_groups`.

### Đợt 7: Xóa triệt để thư mục `default` & Ngăn chặn tự động tái sinh
- **File sửa:**
  - `frontend/src/pages/Tags.jsx` (hàm `buildFolderTree`, `treeData`, `DeleteGroupConfirmModal`)
  - `frontend/src/components/TagForm.jsx`
  - `backend/models/tag.py` (`TagCreate`, `TagResponse`)
  - `backend/api/tags.py` (`delete_tag_group_by_name`, `create_tags_batch`, `_enrich`)
- **Nội dung:**
  - Loại bỏ hoàn toàn dòng `ensureNode('default')` và `new Set(['default'])` ở frontend.
  - Khi xoá thư mục `default`, backend cập nhật làm rỗng `tag_group = ''` hoặc xoá tag tương ứng.
  - Thư mục `default` sau khi xoá sẽ biến mất hoàn toàn khỏi cây thư mục. Nếu kênh không có thư mục nào, hiển thị gợi ý `Chưa có thư mục (bấm + để tạo)`.

### Đợt 8: Khắc phục lỗi OPC-UA Server không khởi động được trên máy khác (Xung đột cổng 4840)
- **File sửa:**
  - `backend/core/opcua_server.py`
  - `backend/api/opcua_api.py`
  - `backend/main.py`
  - `frontend/src/pages/OpcUaSettings.jsx`
- **Nội dung:**
  - **Nguyên nhân:** Máy khác cài Kepware hoặc Windows OPC Local Discovery Server (LDS) đã chiếm cổng `4840`, gây lỗi `[WinError 10048] Only one usage of each socket address is normally permitted`.
  - **Khắc phục:**
    1. Bổ sung hàm `_is_port_in_use()` kiểm tra socket trước khi bind.
    2. **Cơ chế Auto-Fallback:** Nếu cổng mặc định `4840` bị chiếm, hệ thống tự động dò và chuyển sang cổng trống kế tiếp (`4841`, `4842`...) và khởi động online thành công.
    3. Xóa tham số ép cứng `port=4840` trong `main.py` để server luôn tôn trọng cấu hình lưu trong `opcua_config.json`.
    4. Giao diện `OpcUaSettings.jsx`: Hiển thị thông báo chi tiết khi tự động chuyển cổng, các nút đổi cổng nhanh 1-Click sang `4841`, `4845`, `49320`, và nút Bật/Tắt Server trực tiếp trên Header.

### Đợt 9: Tối ưu độ ổn định, sửa kiểu dữ liệu Modbus trong OPC-UA Server & Auto-fallback cổng Web UI
- **File sửa:**
  - `backend/core/opcua_server.py`
  - `backend/core/tag_engine.py`
  - `backend/main.py`
  - `backend/db/database.py`
  - `backend/api/opcua_api.py`
  - `frontend/src/pages/OpcUaSettings.jsx`
  - `.gitignore`
- **Nội dung:**
  - Sửa ánh xạ kiểu dữ liệu OPC-UA Server cho `float32_swap`, `float32_be`, `float32_le`, `float64`, `uint16`, `int32_swap` để khớp tuyệt đối `VariantType` giữa lúc khởi tạo và lúc cập nhật giá trị.
  - Xóa node cũ khỏi address space khi cấu trúc tag thay đổi (`delete_nodes`) và giảm tần suất query SQLite trong `_sync_loop` xuống mỗi 3 giây.
  - Tách nhóm polling trong `TagEngine` theo `(connection_id, scan_rate_ms)` để 1 kết nối bị timeout không làm đứng các kết nối khác.
  - Thêm cơ chế tự động chọn cổng Web UI dự phòng (`8001`, `8002`...) trong `main.py` nếu cổng `8000` đã bị chiếm.
  - Đồng bộ schema SQLite (`scan_rate_ms DEFAULT 100`, `tag_group DEFAULT ''`), đồng bộ ô nhập Port khi auto-fallback ở `OpcUaSettings.jsx`, và thêm `build/` vào `.gitignore`.

### Đợt 10: Cài đặt `ui-ux-pro-max` Skill & Nâng cấp toàn bộ giao diện theo Design System
- **Skill & Design System đã cài:**
  - `.agents/skills/ui-ux-pro-max/` (và global `~/.gemini/config/skills/ui-ux-pro-max/`)
  - `design-system/industrial-gateway/MASTER.md`, `tokens.json`, `tokens.css`
- **File giao diện đã nâng cấp:**
  - `frontend/index.html`, `frontend/src/index.css`, `frontend/src/utils/helpers.js`
  - `frontend/src/components/Layout.jsx`, `Sidebar.jsx`, `StatusBadge.jsx`, `RealtimeChart.jsx`
  - `frontend/src/pages/Dashboard.jsx`, `Connections.jsx`, `OpcUaSettings.jsx`, `Logs.jsx`, `Tags.jsx`
- **Nội dung:**
  - Áp dụng bảng màu **Industrial Dark Tech + Status Green** (`#0F172A` background, `#1B2336` glassmorphism cards, `#22C55E` live accent, độ tương phản ≥ 4.5:1).
  - Font kỹ thuật chuyên dụng: **Fira Code** (tiêu đề, số liệu realtime, NodeId) kết hợp **Fira Sans** (nội dung).
  - Loại bỏ toàn bộ emoji làm icon (`⚠`, `⚡`, `📂`), thay bằng Lucide SVG đồng bộ; thêm responsive sidebar drawer cho màn hình nhỏ, focus-visible ring, `aria-label`, `cursor-pointer` và hỗ trợ `prefers-reduced-motion`.

### Đợt 11: Chỉ nhập tag vào đúng thư mục được chọn khi Scan OPC-DA / OPC-UA
- **File sửa:**
  - `frontend/src/components/OpcUaBrowserModal.jsx`
  - `frontend/src/components/OpcDaBrowserModal.jsx`
- **Nội dung:**
  - Bỏ cơ chế tự động tạo thêm các cấp thư mục lồng nhau theo đường dẫn trên OPC Server (`getLeafGroup`, `handleAddBranch`, `handleScanAll`, nút `Gán tất cả`).
  - Toàn bộ tag được quét hoặc thêm sẽ đi thẳng vào đúng thư mục đang đứng (kể cả thư mục con như `DAIPHUC/TRAM_2`) hoặc thư mục đích người dùng chọn trong ô `Thư mục:`.
  - Bỏ ép fallback về `'default'` khi để trống thư mục đích.

### Đợt 12: Chức năng Copy / Paste Tags & Thư mục (tự động tăng chỉ số khi trùng tên)
- **File sửa:**
  - `backend/api/tags.py` (`_next_unique_name`, `POST /api/tags/paste`, `POST /api/tags/groups/paste`)
  - `frontend/src/api/tags.js` (`pasteTags`, `pasteTagGroup`)
  - `frontend/src/pages/Tags.jsx` (checkbox chọn nhiều tag, nút Copy/Paste trên dòng tag, cây thư mục `TreeNode`, thanh thao tác nhanh và phím tắt `Ctrl+C` / `Ctrl+V`)
- **Nội dung:**
  - Hỗ trợ Copy/Paste 1 tag hoặc nhiều tag cùng lúc; nếu trùng tên trong cùng thư mục sẽ tự động tăng chỉ số (`BOM1` -> `BOM2` -> `BOM3`, `TRAM_01` -> `TRAM_02`, `AP` -> `AP_1` -> `AP_2`).
  - Hỗ trợ Copy/Paste toàn bộ thư mục (kèm thư mục con và toàn bộ tag bên trong); tự động tăng chỉ số tên thư mục nếu trùng cùng cấp.

### Đợt 13: Nhóm 3 — IoT Gateway (Forward Engine UI) & Tag Nội Bộ / Công Thức (`internal` Driver)
- **File thêm / sửa:**
  - `backend/core/forward_engine.py`, `backend/api/forward_api.py`, `backend/main.py`
  - `backend/drivers/internal_driver.py`, `backend/core/driver_manager.py`, `backend/models/connection.py`
  - `frontend/src/pages/IoTGateway.jsx`, `frontend/src/App.jsx`, `frontend/src/components/Sidebar.jsx`
  - `frontend/src/components/ConnectionForm.jsx`, `frontend/src/components/TagForm.jsx`, `frontend/src/utils/helpers.js`
- **Nội dung:**
  - **IoT Gateway (`/iot-gateway`):** Giao diện cấu hình đẩy dữ liệu live ra MQTT Broker (Outbound) và HTTP REST Webhook (JSON Batch), lọc theo kênh, nút Chạy/Dừng và nút Gửi thử ngay.
  - **Internal Driver (`protocol = 'internal'`):** Hỗ trợ 3 loại tag không cần PLC: Memory Tag (`MEM:KEY=val`, đọc/ghi 2 chiều từ Web & SCADA), Simulator Tag (`SIM:SINE`, `SIM:RAMP`, `SIM:RANDOM`, `SIM:TOGGLE`), và Formula / Derived Tag (`=FLOW_1 + FLOW_2`, tính toán an toàn qua AST từ giá trị live của `TagEngine`).

### Đợt 14: Nhóm 1 & Nhóm 2 (Chuẩn Kepware) — Scaling, Read-Only, Bulk Edit/Find & Replace, Backup/Restore, Hidden Auto-Start, _System Watchdog, Auto-Demotion & Data Logger (Historian)
- **File thêm / sửa:**
  - **Backend:** `backend/core/scaling.py`, `backend/core/data_logger.py`, `backend/api/history_api.py`, `backend/api/system_api.py`, `backend/db/database.py`, `backend/models/tag.py`, `backend/models/connection.py`, `backend/core/tag_engine.py`, `backend/core/opcua_server.py`, `backend/api/tags.py`, `backend/api/connections.py`, `backend/drivers/base_driver.py`, `backend/drivers/*_driver.py`, `backend/core/driver_manager.py`, `backend/main.py`, `scripts/Start_Gateway_Hidden.vbs`
  - **Frontend:** `frontend/src/api/history.js`, `frontend/src/api/system.js`, `frontend/src/api/tags.js`, `frontend/src/components/BulkEditModal.jsx`, `frontend/src/components/FindReplaceModal.jsx`, `frontend/src/components/TagForm.jsx`, `frontend/src/pages/Tags.jsx`, `frontend/src/pages/Connections.jsx`, `frontend/src/pages/Historian.jsx`, `frontend/src/pages/SystemSettings.jsx`, `frontend/src/App.jsx`, `frontend/src/components/Sidebar.jsx`
- **Nội dung:**
  - **Bulk Edit & Find/Replace (#1):** `POST /api/tags/bulk-update` & `POST /api/tags/find-replace` (hỗ trợ xem trước `dry_run`) trên các tag được tích chọn.
  - **Scaling & Engineering Units (#2):** Quy đổi `linear` (`raw_min..raw_max` -> `eng_min..eng_max`, tùy chọn kẹp giá trị `scale_clamp` + reverse scaling khi ghi xuống PLC) và `factor` (`a * x + b`) kèm đơn vị đo `unit`.
  - **Client Access `rw`/`ro` (#3):** Chặn ghi tag `ro` tại REST API (`HTTP 403`) và OPC-UA Server (`set_writable=False`), hiển thị biểu tượng ổ khóa trên UI.
  - **Hidden Startup & Auto-Start Windows (#4):** Hỗ trợ đăng ký `HKCU\...\Run` qua `wscript.exe` + `start_hidden.vbs` và cung cấp `Start_Gateway_Hidden.vbs` trong bản Portable để chạy ngầm không cửa sổ CMD.
  - **Project Backup & Restore (#5):** Xuất/nhập toàn bộ kênh, thư mục, tag và cấu hình dịch vụ (`opcua_config`, `forward_config`, `logger_config`) trong 1 file `.json` (hỗ trợ `replace` và `merge`).
  - **`_System` Tags & Watchdog (#6):** Mỗi kênh bật trên OPC-UA Server tự tạo nhóm `_System` (`_Connected`, `_Error`, `_Demoted`, `_TagCount`, `_GoodCount`, `_BadCount`, `_Timestamp`) và hiển thị live trên UI Connections & Hệ thống.
  - **Auto-Demotion & Quick Enable/Disable (#7):** Giãn chu kỳ kết nối lại tăng dần `5s -> 10s -> 20s -> 30s -> 60s` trên các driver PLC/OPC + nút Power bật/tắt nhanh từng kênh.
  - **Data Logger / Historian (#8):** Trang `/historian` cấu hình ghi lịch sử SQLite (`tag_history`) theo chu kỳ, Deadband, lưu trữ giữ ngày (`retention_days`), xem biểu đồ xu hướng Recharts và xuất Excel.

### Đợt 15: Bổ sung Sổ tay Hướng dẫn Vận hành đầy đủ chi tiết & sửa xung đột `/docs`
- **File thêm / sửa:**
  - `backend/main.py` (`docs_url="/api/docs"`, `redoc_url="/api/redoc"`, `openapi_url="/api/openapi.json"`, gỡ chặn `/docs` khỏi `serve_spa`)
  - `frontend/src/pages/Docs.jsx` (viết lại hoàn chỉnh theo giao diện Dark Glassmorphism với tìm kiếm từ khóa và 9 chương vận hành đầy đủ)
  - `HUONG_DAN_VAN_HANH.md`, `HUONG_DAN_SU_DUNG.txt`
- **Nội dung:**
  - Cung cấp tài liệu vận hành chi tiết cả trong Web UI (`/docs`) lẫn file Markdown offline (`HUONG_DAN_VAN_HANH.md`) đóng gói kèm bản Portable: khởi chạy ẩn & Auto-Start Windows, bảng cổng Firewall, checklist đầu ca/tắt an toàn, hướng dẫn 6 giao thức (S7, Modbus byte-order, MQTT, OPC-DA, OPC-UA, Internal), bảng cú pháp Address, Copy/Paste/Bulk Edit/Find & Replace/Excel, Scaling & Reverse Scaling, phân quyền `rw/ro`, `_System` Watchdog Tags, Historian, IoT Gateway, Backup/Restore, REST API/WebSocket và bảng 8 sự cố thực tế.

### Đợt 16: Module Vùng Đệm & Điều Khiển USR-M100 qua MQTT (`/usr-m100`)
- **File thêm / sửa:**
  - **Backend:** `backend/drivers/mqtt_driver.py` (`get_topic_entry`, `publish_raw`), `backend/core/usr_m100_service.py`, `backend/api/usr_m100_api.py`, `backend/main.py`, `backend/api/system_api.py`
  - **Frontend:** `frontend/src/api/usrM100.js`, `frontend/src/pages/UsrM100Control.jsx`, `frontend/src/App.jsx`, `frontend/src/components/Sidebar.jsx`
- **Nội dung:**
  - Giao diện `/usr-m100` quản lý trạm USR-M100 dùng Gateway làm vùng đệm trung gian: lưu cấu hình tại `usr_m100_config.json`, tích hợp Backup/Restore (`usr_m100_config`).
  - Hỗ trợ đóng gói chuẩn PUSR `rw_prot` (`Ver: "1.0.1"`, `dir: "down"`, `w_data` / `r_data`, tự chia lô tối đa 5 điểm/gói, tùy chọn kiểu value chuỗi/số) và `flat_json`, xem trước JSON trực tiếp, nạp nhanh từ nhóm Tag MQTT sẵn có, theo dõi ACK `dir: "up"` (`err: "0"`) và tùy chọn Auto-Sync từ Tag nguồn.

### Đợt 17: Chọn Tag có sẵn trong phần mềm & Chỉ gửi xuống USR-M100 khi thay đổi giá trị
- **File sửa:**
  - `backend/core/usr_m100_service.py` (`_values_differ`, `last_sent_value`, `deadband`, `only_changed`, cơ chế retry khi mất MQTT trong `_poll_auto_sync`)
  - `backend/api/usr_m100_api.py` (`source_tag_label`, `feedback_tag_label`, `source_quality`, `only_changed` trên `/publish`)
  - `frontend/src/pages/UsrM100Control.jsx` (`TagPickerModal`, công tắc Auto-Sync nhanh trên thanh trạm, cột Tag nguồn & trạng thái Đã đổi/Chưa đổi, checkbox `Chỉ gửi điểm có thay đổi`, tìm kiếm tag & cảnh báo lặp trong `PointModal`)
  - `frontend/src/pages/Docs.jsx`, `HUONG_DAN_VAN_HANH.md`
- **Nội dung:**
  - Cho phép tìm theo kênh/nhóm và tích chọn trực tiếp bất kỳ tag nào có sẵn (PLC S7, Modbus, OPC-DA/UA, Internal, MQTT) để gắn làm `source_tag_id` của trạm USR-M100.
  - Chỉ gửi MQTT khi giá trị thay đổi (cả chế độ Auto-Sync nền kèm `deadband` lọc nhiễu và nút Publish Lô `only_changed`), tránh gửi trùng giá trị cũ và giữ thay đổi để thử lại an toàn khi MQTT reconnect.

### Đợt 18: Dashboard dạng bảng phân theo thư mục + Rà soát & Tối ưu Toàn diện (Nhóm A, B, C)
- **File sửa:**
  - **Backend:** `backend/drivers/mqtt_driver.py` (sửa `write_tag` cho `Topic:Key` qua `publish_raw`), `backend/core/data_logger.py` (chỉ ghi lịch sử khi `quality == 'Good'`), `backend/api/connections.py` & `backend/core/tag_engine.py` (gọi `TagEngine().reload()` khi xóa kênh và dọn `_tag_cache` tag cũ), `backend/api/system_api.py` (ánh xạ `old_tag_id -> new_tag_id` và `conn_id_map` cho `usr_m100_config` & `forward_config` khi Restore), `backend/core/usr_m100_service.py` (debounce 15s khi ghi `last_sent_value` từ Auto-Sync xuống đĩa + flush khi `stop()`), `backend/core/opcua_server.py` (chỉ `set_value` khi giá trị thay đổi), `backend/db/database.py` (`PRAGMA busy_timeout=5000`, `PRAGMA synchronous=NORMAL`).
  - **Frontend:** `frontend/src/pages/Dashboard.jsx` (`FolderTreeNode`, `FolderSectionHeader`, `TagTableRow` với `React.memo`, `QuickWriteModal` ghi nhanh giá trị trực tiếp từ bảng Dashboard, lọc Good/Lỗi, thu gọn nhóm, ghim 4 `RealtimeChart`), cùng các file `RealtimeChart.jsx`, `useWebSocket.js`, `OpcUaSettings.jsx`, `IoTGateway.jsx`, `Historian.jsx`, `AutoTagModal.jsx`, `ConnectionForm.jsx`, `TagForm.jsx`, `OpcDaBrowserModal.jsx`, `OpcUaBrowserModal.jsx`, `Tags.jsx`, `Docs.jsx`, `HUONG_DAN_VAN_HANH.md`.
- **Nội dung:**
  - Chuyển đổi danh sách Live Tags trên Dashboard từ dạng thẻ phẳng sang **bảng dữ liệu công nghiệp phân nhóm theo từng Kênh & Thư mục (`tag_group`)**, hỗ trợ thư mục đa cấp (vd `DAIPHUC/tram2`), đếm tỷ lệ `Good / Total` trên mỗi header thư mục, ghim biểu đồ realtime và ghi nhanh giá trị (`PenLine`) ngay trên từng dòng tag.
  - Sửa triệt để các lỗi tiềm ẩn ở Backend (Nhóm A), tối ưu hiệu năng CPU/Disk/SQLite khi chạy 24/7 (Nhóm B) và xử lý sạch toàn bộ cảnh báo `oxlint` trên toàn bộ 33 file Frontend (`0 warnings, 0 errors`).

---

## 3. CƠ SỞ DỮ LIỆU SQLITE (`backend/gateway.db`)

- **Bảng `connections`**: Lưu thông tin kênh kết nối (S7, Modbus, MQTT, OPC-DA, OPC-UA, Internal).
  - Khóa chính: `id` (INTEGER). Các cột: `name`, `protocol`, `host`, `port`, `config` (JSON text), `enabled`.
- **Bảng `tag_groups`**: Lưu danh sách thư mục cây.
  - Khóa chính: `id`. Các cột: `connection_id`, `name` (chuỗi đường dẫn như `TRAM_1/BOM`), `description`.
- **Bảng `tags`**: Lưu thông tin từng thẻ tag.
  - Khóa chính: `id`. Các cột: `connection_id`, `name`, `address`, `data_type`, `scan_rate_ms`, `enabled`, `description`, `tag_group`, `access` (`rw`/`ro`), `unit`, `scale_type` (`none`/`linear`/`factor`), `raw_min`, `raw_max`, `eng_min`, `eng_max`, `scale_factor`, `scale_offset`, `scale_clamp`, `log_enabled`.
  - Ràng buộc: `UNIQUE(connection_id, tag_group, name)`.
- **Bảng `tag_history`**: Lưu lịch sử Data Logger (Historian).
  - Các cột: `id`, `tag_id`, `ts` (UNIX epoch float), `value`, `quality` (đánh chỉ mục `idx_tag_history_tag_ts(tag_id, ts DESC)`).

---

## 4. QUY TRÌNH BUILD & ĐÓNG GÓI ỨNG DỤNG (CHEAT SHEET)

Mỗi khi chỉnh sửa xong code và muốn tạo file `.exe` / `.zip` mới để chạy trên máy thật:

```powershell
# Bước 1: Di chuyển vào thư mục dự án
cd "C:\Users\DELL\.gemini\antigravity\scratch\industrial-gateway"

# Bước 2: Build lại frontend nếu có sửa code React trong frontend/src/
cd frontend
npm.cmd run build
cd ..

# Bước 3: Đồng bộ file cấu hình OPC-UA mặc định vào dist
Copy-Item "backend\opcua_config.json" -Destination "dist\IndustrialGateway\opcua_config.json" -Force

# Bước 4: Chạy PyInstaller biên dịch file exe
.\backend\venv\Scripts\pyinstaller.exe IndustrialGateway.spec --noconfirm

# Bước 5: Nén thành file Portable .zip để mang sang máy khác
Compress-Archive -Path dist\IndustrialGateway\* -DestinationPath IndustrialGateway_Portable.zip -Force
```
File sản phẩm cuối cùng là: `IndustrialGateway_Portable.zip` (chỉ cần giải nén và chạy `IndustrialGateway.exe`).
