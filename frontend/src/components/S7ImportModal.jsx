import React, { useState, useMemo, useRef } from 'react';
import {
  Cpu,
  X,
  Upload,
  FileCode2,
  ClipboardPaste,
  AlertTriangle,
  CheckSquare,
  Square,
  Search,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { parseS7File, parseS7Text, importTagsBatch } from '../api/tags';

const SAMPLE_TIA_DB = `DATA_BLOCK "DB_TramBom"
{ S7_Optimized_Access := 'FALSE' }
VERSION : 0.1
NON_RETAIN
   VAR
      AutoMode : Bool;   // Che do tu dong
      StartCmd : Bool;   // Lenh khoi dong
      StatusCode : Byte;   // Ma trang thai
      PressureSP : Real := 4.5;   // Ap suat dat (bar)
      Bom1 : Struct
         Run : Bool;
         Fault : Bool;
         FrequencyHz : Real;   // Tan so bien tan
      END_STRUCT;
      TempC : Array[1..2] of Real;   // Nhiet do cam bien
      StationName : String[20] := 'Tram-01';
   END_VAR
BEGIN
END_DATA_BLOCK`;

const FORMAT_LABELS = {
  tia_db_source: 'TIA Source (.db/.scl/.udt)',
  tia_xml_db: 'TIA Openness XML (GlobalDB)',
  tia_xml_tags: 'TIA Openness XML (PLC Tags)',
  tia_xlsx_tags: 'TIA Excel (.xlsx)',
  tia_db_paste: 'TIA DB Editor (Copy-Paste Offset)',
  step7_sdf: 'STEP 7 Symbols (.sdf)',
};

export default function S7ImportModal({
  connections = [],
  defaultConnId = null,
  defaultGroup = '',
  onClose,
  onSuccess,
}) {
  const initialConn =
    connections.find((c) => c.id === defaultConnId) ||
    connections.find((c) => c.protocol === 's7') ||
    connections[0];

  const [connectionId, setConnectionId] = useState(initialConn?.id ? String(initialConn.id) : '');
  const [dbNumber, setDbNumber] = useState('1');
  const [defaultGroupInput, setDefaultGroupInput] = useState(defaultGroup || '');
  const [scanRateMs, setScanRateMs] = useState('100');
  const [inputMode, setInputMode] = useState('file'); // 'file' | 'paste'

  const [selectedFile, setSelectedFile] = useState(null);
  const [pasteText, setPasteText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);

  const [parseResult, setParseResult] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [selectedIndices, setSelectedIndices] = useState(() => new Set());
  const [filterText, setFilterText] = useState('');
  const fileInputRef = useRef(null);

  const currentConn = connections.find((c) => String(c.id) === String(connectionId));
  const isS7Conn = currentConn?.protocol === 's7';

  const applyParseResult = (res) => {
    setParseResult(res);
    const list = (res.candidates || []).map((c) => ({ ...c }));
    setCandidates(list);
    setSelectedIndices(new Set(list.map((_, i) => i)));
    if (res.db_number && !selectedFile) {
      setDbNumber(String(res.db_number));
    }
    if (list.length > 0) {
      toast.success(res.message || `Đã trích xuất ${list.length} tag S7`);
    } else {
      toast.error('Không tìm thấy tag hợp lệ trong dữ liệu đã chọn');
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    await runParseFile(file);
  };

  const runParseFile = async (fileObj) => {
    const targetFile = fileObj || selectedFile;
    if (!targetFile) {
      toast.error('Vui lòng chọn file TIA Portal trước');
      return;
    }
    setParsing(true);
    try {
      const parsedDb = parseInt(dbNumber, 10);
      const res = await parseS7File(targetFile, {
        db_number: Number.isFinite(parsedDb) && parsedDb > 0 ? parsedDb : undefined,
        default_group: defaultGroupInput.trim(),
        scan_rate_ms: parseInt(scanRateMs, 10) || 100,
      });
      applyParseResult(res);
    } catch (err) {
      toast.error(err.response?.data?.detail || err.message || 'Lỗi đọc file S7');
    } finally {
      setParsing(false);
    }
  };

  const handleParseText = async () => {
    if (!pasteText.trim()) {
      toast.error('Vui lòng dán bảng DB hoặc mã Source TIA Portal');
      return;
    }
    setParsing(true);
    try {
      const parsedDb = parseInt(dbNumber, 10);
      const res = await parseS7Text({
        text: pasteText,
        db_number: Number.isFinite(parsedDb) && parsedDb > 0 ? parsedDb : undefined,
        default_group: defaultGroupInput.trim(),
        scan_rate_ms: parseInt(scanRateMs, 10) || 100,
      });
      applyParseResult(res);
    } catch (err) {
      toast.error(err.response?.data?.detail || err.message || 'Không thể phân tích dữ liệu S7');
    } finally {
      setParsing(false);
    }
  };

  const filteredIndexed = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return candidates
      .map((c, idx) => ({ c, idx }))
      .filter(({ c }) => {
        if (!q) return true;
        return (
          (c.name || '').toLowerCase().includes(q) ||
          (c.address || '').toLowerCase().includes(q) ||
          (c.tag_group || '').toLowerCase().includes(q) ||
          (c.description || '').toLowerCase().includes(q)
        );
      });
  }, [candidates, filterText]);

  const toggleIndex = (idx) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    const visibleIds = filteredIndexed.map((x) => x.idx);
    const allChecked = visibleIds.length > 0 && visibleIds.every((i) => selectedIndices.has(i));
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (allChecked) {
        visibleIds.forEach((i) => next.delete(i));
      } else {
        visibleIds.forEach((i) => next.add(i));
      }
      return next;
    });
  };

  const updateCandidateField = (idx, field, val) => {
    setCandidates((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, [field]: val } : item))
    );
  };

  const handleImport = async () => {
    const connInt = parseInt(connectionId, 10);
    if (!connInt) {
      toast.error('Vui lòng chọn kênh kết nối S7 đích');
      return;
    }
    const chosen = candidates
      .filter((_, idx) => selectedIndices.has(idx))
      .map((c) => ({
        connection_id: connInt,
        name: (c.name || '').trim(),
        address: (c.address || '').trim(),
        data_type: c.data_type || 'float32',
        tag_group: (c.tag_group || '').trim(),
        scan_rate_ms: parseInt(c.scan_rate_ms, 10) || parseInt(scanRateMs, 10) || 100,
        description: c.description || '',
        access: 'rw',
        enabled: true,
      }))
      .filter((t) => t.name && t.address);

    if (chosen.length === 0) {
      toast.error('Chưa chọn tag nào để Import');
      return;
    }

    setImporting(true);
    try {
      const res = await importTagsBatch(chosen);
      toast.success(res.message || `Đã import ${res.count} tag S7 thành công`);
      onSuccess?.(connInt, chosen[0]?.tag_group || '');
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || err.message || 'Import tag S7 thất bại');
    } finally {
      setImporting(false);
    }
  };

  const allVisibleSelected =
    filteredIndexed.length > 0 && filteredIndexed.every((x) => selectedIndices.has(x.idx));

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="glass-panel rounded-2xl border border-slate-700 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl text-xs">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800">
          <div>
            <h3 className="font-heading font-bold text-slate-100 text-sm flex items-center gap-2">
              <Cpu className="w-4 h-4 text-amber-400" />
              Import Tag từ file lập trình Siemens TIA Portal (S7)
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Hỗ trợ file Source DB/UDT (<code className="text-sky-300">.db / .scl / .awl / .udt</code>), PLC Tags (<code className="text-sky-300">.xlsx / .xml</code>), STEP 7 (<code className="text-sky-300">.sdf</code>) hoặc dán bảng Offset trực tiếp từ TIA Portal
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Config Bar */}
        <div className="p-4 border-b border-slate-800 bg-[#0F172A]/60 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Kênh Siemens S7 đích *
              </label>
              <select
                value={connectionId}
                onChange={(e) => setConnectionId(e.target.value)}
                className="w-full bg-[#0F172A] border border-slate-700 rounded-lg px-2.5 py-2 text-slate-100"
              >
                <option value="">-- Chọn kết nối S7 --</option>
                {connections.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name} ({c.protocol})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Số DB (dùng cho .db / Paste DB)
              </label>
              <input
                type="number"
                min={1}
                max={65535}
                value={dbNumber}
                onChange={(e) => setDbNumber(e.target.value)}
                placeholder="VD: 1"
                className="w-full bg-[#0F172A] border border-slate-700 rounded-lg px-2.5 py-2 font-mono text-slate-100"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Thư mục gốc (để trống = tên DB)
              </label>
              <input
                type="text"
                value={defaultGroupInput}
                onChange={(e) => setDefaultGroupInput(e.target.value)}
                placeholder="VD: TRAM_BOM"
                className="w-full bg-[#0F172A] border border-slate-700 rounded-lg px-2.5 py-2 text-slate-100"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Scan Rate mặc định (ms)
              </label>
              <input
                type="number"
                min={50}
                max={60000}
                value={scanRateMs}
                onChange={(e) => setScanRateMs(e.target.value)}
                className="w-full bg-[#0F172A] border border-slate-700 rounded-lg px-2.5 py-2 font-mono text-slate-100"
              />
            </div>
          </div>

          {currentConn && !isS7Conn && (
            <div className="bg-amber-500/10 border border-amber-500/35 rounded-lg px-3 py-2 text-[11px] text-amber-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                Kênh đang chọn có giao thức <strong>{currentConn.protocol}</strong> (khuyến nghị chọn kênh <code>s7</code>).
              </span>
            </div>
          )}

          {/* Input Mode Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="inline-flex rounded-lg border border-slate-700 bg-[#0F172A] p-0.5">
              <button
                type="button"
                onClick={() => setInputMode('file')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-semibold transition-colors cursor-pointer ${
                  inputMode === 'file' ? 'bg-amber-500/20 text-amber-300' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Upload className="w-3.5 h-3.5" />
                Tải file từ TIA Portal
              </button>
              <button
                type="button"
                onClick={() => setInputMode('paste')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-semibold transition-colors cursor-pointer ${
                  inputMode === 'paste' ? 'bg-amber-500/20 text-amber-300' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <ClipboardPaste className="w-3.5 h-3.5" />
                Dán bảng DB / Source trực tiếp
              </button>
            </div>

            {parseResult && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono text-[11px]">
                <FileCode2 className="w-3.5 h-3.5" />
                {FORMAT_LABELS[parseResult.detected_format] || parseResult.detected_format} • {candidates.length} tag
              </span>
            )}
          </div>

          {/* Mode Body */}
          {inputMode === 'file' ? (
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 items-center bg-[#0B1120]/70 border border-slate-800 rounded-xl p-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".db,.scl,.awl,.udt,.xml,.xlsx,.sdf,.csv,.txt"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={parsing}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-[#0F172A] font-bold cursor-pointer disabled:opacity-50"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    {parsing ? 'Đang phân tích...' : 'Chọn file TIA Portal (.db, .xlsx, .xml...)'}
                  </button>
                  {selectedFile && (
                    <>
                      <span className="font-mono text-slate-200">{selectedFile.name}</span>
                      <button
                        type="button"
                        onClick={() => runParseFile(selectedFile)}
                        disabled={parsing}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer"
                        title="Phân tích lại với Số DB / Thư mục mới"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Phân tích lại
                      </button>
                    </>
                  )}
                </div>
                <p className="text-[11px] text-slate-400">
                  <strong>Mẹo xuất từ TIA Portal:</strong> Với Data Block, chuột phải DB &rarr; <em>Generate source from blocks</em> (<code>.db</code>); hoặc vào <em>PLC tags &rarr; Export</em> (<code>.xlsx</code> / <code>.xml</code>). Nhớ bỏ tích <em>Optimized block access</em> trên S7-1200/1500.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2 bg-[#0B1120]/70 border border-slate-800 rounded-xl p-3">
              <textarea
                rows={5}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Dán các dòng bảng DB từ TIA Portal (Name [Tab] Data type [Tab] Offset [Tab] ... Comment) hoặc dán nội dung file .db / .udt vào đây..."
                className="w-full bg-[#0F172A] border border-slate-700 rounded-lg p-2.5 font-mono text-[11px] text-slate-100 focus:outline-none focus:border-amber-500"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setPasteText(SAMPLE_TIA_DB)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Nạp mẫu TIA Portal DB
                </button>
                <button
                  type="button"
                  onClick={handleParseText}
                  disabled={parsing || !pasteText.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-[#0F172A] font-bold cursor-pointer disabled:opacity-40"
                >
                  <FileCode2 className="w-3.5 h-3.5" />
                  {parsing ? 'Đang phân tích...' : 'Phân tích & Trích xuất Tag'}
                </button>
              </div>
            </div>
          )}

          {/* Warnings */}
          {parseResult?.warnings?.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-3 space-y-1 text-[11px] text-amber-200">
              {parseResult.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Candidate Preview Filter Bar */}
        {candidates.length > 0 && (
          <div className="px-4 py-2.5 border-b border-slate-800 bg-[#0F172A]/40 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={toggleSelectAllVisible}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer"
            >
              {allVisibleSelected ? (
                <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Square className="w-3.5 h-3.5 text-slate-400" />
              )}
              {allVisibleSelected ? 'Bỏ chọn tất cả đang lọc' : 'Chọn tất cả đang lọc'}
            </button>

            <div className="relative min-w-[240px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Lọc theo tên tag, địa chỉ, thư mục..."
                className="w-full bg-[#0F172A] border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-slate-100"
              />
            </div>
          </div>
        )}

        {/* Candidate Table */}
        <div className="flex-1 overflow-auto min-h-[200px]">
          {candidates.length === 0 ? (
            <div className="p-10 text-center text-slate-400 space-y-1.5">
              <FileCode2 className="w-9 h-9 mx-auto opacity-30" />
              <p className="text-sm font-medium text-slate-300">Chưa có danh sách Tag phân tích</p>
              <p className="text-[11px] text-slate-500">
                Chọn file xuất từ TIA Portal hoặc chuyển sang tab Dán bảng DB / Source để xem trước các địa chỉ S7 tự động tính toán.
              </p>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-[#0F172A] border-b border-slate-800 text-slate-400 sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 w-10 text-center">Chọn</th>
                  <th className="px-3 py-2 text-left font-semibold min-w-[140px]">Thư mục (Group)</th>
                  <th className="px-3 py-2 text-left font-semibold min-w-[140px]">Tên Tag</th>
                  <th className="px-3 py-2 text-left font-semibold">Địa chỉ S7</th>
                  <th className="px-3 py-2 text-left font-semibold">Kiểu TIA &rarr; GW</th>
                  <th className="px-3 py-2 text-left font-semibold">Offset</th>
                  <th className="px-3 py-2 text-left font-semibold">Mô tả</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {filteredIndexed.map(({ c, idx }) => {
                  const checked = selectedIndices.has(idx);
                  return (
                    <tr
                      key={`${c.address}-${idx}`}
                      className={checked ? 'bg-emerald-500/5 hover:bg-emerald-500/10' : 'opacity-60 hover:bg-slate-800/40'}
                    >
                      <td className="px-3 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleIndex(idx)}
                          className="accent-emerald-500 rounded cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          value={c.tag_group}
                          onChange={(e) => updateCandidateField(idx, 'tag_group', e.target.value)}
                          className="w-full bg-[#0F172A]/80 border border-slate-800 rounded px-2 py-1 font-mono text-[11px] text-amber-300"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          value={c.name}
                          onChange={(e) => updateCandidateField(idx, 'name', e.target.value)}
                          className="w-full bg-[#0F172A]/80 border border-slate-800 rounded px-2 py-1 font-semibold text-slate-100"
                        />
                      </td>
                      <td className="px-3 py-1.5 font-mono font-bold text-emerald-400 whitespace-nowrap">
                        {c.address}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-[11px] whitespace-nowrap">
                        <span className="text-slate-400">{c.tia_type || '—'}</span>
                        <span className="text-slate-600 mx-1">&rarr;</span>
                        <span className="text-sky-300">{c.data_type}</span>
                      </td>
                      <td className="px-3 py-1.5 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                        {c.offset_str || '—'}
                      </td>
                      <td className="px-3 py-1.5 text-slate-400 max-w-[180px] truncate" title={c.description}>
                        {c.description || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-[#0B1120]/85 flex flex-wrap items-center justify-between gap-3">
          <span className="text-slate-300 font-mono">
            Đã chọn <strong className="text-emerald-400">{selectedIndices.size}</strong> / {candidates.length} tag
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={importing || selectedIndices.size === 0 || !connectionId}
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-[#0F172A] font-bold rounded-lg cursor-pointer disabled:opacity-40"
            >
              {importing ? 'Đang Import...' : `Import ${selectedIndices.size} Tag vào Gateway`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
