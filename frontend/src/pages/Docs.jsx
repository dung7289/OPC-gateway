import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Code2,
  FileSpreadsheet,
  HardDriveDownload,
  History,
  Layers,
  Lock,
  Plug,
  Power,
  Rocket,
  Search,
  Send,
  Server,
  ShieldAlert,
  SlidersHorizontal,
  Tag,
  Terminal,
  X,
} from 'lucide-react';

const SECTIONS = [
  {
    id: 'startup',
    label: '1. Khởi động & Vận hành hằng ngày',
    icon: Rocket,
    keywords: 'portable exe vbs startup firewall port 8000 dau ca tat an toan sqlite log console',
  },
  {
    id: 'connections',
    label: '2. Kết nối Thiết bị & Auto-Demotion',
    icon: Plug,
    keywords: 'siemens s7 modbus tcp rtu float32 swap cdab badc mqtt opc da opc ua internal auto demotion reconnect',
  },
  {
    id: 'tags',
    label: '3. Quản lý Tag, Thư mục & Bulk Edit',
    icon: Tag,
    keywords: 'address syntax folder group copy paste ctrl+c ctrl+v bulk edit find replace dry run excel import export',
  },
  {
    id: 'scaling_internal',
    label: '4. Scaling, Quyền RO/RW & Tag Nội bộ',
    icon: SlidersHorizontal,
    keywords: 'linear factor clamp reverse scaling don vi unit read only ro rw 403 mem sim formula ast',
  },
  {
    id: 'opcua',
    label: '5. OPC-UA Server & _System Watchdog',
    icon: Server,
    keywords: 'opc.tcp 4840 4841 security none sign encrypt ns=2 nodeid _connected _demoted _goodcount watchdog wincc ignition kepware',
  },
  {
    id: 'historian',
    label: '6. Data Logger (Historian) & Biểu đồ',
    icon: History,
    keywords: 'data logger historian sqlite deadband retention days interval sample now recharts kpi min max avg excel',
  },
  {
    id: 'iot',
    label: '7. IoT Gateway & USR-M100 MQTT',
    icon: Send,
    keywords: 'iot gateway forwarder mqtt outbound webhook json batch authorization header publish test usr-m100 rw_prot w_data r_data vung dem ack',
  },
  {
    id: 'backup_ops',
    label: '8. Sao lưu, Khôi phục & Bảo trì',
    icon: HardDriveDownload,
    keywords: 'backup restore replace merge json migrate upgrade registry hkcu run bao tri tuan thang',
  },
  {
    id: 'api_troubleshoot',
    label: '9. REST API, WebSocket & Xử lý Sự cố',
    icon: Code2,
    keywords: 'rest api swagger /api/docs websocket ws 403 troubleshoot put get optimized block dcom port 8000',
  },
];

function SectionHeader({ icon: Icon, title, subtitle }) {
  return (
    <div className="border-b border-slate-800 pb-4 mb-5">
      <h2 className="font-heading text-lg font-bold text-slate-100 flex items-center gap-2.5">
        <span className="p-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
          <Icon className="w-4 h-4" />
        </span>
        {title}
      </h2>
      {subtitle && <p className="text-xs text-slate-400 mt-1.5">{subtitle}</p>}
    </div>
  );
}

function Callout({ variant = 'info', title, children }) {
  const styles = {
    info: 'bg-sky-500/10 border-sky-500/30 text-sky-200',
    warn: 'bg-amber-500/10 border-amber-500/35 text-amber-200',
    success: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200',
  };
  const IconComp = variant === 'warn' ? AlertTriangle : variant === 'success' ? CheckCircle2 : ShieldAlert;
  return (
    <div className={`border rounded-xl p-4 text-xs leading-relaxed space-y-1 ${styles[variant] || styles.info}`}>
      <div className="font-semibold flex items-center gap-1.5">
        <IconComp className="w-4 h-4 shrink-0" />
        <span>{title}</span>
      </div>
      <div className="text-slate-300">{children}</div>
    </div>
  );
}

export default function Docs() {
  const [activeTab, setActiveTab] = useState('startup');
  const [searchTerm, setSearchTerm] = useState('');

  const matchingTabs = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter(
      (s) => s.label.toLowerCase().includes(q) || s.keywords.toLowerCase().includes(q)
    );
  }, [searchTerm]);

  const effectiveTab = useMemo(() => {
    if (matchingTabs.some((s) => s.id === activeTab)) return activeTab;
    return matchingTabs[0]?.id || activeTab;
  }, [activeTab, matchingTabs]);

  return (
    <div className="space-y-5 max-w-7xl mx-auto pb-12">
      {/* Header Banner */}
      <div className="glass-panel rounded-2xl p-6 border border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <span className="p-2 rounded-xl bg-emerald-500/15 border border-emerald-500/35 text-emerald-400">
              <BookOpen className="w-5 h-5" />
            </span>
            <h1 className="font-heading text-xl font-bold text-slate-100">
              Sổ Tay Vận Hành Industrial Gateway
            </h1>
          </div>
          <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
            Hướng dẫn đầy đủ từ khởi chạy Portable, kết nối PLC/Modbus/MQTT/OPC-DA/OPC-UA, Scaling, Read-Only, Bulk Edit, Historian, IoT Gateway đến sao lưu khôi phục và xử lý sự cố thực tế tại nhà máy.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shrink-0">
          <div className="relative min-w-[260px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Tìm chủ đề (vd: PUT/GET, float32_swap, 403)..."
              className="w-full bg-[#0F172A] border border-slate-700 rounded-lg pl-8 pr-8 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="p-1 text-slate-400 hover:text-slate-200 absolute right-1.5 top-1/2 -translate-y-1/2 cursor-pointer"
                aria-label="Xóa từ khóa tìm kiếm"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="px-3 py-2 rounded-lg bg-[#0F172A] border border-slate-800 text-[11px] font-mono text-slate-300 whitespace-nowrap">
            File offline: <span className="text-emerald-400">HUONG_DAN_VAN_HANH.md</span>
          </div>
        </div>
      </div>

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[275px_1fr] gap-5 items-start">
        {/* Sticky Sidebar Index */}
        <aside className="glass-panel rounded-xl p-2.5 border border-slate-800 lg:sticky lg:top-4 space-y-1">
          <div className="px-3 py-1.5 text-[10px] font-heading font-semibold uppercase tracking-wider text-slate-500">
            Mục lục vận hành ({matchingTabs.length}/9)
          </div>
          {matchingTabs.length === 0 ? (
            <div className="px-3 py-4 text-xs text-slate-400">
              Không tìm thấy mục nào khớp từ khóa &ldquo;{searchTerm}&rdquo;.
            </div>
          ) : (
            matchingTabs.map(({ id, label, icon: Icon }) => {
              const isActive = effectiveTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-xs font-medium transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/35'
                      : 'text-slate-300 hover:bg-slate-800/70 border border-transparent'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-emerald-400' : 'text-slate-400'}`} />
                  <span className="leading-snug">{label}</span>
                </button>
              );
            })
          )}
        </aside>

        {/* Content Body */}
        <div className="glass-panel rounded-2xl border border-slate-800 p-6 space-y-6">
          {/* TAB 1: KHỞI ĐỘNG & VẬN HÀNH HẰNG NGÀY */}
          {effectiveTab === 'startup' && (
            <div className="space-y-6">
              <SectionHeader
                icon={Rocket}
                title="1. Khởi động, Kiến trúc Hệ thống & Quy trình Hằng ngày"
                subtitle="Cách khởi chạy bản Portable, tự khởi động chạy ngầm cùng Windows, cổng mạng và checklist kiểm tra ca."
              />

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-[#0F172A]/80 border border-slate-800 rounded-xl p-4 space-y-2">
                  <div className="text-[11px] font-mono uppercase text-sky-400 font-semibold flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5" /> Tầng 1 · Thiết bị trường (Field)
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Thu thập trực tiếp từ PLC Siemens S7, Modbus TCP/RTU, MQTT IoT Broker, OPC-DA Server (Kepware/Phoenix Contact), OPC-UA Server và kênh ảo Internal.
                  </p>
                </div>
                <div className="bg-[#0F172A]/80 border border-slate-800 rounded-xl p-4 space-y-2">
                  <div className="text-[11px] font-mono uppercase text-emerald-400 font-semibold flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5" /> Tầng 2 · Gateway Core
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Đọc theo chu kỳ từng tag (<code className="text-emerald-300">scan_rate_ms</code>), quy đổi Scaling + đơn vị, kiểm soát quyền <code className="text-amber-300">ro/rw</code> và ghi lịch sử vào SQLite.
                  </p>
                </div>
                <div className="bg-[#0F172A]/80 border border-slate-800 rounded-xl p-4 space-y-2">
                  <div className="text-[11px] font-mono uppercase text-violet-400 font-semibold flex items-center gap-1.5">
                    <Server className="w-3.5 h-3.5" /> Tầng 3 · SCADA / IIoT / Cloud
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Xuất lên SCADA qua <strong>OPC-UA Server</strong> (kèm nhóm <code className="text-sky-300">_System</code>), đẩy MQTT/Webhook qua <strong>IoT Gateway</strong>, hoặc Web qua REST API + WebSocket.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="font-heading text-sm font-bold text-slate-100">Cách khởi chạy bản Portable</h3>
                <div className="overflow-x-auto border border-slate-800 rounded-xl">
                  <table className="w-full text-xs">
                    <thead className="bg-[#0F172A] border-b border-slate-800 text-slate-400">
                      <tr>
                        <th className="text-left px-4 py-2.5 font-semibold">Tình huống sử dụng</th>
                        <th className="text-left px-4 py-2.5 font-semibold">File cần chạy</th>
                        <th className="text-left px-4 py-2.5 font-semibold">Hành vi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80 text-slate-300">
                      <tr>
                        <td className="px-4 py-2.5 font-semibold text-emerald-300">Chạy sản xuất 24/7 (Khuyên dùng)</td>
                        <td className="px-4 py-2.5 font-mono text-sky-300">Start_Gateway_Hidden.vbs</td>
                        <td className="px-4 py-2.5">Khởi chạy <code className="text-slate-200">IndustrialGateway.exe</code> chạy ngầm hoàn toàn, không hiện cửa sổ CMD đen tránh bấm nhầm tắt.</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold text-amber-300">Kiểm tra / Gỡ lỗi ban đầu</td>
                        <td className="px-4 py-2.5 font-mono text-sky-300">IndustrialGateway.exe</td>
                        <td className="px-4 py-2.5">Mở cửa sổ Console in trực tiếp log kết nối PLC, Modbus, OPC-DA, OPC-UA và HTTP request.</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold text-slate-100">Tự khởi động cùng Windows</td>
                        <td className="px-4 py-2.5 font-mono text-sky-300">/system (Web UI)</td>
                        <td className="px-4 py-2.5">Vào mục <strong>Hệ thống &amp; Sao lưu</strong> → nhấn <strong>Bật Auto-Start chạy ngầm</strong> để tự chạy khi đăng nhập Windows.</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-[#0F172A]/80 border border-slate-800 rounded-xl p-4 space-y-2">
                  <h3 className="font-heading text-xs font-bold text-slate-100 uppercase tracking-wider">
                    Bảng cổng mạng cần mở trên Windows Firewall
                  </h3>
                  <ul className="text-xs text-slate-300 font-mono space-y-1.5">
                    <li>• <span className="text-emerald-400">TCP 8000</span> : Web UI + REST API + WebSocket (đổi qua biến <code className="text-slate-200">GATEWAY_PORT</code>; tự nhảy 8000..8019 nếu bận)</li>
                    <li>• <span className="text-emerald-400">TCP 4840 / 4841</span> : OPC-UA Server cho SCADA kết nối vào</li>
                    <li>• <span className="text-sky-400">TCP 102</span> : Kết nối ra Siemens S7 PLC</li>
                    <li>• <span className="text-sky-400">TCP 502</span> : Kết nối ra thiết bị Modbus TCP</li>
                    <li>• <span className="text-sky-400">TCP 1883</span> : Kết nối tới MQTT Broker (thu thập &amp; đẩy dữ liệu)</li>
                  </ul>
                </div>

                <div className="bg-[#0F172A]/80 border border-slate-800 rounded-xl p-4 space-y-2">
                  <h3 className="font-heading text-xs font-bold text-slate-100 uppercase tracking-wider">
                    Checklist kiểm tra đầu ca &amp; tắt an toàn
                  </h3>
                  <ol className="text-xs text-slate-300 space-y-1.5 list-decimal pl-4">
                    <li>Mở Web UI tại <code className="text-emerald-300">http://localhost:8000</code>: kiểm tra 4 thẻ KPI trên Dashboard và bảng dữ liệu Live phân nhóm theo <strong>Cây Thư Mục</strong> (hỗ trợ lọc chất lượng Good/Lỗi, thu gọn thư mục và ghim tối đa 4 biểu đồ realtime).</li>
                    <li>Vào trang <strong>Connections</strong>: kiểm tra cột <strong>Status</strong> (xanh, không kẹt <span className="text-amber-300">Auto-Demoted</span>) và cột <strong>Tags (_System)</strong> đạt <code className="text-emerald-300">Good / Total</code>.</li>
                    <li>Kiểm tra trạng thái <strong>OPC-UA Server</strong> / <strong>IoT Gateway</strong> / <strong>Data Logger</strong> đang Running đúng yêu cầu ca trực.</li>
                    <li>Khi bảo trì cần tắt phần mềm: nhấn <code className="text-amber-300">Ctrl+C</code> trong cửa sổ Console hoặc tắt tiến trình <code className="text-slate-200">IndustrialGateway.exe</code> để lifespan đóng DriverManager &amp; flush SQLite an toàn.</li>
                  </ol>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: KẾT NỐI THIẾT BỊ & AUTO-DEMOTION */}
          {effectiveTab === 'connections' && (
            <div className="space-y-6">
              <SectionHeader
                icon={Plug}
                title="2. Cấu hình Thiết bị & Cơ chế Auto-Demotion"
                subtitle="Thông số chi tiết của 6 giao thức thu thập dữ liệu, giải mã byte order Modbus và nút bật/tắt kênh."
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-[#0F172A]/80 border border-slate-800 rounded-xl p-4 space-y-2">
                  <h3 className="font-heading text-sm font-bold text-amber-300">1. Siemens S7 (S7-1200 / 1500 / 300 / 400)</h3>
                  <ul className="text-xs text-slate-300 space-y-1 font-mono">
                    <li>• <strong>Host:</strong> IP của PLC (vd: 192.168.11.3)</li>
                    <li>• <strong>Port:</strong> 102 (mặc định S7 ISO-on-TCP)</li>
                    <li>• <strong>Rack / Slot:</strong> Rack <code className="text-emerald-300">0</code>; Slot <code className="text-emerald-300">1</code> (S7-1200/1500) hoặc <code className="text-emerald-300">2</code> (S7-300)</li>
                  </ul>
                  <Callout variant="warn" title="Bắt buộc trên TIA Portal">
                    Tích chọn <strong>Permit access with PUT/GET communication from remote partner</strong> trong Device Configuration &rarr; Protection, và bỏ tích <strong>Optimized block access</strong> ở thuộc tính của Data Block (DB) cần đọc.
                  </Callout>
                </div>

                <div className="bg-[#0F172A]/80 border border-slate-800 rounded-xl p-4 space-y-2">
                  <h3 className="font-heading text-sm font-bold text-sky-300">2. Modbus TCP &amp; Modbus RTU</h3>
                  <ul className="text-xs text-slate-300 space-y-1 font-mono">
                    <li>• <strong>Modbus TCP:</strong> Host (IP thiết bị) + Port <code className="text-emerald-300">502</code></li>
                    <li>• <strong>Modbus RTU:</strong> Serial Port (vd: <code className="text-emerald-300">COM1</code>) + Baudrate (<code className="text-slate-200">2400..115200</code>)</li>
                  </ul>
                  <div className="text-[11px] text-slate-300 bg-slate-900 border border-slate-800 rounded-lg p-2.5 space-y-1">
                    <div className="font-semibold text-sky-300">Xử lý đảo Word/Byte thanh ghi 32-bit:</div>
                    <div>• <code className="text-emerald-300">float32</code> / <code className="text-emerald-300">int32</code>: Big-Endian ABCD (chuẩn Modbus)</div>
                    <div>• <code className="text-emerald-300">float32_swap</code> / <code className="text-emerald-300">int32_swap</code>: Đảo Word CDAB (phổ biến với Schneider, biến tần, đồng hồ điện)</div>
                    <div>• <code className="text-emerald-300">float32_be</code>: BADC Byte-Swapped • <code className="text-emerald-300">float32_le</code>: DCBA Little-Endian</div>
                  </div>
                </div>

                <div className="bg-[#0F172A]/80 border border-slate-800 rounded-xl p-4 space-y-2">
                  <h3 className="font-heading text-sm font-bold text-violet-300">3. MQTT Client (Thu thập IoT)</h3>
                  <ul className="text-xs text-slate-300 space-y-1 font-mono">
                    <li>• <strong>Broker URL:</strong> <code className="text-emerald-300">mqtt://123.31.43.19:1883</code></li>
                    <li>• <strong>Client ID / Username / Password:</strong> Tùy theo Broker</li>
                    <li>• <strong>Auto Tag (JSON):</strong> Bấm nút <span className="text-violet-300">Auto Tag JSON</span> trên dòng kênh hoặc trang Tags để lắng nghe topic và tự sinh hàng loạt tag từ payload JSON.</li>
                  </ul>
                </div>

                <div className="bg-[#0F172A]/80 border border-slate-800 rounded-xl p-4 space-y-2">
                  <h3 className="font-heading text-sm font-bold text-emerald-300">4. OPC-DA Classic &amp; OPC-UA Client</h3>
                  <ul className="text-xs text-slate-300 space-y-1 font-mono">
                    <li>• <strong>OPC-DA:</strong> Chọn <code className="text-emerald-300">Server ProgID</code> (vd: <code>Kepware.KEPServerEX.V6</code>, <code>PhoenixContact.AX-Server.21</code>) + Update Rate (ms). Dùng nút <strong>Scan OPC-DA</strong> để duyệt cây Item.</li>
                    <li>• <strong>OPC-UA Client:</strong> Nhập <code className="text-emerald-300">Endpoint URL</code> (vd: <code>opc.tcp://localhost:49320</code>), Security Mode (None/Sign/SignAndEncrypt), User/Pass nếu có. Dùng <strong>Scan OPC-UA</strong> để nhập tag.</li>
                  </ul>
                </div>
              </div>

              <Callout variant="info" title="Cơ chế Auto-Demotion & Nút Bật/Tắt nhanh kênh (Connections)">
                <div className="space-y-1.5 mt-1">
                  <p>
                    • Khi một PLC tắt nguồn hoặc đứt mạng, driver không spam kết nối lại mỗi vài giây gây nghẽn mạng. Hệ thống tự động giãn thời gian chờ theo bậc: <code className="text-amber-300">5s → 10s → 20s → 30s → 60s</code> và hiển thị badge <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">Auto-Demoted</span> cạnh trạng thái kênh. Khi kết nối lại thành công, chu kỳ lập tức reset về bình thường.
                  </p>
                  <p className="flex items-center gap-1.5">
                    <Power className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>Khi cần bảo trì PLC dài ngày: bấm biểu tượng <strong>Power</strong> trên dòng kết nối tại <strong>Connections</strong> để tạm tắt kênh (<code className="text-slate-200">Disabled</code>) — toàn bộ polling tag thuộc kênh đó sẽ dừng sạch và không sinh lỗi giả.</span>
                  </p>
                </div>
              </Callout>
            </div>
          )}

          {/* TAB 3: QUẢN LÝ TAG, THƯ MỤC & BULK EDIT */}
          {effectiveTab === 'tags' && (
            <div className="space-y-6">
              <SectionHeader
                icon={Tag}
                title="3. Quản lý Tag, Cây Thư mục, Copy/Paste & Sửa Hàng loạt"
                subtitle="Bảng cú pháp địa chỉ chuẩn xác theo từng driver, thao tác nhanh hàng nghìn tag giống Kepware."
              />

              <div className="overflow-x-auto border border-slate-800 rounded-xl">
                <table className="w-full text-xs">
                  <thead className="bg-[#0F172A] border-b border-slate-800 text-slate-400">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-semibold">Giao thức</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Cú pháp Address</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Ví dụ thực tế</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Kiểu dữ liệu</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 text-slate-300">
                    <tr>
                      <td className="px-4 py-2.5 font-semibold text-amber-300">Siemens S7</td>
                      <td className="px-4 py-2.5 font-mono">DB&lt;n&gt;.DBX&lt;b&gt;.&lt;bit&gt;, DB&lt;n&gt;.DBB&lt;b&gt;, DB&lt;n&gt;.DBW&lt;b&gt;, DB&lt;n&gt;.DBD&lt;b&gt;, M&lt;b&gt;.&lt;bit&gt;, Q&lt;b&gt;.&lt;bit&gt;, I&lt;b&gt;.&lt;bit&gt;</td>
                      <td className="px-4 py-2.5 font-mono text-sky-300">DB24.DBX22.0 · DB21.DBD158 · DB1.DBW0 · M0.0</td>
                      <td className="px-4 py-2.5 font-mono">bool, int16, int32, float32</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2.5 font-semibold text-sky-300">Modbus TCP/RTU</td>
                      <td className="px-4 py-2.5 font-mono">HR:&lt;offset&gt;, CO:&lt;offset&gt;, IR:&lt;offset&gt;, DI:&lt;offset&gt;</td>
                      <td className="px-4 py-2.5 font-mono text-sky-300">HR:0 · HR:40 · CO:5 · IR:10 · DI:2</td>
                      <td className="px-4 py-2.5 font-mono">bool, int16, uint16, int32, int32_swap, float32, float32_swap, float32_be, float32_le</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2.5 font-semibold text-violet-300">MQTT</td>
                      <td className="px-4 py-2.5 font-mono">&lt;topic&gt;:&lt;json_path&gt; hoặc &lt;topic&gt;</td>
                      <td className="px-4 py-2.5 font-mono text-sky-300">sensor/tram1:BOM_1.ACK · telemetry:$.temp</td>
                      <td className="px-4 py-2.5 font-mono">bool, int16, int32, float32, string</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2.5 font-semibold text-cyan-300">OPC-DA</td>
                      <td className="px-4 py-2.5 font-mono">Exact Item ID trên OPC Server</td>
                      <td className="px-4 py-2.5 font-mono text-sky-300">Channel1.Device1.TagName</td>
                      <td className="px-4 py-2.5 font-mono">Tự ép theo data_type</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2.5 font-semibold text-emerald-300">OPC-UA Client</td>
                      <td className="px-4 py-2.5 font-mono">NodeId (ns=&lt;i&gt;;s=... hoặc ns=&lt;i&gt;;i=...)</td>
                      <td className="px-4 py-2.5 font-mono text-sky-300">ns=2;s=TRAM_1.AP1 · ns=2;i=1001</td>
                      <td className="px-4 py-2.5 font-mono">bool, int16, int32, float32, string</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2.5 font-semibold text-teal-300">Internal</td>
                      <td className="px-4 py-2.5 font-mono">MEM:&lt;k&gt;[=val] · SIM:... · =&lt;expr&gt;</td>
                      <td className="px-4 py-2.5 font-mono text-sky-300">MEM:SP1=3.5 · SIM:SINE(0,100,20) · =FLOW_1+FLOW_2</td>
                      <td className="px-4 py-2.5 font-mono">bool, int16, int32, float32, string</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-[#0F172A]/80 border border-slate-800 rounded-xl p-4 space-y-2 text-xs text-slate-300">
                  <h3 className="font-heading text-sm font-bold text-slate-100">Cây Thư mục, Scan OPC &amp; Copy/Paste</h3>
                  <ul className="space-y-1.5">
                    <li>• <strong>Thư mục con:</strong> Đặt dạng đường dẫn gạch chéo như <code className="text-amber-300">DAIPHUC/tram2</code>; cây bên trái tự phân cấp và tạo nhánh tương ứng trên OPC-UA Server.</li>
                    <li>• <strong>Scan OPC-DA / OPC-UA:</strong> Chọn đúng thư mục (kể cả thư mục con) trên cây trước khi bấm Scan — toàn bộ tag quét được sẽ nạp thẳng vào thư mục đang chọn mà không tự sinh thư mục rác mới.</li>
                    <li>• <strong>Copy / Paste (<code className="text-emerald-300">Ctrl+C</code> / <code className="text-emerald-300">Ctrl+V</code>):</strong> Tích chọn 1 hoặc nhiều tag (hoặc đứng tại 1 thư mục và bấm Copy thư mục) rồi Paste vào cùng thư mục hay thư mục khác. Trùng tên tự tăng chỉ số (<code className="text-sky-300">BOM1 → BOM2</code>, <code className="text-sky-300">AP → AP_1</code>).</li>
                  </ul>
                </div>

                <div className="bg-[#0F172A]/80 border border-slate-800 rounded-xl p-4 space-y-2 text-xs text-slate-300">
                  <h3 className="font-heading text-sm font-bold text-slate-100 flex items-center gap-1.5">
                    <FileSpreadsheet className="w-4 h-4 text-emerald-400" /> Sửa Hàng loạt, Find/Replace &amp; Excel
                  </h3>
                  <ul className="space-y-1.5">
                    <li>• <strong>Sửa hàng loạt (Bulk Edit):</strong> Tích chọn nhiều tag → bấm <strong>Sửa hàng loạt</strong> để đổi cùng lúc Scan Rate, Data Type, Thư mục, Access (`rw/ro`), Đơn vị, Scaling hoặc cờ Ghi lịch sử.</li>
                    <li>• <strong>Tìm &amp; Thay (Find &amp; Replace):</strong> Tích chọn các tag → đổi hàng loạt chuỗi trong Address (vd: đổi <code className="text-amber-300">DB21.</code> thành <code className="text-emerald-300">DB22.</code>), Tên tag, Mô tả hoặc Thư mục. Luôn hỗ trợ <strong>Xem trước (Dry Run)</strong> trước khi ghi.</li>
                    <li>• <strong>Excel Export / Import:</strong> Nút <strong>Export Excel</strong> xuất đầy đủ cả cột <code className="text-slate-200">Access (rw/ro)</code>, <code className="text-slate-200">Unit</code>, <code className="text-slate-200">Scale Type</code>, <code className="text-slate-200">Log Enabled</code>; nút <strong>Import Excel</strong> tự động bỏ qua/cập nhật chống trùng lặp.</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: SCALING, QUYỀN RO/RW & TAG NỘI BỘ */}
          {effectiveTab === 'scaling_internal' && (
            <div className="space-y-6">
              <SectionHeader
                icon={SlidersHorizontal}
                title="4. Scaling, Quyền Read-Only & Tag Nội bộ / Công thức"
                subtitle="Quy đổi tín hiệu thô PLC sang đơn vị kỹ thuật, bảo vệ tag không cho ghi đè và tạo tag tính toán không cần PLC."
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-[#0F172A]/80 border border-slate-800 rounded-xl p-4 space-y-2.5 text-xs text-slate-300">
                  <h3 className="font-heading text-sm font-bold text-sky-300">Quy đổi Scaling &amp; Đơn vị đo (Unit)</h3>
                  <p>
                    Cấu hình ngay trong form <strong>Sửa/Thêm Tag</strong> hoặc qua <strong>Sửa hàng loạt</strong>:
                  </p>
                  <ul className="space-y-1.5 font-mono text-[11px] bg-slate-900 border border-slate-800 rounded-lg p-3">
                    <li>• <span className="text-emerald-300 font-bold">linear</span>: Quy đổi tuyến tính <code className="text-slate-200">raw_min..raw_max</code> → <code className="text-slate-200">eng_min..eng_max</code> (vd: 4-20mA Siemens <code className="text-sky-300">0..27648 → 0..10 bar</code>).</li>
                    <li>• <span className="text-emerald-300 font-bold">scale_clamp</span>: Khi bật Clamp, giá trị vượt biên sẽ được kẹp gọn trong khoảng Eng Min..Eng Max.</li>
                    <li>• <span className="text-emerald-300 font-bold">Reverse Scaling</span>: Khi ghi giá trị Engineering (vd: 7.5 bar) từ Web hoặc SCADA xuống PLC, Gateway tự quy ngược thành Raw (<code className="text-sky-300">20736</code>) trước khi ghi.</li>
                    <li>• <span className="text-emerald-300 font-bold">factor</span>: Tính theo <code className="text-slate-200">y = scale_factor * raw + scale_offset</code> (vd: thanh ghi nhiệt độ 250 với factor 0.1 → <code className="text-sky-300">25.0 °C</code>).</li>
                  </ul>
                </div>

                <div className="bg-[#0F172A]/80 border border-slate-800 rounded-xl p-4 space-y-2.5 text-xs text-slate-300">
                  <h3 className="font-heading text-sm font-bold text-amber-300 flex items-center gap-1.5">
                    <Lock className="w-4 h-4" /> Phân quyền Client Access (rw / ro)
                  </h3>
                  <p>
                    Dùng cho các biến đo cảm biến, công tơ, cảnh báo hoặc công thức chỉ được phép đọc, ngăn thao tác ghi nhầm từ Client bên ngoài:
                  </p>
                  <ul className="space-y-1.5">
                    <li>• Chọn Access = <code className="text-amber-300 font-mono">ro</code> (Read-Only): Bảng tag gắn nhãn <strong>RO</strong> màu vàng và thay nút bút ghi bằng biểu tượng <strong>Ổ khóa</strong>.</li>
                    <li>• Gọi REST API <code className="text-sky-300">POST /api/tags/&#123;id&#125;/write</code> vào tag <code className="text-amber-300">ro</code> sẽ bị chặn với mã lỗi <code className="text-red-300">HTTP 403</code>.</li>
                    <li>• Trên <strong>OPC-UA Server</strong>, biến <code className="text-amber-300">ro</code> có AccessLevel Read-Only (<code className="text-slate-200">set_writable=False</code>) và bị bỏ qua nếu client cố ghi.</li>
                  </ul>
                </div>
              </div>

              <div className="bg-[#0F172A]/80 border border-slate-800 rounded-xl p-4 space-y-3 text-xs text-slate-300">
                <h3 className="font-heading text-sm font-bold text-teal-300">
                  Kênh Nội Bộ (Internal Driver) — Không cần PLC thật
                </h3>
                <p>
                  Tạo một kết nối có Protocol = <code className="text-teal-300 font-mono">internal</code> tại trang <strong>Connections</strong>, sau đó thêm tag theo 3 chế độ:
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono text-[11px]">
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-1">
                    <div className="text-emerald-300 font-bold">1. Memory Tag (Đọc/Ghi 2 chiều)</div>
                    <div><code>MEM:SETPOINT_1=3.5</code></div>
                    <div className="text-slate-400 font-sans">Khởi tạo giá trị mặc định 3.5; SCADA và Web có thể ghi/đọc giữ trạng thái trong RAM.</div>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-1">
                    <div className="text-sky-300 font-bold">2. Simulator Tag (Tín hiệu giả lập)</div>
                    <div><code>SIM:SINE(0,100,20)</code></div>
                    <div><code>SIM:RAMP(0,100,1)</code></div>
                    <div><code>SIM:RANDOM(20,30)</code> · <code>SIM:TOGGLE(5)</code></div>
                    <div className="text-slate-400 font-sans">Tự sinh sóng sin, răng cưa, ngẫu nhiên hoặc xung vuông (chỉ đọc).</div>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-1">
                    <div className="text-amber-300 font-bold">3. Formula / Derived Tag (Công thức AST)</div>
                    <div><code>=FLOW_1 + FLOW_2</code></div>
                    <div><code>=(AP1 + AP2) / 2</code></div>
                    <div><code>=round(PUMP1_FLOW * 3.6, 2)</code></div>
                    <div><code>=1 if AP1 &gt; 2.5 else 0</code></div>
                    <div className="text-slate-400 font-sans">Tham chiếu tên tag, <code>Nhom.Tag</code>, hoặc <code>Kenh.Nhom.Tag</code>; hỗ trợ <code>min, max, abs, round</code>.</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: OPC-UA SERVER & _SYSTEM WATCHDOG */}
          {effectiveTab === 'opcua' && (
            <div className="space-y-6">
              <SectionHeader
                icon={Server}
                title="5. OPC-UA Server & Nhóm _System Tags (Watchdog)"
                subtitle="Kết nối WinCC, Ignition, Kepware Client, UaExpert vào Gateway và cấu hình cảnh báo mất kết nối PLC."
              />

              <div className="bg-[#0F172A]/80 border border-sky-500/30 rounded-xl p-4 space-y-2 text-xs text-slate-300">
                <h3 className="font-heading text-sm font-bold text-sky-300">Thông số kết nối SCADA vào Gateway</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono">
                  <div>• <strong>Endpoint (trên trang /opcua-server):</strong> <span className="text-emerald-300">opc.tcp://&lt;IP-Gateway&gt;:4840/freeopcua/server/</span></div>
                  <div>• <strong>Lưu ý Auto-Fallback:</strong> Nếu cổng 4840 đã bị Kepware hoặc phần mềm khác chiếm, Server tự chuyển sang cổng <code className="text-amber-300">4841</code> (xem đúng Endpoint tại trang OPC-UA Server).</div>
                  <div>• <strong>Security Policy:</strong> <code className="text-slate-200">None</code> (mặc định), hỗ trợ bật <code className="text-slate-200">Sign</code> / <code className="text-slate-200">SignAndEncrypt</code>.</div>
                  <div>• <strong>Xác thực:</strong> Anonymous hoặc bật <code className="text-slate-200">require_auth</code> (mặc định gợi ý <code className="text-slate-200">admin / password123</code> — hãy đổi khi vận hành thật).</div>
                </div>
              </div>

              <div className="bg-[#0F172A] border border-slate-800 rounded-xl p-4 font-mono text-xs text-emerald-300 leading-relaxed overflow-x-auto">
                <div>Objects/</div>
                <div>&nbsp;&nbsp;└── plc/  (Tên kênh kết nối)</div>
                <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;├── _System/  (Tự sinh cho mỗi kênh đang bật)</div>
                <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│&nbsp;&nbsp;&nbsp;&nbsp;├── _Connected  → ns=2;s=plc._System._Connected  (Boolean)</div>
                <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│&nbsp;&nbsp;&nbsp;&nbsp;├── _Error      → ns=2;s=plc._System._Error      (Boolean)</div>
                <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│&nbsp;&nbsp;&nbsp;&nbsp;├── _Demoted    → ns=2;s=plc._System._Demoted    (Boolean: đang Auto-Demotion)</div>
                <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│&nbsp;&nbsp;&nbsp;&nbsp;├── _TagCount   → ns=2;s=plc._System._TagCount   (Tổng tag bật của kênh)</div>
                <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│&nbsp;&nbsp;&nbsp;&nbsp;├── _GoodCount  → ns=2;s=plc._System._GoodCount  (Số tag Quality Good)</div>
                <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│&nbsp;&nbsp;&nbsp;&nbsp;├── _BadCount   → ns=2;s=plc._System._BadCount   (Số tag lỗi/chưa có giá trị)</div>
                <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│&nbsp;&nbsp;&nbsp;&nbsp;└── _Timestamp  → ns=2;s=plc._System._Timestamp  (UTC ISO cập nhật mỗi giây)</div>
                <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;└── BOM_1/</div>
                <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;└── ACK       → ns=2;s=plc.BOM_1.ACK</div>
              </div>

              <Callout variant="success" title="Mẹo gắn Watchdog trên SCADA">
                Trên WinCC / Ignition / Kepware, hãy đọc tag <code className="text-emerald-300">ns=2;s=&lt;TenKenh&gt;._System._Connected</code> (hoặc <code className="text-amber-300">_Error</code>) để kích hoạt còi cảnh báo khi PLC mất truyền thông, và theo dõi <code className="text-sky-300">_GoodCount == _TagCount</code> để kiểm tra toàn bộ thẻ đang đọc ổn định.
              </Callout>
            </div>
          )}

          {/* TAB 6: DATA LOGGER (HISTORIAN) & BIỂU ĐỒ */}
          {effectiveTab === 'historian' && (
            <div className="space-y-6">
              <SectionHeader
                icon={History}
                title="6. Data Logger (Historian) & Truy vấn Biểu đồ Lịch sử"
                subtitle="Ghi chuỗi thời gian dài hạn vào bảng SQLite tag_history với Deadband chống rác dung lượng."
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-300">
                <div className="bg-[#0F172A]/80 border border-slate-800 rounded-xl p-4 space-y-2">
                  <h3 className="font-heading text-sm font-bold text-emerald-300">Thiết lập Data Logger (/historian)</h3>
                  <ul className="space-y-1.5">
                    <li>• <strong>Bật Data Logger chạy nền:</strong> Khi kích hoạt, hệ thống tự lưu cấu hình vào <code className="text-slate-200">logger_config.json</code> và ghi nền liên tục.</li>
                    <li>• <strong>Chu kỳ lấy mẫu (giây):</strong> Khoảng thời gian tối thiểu giữa 2 lần kiểm tra ghi (1–3600 giây).</li>
                    <li>• <strong>Deadband:</strong> Nếu độ lệch so với mẫu đã lưu trước đó nhỏ hơn ngưỡng Deadband, mẫu mới sẽ được bỏ qua để tiết kiệm dung lượng ổ đĩa.</li>
                    <li>• <strong>Thời gian giữ lịch sử (ngày):</strong> Hệ thống tự dọn các mẫu cũ quá <code className="text-amber-300">retention_days</code>.</li>
                    <li>• <strong>Chọn tag ghi:</strong> Tắt &ldquo;Ghi tất cả tag&rdquo; để chỉ ghi những tag đã bật <code className="text-emerald-300">log_enabled = true</code> (badge <strong>Log</strong> trên danh sách Tag).</li>
                  </ul>
                </div>

                <div className="bg-[#0F172A]/80 border border-slate-800 rounded-xl p-4 space-y-2">
                  <h3 className="font-heading text-sm font-bold text-sky-300">Thao tác Vận hành &amp; Xuất Báo cáo</h3>
                  <ul className="space-y-1.5">
                    <li>• <strong>Ghi mẫu ngay:</strong> Dùng ngay lúc nghiệm thu để ép ghi 1 snapshot tức thời (bỏ qua Deadband) của mọi tag số đang hợp lệ.</li>
                    <li>• <strong>Truy vấn &amp; KPI:</strong> Chọn Tag + khung thời gian (<code className="text-slate-200">1 giờ / 6 giờ / 24 giờ / 7 ngày</code>) để xem biểu đồ xu hướng cùng 4 chỉ số: <strong>Số mẫu</strong>, <strong>Min</strong>, <strong>Max</strong>, <strong>Avg</strong>.</li>
                    <li>• <strong>Xuất Excel (.xlsx):</strong> Tạo file <code className="text-emerald-300">history_&lt;TenTag&gt;_&lt;Nh&gt;.xlsx</code> gồm Thời gian Local, ISO UTC, Connection, Tag, Value, Unit, Quality.</li>
                    <li>• <strong>Xóa lịch sử tag:</strong> Dùng khi dọn dữ liệu chạy thử trước khi bàn giao nhà máy.</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* TAB 7: IOT GATEWAY (MQTT & HTTP WEBHOOK) */}
          {effectiveTab === 'iot' && (
            <div className="space-y-6">
              <SectionHeader
                icon={Send}
                title="7. IoT Gateway — Đẩy dữ liệu ra MQTT Broker & HTTP Webhook"
                subtitle="Đẩy dữ liệu realtime lên ThingsBoard, EMQX, Node-RED, Grafana hoặc Webhook Cloud ngay trên Web UI (/iot-gateway)."
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-300">
                <div className="bg-[#0F172A]/80 border border-slate-800 rounded-xl p-4 space-y-2">
                  <h3 className="font-heading text-sm font-bold text-emerald-300">1. MQTT Outbound (Publish định kỳ)</h3>
                  <p>Cấu hình trực tiếp tại trang <strong>IoT Gateway</strong> (<code className="text-slate-200">/iot-gateway</code>):</p>
                  <ul className="space-y-1 font-mono text-[11px]">
                    <li>• <strong>Host / Port / QoS (0/1/2) / Username / Password</strong></li>
                    <li>• <strong>Lọc kênh (connection_ids):</strong> Chọn gửi tất cả hoặc chỉ chọn một vài kênh cụ thể.</li>
                    <li>• <strong>Topic phát sinh:</strong> <span className="text-sky-300">&lt;topic_prefix&gt;/&lt;Kenh&gt;/&lt;Nhom&gt;/&lt;Tag&gt;</span> (bỏ nhóm nếu không có group).</li>
                  </ul>
                  <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-[11px] font-mono text-amber-300 overflow-x-auto">
{`{
  "tag_id": 10,
  "connection": "plc",
  "group": "BOM_1",
  "tag": "ACK",
  "scada_tag": "BOM_1.ACK",
  "data_type": "bool",
  "value": true,
  "quality": "Good",
  "timestamp": "2026-11-22T06:00:00Z"
}`}
                  </pre>
                </div>

                <div className="bg-[#0F172A]/80 border border-slate-800 rounded-xl p-4 space-y-2">
                  <h3 className="font-heading text-sm font-bold text-sky-300">2. HTTP REST Webhook (JSON Batch)</h3>
                  <p>Phù hợp đẩy đồng bộ lô dữ liệu về server ERP / Cloud API:</p>
                  <ul className="space-y-1 font-mono text-[11px]">
                    <li>• <strong>URL / Method (POST/PUT) / Header Authorization</strong> (vd: <code className="text-slate-200">Bearer &lt;token&gt;</code>)</li>
                    <li>• <strong>Nút Gửi thử ngay:</strong> Bấm để kiểm tra ngay không cần chờ hết chu kỳ, hiển thị số tag đã gửi và báo lỗi nếu Broker/Webhook từ chối.</li>
                  </ul>
                  <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-[11px] font-mono text-emerald-300 overflow-x-auto">
{`{
  "source": "IndustrialGateway",
  "timestamp": "2026-11-22T06:00:00+00:00",
  "count": 2,
  "tags": [ ... ]
}`}
                  </pre>
                </div>
              </div>

              <div className="bg-[#0F172A]/80 border border-emerald-500/30 rounded-xl p-4 space-y-2.5 text-xs text-slate-300">
                <h3 className="font-heading text-sm font-bold text-emerald-300">
                  3. Điều khiển thiết bị PUSR USR-M100 qua vùng đệm MQTT (/usr-m100)
                </h3>
                <p>
                  Dùng Gateway làm vùng đệm trung gian giữ giá trị cài đặt, nạp nhanh từ nhóm Tag MQTT (<code className="text-sky-300">DAPCAU</code>, <code className="text-sky-300">DAUHAN</code>...) và Publish xuống Topic Subscribe của USR-M100 theo chuẩn <code className="text-amber-300">rw_prot</code> (tự chia lô tối đa 5 điểm/gói) hoặc JSON phẳng:
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-[11px] font-mono text-amber-300 overflow-x-auto">
{`{
  "rw_prot": {
    "Ver": "1.0.1",
    "dir": "down",
    "id": "12345",
    "w_data": [
      { "name": "DO1", "value": "1" }
    ]
  }
}`}
                  </pre>
                  <ul className="space-y-1.5 text-[11px]">
                    <li>• <strong>Chọn Tag có sẵn &amp; chỉ gửi khi đổi giá trị:</strong> Dùng nút <strong>Chọn Tag từ phần mềm</strong> tại <code className="text-sky-300">/usr-m100</code> để gắn trực tiếp tag PLC S7, Modbus, OPC-DA/UA, Internal làm <code className="text-emerald-300">source_tag_id</code>; bật <strong>Auto-Sync</strong> (có <code className="text-slate-200">deadband</code> chống nhiễu số thực và tự thử lại khi MQTT online lại) hoặc tick <strong>Chỉ gửi điểm có thay đổi</strong> khi gửi lô.</li>
                    <li>• <strong>Tùy chọn định dạng:</strong> Chọn <code>rw_prot</code> (hỗ trợ cả <code>w_data</code> điều khiển &amp; <code>r_data</code> truy vấn) hoặc <code>flat_json</code> (<code>&#123;&quot;DO1&quot;: 1&#125;</code>), tùy chỉnh kiểu value chuỗi hay số.</li>
                    <li>• <strong>Theo dõi phản hồi ACK:</strong> Tự động nghe <code>pub_topic</code>; khi M100 trả <code>dir: &quot;up&quot;</code>, đối khớp <code>id</code> và hiện trạng thái <code>M100 OK (err: 0)</code> hoặc báo lỗi.</li>
                    <li>• <strong>Lưu ý chống lặp:</strong> Không gắn cùng 1 tag MQTT PUB làm cả <code>source_tag_id</code> lẫn <code>feedback_tag_id</code>.</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* TAB 8: SAO LƯU, KHÔI PHỤC & BẢO TRÌ */}
          {effectiveTab === 'backup_ops' && (
            <div className="space-y-6">
              <SectionHeader
                icon={HardDriveDownload}
                title="8. Sao lưu Dự án, Di chuyển Máy & Lịch Bảo trì"
                subtitle="Backup cấu hình một file duy nhất (.json), khôi phục an toàn và kế hoạch kiểm tra định kỳ."
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-300">
                <div className="bg-[#0F172A]/80 border border-slate-800 rounded-xl p-4 space-y-2">
                  <h3 className="font-heading text-sm font-bold text-emerald-300">Project Backup &amp; Restore (/system)</h3>
                  <ul className="space-y-1.5">
                    <li>• Bấm <strong>Tải Backup (.json)</strong> để xuất 1 file duy nhất chứa: <code className="text-slate-200">connections</code>, <code className="text-slate-200">tag_groups</code>, <code className="text-slate-200">tags</code> (kèm Scaling/Access/Log), <code className="text-slate-200">opcua_config</code>, <code className="text-slate-200">forward_config</code>, <code className="text-slate-200">logger_config</code>, <code className="text-slate-200">usr_m100_config</code>.</li>
                    <li>• <strong>Chế độ Replace (Thay thế):</strong> Xóa sạch cấu hình kênh/tag hiện có rồi nạp lại từ file Backup — dùng khi khôi phục thảm họa hoặc nhân bản máy Gateway mới.</li>
                    <li>• <strong>Chế độ Merge (Gộp thêm):</strong> Giữ nguyên các kênh/tag đang chạy và chỉ chèn thêm phần chưa tồn tại.</li>
                    <li>• Khi khôi phục, driver sẽ nạp lại ở tác vụ nền để không gây treo giao diện khi có PLC ngoại tuyến.</li>
                  </ul>
                </div>

                <div className="bg-[#0F172A]/80 border border-slate-800 rounded-xl p-4 space-y-2">
                  <h3 className="font-heading text-sm font-bold text-amber-300">Bảo trì &amp; Di chuyển bản Portable</h3>
                  <ul className="space-y-1.5">
                    <li>• <strong>Khi nâng cấp / chuyển máy thủ công:</strong> Sao lưu file <code className="text-emerald-300">gateway.db</code> cùng các file <code className="text-sky-300">opcua_config.json</code>, <code className="text-sky-300">forward_config.json</code>, <code className="text-sky-300">logger_config.json</code>, <code className="text-sky-300">usr_m100_config.json</code> nằm cạnh file thực thi, hoặc dùng file Backup JSON từ <code className="text-slate-200">/system</code>.</li>
                    <li>• <strong>Hằng tuần:</strong> Xuất 1 bản Project Backup lưu sang ổ đĩa ngoài / NAS và rà trang <strong>Logs</strong> lọc mức <code className="text-red-300">ERROR / WARNING</code>.</li>
                    <li>• <strong>Hằng tháng:</strong> Kiểm tra dung lượng <code className="text-slate-200">gateway.db</code> (điều chỉnh <code className="text-slate-200">retention_days</code> hoặc <code className="text-slate-200">deadband</code> trên Data Logger nếu ghi nhiều tag tần suất cao).</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* TAB 9: REST API, WEBSOCKET & XỬ LÝ SỰ CỐ */}
          {effectiveTab === 'api_troubleshoot' && (
            <div className="space-y-6">
              <SectionHeader
                icon={Code2}
                title="9. REST API, WebSocket & Xử lý Sự cố Thực tế"
                subtitle="Danh sách API tích hợp Web SCADA ngoài và 9 lỗi thường gặp khi triển khai hiện trường."
              />

              <div className="overflow-x-auto border border-slate-800 rounded-xl">
                <table className="w-full text-xs">
                  <thead className="bg-[#0F172A] border-b border-slate-800 text-slate-400">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-semibold">Method &amp; Path</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Chức năng</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 font-mono text-[11px] text-slate-300">
                    <tr>
                      <td className="px-4 py-2 text-emerald-300">GET /api/health · GET /api/docs</td>
                      <td className="px-4 py-2 font-sans">Kiểm tra sống dịch vụ · Mở tài liệu Swagger OpenAPI</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2 text-sky-300">GET/POST/PUT/DELETE /api/connections · POST /api/connections/&#123;id&#125;/reconnect</td>
                      <td className="px-4 py-2 font-sans">Quản lý kênh (trả thêm <code className="font-mono">demoted, tag_count, good_count, bad_count</code>)</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2 text-sky-300">GET/POST/PUT/DELETE /api/tags · POST /api/tags/&#123;id&#125;/write</td>
                      <td className="px-4 py-2 font-sans">Quản lý tag và ghi giá trị (tự reverse scaling; trả <code className="font-mono">HTTP 403</code> nếu tag đặt <code className="font-mono">ro</code>)</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2 text-sky-300">POST /api/tags/bulk-update · POST /api/tags/find-replace</td>
                      <td className="px-4 py-2 font-sans">Cập nhật hàng loạt &amp; Tìm/Thay thế (<code className="font-mono">dry_run</code> xem trước)</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2 text-sky-300">POST /api/tags/paste · POST /api/tags/groups/paste</td>
                      <td className="px-4 py-2 font-sans">Copy/Paste tag hoặc toàn bộ thư mục kèm tự tăng chỉ số khi trùng tên</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2 text-amber-300">GET/PUT /api/history/config · POST /api/history/sample-now · GET /api/history/query · DELETE /api/history/clear</td>
                      <td className="px-4 py-2 font-sans">Cấu hình Data Logger, ghi mẫu ngay, truy vấn biểu đồ lịch sử và xóa dữ liệu lịch sử</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2 text-amber-300">GET/PUT /api/forward/config · POST /api/forward/start|stop|test · GET/PUT /api/opcua/config</td>
                      <td className="px-4 py-2 font-sans">Điều khiển IoT Gateway Forwarder và OPC-UA Server</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2 text-emerald-300">GET/POST/PUT/DELETE /api/usr-m100/devices · .../buffer|publish|query · POST /api/usr-m100/publish-raw · GET /api/usr-m100/history</td>
                      <td className="px-4 py-2 font-sans">Quản lý trạm vùng đệm USR-M100, publish lệnh <code className="font-mono">rw_prot</code>/<code className="font-mono">flat_json</code> và theo dõi ACK</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2 text-violet-300">GET /api/system/backup · POST /api/system/restore · GET/POST /api/system/autostart</td>
                      <td className="px-4 py-2 font-sans">Sao lưu/Khôi phục JSON và bật tắt Windows Registry Auto-Start</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2 text-emerald-300">WS ws://&lt;host&gt;:8000/ws</td>
                      <td className="px-4 py-2 font-sans">Nhận stream giá trị tag realtime dạng push (JSON <code className="font-mono">&#123; tag_id, value, quality, timestamp &#125;</code>)</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="space-y-3">
                <h3 className="font-heading text-sm font-bold text-slate-100 flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-amber-400" /> Bảng Xử lý Sự cố Nhanh (Troubleshooting)
                </h3>
                <div className="overflow-x-auto border border-slate-800 rounded-xl">
                  <table className="w-full text-xs">
                    <thead className="bg-[#0F172A] border-b border-slate-800 text-slate-400">
                      <tr>
                        <th className="px-4 py-2.5 text-left font-semibold">Triệu chứng</th>
                        <th className="px-4 py-2.5 text-left font-semibold">Nguyên nhân phổ biến</th>
                        <th className="px-4 py-2.5 text-left font-semibold">Cách khắc phục</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80 text-slate-300">
                      <tr>
                        <td className="px-4 py-2.5 font-semibold text-amber-300">Siemens S7 kết nối lỗi hoặc đọc DB thất bại</td>
                        <td className="px-4 py-2.5">PLC chưa bật PUT/GET hoặc DB đang bật Optimized block access</td>
                        <td className="px-4 py-2.5">Vào TIA Portal bật PUT/GET, tắt Optimized block access, kiểm tra Rack=0 Slot=1 (S7-1200/1500) hoặc Slot=2 (S7-300) và mở cổng TCP 102.</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold text-amber-300">Modbus đọc sai số thực (ra số rất lớn hoặc rất nhỏ)</td>
                        <td className="px-4 py-2.5">Sai thứ tự Byte/Word giữa thiết bị và chuẩn Big-Endian</td>
                        <td className="px-4 py-2.5">Đổi <code className="font-mono text-sky-300">data_type</code> sang <code className="font-mono">float32_swap</code> (CDAB), <code className="font-mono">float32_be</code> (BADC) hoặc <code className="font-mono">float32_le</code> (DCBA).</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold text-amber-300">OPC-DA báo lỗi COM / Server execution failed</td>
                        <td className="px-4 py-2.5">OPC Server chạy dưới quyền System/Admin khác quyền user hoặc chưa cấu hình DCOM</td>
                        <td className="px-4 py-2.5">Chạy Gateway và OPC-DA Server cùng quyền Administrator trên cùng máy Windows, kiểm tra đúng ProgID trong sổ thả xuống.</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold text-amber-300">Kênh hiện badge Auto-Demoted</td>
                        <td className="px-4 py-2.5">Thiết bị ngoại tuyến liên tiếp; driver giãn chu kỳ thử lại (tối đa 60s)</td>
                        <td className="px-4 py-2.5">Kiểm tra dây mạng/nguồn PLC; sau khi có mạng lại có thể đợi tối đa 60s hoặc bấm nút <strong>Reconnect</strong> để nối ngay.</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold text-amber-300">Ghi giá trị báo lỗi HTTP 403 / khóa bút</td>
                        <td className="px-4 py-2.5">Tag đang bật chế độ chỉ đọc (<code className="font-mono">access = ro</code>) hoặc là tag SIM/Formula</td>
                        <td className="px-4 py-2.5">Sửa Tag chuyển sang <code className="font-mono text-emerald-300">rw</code> nếu thực sự cần điều khiển; tag SIM/Công thức luôn là chỉ đọc.</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold text-amber-300">SCADA từ máy khác không kết nối được OPC-UA Server</td>
                        <td className="px-4 py-2.5">Windows Firewall chặn cổng 4840/4841 hoặc cổng bị đổi do xung đột</td>
                        <td className="px-4 py-2.5">Xem chính xác Endpoint &amp; Port tại trang <code className="font-mono">/opcua-server</code> và mở Inbound Rule TCP 4840-4841 trên Firewall.</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold text-amber-300">Trang Lịch sử (/historian) chưa có điểm dữ liệu</td>
                        <td className="px-4 py-2.5">Logger đang tắt, tag chưa bật <code className="font-mono">log_enabled</code>, hoặc tag là kiểu chuỗi</td>
                        <td className="px-4 py-2.5">Bật Data Logger hoặc nhấn <strong>Ghi mẫu ngay</strong>; kiểm tra badge <strong>Log</strong> trên tag số (chỉ giá trị số/bool mới vẽ đồ thị).</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold text-amber-300">Trình duyệt không mở được http://localhost:8000</td>
                        <td className="px-4 py-2.5">Cổng 8000 đã có tiến trình khác dùng nên Gateway tự dời sang 8001..8019</td>
                        <td className="px-4 py-2.5">Mở console/log tìm dòng <code className="font-mono">Auto-switching Web UI to http://localhost:...</code> hoặc tắt tiến trình cũ đang giữ cổng 8000.</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold text-amber-300">USR-M100 đã Publish nhưng thiết bị không đóng/cắt hoặc không hiện ACK M100 OK</td>
                        <td className="px-4 py-2.5">Sai sub_topic (nhầm sang topic PUB), sai kiểu value chuỗi &quot;1&quot; vs số 1, hoặc tên biến name chưa khớp M100</td>
                        <td className="px-4 py-2.5">Kiểm tra đúng <em>Query/Control Topic</em> trên giao diện Web M100 (phải khác <code className="font-mono">pub_topic</code>), thử bật/tắt tùy chọn <strong>Kiểu value chuỗi</strong>, đối chiếu chính xác tên điểm (<code className="font-mono">DO1</code>, <code className="font-mono">CMD</code>...) và theo dõi cột trạng thái ACK tại <code className="font-mono">/usr-m100</code>.</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold text-amber-300">Đã gắn Tag vào trạm USR-M100 nhưng chưa thấy tự động gửi lệnh</td>
                        <td className="px-4 py-2.5">Auto-Sync giữ giá trị đầu tiên làm baseline để tránh gửi tràn lệnh khi mới gắn/khởi động</td>
                        <td className="px-4 py-2.5">Auto-Sync chỉ gửi khi giá trị Tag nguồn thay đổi vượt ngưỡng <code className="font-mono">deadband</code> (cần <code className="font-mono">Quality = Good</code>, nút <strong>Auto-Sync ON</strong> và MQTT Online). Muốn đẩy ngay giá trị hiện tại lần đầu, bỏ chọn tạm <strong>Chỉ gửi điểm có thay đổi</strong> rồi nhấn <strong>Publish Lô</strong>.</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
