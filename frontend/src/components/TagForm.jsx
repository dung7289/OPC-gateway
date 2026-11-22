import React, { useState } from 'react';
import { X } from 'lucide-react';
import { createTag, updateTag } from '../api/tags';
import toast from 'react-hot-toast';

const DATA_TYPES = [
  { value: 'bool',         label: 'Boolean' },
  { value: 'int16',        label: 'Int16  (16-bit signed)' },
  { value: 'uint16',       label: 'UInt16 (16-bit unsigned)' },
  { value: 'int32',        label: 'Int32  (ABCD - Big Endian)' },
  { value: 'int32_swap',   label: 'Int32  (CDAB - Word Swap)' },
  { value: 'float32',      label: 'Float32 (ABCD - Big Endian)' },
  { value: 'float32_swap', label: 'Float32 (CDAB - Word Swap) ★' },
  { value: 'float32_be',   label: 'Float32 (BADC - Byte Swap)' },
  { value: 'float32_le',   label: 'Float32 (DCBA - Little Endian)' },
  { value: 'string',       label: 'String' },
];

const ADDRESS_HINTS = {
  modbus_tcp: 'Ví dụ: HR:0 (Holding Reg), CO:0 (Coil), IR:0 (Input Reg), DI:0 (Discrete Input)',
  modbus_rtu: 'Ví dụ: HR:0 (Holding Reg), CO:0 (Coil), IR:0 (Input Reg), DI:0 (Discrete Input)',
  s7: 'Ví dụ: DB1.DBW0, DB1.DBD4, M0.0, I0.0, Q0.0',
  mqtt: 'Ví dụ: ten_topic:DI1 hoặc ten_topic.AP1 (để bóc trường trong JSON)',
  opcua: 'Ví dụ: ns=2;i=1001 hoặc ns=2;s=Device1.Tag1',
  opc_da: 'Ví dụ: Channel1.Device1.TagName hoặc _System._Time_Second',
  internal: 'Memory: MEM:SETPOINT=3.5 | Simulator: SIM:SINE(0,100,20), SIM:RANDOM(10,50), SIM:TOGGLE(5) | Công thức: =FLOW_1 + FLOW_2 hoặc =(AP1+AP2)/2',
};

function FieldRow({ label, hint, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-gray-700">{label}</label>
      {children}
      {hint && <p className="text-xs text-blue-600 bg-blue-50 p-1.5 rounded">{hint}</p>}
    </div>
  );
}

function Input({ ...props }) {
  return (
    <input
      className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-full"
      {...props}
    />
  );
}

function Select({ children, ...props }) {
  return (
    <select
      className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-full bg-white"
      {...props}
    >
      {children}
    </select>
  );
}

export default function TagForm({ tag, connections = [], defaultConnectionId, defaultGroup, existingGroups = [], onSuccess, onClose }) {
  const isEdit = !!tag;

  const [form, setForm] = useState(() => {
    const base = {
      name: '',
      connection_id: defaultConnectionId || connections[0]?.id || '',
      tag_group: defaultGroup || (existingGroups && existingGroups[0] ? existingGroups[0] : ''),
      address: '',
      data_type: 'float32',
      scan_rate_ms: '100',
      description: '',
      access: 'rw',
      unit: '',
      log_enabled: false,
      scale_type: 'none',
      raw_min: '0',
      raw_max: '27648',
      eng_min: '0',
      eng_max: '100',
      scale_factor: '1',
      scale_offset: '0',
      scale_clamp: false,
    };
    if (!tag) return base;
    return {
      ...base,
      ...tag,
      connection_id: tag.connection_id || connections[0]?.id || '',
      tag_group: tag.tag_group || '',
      scan_rate_ms: String(tag.scan_rate_ms || '100'),
      access: tag.access || 'rw',
      unit: tag.unit || '',
      log_enabled: !!tag.log_enabled,
      scale_type: tag.scale_type || 'none',
      raw_min: String(tag.raw_min ?? 0),
      raw_max: String(tag.raw_max ?? 27648),
      eng_min: String(tag.eng_min ?? 0),
      eng_max: String(tag.eng_max ?? 100),
      scale_factor: String(tag.scale_factor ?? 1),
      scale_offset: String(tag.scale_offset ?? 0),
      scale_clamp: !!tag.scale_clamp,
    };
  });
  const [loading, setLoading] = useState(false);

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const selectedConn = connections.find((c) => String(c.id) === String(form.connection_id));
  const addressHint = selectedConn ? (ADDRESS_HINTS[selectedConn.protocol] || '') : '';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = {
        name: form.name.trim(),
        connection_id: parseInt(form.connection_id, 10),
        tag_group: (form.tag_group || '').trim(),
        address: form.address.trim(),
        data_type: form.data_type,
        scan_rate_ms: parseInt(form.scan_rate_ms, 10) || 100,
        description: form.description || '',
        enabled: true,
        access: form.access || 'rw',
        unit: (form.unit || '').trim(),
        log_enabled: !!form.log_enabled,
        scale_type: form.scale_type || 'none',
        raw_min: Number.isFinite(parseFloat(form.raw_min)) ? parseFloat(form.raw_min) : 0,
        raw_max: Number.isFinite(parseFloat(form.raw_max)) ? parseFloat(form.raw_max) : 100,
        eng_min: Number.isFinite(parseFloat(form.eng_min)) ? parseFloat(form.eng_min) : 0,
        eng_max: Number.isFinite(parseFloat(form.eng_max)) ? parseFloat(form.eng_max) : 100,
        scale_factor: Number.isFinite(parseFloat(form.scale_factor)) ? parseFloat(form.scale_factor) : 1,
        scale_offset: Number.isFinite(parseFloat(form.scale_offset)) ? parseFloat(form.scale_offset) : 0,
        scale_clamp: !!form.scale_clamp,
      };
      if (isEdit) {
        await updateTag(tag.id, payload);
        toast.success('Tag updated successfully');
      } else {
        await createTag(payload);
        toast.success('Tag created successfully');
      }
      onSuccess?.();
    } catch (err) {
      const msg = err.response?.data?.detail 
        ? (typeof err.response.data.detail === 'string' ? err.response.data.detail : JSON.stringify(err.response.data.detail))
        : err.message || 'Operation failed';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {isEdit ? 'Edit Tag' : 'Add New Tag'}
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <FieldRow label="Tag Name *">
            <Input
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Temperature_Zone1"
            />
          </FieldRow>

          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="Connection *">
              <Select
                required
                value={form.connection_id}
                onChange={(e) => set('connection_id', e.target.value)}
              >
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.protocol.toUpperCase()})
                  </option>
                ))}
              </Select>
            </FieldRow>

            <FieldRow label="Tag Group (Thư mục / Nhóm)">
              <div className="relative">
                <input
                  list="group-options"
                  value={form.tag_group}
                  onChange={(e) => set('tag_group', e.target.value)}
                  placeholder="TRAM1, BOM1, Khu_A/May_1..."
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-full"
                />
                <datalist id="group-options">
                  {existingGroups.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              </div>
            </FieldRow>
          </div>

          <FieldRow label="Address *" hint={addressHint}>
            <Input
              required
              value={form.address}
              onChange={(e) => set('address', e.target.value)}
              placeholder={addressHint || 'Address'}
            />
          </FieldRow>

          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="Data Type *">
              <Select value={form.data_type} onChange={(e) => set('data_type', e.target.value)}>
                {DATA_TYPES.map((dt) => (
                  <option key={dt.value} value={dt.value}>{dt.label}</option>
                ))}
              </Select>
            </FieldRow>

            <FieldRow label="Scan Rate (ms) *">
              <Input
                required
                type="number"
                min="50"
                step="50"
                value={form.scan_rate_ms}
                onChange={(e) => set('scan_rate_ms', e.target.value)}
                placeholder="100"
              />
            </FieldRow>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="Quyền truy cập (Client Access)">
              <Select value={form.access} onChange={(e) => set('access', e.target.value)}>
                <option value="rw">Read / Write (Đọc &amp; Ghi)</option>
                <option value="ro">Read Only (Chỉ đọc — khóa ghi)</option>
              </Select>
            </FieldRow>

            <FieldRow label="Đơn vị đo (Unit)">
              <Input
                value={form.unit}
                onChange={(e) => set('unit', e.target.value)}
                placeholder="vd: bar, m³/h, Hz, °C..."
              />
            </FieldRow>
          </div>

          {/* Scaling block */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-semibold text-gray-700">Scaling (Quy đổi giá trị kỹ thuật)</label>
              <Select
                value={form.scale_type}
                onChange={(e) => set('scale_type', e.target.value)}
                style={{ width: 'auto' }}
              >
                <option value="none">Không quy đổi</option>
                <option value="linear">Tuyến tính (Raw → Eng)</option>
                <option value="factor">Hệ số (a × Raw + b)</option>
              </Select>
            </div>

            {form.scale_type === 'linear' && (
              <div className="space-y-2">
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <label className="text-[11px] text-gray-500 block mb-0.5">Raw Min</label>
                    <Input type="number" step="any" value={form.raw_min} onChange={(e) => set('raw_min', e.target.value)} />
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-500 block mb-0.5">Raw Max</label>
                    <Input type="number" step="any" value={form.raw_max} onChange={(e) => set('raw_max', e.target.value)} />
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-500 block mb-0.5">Eng Min</label>
                    <Input type="number" step="any" value={form.eng_min} onChange={(e) => set('eng_min', e.target.value)} />
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-500 block mb-0.5">Eng Max</label>
                    <Input type="number" step="any" value={form.eng_max} onChange={(e) => set('eng_max', e.target.value)} />
                  </div>
                </div>
                <label className="inline-flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!form.scale_clamp}
                    onChange={(e) => set('scale_clamp', e.target.checked)}
                    className="rounded accent-emerald-500 cursor-pointer"
                  />
                  <span>Giới hạn kết quả trong khoảng [Eng Min, Eng Max] (Clamp)</span>
                </label>
              </div>
            )}

            {form.scale_type === 'factor' && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-gray-500 block mb-0.5">Hệ số nhân (a)</label>
                  <Input type="number" step="any" value={form.scale_factor} onChange={(e) => set('scale_factor', e.target.value)} />
                </div>
                <div>
                  <label className="text-[11px] text-gray-500 block mb-0.5">Độ lệch cộng (b)</label>
                  <Input type="number" step="any" value={form.scale_offset} onChange={(e) => set('scale_offset', e.target.value)} />
                </div>
              </div>
            )}
          </div>

          <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={!!form.log_enabled}
              onChange={(e) => set('log_enabled', e.target.checked)}
              className="rounded accent-emerald-500 cursor-pointer"
            />
            <span>Ghi lịch sử vào Data Logger (Historian)</span>
          </label>

          <FieldRow label="Description (optional)">
            <Input
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Ghi chú về tag này..."
            />
          </FieldRow>

          {/* Buttons */}
          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100 mt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? 'Saving...' : isEdit ? 'Update' : 'Create Tag'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
