# SỔ TAY VẬN HÀNH INDUSTRIAL GATEWAY (PHIÊN BẢN ĐẦY ĐỦ)

Tài liệu hướng dẫn cài đặt, cấu hình, vận hành hằng ngày, sao lưu dự án và xử lý sự cố cho phần mềm **Industrial Gateway** (nền tảng trung gian truyền thông đa giao thức chuẩn Kepware).

---

## MỤC LỤC
1. [Tổng quan kiến trúc & Cổng mạng](#1-tổng-quan-kiến-trúc--cổng-mạng)
2. [Khởi chạy & Tự động khởi động cùng Windows](#2-khởi-chạy--tự-động-khởi-động-cùng-windows)
3. [Quy trình vận hành đầu ca & tắt phần mềm an toàn](#3-quy-trình-vận-hành-đầu-ca--tắt-phần-mềm-an-toàn)
4. [Cấu hình Kết nối Thiết bị & Cơ chế Auto-Demotion](#4-cấu-hình-kết-nối-thiết-bị--cơ-chế-auto-demotion)
5. [Quản lý Tag, Cây Thư mục, Copy/Paste, Bulk Edit & Excel](#5-quản-lý-tag-cây-thư-mục-copypaste-bulk-edit--excel)
6. [Scaling, Quyền Read-Only (RO/RW) & Tag Nội bộ](#6-scaling-quyền-read-only-rorw--tag-nội-bộ)
7. [OPC-UA Server & Nhóm `_System` Watchdog Tags](#7-opc-ua-server--nhóm-_system-watchdog-tags)
8. [Data Logger (Historian) & Biểu đồ Xu hướng](#8-data-logger-historian--biểu-đồ-xu-hướng)
9. [IoT Gateway (MQTT Outbound & HTTP Webhook)](#9-iot-gateway-mqtt-outbound--http-webhook)
10. [Sao lưu, Khôi phục Dự án & Lịch Bảo trì](#10-sao-lưu-khôi-phục-dự-án--lịch-bảo-trì)
11. [REST API, WebSocket & Xử lý Sự cố Hiện trường](#11-rest-api-websocket--xử-lý-sự-cố-hiện-trường)

---

## 1. Tổng quan kiến trúc & Cổng mạng

Phần mềm đóng vai trò cầu nối truyền thông 3 tầng:
- **Tầng dưới (Field Level):** Đọc/ghi trực tiếp tới Siemens S7, Modbus TCP/RTU, MQTT Broker, OPC-DA Classic (COM), OPC-UA Client và kênh nội bộ Internal.
- **Tầng lõi (Gateway Core):** Quản lý cây thư mục Channels & Groups, Polling Engine đa tốc độ (`scan_rate_ms`), Scaling hai chiều, kiểm soát quyền `rw`/`ro`, lưu lịch sử Historian vào SQLite (`gateway.db`).
- **Tầng trên (Supervisory / Cloud):** Xuất dữ liệu lên SCADA qua **OPC-UA Server** (kèm `_System` Watchdog), đẩy **IoT Gateway** (MQTT Outbound & HTTP Webhook) hoặc tích hợp Web SCADA qua **REST API + WebSocket**.

| Dịch vụ / Giao thức | Cổng mặc định | Chiều kết nối | Ghi chú |
|---|---:|---|---|
| Web UI + REST API + WebSocket | TCP `8000` | Inbound tới Gateway | Đổi được qua biến môi trường `GATEWAY_PORT`; nếu cổng 8000 bận sẽ tự thử `8001..8019` |
| OPC-UA Server | TCP `4840` / `4841` | Inbound từ SCADA | Nếu `4840` bị phần mềm khác chiếm, tự chuyển sang `4841` |
| Siemens S7 PLC | TCP `102` | Outbound từ Gateway | Yêu cầu mở PUT/GET trên PLC |
| Modbus TCP | TCP `502` | Outbound từ Gateway | Hoặc COM port với Modbus RTU |
| MQTT Broker | TCP `1883` | Outbound (thu thập & đẩy) | Cho phép dùng Broker nội bộ hoặc Cloud |

---

## 2. Khởi chạy & Tự động khởi động cùng Windows

### 2.1 Chạy bản Portable
Trong thư mục giải nén `IndustrialGateway\`:
- **Chạy ngầm sản xuất 24/7 (Khuyên dùng):** Nhấp đúp **`Start_Gateway_Hidden.vbs`**. Ứng dụng chạy nền không hiện cửa sổ CMD đen (tránh người vận hành bấm nhầm nút X đóng cửa sổ).
- **Chạy kèm màn hình Log (Kiểm tra/Debug):** Nhấp đúp **`IndustrialGateway.exe`**. Cửa sổ Console sẽ hiển thị log thời gian thực của từng driver.
- Sau khi chạy, mở trình duyệt truy cập: `http://localhost:8000` (hoặc `http://<IP-máy-Gateway>:8000` từ máy khác trong mạng LAN).

### 2.2 Bật tự khởi động cùng Windows (Chạy ngầm)
1. Trên giao diện Web, mở menu **Hệ thống & Sao lưu** (`http://localhost:8000/system`).
2. Nhấn **Bật Auto-Start chạy ngầm**.
3. Phần mềm tự tạo file `start_hidden.vbs` cạnh ứng dụng và ghi khóa Registry `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\IndustrialGateway` chạy qua `wscript.exe`. Khi khởi động lại Windows, Gateway tự chạy ngầm ngay lập tức.

---

## 3. Quy trình vận hành đầu ca & tắt phần mềm an toàn

### Checklist kiểm tra đầu ca (3 phút)
1. Mở **Dashboard** (`/`): kiểm tra 4 thẻ KPI (kết nối Online, tỷ lệ Good Quality, trạng thái WebSocket `Live`), duyệt nhanh từng **Thư mục** trên **Cây thư mục** bên trái hoặc bảng dữ liệu live phân nhóm theo thư mục bên phải (có lọc chất lượng `Good`/`Lỗi`, tìm kiếm, thu gọn/mở rộng nhóm và ghim tối đa 4 biểu đồ realtime).
2. Mở **Connections** (`/connections`):
   - Kiểm tra các kênh đang dùng đều ở trạng thái xanh **Connected**.
   - Nếu thấy badge **`Auto-Demoted`**: PLC/thiết bị đang mất kết nối, cần kiểm tra nguồn điện hoặc dây mạng.
   - Kiểm tra cột **Tags (_System)**: tỷ lệ `Good / Total` phải đạt đủ số tag đang bật.
3. Mở **Logs** (`/logs`): kiểm tra không có lỗi ghi SQLite hay lỗi kết nối bất thường.
4. Nếu có đẩy Cloud hoặc ghi lịch sử: kiểm tra đèn trạng thái Running tại `/iot-gateway` và `/historian`.

### Quy trình tắt phần mềm an toàn
- Nếu chạy bằng `IndustrialGateway.exe`: nhấn **`Ctrl + C`** một lần trong cửa sổ Console và đợi log hiện `=== Industrial Gateway stopped ===` (đảm bảo đóng kết nối OPC-DA/S7/Modbus và flush toàn bộ dữ liệu SQLite).
- Nếu chạy ngầm bằng VBS: đóng tiến trình `IndustrialGateway.exe` trong Task Manager khi cần nâng cấp hoặc bảo trì máy.

---

## 4. Cấu hình Kết nối Thiết bị & Cơ chế Auto-Demotion

Truy cập **Connections** → **Add Connection**:

### 4.1 Siemens S7 (S7-1200 / S7-1500 / S7-300 / S7-400)
- **Host / Port:** IP của PLC và cổng `102`.
- **Rack / Slot:**
  - S7-1200 / S7-1500: `Rack = 0`, `Slot = 1`.
  - S7-300 / S7-400: `Rack = 0`, `Slot = 2`.
- **Lưu ý TIA Portal (Bắt buộc):**
  - Bật **Permit access with PUT/GET communication from remote partner** trong *Device Configuration → Protection & Security*.
  - Bỏ tích **Optimized block access** trong *Properties → Attributes* của các Data Block (DB) cần đọc/ghi.
- **Import hàng loạt Tag trực tiếp từ TIA Portal (`/tags` → nút `Import TIA S7`):**
  - **File Source Data Block / UDT (`.db`, `.scl`, `.awl`, `.udt`):** Trong TIA Portal chuột phải vào DB → *Generate source from blocks* → nạp file vào Gateway để tự động tính Offset (`Bool`, `Byte`, `Int`, `UInt`/`Word`, `DInt`/`DWord`/`Time`, `Real`, `LReal`, `String`, `Struct` lồng nhau và `Array`).
  - **Bảng PLC Tags (`.xlsx`, `.xml`) & STEP 7 (`.sdf`):** Vào *PLC tags → Export* trong TIA Portal để nạp toàn bộ vùng nhớ `%I`, `%Q`, `%M`.
  - **Dán trực tiếp từ TIA DB Editor:** Copy trực tiếp các dòng trong bảng DB (khi đã tắt Optimized và Compile để hiện cột `Offset`) rồi dán sang tab *Dán bảng DB / Source* để lấy địa chỉ S7 chính xác 100%.

### 4.2 Modbus TCP & Modbus RTU
- **Modbus TCP:** Nhập `Host` (IP) và `Port` (`502`).
- **Modbus RTU:** Nhập `Serial Port` (vd: `COM1`, `COM3`, `/dev/ttyUSB0`) và `Baudrate` (`2400`–`115200`).
- **Xử lý thứ tự Word/Byte (rất hay gặp ở biến tần, đồng hồ điện, Schneider):**
  - `float32` / `int32`: Big-Endian `ABCD` (chuẩn Modbus phổ thông).
  - `float32_swap` / `int32_swap`: Đảo Word `CDAB` (Word thấp đứng trước).
  - `float32_be`: Đảo Byte từng Word `BADC`.
  - `float32_le`: Little-Endian hoàn toàn `DCBA`.

### 4.3 MQTT Client
- Nhập `Broker URL` dạng `mqtt://host:1883`, `Client ID`, và `Username`/`Password` (nếu Broker có xác thực).
- Có nút **Auto Tag (JSON)** để nghe trực tiếp topic trên Broker, phân tích cây JSON và sinh nhanh danh sách tag vào thư mục mong muốn.

### 4.4 OPC-DA Classic (Windows COM)
- Chọn `Server ProgID` từ danh sách tự phát hiện trên Windows (vd: `Kepware.KEPServerEX.V6`, `PhoenixContact.AX-Server.21`) và cấu hình `Update Rate (ms)`.
- Dùng nút **Scan OPC-DA** để duyệt cây tag trực tiếp từ OPC Server.

### 4.5 OPC-UA Client
- Nhập `Endpoint URL` (vd: `opc.tcp://192.168.1.50:4840`), `Security Mode` (`None`, `Sign`, `SignAndEncrypt`), `Username`/`Password` nếu có.
- Dùng nút **Scan OPC-UA** để duyệt Node và nhập tag.

### 4.6 Auto-Demotion & Nút Bật/Tắt nhanh kênh (Power)
- **Auto-Demotion:** Nếu kết nối bị lỗi liên tiếp, chu kỳ thử kết nối lại tự giãn dần **`5s → 10s → 20s → 30s → 60s`** và gắn nhãn `Auto-Demoted`. Khi thiết bị online trở lại, bộ đếm lỗi tự reset về 0.
- **Nút Power (Tạm tắt/Bật kênh):** Dùng khi dừng dây chuyền hoặc bảo trì PLC lâu dài. Kênh `Disabled` sẽ dừng hoàn toàn polling tag và loại khỏi cảnh báo lỗi.

---

## 5. Quản lý Tag, Cây Thư mục, Copy/Paste, Bulk Edit & Excel

### 5.1 Bảng cú pháp Address chuẩn
| Giao thức | Cú pháp Address | Ví dụ |
|---|---|---|
| Siemens S7 | `DB<n>.DBX<b>.<bit>`, `DB<n>.DBB<b>`, `DB<n>.DBW<b>`, `DB<n>.DBD<b>`, `DB<n>.DBL<b>`, `DB<n>.DBS<b>.<len>`, `[%](I\|Q\|M)[X/B/W/D/L]<b>` | `DB24.DBX22.0`, `DB21.DBD158`, `DB1.DBS20.24`, `%I0.0`, `%MW10`, `%MD20` |
| Modbus TCP/RTU | `HR:<offset>`, `CO:<offset>`, `IR:<offset>`, `DI:<offset>` | `HR:0`, `HR:40`, `CO:5`, `IR:10` |
| MQTT | `<topic>:<json_path>` hoặc `<topic>` | `sensor/data:BOM_1.ACK`, `telemetry:$.temp` |
| OPC-DA | Exact OPC Item ID | `Channel1.Device1.TagName` |
| OPC-UA Client | NodeId string | `ns=2;s=MyTag`, `ns=2;i=1001` |
| Internal | `MEM:<key>[=val]`, `SIM:<spec>`, `=<expr>` | `MEM:SP1=3.5`, `SIM:SINE(0,100,20)`, `=FLOW_1+FLOW_2` |

### 5.2 Cây thư mục & Scan OPC đúng thư mục
- Tên thư mục hỗ trợ lồng nhiều cấp bằng dấu `/`, ví dụ: `DAIPHUC/tram2`.
- Khi ấn **Scan OPC-DA** hoặc **Scan OPC-UA**: chọn đúng thư mục (kể cả thư mục con) trên cây trước khi Scan; toàn bộ tag sẽ nạp thẳng vào đúng thư mục đó.

### 5.3 Copy / Paste (`Ctrl+C` / `Ctrl+V`)
- Tích chọn 1 hoặc nhiều tag (hoặc chọn 1 thư mục trên cây bên trái) rồi bấm Copy / Paste.
- Khi Paste trùng tên trong cùng thư mục, hệ thống tự động tăng chỉ số: `BOM1` → `BOM2`, `TRAM_01` → `TRAM_02`, `AP` → `AP_1`.

### 5.4 Sửa hàng loạt (Bulk Edit) & Tìm/Thay thế (Find & Replace)
- Tích chọn nhiều tag trên bảng:
  - **Sửa hàng loạt:** Đổi đồng thời `Scan Rate`, `Data Type`, `Tag Group`, `Access (rw/ro)`, `Unit`, cấu hình `Scaling` và cờ `Log Enabled`.
  - **Tìm & Thay:** Tìm chuỗi con trong `Address`, `Name`, `Description` hoặc `Tag Group` (hỗ trợ nút **Xem trước / Dry Run** trước khi áp dụng).

### 5.5 Import / Export Excel (`.xlsx`)
- Nút **File Mẫu** tải template chuẩn (`Connection ID`, `Tag Group (Thư mục)`, `Tag Name`, `Address`, `Data Type`, `Scan Rate (ms)`, `Description`).
- Nút **Export Excel** xuất kèm thêm các cột mở rộng (`Access (rw/ro)`, `Unit`, `Scale Type`, `Log Enabled`) và có thể chỉnh sửa rồi **Import Excel** ngược lại.

---

## 6. Scaling, Quyền Read-Only (RO/RW) & Tag Nội bộ

### 6.1 Scaling & Đơn vị (`unit`)
- **`none`:** Giữ nguyên giá trị thô đọc từ thiết bị.
- **`linear`:** Quy đổi tuyến tính từ `raw_min..raw_max` sang `eng_min..eng_max` (ví dụ `0..27648` → `0..10 bar`). Nếu bật **`scale_clamp`**, giá trị vượt khung sẽ bị kẹp trong biên Engineering. Khi **ghi** giá trị mới vào tag `linear`, Gateway tự chạy **Reverse Scaling** quy ngược về Raw trước khi ghi xuống PLC.
- **`factor`:** Quy đổi tuyến tính hệ số `y = scale_factor * raw + scale_offset` (ví dụ `0.1 * raw + 0`).
- **Đơn vị (`unit`):** Hiển thị ngay cạnh giá trị live trên bảng Tag, biểu đồ Historian và file Excel lịch sử.

### 6.2 Client Access (`rw` / `ro`)
- Đặt `ro` (Read-Only) cho các biến đo đạc, công tơ, cảnh báo để chống ghi nhầm:
  - Giao diện Web khóa nút ghi bằng biểu tượng **Ổ khóa** và hiện badge **`RO`**.
  - REST API `POST /api/tags/{id}/write` trả **`HTTP 403`**.
  - OPC-UA Server tắt quyền ghi (`set_writable=False`).

### 6.3 Tag Nội bộ (`protocol = internal`)
Tạo kết nối `internal` tại trang Connections, sau đó tạo tag với các cú pháp:
1. **Memory Tag (Đọc/Ghi 2 chiều):** `MEM:SETPOINT_1` hoặc `MEM:SETPOINT_1=3.5`.
2. **Simulator Tag (Giả lập kiểm thử):**
   - `SIM:SINE(0,100,20)` — sóng hình sin từ 0 đến 100, chu kỳ 20 giây.
   - `SIM:RAMP(0,100,1)` — tăng dần từng bước 1, chạm 100 quay lại 0.
   - `SIM:RANDOM(20,30)` — giá trị ngẫu nhiên 20..30.
   - `SIM:TOGGLE(5)` — đảo trạng thái `true/false` mỗi 5 giây.
3. **Formula / Derived Tag (Công thức an toàn AST):**
   - `=FLOW_1 + FLOW_2`, `=(AP1 + AP2) / 2`, `=round(PUMP1_FLOW * 3.6, 2)`, `=1 if AP1 > 2.5 else 0` (hoặc `CALC:...`).
   - Hỗ trợ tham chiếu dạng `TenTag`, `Nhom.TenTag`, `Kenh.Nhom.TenTag`, `TAG_<id>` cùng các hàm `abs, min, max, round`.

---

## 7. OPC-UA Server & Nhóm `_System` Watchdog Tags

- Cấu hình tại `/opcua-server`: đặt Port (`4840`), Security Mode (`None`, `Sign`, `SignAndEncrypt`), bật/tắt `require_auth` (`username`/`password`).
- Cây Address Space chuẩn Kepware:
  - `Objects → <Channel> → <Group> → <Tag>` (`ns=2;s=<Channel>.<Group>.<Tag>`).
  - Trong SCADA (WinCC / Ignition / Kepware Client / UaExpert), chạy Tag Browse / Tag Generation sẽ tự nhận đủ cây thư mục và tên tag chuẩn `<Group>.<Tag>`.
- **Nhóm `_System` tự sinh trên mỗi kênh đang bật (`ns=2;s=<Channel>._System.<Tag>`):**
  - `_Connected` (Boolean): Trạng thái driver đang kết nối.
  - `_Error` (Boolean): Phủ định của `_Connected` (bằng `True` khi lỗi).
  - `_Demoted` (Boolean): `True` khi driver đang ở trạng thái Auto-Demoted.
  - `_TagCount` (Int32): Tổng số tag đang bật của kênh.
  - `_GoodCount` (Int32): Số tag đang có quality `Good`.
  - `_BadCount` (Int32): Số tag không phải `Good`.
  - `_Timestamp` (String): Mốc thời gian UTC ISO cập nhật mỗi giây.

---

## 8. Data Logger (Historian) & Biểu đồ Xu hướng

Truy cập trang **Lịch sử & Logger** (`/historian`):
1. **Cấu hình ghi nền:**
   - Bật **Bật Data Logger chạy nền**.
   - Đặt **Chu kỳ lấy mẫu (giây)** (`1..3600`), **Deadband** (ngưỡng bỏ qua thay đổi nhỏ hơn ngưỡng để không phình DB), và **Thời gian giữ lịch sử (ngày)** (`retention_days`, mặc định 30 ngày, tự động dọn dữ liệu quá hạn).
   - Chọn **Ghi tất cả tag có giá trị số** hoặc bỏ chọn để chỉ ghi những tag có bật **Ghi lịch sử (`log_enabled`)**.
2. **Thao tác nhanh:**
   - Nhấn **Ghi mẫu ngay** để lưu tức thời 1 ảnh chụp các tag đang có giá trị số hợp lệ (bỏ qua Deadband).
   - Chọn Tag + cửa sổ thời gian (`1 giờ`, `6 giờ`, `24 giờ`, `7 ngày`) để xem 4 thẻ KPI (**Số mẫu**, **Min**, **Max**, **Avg**), biểu đồ đường Recharts và bảng mẫu gần nhất.
   - Nhấn **Xuất Excel** để tải file `.xlsx` phục vụ báo cáo ca/tháng, hoặc **Xóa lịch sử tag** khi dọn dữ liệu test.

---

## 9. IoT Gateway (MQTT Outbound & HTTP Webhook)

Truy cập trang **IoT Gateway** (`/iot-gateway`):
- Đặt **Chu kỳ gửi (giây)** và tùy chọn lọc theo **Danh sách kênh** (`connection_ids`, để trống nếu muốn gửi mọi kênh).
- **MQTT Outbound:** Nhập `host`, `port`, `topic_prefix`, `qos` (0/1/2), `username`/`password`. Topic phát sinh: `<topic_prefix>/<Connection>/<Group>/<Tag>`.
- **HTTP REST Webhook:** Nhập `url`, `method` (`POST`/`PUT`), `auth_header` (vd `Bearer ...`). Body JSON Batch gồm `{ source, timestamp, count, tags: [...] }`.
- Dùng nút **Chạy / Dừng** để điều khiển dịch vụ và **Gửi thử ngay** để kiểm tra kết nối Broker/Webhook tức thì.

### 9.3 Vùng đệm & Điều khiển USR-M100 qua MQTT (`/usr-m100`)
Dùng để sử dụng Industrial Gateway làm vùng đệm điều khiển thiết bị IoT **PUSR USR-M100**:
- **Chọn Tag có sẵn từ phần mềm & Chỉ gửi khi đổi giá trị (On-Change):**
  - Nhấn nút **Chọn Tag từ phần mềm** để tìm theo kênh/thư mục và gắn các tag sẵn có (Siemens S7, Modbus, OPC-DA, OPC-UA, Internal, MQTT) làm `source_tag_id` điều khiển trạm M100.
  - **Auto-Sync On-Change:** Khi bật, hệ thống chỉ giữ baseline ban đầu (không spam lệnh lúc mới khởi động) và **chỉ publish xuống USR-M100 khi giá trị tag nguồn thay đổi** (có tham số `deadband` lọc nhiễu cho tag số thực; nếu MQTT tạm mất mạng sẽ giữ giá trị chưa gửi để thử lại khi online).
  - Khi bấm **Publish Lô**, bật sẵn tùy chọn **Chỉ gửi điểm có thay đổi** (`only_changed`) để bỏ qua các điểm đang trùng với `last_sent_value`.
  - *Lưu ý:* Không gắn cùng 1 tag MQTT PUB làm cả `source_tag_id` và `feedback_tag_id` để tránh vòng lặp lệnh.
- Hỗ trợ 2 chế độ Payload:
  - **`rw_prot` (Chuẩn PUSR USR-M100):** Đóng gói `{ "rw_prot": { "Ver": "1.0.1", "dir": "down", "id": "...", "w_data": [{"name": "DO1", "value": "1"}] } }`, tự chia lô tối đa **5 điểm/gói**, hỗ trợ gửi kèm hoặc gọi riêng `r_data`, tùy chọn `value` chuỗi (`"1"`) hay số (`1`), và theo dõi phản hồi `dir: "up"` (`err: "0"` OK / `"1"` Lỗi) từ `pub_topic`.
  - **`flat_json` (JSON phẳng):** Đóng gói `{ "DO1": 1 }`.
- Có tính năng **Nạp nhanh từ nhóm Tag MQTT có sẵn**, giữ **Giá trị Vùng đệm** trước khi Publish hàng loạt, và tab **Gửi Nhanh Tùy Chỉnh**.

---

## 10. Sao lưu, Khôi phục Dự án & Lịch Bảo trì

- **Sao lưu một chạm tại `/system`:** Nhấn **Tải Backup (.json)** để xuất toàn bộ cấu hình (kênh, thư mục, tag, OPC-UA Server, IoT Forwarder, Data Logger, trạm USR-M100 `usr_m100_config`).
- **Khôi phục tại `/system`:** Nạp file `.json`, chọn chế độ:
  - **Replace (Thay thế):** Xóa toàn bộ kênh/tag cũ và khôi phục nguyên bản từ file backup.
  - **Merge (Gộp thêm):** Giữ cấu hình cũ, chỉ thêm kênh/nhóm/tag mới chưa có.
- **Lịch bảo trì khuyến nghị:**
  - *Hằng tuần:* Xuất 1 bản Backup JSON lưu dự phòng ngoài máy trạm; rà lỗi tại `/logs`.
  - *Hằng tháng:* Kiểm tra kích thước `gateway.db`; điều chỉnh `deadband` hoặc `retention_days` nếu lưu lượng Historian cao.
  - *Trước khi nâng cấp phiên bản:* Tắt Gateway an toàn, copy dự phòng `gateway.db`, `opcua_config.json`, `forward_config.json`, `logger_config.json`, `usr_m100_config.json` (và xuất thêm 1 file Backup JSON).

---

## 11. REST API, WebSocket & Xử lý Sự cố Hiện trường

### 11.1 Danh sách API chính (Swagger Interactive tại `/api/docs`)
- **Hệ thống & Tài liệu:** `GET /api/health`, `GET /api/docs` (Swagger UI), `GET /api/system/backup`, `POST /api/system/restore`, `GET/POST /api/system/autostart`.
- **Connections:** `GET/POST /api/connections`, `PUT/DELETE /api/connections/{id}`, `POST /api/connections/{id}/reconnect`, `POST /api/connections/test`, `GET /api/connections/opc-da/servers`.
- **Tags & Groups:** `GET/POST /api/tags`, `PUT/DELETE /api/tags/{id}`, `POST /api/tags/{id}/write`, `POST /api/tags/batch`, `POST /api/tags/bulk-update`, `POST /api/tags/find-replace`, `POST /api/tags/paste`, `GET/POST /api/tags/groups`, `PUT /api/tags/groups/rename`, `DELETE /api/tags/groups/by-name`, `POST /api/tags/groups/paste`.
- **USR-M100 Control:** `GET/POST /api/usr-m100/devices`, `PUT/DELETE /api/usr-m100/devices/{id}`, `POST /api/usr-m100/devices/{id}/buffer`, `POST /api/usr-m100/devices/{id}/publish`, `POST /api/usr-m100/devices/{id}/query`, `POST /api/usr-m100/publish-raw`, `GET/DELETE /api/usr-m100/history`.
- **Dịch vụ & Lịch sử:** `GET/PUT /api/opcua/config`, `GET/PUT /api/forward/config`, `POST /api/forward/start|stop|test`, `GET/PUT /api/history/config`, `POST /api/history/sample-now`, `GET /api/history/query`, `DELETE /api/history/clear`, `GET/DELETE /api/logs`, `WS /ws`.

### 11.2 10 tình huống xử lý sự cố thường gặp
1. **Siemens S7 không kết nối hoặc đọc DB trả Bad:** Kiểm tra PUT/GET và bỏ tích *Optimized block access* trong TIA Portal; xác nhận `Rack=0`, `Slot=1` (S7-1200/1500) hoặc `Slot=2` (S7-300); mở cổng TCP 102.
2. **Modbus đọc giá trị Float32 sai hẳn (ví dụ `1e-38` hoặc `1e+20`):** Đổi `data_type` qua `float32_swap` (CDAB), `float32_be` (BADC) hoặc `float32_le` (DCBA).
3. **OPC-DA không duyệt hoặc không kết nối được COM Server:** Chạy cả Gateway và OPC-DA Server (Kepware / Phoenix Contact) cùng quyền Windows Administrator; kiểm tra đúng `Server ProgID`.
4. **Kênh hiển thị badge `Auto-Demoted`:** PLC đang mất mạng liên tục nên driver tự giãn chu kỳ thử lại tối đa 60s. Khi mạng thông lại, nhấn **Reconnect** tại `/connections` để kết nối tức thì.
5. **Ghi giá trị báo lỗi `HTTP 403` hoặc hiện biểu tượng Ổ khóa:** Tag đang đặt `access = ro` (Read-Only). Nếu cần ghi từ SCADA/Web, sửa tag chuyển sang `rw`. (Tag `SIM:` và công thức `=` luôn là chỉ đọc).
6. **SCADA máy khác không nối vào OPC-UA Server được:** Mở Firewall Inbound cho TCP 4840/4841 trên máy chạy Gateway và kiểm tra đúng Endpoint hiển thị tại `/opcua-server` (tránh trường hợp đã auto-fallback sang 4841).
7. **Biểu đồ `/historian` trống:** Bật Data Logger hoặc nhấn **Ghi mẫu ngay**; đảm bảo tag đang có giá trị số/bool (`Quality: Good`) và được bật `log_enabled` (hoặc bật "Ghi tất cả tag").
8. **Không truy cập được `http://localhost:8000`:** Nếu cổng 8000 bị phần mềm khác chiếm trước khi mở, Gateway tự nhảy sang cổng kế tiếp (`8001..8019`). Xem log console hoặc đặt biến môi trường `GATEWAY_PORT`.
9. **USR-M100 đã Publish nhưng thiết bị không đóng/cắt hoặc không hiện `M100 OK`:** Kiểm tra đúng **Subscribe / Control Topic** trên giao diện Web M100 (phải khác `pub_topic` để tránh lặp gói tin); thử đổi tùy chọn **Kiểu value chuỗi (`"1"` vs `1`)**; kiểm tra chính xác tên điểm `name` khai báo trong M100 (vd `DO1`, `CMD`) và đảm bảo kết nối MQTT ở `/connections` đang Online.
10. **Đã gắn Tag vào trạm USR-M100 nhưng chưa thấy tự động gửi lệnh:** Khi mới gắn tag hoặc khởi động lại Gateway, **Auto-Sync** lưu giá trị hiện tại làm *baseline* (không gửi tràn lệnh ngay) và chỉ publish khi giá trị Tag nguồn thực sự thay đổi vượt ngưỡng `deadband` (với `Quality = Good`, nút **Auto-Sync ON**, và kết nối MQTT đang Online). Nếu cần gửi ngay giá trị hiện tại lần đầu, bỏ chọn tạm **Chỉ gửi điểm có thay đổi** rồi nhấn **Publish Lô**.
