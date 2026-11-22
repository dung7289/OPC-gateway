import React, { useState } from 'react';
import { X, SlidersHorizontal } from 'lucide-react';
import toast from 'react-hot-toast';
import { bulkUpdateTags } from '../api/tags';

const DATA_TYPES = [
  { value: 'bool', label: 'Boolean' },
  { value: 'int16', label: 'Int16' },
  { value: 'uint16', label: 'UInt16' },
  { value: 'int32', label: 'Int32' },
  { value: 'int32_swap', label: 'Int32 (CDAB Swap)' },
  { value: 'float32', label: 'Float32' },
  { value: 'float32_swap', label: 'Float32 (CDAB Swap)' },
  { value: 'float32_be', label: 'Float32 (BADC Byte Swap)' },
  { value: 'float32_le', label: 'Float32 (DCBA)' },
  { value: 'string', label: 'String' },
];

export default function BulkEditModal({ tagIds = [], existingGroups = [], onClose, onSuccess }) {
  const [applyScanRate, setApplyScanRate] = useState(false);
  const [scanRate, setScanRate] = useState('100');

  const [applyDataType, setApplyDataType] = useState(false);
  const [dataType, setDataType] = useState('float32');

  const [applyGroup, setApplyGroup] = useState(false);
  const [tagGroup, setTagGroup] = useState('');

  const [applyAccess, setApplyAccess] = useState(false);
  const [access, setAccess] = useState('rw');

  const [applyUnit, setApplyUnit] = useState(false);
  const [unit, setUnit] = useState('');

  const [applyLog, setApplyLog] = useState(false);
  const [logEnabled, setLogEnabled] = useState(true);

  const [applyEnabled, setApplyEnabled] = useState(false);
  const [enabled, setEnabled] = useState(true);

  const [applyScale, setApplyScale] = useState(false);
  const [scaleType, setScaleType] = useState('linear');
  const [rawMin, setRawMin] = useState('0');
  const [rawMax, setRawMax] = useState('27648');
  const [engMin, setEngMin] = useState('0');
  const [engMax, setEngMax] = useState('100');
  const [scaleFactor, setScaleFactor] = useState('1');
  const [scaleOffset, setScaleOffset] = useState('0');
  const [scaleClamp, setScaleClamp] = useState(false);

  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = { tag_ids: tagIds };
    if (applyScanRate) payload.scan_rate_ms = parseInt(scanRate, 10) || 100;
    if (applyDataType) payload.data_type = dataType;
    if (applyGroup) payload.tag_group = tagGroup.trim();
    if (applyAccess) payload.access = access;
    if (applyUnit) payload.unit = unit.trim();
    if (applyLog) payload.log_enabled = logEnabled;
    if (applyEnabled) payload.enabled = enabled;
    if (applyScale) {
      payload.scale_type = scaleType;
      if (scaleType === 'linear') {
        payload.raw_min = parseFloat(rawMin) || 0;
        payload.raw_max = Number.isFinite(parseFloat(rawMax)) ? parseFloat(rawMax) : 100;
        payload.eng_min = parseFloat(engMin) || 0;
        payload.eng_max = Number.isFinite(parseFloat(engMax)) ? parseFloat(engMax) : 100;
        payload.scale_clamp = scaleClamp;
      } else if (scaleType === 'factor') {
        payload.scale_factor = Number.isFinite(parseFloat(scaleFactor)) ? parseFloat(scaleFactor) : 1;
        payload.scale_offset = parseFloat(scaleOffset) || 0;
      }
    }

    if (Object.keys(payload).length <= 1) {
      toast.error('Hãy tích chọn ít nhất 1 thuộc tính cần sửa hàng loạt');
      return;
    }

    setSaving(true);
    try {
      const res = await bulkUpdateTags(payload);
      toast.success(res.message || `Đã cập nhật ${res.updated_count} tag`);
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || err.message || 'Cập nhật hàng loạt thất bại');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/65 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="glass-panel rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-slate-700">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800">
          <h3 className="font-heading font-bold text-slate-100 text-sm flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-emerald-400" />
            Sửa Hàng Loạt ({tagIds.length} tag đã chọn)
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3 text-xs">
          <p className="text-[11px] text-slate-400">
            Tích vào ô đầu dòng của những thuộc tính muốn áp dụng đồng loạt cho {tagIds.length} tag:
          </p>

          {/* Scan Rate */}
          <div className="flex items-center gap-3 p-2.5 rounded-lg bg-[#0F172A]/70 border border-slate-800">
            <label className="flex items-center gap-2 w-36 shrink-0 cursor-pointer font-semibold text-slate-200">
              <input type="checkbox" checked={applyScanRate} onChange={(e) => setApplyScanRate(e.target.checked)} className="accent-emerald-500 cursor-pointer" />
              Scan Rate (ms)
            </label>
            <input
              type="number"
              min="50"
              step="50"
              disabled={!applyScanRate}
              value={scanRate}
              onChange={(e) => setScanRate(e.target.value)}
              className="flex-1 rounded-lg px-2.5 py-1.5 border font-mono disabled:opacity-40"
            />
          </div>

          {/* Data Type */}
          <div className="flex items-center gap-3 p-2.5 rounded-lg bg-[#0F172A]/70 border border-slate-800">
            <label className="flex items-center gap-2 w-36 shrink-0 cursor-pointer font-semibold text-slate-200">
              <input type="checkbox" checked={applyDataType} onChange={(e) => setApplyDataType(e.target.checked)} className="accent-emerald-500 cursor-pointer" />
              Kiểu dữ liệu
            </label>
            <select
              disabled={!applyDataType}
              value={dataType}
              onChange={(e) => setDataType(e.target.value)}
              className="flex-1 rounded-lg px-2.5 py-1.5 border disabled:opacity-40 cursor-pointer"
            >
              {DATA_TYPES.map((dt) => (
                <option key={dt.value} value={dt.value}>{dt.label}</option>
              ))}
            </select>
          </div>

          {/* Tag Group */}
          <div className="flex items-center gap-3 p-2.5 rounded-lg bg-[#0F172A]/70 border border-slate-800">
            <label className="flex items-center gap-2 w-36 shrink-0 cursor-pointer font-semibold text-slate-200">
              <input type="checkbox" checked={applyGroup} onChange={(e) => setApplyGroup(e.target.checked)} className="accent-emerald-500 cursor-pointer" />
              Chuyển thư mục
            </label>
            <input
              type="text"
              list="bulk-group-options"
              disabled={!applyGroup}
              value={tagGroup}
              onChange={(e) => setTagGroup(e.target.value)}
              placeholder="TRAM1/BOM1 (để trống = cấp kênh)"
              className="flex-1 rounded-lg px-2.5 py-1.5 border disabled:opacity-40"
            />
            <datalist id="bulk-group-options">
              {existingGroups.map((g) => <option key={g} value={g} />)}
            </datalist>
          </div>

          {/* Access */}
          <div className="flex items-center gap-3 p-2.5 rounded-lg bg-[#0F172A]/70 border border-slate-800">
            <label className="flex items-center gap-2 w-36 shrink-0 cursor-pointer font-semibold text-slate-200">
              <input type="checkbox" checked={applyAccess} onChange={(e) => setApplyAccess(e.target.checked)} className="accent-emerald-500 cursor-pointer" />
              Quyền truy cập
            </label>
            <select
              disabled={!applyAccess}
              value={access}
              onChange={(e) => setAccess(e.target.value)}
              className="flex-1 rounded-lg px-2.5 py-1.5 border disabled:opacity-40 cursor-pointer"
            >
              <option value="rw">Read / Write (Đọc &amp; Ghi)</option>
              <option value="ro">Read Only (Chỉ đọc)</option>
            </select>
          </div>

          {/* Unit */}
          <div className="flex items-center gap-3 p-2.5 rounded-lg bg-[#0F172A]/70 border border-slate-800">
            <label className="flex items-center gap-2 w-36 shrink-0 cursor-pointer font-semibold text-slate-200">
              <input type="checkbox" checked={applyUnit} onChange={(e) => setApplyUnit(e.target.checked)} className="accent-emerald-500 cursor-pointer" />
              Đơn vị đo (Unit)
            </label>
            <input
              type="text"
              disabled={!applyUnit}
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="vd: bar, m³/h, Hz"
              className="flex-1 rounded-lg px-2.5 py-1.5 border disabled:opacity-40"
            />
          </div>

          {/* Data Logger & Enabled */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#0F172A]/70 border border-slate-800">
              <label className="flex items-center gap-2 cursor-pointer font-semibold text-slate-200">
                <input type="checkbox" checked={applyLog} onChange={(e) => setApplyLog(e.target.checked)} className="accent-emerald-500 cursor-pointer" />
                Ghi lịch sử
              </label>
              <select
                disabled={!applyLog}
                value={logEnabled ? '1' : '0'}
                onChange={(e) => setLogEnabled(e.target.value === '1')}
                className="rounded px-2 py-1 border disabled:opacity-40 cursor-pointer"
              >
                <option value="1">Bật</option>
                <option value="0">Tắt</option>
              </select>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#0F172A]/70 border border-slate-800">
              <label className="flex items-center gap-2 cursor-pointer font-semibold text-slate-200">
                <input type="checkbox" checked={applyEnabled} onChange={(e) => setApplyEnabled(e.target.checked)} className="accent-emerald-500 cursor-pointer" />
                Trạng thái Tag
              </label>
              <select
                disabled={!applyEnabled}
                value={enabled ? '1' : '0'}
                onChange={(e) => setEnabled(e.target.value === '1')}
                className="rounded px-2 py-1 border disabled:opacity-40 cursor-pointer"
              >
                <option value="1">Enable</option>
                <option value="0">Disable</option>
              </select>
            </div>
          </div>

          {/* Scaling */}
          <div className="p-2.5 rounded-lg bg-[#0F172A]/70 border border-slate-800 space-y-2">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 w-36 shrink-0 cursor-pointer font-semibold text-slate-200">
                <input type="checkbox" checked={applyScale} onChange={(e) => setApplyScale(e.target.checked)} className="accent-emerald-500 cursor-pointer" />
                Scaling
              </label>
              <select
                disabled={!applyScale}
                value={scaleType}
                onChange={(e) => setScaleType(e.target.value)}
                className="flex-1 rounded-lg px-2.5 py-1.5 border disabled:opacity-40 cursor-pointer"
              >
                <option value="none">Không quy đổi</option>
                <option value="linear">Tuyến tính (Raw → Eng)</option>
                <option value="factor">Hệ số (a × Raw + b)</option>
              </select>
            </div>

            {applyScale && scaleType === 'linear' && (
              <div className="space-y-2 pt-1">
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <span className="text-[10px] text-slate-400">Raw Min</span>
                    <input type="number" step="any" value={rawMin} onChange={(e) => setRawMin(e.target.value)} className="w-full rounded px-2 py-1 border font-mono" />
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400">Raw Max</span>
                    <input type="number" step="any" value={rawMax} onChange={(e) => setRawMax(e.target.value)} className="w-full rounded px-2 py-1 border font-mono" />
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400">Eng Min</span>
                    <input type="number" step="any" value={engMin} onChange={(e) => setEngMin(e.target.value)} className="w-full rounded px-2 py-1 border font-mono" />
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400">Eng Max</span>
                    <input type="number" step="any" value={engMax} onChange={(e) => setEngMax(e.target.value)} className="w-full rounded px-2 py-1 border font-mono" />
                  </div>
                </div>
                <label className="inline-flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={scaleClamp} onChange={(e) => setScaleClamp(e.target.checked)} className="accent-emerald-500 cursor-pointer" />
                  Clamp trong [Eng Min, Eng Max]
                </label>
              </div>
            )}

            {applyScale && scaleType === 'factor' && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div>
                  <span className="text-[10px] text-slate-400">Hệ số nhân (a)</span>
                  <input type="number" step="any" value={scaleFactor} onChange={(e) => setScaleFactor(e.target.value)} className="w-full rounded px-2 py-1 border font-mono" />
                </div>
                <div>
                  <span className="text-[10px] text-slate-400">Độ lệch cộng (b)</span>
                  <input type="number" step="any" value={scaleOffset} onChange={(e) => setScaleOffset(e.target.value)} className="w-full rounded px-2 py-1 border font-mono" />
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 font-bold text-[#0F172A] bg-emerald-500 hover:bg-emerald-400 rounded-lg cursor-pointer disabled:opacity-50"
            >
              {saving ? 'Đang áp dụng...' : 'Áp Dụng Hàng Loạt'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
