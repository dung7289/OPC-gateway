import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Radio,
  Plus,
  Edit2,
  Trash2,
  Send,
  Save,
  RefreshCw,
  Copy,
  CheckCircle2,
  AlertTriangle,
  Clock,
  SlidersHorizontal,
  Sparkles,
  X,
  Eye,
  Zap,
  Link2,
  Search,
  Power,
} from 'lucide-react';
import { fetchConnections } from '../api/connections';
import { fetchTags, fetchTagGroups } from '../api/tags';
import {
  fetchUsrM100Devices,
  createUsrM100Device,
  updateUsrM100Device,
  deleteUsrM100Device,
  updateUsrM100Buffer,
  publishUsrM100Device,
  queryUsrM100Device,
  publishUsrM100Raw,
  fetchUsrM100History,
  clearUsrM100History,
} from '../api/usrM100';
import StatusBadge from '../components/StatusBadge';

function mapPointType(tagDataType) {
  const dt = (tagDataType || '').toLowerCase();
  if (dt === 'bool') return 'bool';
  if (dt.includes('int')) return 'int';
  if (dt.includes('float')) return 'float';
  return 'string';
}

function formatPointValueClient(value, dataType, valueAsString) {
  const dt = (dataType || 'string').toLowerCase();
  if (dt === 'bool') {
    const truthy =
      typeof value === 'boolean'
        ? value
        : typeof value === 'number'
        ? value !== 0
        : ['1', 'true', 'on', 'yes'].includes(String(value ?? '').trim().toLowerCase());
    const num = truthy ? 1 : 0;
    return valueAsString ? String(num) : num;
  }
  if (dt === 'int') {
    const parsed = parseInt(Number(value), 10);
    const num = Number.isNaN(parsed) ? 0 : parsed;
    return valueAsString ? String(num) : num;
  }
  if (dt === 'float') {
    const parsed = parseFloat(value);
    const num = Number.isNaN(parsed) ? 0 : Number(parsed.toFixed(6));
    return valueAsString ? String(num) : num;
  }
  return value === null || value === undefined ? '' : String(value);
}

function pointsValuesDifferClient(valA, valB, dataType, valueAsString, deadband = 0) {
  if (valB === null || valB === undefined) return true;
  const dt = (dataType || 'string').toLowerCase();
  const nA = formatPointValueClient(valA, dt, false);
  const nB = formatPointValueClient(valB, dt, false);
  if ((dt === 'int' || dt === 'float') && Number(deadband) > 0) {
    return Math.abs(Number(nA) - Number(nB)) >= Number(deadband);
  }
  return formatPointValueClient(valA, dt, valueAsString) !== formatPointValueClient(valB, dt, valueAsString);
}

function buildPreviewPayloadsClient({
  payloadMode = 'rw_prot',
  ver = '1.0.1',
  valueAsString = true,
  includeRdata = false,
  wItems = [],
  rItems = [],
  msgId = '12345',
}) {
  const cleanW = wItems.filter((it) => (it.name || '').trim());
  const cleanR = rItems.map((r) => (r || '').trim()).filter(Boolean);

  if (payloadMode === 'flat_json') {
    if (cleanW.length === 0) return [];
    const obj = {};
    cleanW.forEach((it) => {
      obj[it.name.trim()] = formatPointValueClient(it.value, it.data_type, valueAsString);
    });
    return [obj];
  }

  const wChunks = [];
  for (let i = 0; i < cleanW.length; i += 5) wChunks.push(cleanW.slice(i, i + 5));
  const rSet = new Set(cleanR);
  if (includeRdata) cleanW.forEach((w) => rSet.add(w.name.trim()));
  const rArr = Array.from(rSet);
  const rChunks = [];
  for (let i = 0; i < rArr.length; i += 5) rChunks.push(rArr.slice(i, i + 5));

  const total = Math.max(wChunks.length, rChunks.length);
  if (total === 0) return [];
  const packets = [];
  for (let i = 0; i < total; i += 1) {
    const body = {
      Ver: (ver || '1.0.1').trim() || '1.0.1',
      dir: 'down',
      id: total === 1 ? String(msgId) : `${msgId}_${i + 1}`,
    };
    if (rChunks[i]?.length) body.r_data = rChunks[i].map((name) => ({ name }));
    if (wChunks[i]?.length) {
      body.w_data = wChunks[i].map((it) => ({
        name: it.name.trim(),
        value: formatPointValueClient(it.value, it.data_type, valueAsString),
      }));
    }
    packets.push({ rw_prot: body });
  }
  return packets;
}

function suggestSubTopic(pubTopic) {
  const clean = (pubTopic || '').trim();
  if (!clean) return '';
  if (/\/pub$/i.test(clean)) return clean.replace(/\/pub$/i, '/SUB');
  return `${clean.replace(/\/+$/, '')}/SUB`;
}

function DeviceFormModal({
  device,
  mqttConnections,
  allTags,
  allGroups,
  onSave,
  onClose,
  saving,
}) {
  const isEdit = Boolean(device);
  const defaultConnId = device?.connection_id || mqttConnections[0]?.id || '';

  const [name, setName] = useState(device?.name || '');
  const [connectionId, setConnectionId] = useState(String(defaultConnId));
  const [subTopic, setSubTopic] = useState(device?.sub_topic || '');
  const [pubTopic, setPubTopic] = useState(device?.pub_topic || '');
  const [payloadMode, setPayloadMode] = useState(device?.payload_mode || 'rw_prot');
  const [ver, setVer] = useState(device?.ver || '1.0.1');
  const [valueAsString, setValueAsString] = useState(device?.value_as_string ?? true);
  const [includeRdata, setIncludeRdata] = useState(device?.include_rdata_on_write ?? false);
  const [qos, setQos] = useState(String(device?.qos ?? 0));
  const [retain, setRetain] = useState(device?.retain ?? false);
  const [autoSync, setAutoSync] = useState(device?.auto_sync_enabled ?? true);
  const [points, setPoints] = useState(
    device?.points?.length
      ? device.points
      : [
          {
            name: 'DO1',
            label: 'DO1',
            data_type: 'bool',
            buffered_value: 0,
            feedback_tag_id: null,
            source_tag_id: null,
          },
        ]
  );
  const [quickGroup, setQuickGroup] = useState('');

  const connGroups = useMemo(() => {
    const cid = Number(connectionId);
    const set = new Set();
    allGroups
      .filter((g) => g.connection_id === cid && g.name)
      .forEach((g) => set.add(g.name));
    allTags
      .filter((t) => t.connection_id === cid && t.tag_group)
      .forEach((t) => set.add(t.tag_group));
    return Array.from(set).sort();
  }, [connectionId, allGroups, allTags]);

  const handleLoadFromGroup = (grpName) => {
    setQuickGroup(grpName);
    if (!grpName) return;
    const cid = Number(connectionId);
    const matching = allTags.filter(
      (t) => t.connection_id === cid && t.tag_group === grpName
    );
    if (matching.length === 0) {
      toast.error(`Nhóm '${grpName}' chưa có tag nào`);
      return;
    }

    const firstAddr = matching[0].address || '';
    const extractedTopic = firstAddr.includes(':')
      ? firstAddr.split(':', 1)[0].trim()
      : firstAddr.includes('.')
      ? firstAddr.slice(0, firstAddr.lastIndexOf('.')).trim()
      : '';

    if (!name.trim()) setName(`USR-M100 ${grpName}`);
    if (extractedTopic) {
      setPubTopic(extractedTopic);
      if (!subTopic.trim()) setSubTopic(suggestSubTopic(extractedTopic));
    }

    const loadedPoints = matching.map((t) => {
      const val = t.current_value;
      const dt = mapPointType(t.data_type);
      return {
        name: t.name,
        label: t.description || t.name,
        data_type: dt,
        buffered_value: val !== null && val !== undefined ? val : dt === 'string' ? '' : 0,
        feedback_tag_id: t.id,
        source_tag_id: null,
      };
    });
    setPoints(loadedPoints);
    toast.success(`Đã nạp ${loadedPoints.length} điểm từ nhóm '${grpName}' (có thể xóa bớt các điểm DI chỉ đọc)`);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!connectionId) {
      toast.error('Vui lòng chọn kết nối MQTT Broker');
      return;
    }
    if (!name.trim() || !subTopic.trim()) {
      toast.error('Vui lòng nhập Tên trạm và Topic nhận lệnh (SUB)');
      return;
    }
    onSave({
      name: name.trim(),
      connection_id: Number(connectionId),
      sub_topic: subTopic.trim(),
      pub_topic: pubTopic.trim(),
      payload_mode: payloadMode,
      ver: ver.trim() || '1.0.1',
      value_as_string: valueAsString,
      include_rdata_on_write: includeRdata,
      qos: Number(qos) || 0,
      retain,
      auto_sync_enabled: autoSync,
      points: points
        .filter((p) => (p.name || '').trim())
        .map((p) => ({
          name: p.name.trim(),
          label: (p.label || p.name).trim(),
          data_type: p.data_type || 'bool',
          buffered_value: p.buffered_value ?? 0,
          last_sent_value: p.last_sent_value ?? null,
          deadband: Number(p.deadband) || 0,
          feedback_tag_id: p.feedback_tag_id ? Number(p.feedback_tag_id) : null,
          source_tag_id: p.source_tag_id ? Number(p.source_tag_id) : null,
        })),
    });
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <form
        onSubmit={handleSubmit}
        className="glass-panel rounded-2xl border border-slate-700 w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800">
          <h3 className="font-heading font-bold text-slate-100 text-sm flex items-center gap-2">
            <Radio className="w-4 h-4 text-emerald-400" />
            {isEdit ? `Chỉnh sửa Trạm USR-M100: ${device.name}` : 'Thêm Trạm Điều Khiển USR-M100'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto text-xs">
          {/* Quick Load from MQTT Tag Group */}
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-emerald-200">
              <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Nạp nhanh cấu hình &amp; Feedback từ nhóm Tag MQTT sẵn có:</span>
            </div>
            <select
              value={quickGroup}
              onChange={(e) => handleLoadFromGroup(e.target.value)}
              className="bg-[#0F172A] border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 min-w-[180px]"
            >
              <option value="">-- Chọn nhóm Tag MQTT --</option>
              {connGroups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Tên Trạm / Thiết bị *
              </label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="VD: Trạm Bơm Đáp Cầu (USR-M100)"
                className="w-full bg-[#0F172A] border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Kết nối MQTT Broker *
              </label>
              <select
                required
                value={connectionId}
                onChange={(e) => setConnectionId(e.target.value)}
                className="w-full bg-[#0F172A] border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
              >
                {mqttConnections.length === 0 ? (
                  <option value="">Chưa có kênh MQTT nào</option>
                ) : (
                  mqttConnections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.connected ? 'Online' : 'Offline'})
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Topic Nhận Lệnh trên M100 (Subscribe / Control Topic) *
              </label>
              <input
                required
                value={subTopic}
                onChange={(e) => setSubTopic(e.target.value)}
                placeholder="VD: BNW/QLM/VAN/DAPCAU/SUB"
                className="w-full bg-[#0F172A] border border-slate-700 rounded-lg px-3 py-2 text-sky-300 font-mono"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Topic Phản Hồi từ M100 (Publish / ACK Topic)
              </label>
              <input
                value={pubTopic}
                onChange={(e) => setPubTopic(e.target.value)}
                placeholder="VD: BNW/QLM/VAN/DAPCAU/PUB"
                className="w-full bg-[#0F172A] border border-slate-700 rounded-lg px-3 py-2 text-emerald-300 font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Định dạng Payload
              </label>
              <select
                value={payloadMode}
                onChange={(e) => setPayloadMode(e.target.value)}
                className="w-full bg-[#0F172A] border border-slate-700 rounded-lg px-2.5 py-2 text-slate-100"
              >
                <option value="rw_prot">Chuẩn PUSR rw_prot</option>
                <option value="flat_json">JSON phẳng (Key-Value)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Phiên bản Ver
              </label>
              <input
                value={ver}
                onChange={(e) => setVer(e.target.value)}
                disabled={payloadMode !== 'rw_prot'}
                className="w-full bg-[#0F172A] border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono disabled:opacity-40"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                MQTT QoS
              </label>
              <select
                value={qos}
                onChange={(e) => setQos(e.target.value)}
                className="w-full bg-[#0F172A] border border-slate-700 rounded-lg px-2.5 py-2 text-slate-100"
              >
                <option value="0">0 - At most once</option>
                <option value="1">1 - At least once</option>
                <option value="2">2 - Exactly once</option>
              </select>
            </div>

            <div className="flex flex-col justify-end pb-1.5">
              <label className="inline-flex items-center gap-2 text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={retain}
                  onChange={(e) => setRetain(e.target.checked)}
                  className="accent-emerald-500 rounded"
                />
                <span>Retain Flag</span>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-[#0F172A]/80 border border-slate-800 rounded-xl p-3">
            <label className="inline-flex items-center gap-2 text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={valueAsString}
                onChange={(e) => setValueAsString(e.target.checked)}
                className="accent-emerald-500 rounded"
              />
              <span>Kiểu value chuỗi (<code className="text-amber-300">&quot;1&quot;</code>)</span>
            </label>

            <label className="inline-flex items-center gap-2 text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={includeRdata}
                onChange={(e) => setIncludeRdata(e.target.checked)}
                disabled={payloadMode !== 'rw_prot'}
                className="accent-emerald-500 rounded"
              />
              <span>Gửi kèm <code className="text-sky-300">r_data</code> đọc lại</span>
            </label>

            <label className="inline-flex items-center gap-2 text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={autoSync}
                onChange={(e) => setAutoSync(e.target.checked)}
                className="accent-emerald-500 rounded"
              />
              <span>Tự đồng bộ từ Tag nguồn</span>
            </label>
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-slate-800 flex justify-end gap-2.5 bg-[#0B1120]/70">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg cursor-pointer"
          >
            Hủy
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-[#0F172A] rounded-lg cursor-pointer disabled:opacity-50"
          >
            {saving ? 'Đang lưu...' : isEdit ? 'Lưu thay đổi' : 'Tạo Trạm M100'}
          </button>
        </div>
      </form>
    </div>
  );
}

function PointModal({ point, allTags, connections, onSave, onClose }) {
  const [name, setName] = useState(point?.name || '');
  const [label, setLabel] = useState(point?.label || '');
  const [dataType, setDataType] = useState(point?.data_type || 'bool');
  const [bufferedValue, setBufferedValue] = useState(
    point?.buffered_value !== undefined && point?.buffered_value !== null
      ? String(point.buffered_value)
      : '0'
  );
  const [deadband, setDeadband] = useState(
    point?.deadband !== undefined && point?.deadband !== null ? String(point.deadband) : '0'
  );
  const [feedbackTagId, setFeedbackTagId] = useState(
    point?.feedback_tag_id ? String(point.feedback_tag_id) : ''
  );
  const [sourceTagId, setSourceTagId] = useState(
    point?.source_tag_id ? String(point.source_tag_id) : ''
  );
  const [tagSearch, setTagSearch] = useState('');

  const connMap = useMemo(
    () => Object.fromEntries((connections || []).map((c) => [c.id, c.name])),
    [connections]
  );

  const filteredTags = useMemo(() => {
    const q = tagSearch.trim().toLowerCase();
    if (!q) return allTags;
    return allTags.filter((t) => {
      const cname = (connMap[t.connection_id] || '').toLowerCase();
      return (
        (t.name || '').toLowerCase().includes(q) ||
        (t.tag_group || '').toLowerCase().includes(q) ||
        (t.address || '').toLowerCase().includes(q) ||
        cname.includes(q) ||
        String(t.id) === feedbackTagId ||
        String(t.id) === sourceTagId
      );
    });
  }, [allTags, tagSearch, connMap, feedbackTagId, sourceTagId]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Vui lòng nhập Tên điểm M100 (vd: DO1)');
      return;
    }
    onSave({
      name: name.trim(),
      label: (label || name).trim(),
      data_type: dataType,
      buffered_value:
        dataType === 'bool' || dataType === 'int'
          ? parseInt(bufferedValue, 10) || 0
          : dataType === 'float'
          ? parseFloat(bufferedValue) || 0
          : bufferedValue,
      last_sent_value: point?.last_sent_value ?? null,
      deadband: Math.max(0, parseFloat(deadband) || 0),
      feedback_tag_id: feedbackTagId ? Number(feedbackTagId) : null,
      source_tag_id: sourceTagId ? Number(sourceTagId) : null,
    });
  };

  const loopWarning = Boolean(sourceTagId && feedbackTagId && sourceTagId === feedbackTagId);

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <form
        onSubmit={handleSubmit}
        className="glass-panel rounded-xl border border-slate-700 w-full max-w-lg p-5 space-y-3.5 text-xs shadow-2xl max-h-[92vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
          <h3 className="font-heading font-bold text-slate-100 text-sm">
            {point ? `Sửa điểm điều khiển: ${point.name}` : 'Thêm điểm điều khiển USR-M100'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">
              Tên biến trên M100 (<code className="text-sky-300">name</code>) *
            </label>
            <input
              required
              disabled={Boolean(point)}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="VD: DO1, DO2, SP_PRESS"
              className="w-full bg-[#0F172A] border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono disabled:opacity-60"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Mô tả hiển thị</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="VD: Bơm tăng áp 1"
              className="w-full bg-[#0F172A] border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Kiểu dữ liệu</label>
            <select
              value={dataType}
              onChange={(e) => setDataType(e.target.value)}
              className="w-full bg-[#0F172A] border border-slate-700 rounded-lg px-2.5 py-2 text-slate-100"
            >
              <option value="bool">Boolean (0 / 1)</option>
              <option value="int">Số nguyên (int)</option>
              <option value="float">Số thực (float)</option>
              <option value="string">Chuỗi (string)</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Giá trị vùng đệm</label>
            <input
              value={bufferedValue}
              onChange={(e) => setBufferedValue(e.target.value)}
              className="w-full bg-[#0F172A] border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Deadband (chống nhiễu)</label>
            <input
              type="number"
              min="0"
              step="any"
              value={deadband}
              onChange={(e) => setDeadband(e.target.value)}
              disabled={dataType === 'bool' || dataType === 'string'}
              className="w-full bg-[#0F172A] border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono disabled:opacity-40"
            />
          </div>
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={tagSearch}
            onChange={(e) => setTagSearch(e.target.value)}
            placeholder="Lọc nhanh tag có sẵn theo tên, kênh hoặc địa chỉ..."
            className="w-full bg-[#0F172A] border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-100"
          />
        </div>

        <div>
          <label className="block text-[11px] text-slate-400 mb-1">
            Tag nguồn tự đồng bộ (chỉ gửi xuống M100 khi đổi giá trị)
          </label>
          <select
            value={sourceTagId}
            onChange={(e) => setSourceTagId(e.target.value)}
            className="w-full bg-[#0F172A] border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
          >
            <option value="">-- Chỉ điều khiển thủ công trên Web --</option>
            {filteredTags.map((t) => (
              <option key={t.id} value={t.id}>
                [{connMap[t.connection_id] || `#${t.connection_id}`}] {t.tag_group ? `${t.tag_group}/` : ''}
                {t.name} ({t.address})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] text-slate-400 mb-1">
            Tag giám sát Feedback thực tế từ M100 (tùy chọn)
          </label>
          <select
            value={feedbackTagId}
            onChange={(e) => setFeedbackTagId(e.target.value)}
            className="w-full bg-[#0F172A] border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
          >
            <option value="">-- Không liên kết Feedback --</option>
            {filteredTags.map((t) => (
              <option key={t.id} value={t.id}>
                [{connMap[t.connection_id] || `#${t.connection_id}`}] {t.tag_group ? `${t.tag_group}/` : ''}
                {t.name} ({t.address})
              </option>
            ))}
          </select>
        </div>

        {loopWarning && (
          <div className="bg-amber-500/15 border border-amber-500/40 rounded-lg p-2.5 text-[11px] text-amber-200 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span>
              Cảnh báo: Bạn đang chọn cùng 1 Tag làm cả Tag nguồn và Feedback. Nếu đây là tag đọc từ M100 PUB, hãy tách riêng Tag nguồn (PLC/Internal) để tránh lặp lệnh.
            </span>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg cursor-pointer"
          >
            Hủy
          </button>
          <button
            type="submit"
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-[#0F172A] font-bold rounded-lg cursor-pointer"
          >
            Lưu điểm
          </button>
        </div>
      </form>
    </div>
  );
}

function TagPickerModal({ existingNames, connections, allTags, onConfirm, onClose }) {
  const [connFilter, setConnFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [pickedMap, setPickedMap] = useState({}); // { [tag.id]: targetM100Name }
  const [enableAutoSync, setEnableAutoSync] = useState(true);

  const connMap = useMemo(
    () => Object.fromEntries((connections || []).map((c) => [c.id, c])),
    [connections]
  );

  const availableGroups = useMemo(() => {
    const set = new Set();
    allTags.forEach((t) => {
      if (connFilter !== 'all' && String(t.connection_id) !== connFilter) return;
      if (t.tag_group) set.add(t.tag_group);
    });
    return Array.from(set).sort();
  }, [allTags, connFilter]);

  const filteredTags = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return allTags.filter((t) => {
      if (connFilter !== 'all' && String(t.connection_id) !== connFilter) return false;
      if (groupFilter !== 'all' && (t.tag_group || '') !== groupFilter) return false;
      if (!q) return true;
      return (
        (t.name || '').toLowerCase().includes(q) ||
        (t.address || '').toLowerCase().includes(q) ||
        (t.tag_group || '').toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q)
      );
    });
  }, [allTags, connFilter, groupFilter, searchText]);

  const pickedIds = useMemo(() => Object.keys(pickedMap).map(Number), [pickedMap]);

  const duplicateNames = useMemo(() => {
    const counts = {};
    pickedIds.forEach((tid) => {
      const nm = (pickedMap[tid] || '').trim();
      if (nm) counts[nm] = (counts[nm] || 0) + 1;
    });
    return Object.entries(counts)
      .filter(([nm, cnt]) => cnt > 1 || existingNames.has(nm))
      .map(([nm]) => nm);
  }, [pickedIds, pickedMap, existingNames]);

  const toggleTag = (tag) => {
    setPickedMap((prev) => {
      if (prev[tag.id] !== undefined) {
        const next = { ...prev };
        delete next[tag.id];
        return next;
      }
      return { ...prev, [tag.id]: tag.name };
    });
  };

  const handleConfirm = (e) => {
    e.preventDefault();
    if (pickedIds.length === 0) {
      toast.error('Hãy tích chọn ít nhất 1 Tag trong danh sách');
      return;
    }
    if (duplicateNames.length > 0) {
      toast.error(`Tên điểm M100 bị trùng hoặc đã tồn tại: ${duplicateNames.join(', ')}`);
      return;
    }
    const tagById = Object.fromEntries(allTags.map((t) => [t.id, t]));
    const newPoints = pickedIds
      .map((tid) => {
        const t = tagById[tid];
        if (!t) return null;
        const m100Name = (pickedMap[tid] || t.name || '').trim();
        if (!m100Name) return null;
        const dt = mapPointType(t.data_type);
        const val =
          t.current_value !== null && t.current_value !== undefined
            ? t.current_value
            : dt === 'string'
            ? ''
            : 0;
        return {
          name: m100Name,
          label: t.description || m100Name,
          data_type: dt,
          buffered_value: val,
          last_sent_value: null,
          deadband: 0,
          feedback_tag_id: null,
          source_tag_id: t.id,
        };
      })
      .filter(Boolean);

    onConfirm(newPoints, enableAutoSync);
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <form
        onSubmit={handleConfirm}
        className="glass-panel rounded-2xl border border-slate-700 w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl text-xs"
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800">
          <div>
            <h3 className="font-heading font-bold text-slate-100 text-sm flex items-center gap-2">
              <Link2 className="w-4 h-4 text-sky-400" />
              Chọn Tag có sẵn từ phần mềm để điều khiển USR-M100
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Liên kết Tag PLC S7, Modbus, OPC-DA/UA, Internal... làm Tag nguồn — chỉ gửi lệnh khi giá trị thay đổi
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

        {/* Filters */}
        <div className="p-4 border-b border-slate-800 bg-[#0F172A]/60 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <select
            value={connFilter}
            onChange={(e) => {
              setConnFilter(e.target.value);
              setGroupFilter('all');
            }}
            className="bg-[#0F172A] border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
          >
            <option value="all">Tất cả kênh kết nối ({connections.length})</option>
            {connections.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name} ({c.protocol})
              </option>
            ))}
          </select>

          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className="bg-[#0F172A] border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
          >
            <option value="all">Tất cả thư mục</option>
            {availableGroups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Tìm tên tag, địa chỉ..."
              className="w-full bg-[#0F172A] border border-slate-700 rounded-lg pl-8 pr-3 py-2 text-slate-100"
            />
          </div>
        </div>

        {/* Tag Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#0F172A] border-b border-slate-800 text-slate-400 sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 w-9 text-center">Chọn</th>
                <th className="px-3 py-2 text-left font-semibold">Kênh / Nhóm / Tên Tag</th>
                <th className="px-3 py-2 text-left font-semibold">Address</th>
                <th className="px-3 py-2 text-left font-semibold">Giá trị Live</th>
                <th className="px-3 py-2 text-left font-semibold min-w-[180px] whitespace-nowrap">Tên điểm trên M100 (<code className="text-sky-300">name</code>)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {filteredTags.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    Không có tag nào khớp bộ lọc.
                  </td>
                </tr>
              ) : (
                filteredTags.map((t) => {
                  const isChecked = pickedMap[t.id] !== undefined;
                  const conn = connMap[t.connection_id];
                  const m100Target = pickedMap[t.id] ?? '';
                  const isConflict = isChecked && duplicateNames.includes(m100Target.trim());
                  return (
                    <tr
                      key={t.id}
                      onClick={() => toggleTag(t)}
                      className={`cursor-pointer transition-colors ${
                        isChecked ? 'bg-emerald-500/10' : 'hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleTag(t)}
                          className="accent-emerald-500 rounded cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-slate-100">
                          <span className="text-sky-300">[{conn?.name || `#${t.connection_id}`}]</span>{' '}
                          {t.tag_group ? `${t.tag_group}/` : ''}
                          {t.name}
                        </div>
                        <div className="text-[10px] font-mono text-slate-500">{t.data_type}</div>
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-300 max-w-[220px] truncate" title={t.address}>{t.address}</td>
                      <td className="px-3 py-2 font-mono whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="text-slate-100 font-bold max-w-[110px] truncate"
                            title={
                              t.current_value !== null && t.current_value !== undefined
                                ? String(t.current_value)
                                : '—'
                            }
                          >
                            {t.current_value !== null && t.current_value !== undefined
                              ? String(t.current_value)
                              : '—'}
                          </span>
                          {t.quality && <StatusBadge status={t.quality} size="sm" />}
                        </div>
                      </td>
                      <td className="px-3 py-2 min-w-[180px]" onClick={(e) => e.stopPropagation()}>
                        {isChecked ? (
                          <input
                            value={m100Target}
                            onChange={(e) =>
                              setPickedMap((prev) => ({ ...prev, [t.id]: e.target.value }))
                            }
                            placeholder="VD: DO1"
                            className={`w-full bg-[#0F172A] border rounded-lg px-2.5 py-1 font-mono text-slate-100 ${
                              isConflict ? 'border-red-500' : 'border-emerald-500/50'
                            }`}
                          />
                        ) : (
                          <span className="text-[11px] text-slate-500 font-mono">
                            Gợi ý: {t.name}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-800 bg-[#0B1120]/80 flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={enableAutoSync}
              onChange={(e) => setEnableAutoSync(e.target.checked)}
              className="accent-emerald-500 rounded cursor-pointer"
            />
            <span>Tự bật Auto-Sync cho trạm (chỉ gửi xuống USR-M100 khi Tag đổi giá trị)</span>
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={pickedIds.length === 0 || duplicateNames.length > 0}
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-[#0F172A] font-bold rounded-lg cursor-pointer disabled:opacity-40"
            >
              Thêm {pickedIds.length} Tag vào Trạm
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export default function UsrM100Control() {
  const queryClient = useQueryClient();

  const { data: devices = [], isLoading } = useQuery({
    queryKey: ['usrM100Devices'],
    queryFn: fetchUsrM100Devices,
    refetchInterval: 2500,
  });

  const { data: connections = [] } = useQuery({
    queryKey: ['connections'],
    queryFn: fetchConnections,
  });

  const { data: allTags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: () => fetchTags(),
    refetchInterval: 3000,
  });

  const { data: allGroups = [] } = useQuery({
    queryKey: ['tagGroups'],
    queryFn: () => fetchTagGroups(),
  });

  const mqttConnections = useMemo(
    () => connections.filter((c) => c.protocol === 'mqtt'),
    [connections]
  );

  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [rightTab, setRightTab] = useState('buffer'); // 'buffer' | 'adhoc'
  const [bufferDrafts, setBufferDrafts] = useState({});
  const [selectedPoints, setSelectedPoints] = useState(() => new Set());
  const [onlyChanged, setOnlyChanged] = useState(true);
  const [showPreview, setShowPreview] = useState(true);
  const [showDeviceModal, setShowDeviceModal] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [editingDevice, setEditingDevice] = useState(null);
  const [pointModalState, setPointModalState] = useState(null); // { mode: 'add' | 'edit', point }

  // Quick Adhoc Publish state
  const [adhocConnId, setAdhocConnId] = useState('');
  const [adhocTopic, setAdhocTopic] = useState('');
  const [adhocMode, setAdhocMode] = useState('rw_prot');
  const [adhocVer, setAdhocVer] = useState('1.0.1');
  const [adhocAsString, setAdhocAsString] = useState(true);
  const [adhocQos, setAdhocQos] = useState('0');
  const [adhocRetain, setAdhocRetain] = useState(false);
  const [adhocWItems, setAdhocWItems] = useState([
    { name: 'DO1', value: '1', data_type: 'bool' },
  ]);
  const [adhocRItemsText, setAdhocRItemsText] = useState('');

  const activeDevice = useMemo(() => {
    return devices.find((d) => d.id === selectedDeviceId) || devices[0] || null;
  }, [devices, selectedDeviceId]);

  const effectiveAdhocConnId = adhocConnId || (mqttConnections[0]?.id ? String(mqttConnections[0].id) : '');

  const { data: history = [], refetch: refetchHistory } = useQuery({
    queryKey: ['usrM100History', activeDevice?.id || 'all'],
    queryFn: () => fetchUsrM100History(null, 50),
    refetchInterval: 3000,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['usrM100Devices'] });
    queryClient.invalidateQueries({ queryKey: ['usrM100History'] });
  };

  const createDevMutation = useMutation({
    mutationFn: createUsrM100Device,
    onSuccess: (created) => {
      toast.success(`Đã tạo trạm '${created.name}'`);
      setSelectedDeviceId(created.id);
      setShowDeviceModal(false);
      invalidateAll();
    },
    onError: (err) => toast.error(err.response?.data?.detail || err.message || 'Tạo trạm thất bại'),
  });

  const updateDevMutation = useMutation({
    mutationFn: ({ id, data }) => updateUsrM100Device(id, data),
    onSuccess: (_data, vars) => {
      if (!vars?.silentSuccess) {
        toast.success('Đã cập nhật cấu hình trạm');
      }
      setShowDeviceModal(false);
      setEditingDevice(null);
      setPointModalState(null);
      invalidateAll();
    },
    onError: (err) => toast.error(err.response?.data?.detail || err.message || 'Cập nhật thất bại'),
  });

  const deleteDevMutation = useMutation({
    mutationFn: deleteUsrM100Device,
    onSuccess: () => {
      toast.success('Đã xóa trạm USR-M100');
      setSelectedDeviceId('');
      invalidateAll();
    },
    onError: (err) => toast.error(err.response?.data?.detail || err.message || 'Xóa thất bại'),
  });

  const saveBufferMutation = useMutation({
    mutationFn: ({ id, values }) => updateUsrM100Buffer(id, values),
    onSuccess: () => {
      toast.success('Đã lưu giá trị vào vùng đệm (chưa publish)');
      invalidateAll();
    },
    onError: (err) => toast.error(err.response?.data?.detail || err.message || 'Lỗi lưu vùng đệm'),
  });

  const publishMutation = useMutation({
    mutationFn: ({ id, payload }) => publishUsrM100Device(id, payload),
    onSuccess: (res) => {
      if (res.ok && res.sent === 0 && res.skipped > 0) {
        toast(res.message || 'Giá trị không thay đổi — không gửi lệnh xuống USR-M100');
      } else if (res.ok) {
        toast.success(res.message);
      } else {
        toast.error(res.message || 'Publish thất bại');
      }
      invalidateAll();
    },
    onError: (err) => toast.error(err.response?.data?.detail || err.message || 'Publish thất bại'),
  });

  const queryMutation = useMutation({
    mutationFn: ({ id, payload }) => queryUsrM100Device(id, payload),
    onSuccess: (res) => {
      if (res.ok) toast.success(res.message);
      else toast.error(res.message || 'Gửi truy vấn thất bại');
      invalidateAll();
    },
    onError: (err) => toast.error(err.response?.data?.detail || err.message || 'Lỗi truy vấn r_data'),
  });

  const adhocMutation = useMutation({
    mutationFn: publishUsrM100Raw,
    onSuccess: (res) => {
      if (res.ok) toast.success(res.message);
      else toast.error(res.message || 'Publish thất bại');
      queryClient.invalidateQueries({ queryKey: ['usrM100History'] });
    },
    onError: (err) => toast.error(err.response?.data?.detail || err.message || 'Publish thất bại'),
  });

  const clearHistMutation = useMutation({
    mutationFn: () => clearUsrM100History(),
    onSuccess: () => {
      toast.success('Đã xóa lịch sử lệnh');
      queryClient.invalidateQueries({ queryKey: ['usrM100History'] });
    },
  });

  const getDraftValue = (dev, pt) => {
    const key = `${dev.id}:${pt.name}`;
    return bufferDrafts[key] !== undefined ? bufferDrafts[key] : pt.buffered_value;
  };

  const setDraftValue = (devId, ptName, val) => {
    setBufferDrafts((prev) => ({ ...prev, [`${devId}:${ptName}`]: val }));
  };

  const handleSaveDeviceBuffer = () => {
    if (!activeDevice) return;
    const values = {};
    activeDevice.points.forEach((pt) => {
      values[pt.name] = getDraftValue(activeDevice, pt);
    });
    saveBufferMutation.mutate({ id: activeDevice.id, values });
  };

  const handlePublishBatch = () => {
    if (!activeDevice) return;
    const chosen = activeDevice.points.filter(
      (pt) => selectedPoints.size === 0 || selectedPoints.has(pt.name)
    );
    if (chosen.length === 0) {
      toast.error('Chưa có điểm nào để gửi');
      return;
    }
    const items = chosen.map((pt) => {
      const k = `${activeDevice.id}:${pt.name}`;
      return {
        name: pt.name,
        value: bufferDrafts[k] !== undefined ? bufferDrafts[k] : pt.buffered_value,
        data_type: pt.data_type,
      };
    });
    publishMutation.mutate({
      id: activeDevice.id,
      payload: { items, only_changed: onlyChanged },
    });
  };

  const cleanPointForSave = (p) => ({
    name: p.name,
    label: p.label ?? '',
    data_type: p.data_type || 'bool',
    buffered_value: p.buffered_value ?? 0,
    last_sent_value: p.last_sent_value ?? null,
    deadband: Number(p.deadband) || 0,
    feedback_tag_id: p.feedback_tag_id ?? null,
    source_tag_id: p.source_tag_id ?? null,
  });

  const handleAddTagsFromPicker = (newPoints, enableAutoSync) => {
    if (!activeDevice) return;
    const mergedPoints = [...(activeDevice.points || []), ...newPoints].map(cleanPointForSave);
    const patch = { points: mergedPoints };
    if (enableAutoSync) patch.auto_sync_enabled = true;
    updateDevMutation.mutate(
      { id: activeDevice.id, data: patch, silentSuccess: true },
      {
        onSuccess: () => {
          setShowTagPicker(false);
          toast.success(`Đã gắn ${newPoints.length} tag có sẵn vào trạm '${activeDevice.name}'`);
        },
      }
    );
  };

  const handleQuickToggleAndPublish = (pt, targetVal) => {
    if (!activeDevice) return;
    setDraftValue(activeDevice.id, pt.name, targetVal);
    publishMutation.mutate({
      id: activeDevice.id,
      payload: {
        items: [{ name: pt.name, value: targetVal, data_type: pt.data_type }],
      },
    });
  };

  const handleSavePoint = (pointData) => {
    if (!activeDevice) return;
    const current = activeDevice.points || [];
    let updatedPoints;
    if (pointModalState?.mode === 'edit') {
      updatedPoints = current.map((p) => (p.name === pointData.name ? pointData : p));
    } else {
      if (current.some((p) => p.name === pointData.name)) {
        toast.error(`Điểm '${pointData.name}' đã tồn tại trên trạm này`);
        return;
      }
      updatedPoints = [...current, pointData];
    }
    updateDevMutation.mutate({
      id: activeDevice.id,
      data: { points: updatedPoints.map(cleanPointForSave) },
    });
  };

  const handleDeletePoint = (ptName) => {
    if (!activeDevice) return;
    if (!window.confirm(`Xóa điểm '${ptName}' khỏi trạm?`)) return;
    const updatedPoints = (activeDevice.points || [])
      .filter((p) => p.name !== ptName)
      .map(cleanPointForSave);
    updateDevMutation.mutate({
      id: activeDevice.id,
      data: { points: updatedPoints },
    });
  };

  const previewPackets = useMemo(() => {
    if (rightTab === 'adhoc') {
      const rList = adhocRItemsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      return buildPreviewPayloadsClient({
        payloadMode: adhocMode,
        ver: adhocVer,
        valueAsString: adhocAsString,
        includeRdata: false,
        wItems: adhocWItems,
        rItems: rList,
        msgId: '12345',
      });
    }
    if (!activeDevice) return [];
    const chosen = (activeDevice.points || []).filter(
      (pt) => selectedPoints.size === 0 || selectedPoints.has(pt.name)
    );
    const items = chosen.map((pt) => {
      const k = `${activeDevice.id}:${pt.name}`;
      return {
        name: pt.name,
        value: bufferDrafts[k] !== undefined ? bufferDrafts[k] : pt.buffered_value,
        data_type: pt.data_type,
      };
    });
    return buildPreviewPayloadsClient({
      payloadMode: activeDevice.payload_mode,
      ver: activeDevice.ver,
      valueAsString: activeDevice.value_as_string,
      includeRdata: activeDevice.include_rdata_on_write,
      wItems: items,
      rItems: [],
      msgId: '12345',
    });
  }, [
    rightTab,
    activeDevice,
    selectedPoints,
    bufferDrafts,
    adhocMode,
    adhocVer,
    adhocAsString,
    adhocWItems,
    adhocRItemsText,
  ]);

  const handleCopyPreview = () => {
    const text =
      previewPackets.length === 1
        ? JSON.stringify(previewPackets[0], null, 2)
        : JSON.stringify(previewPackets, null, 2);
    navigator.clipboard.writeText(text);
    toast.success('Đã copy JSON vào Clipboard');
  };

  const handleSendAdhoc = (e) => {
    e.preventDefault();
    if (!effectiveAdhocConnId || !adhocTopic.trim()) {
      toast.error('Chọn kênh MQTT và nhập Topic cần publish');
      return;
    }
    const rList = adhocRItemsText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    adhocMutation.mutate({
      connection_id: Number(effectiveAdhocConnId),
      topic: adhocTopic.trim(),
      payload_mode: adhocMode,
      ver: adhocVer.trim() || '1.0.1',
      value_as_string: adhocAsString,
      qos: Number(adhocQos) || 0,
      retain: adhocRetain,
      w_items: adhocWItems.filter((w) => (w.name || '').trim()),
      r_items: rList,
    });
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-bold text-slate-100 flex items-center gap-2">
            <Radio className="w-5 h-5 text-emerald-400" />
            USR-M100 MQTT Buffer &amp; Control
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Vùng đệm điều khiển thiết bị IoT USR-M100 qua MQTT chuẩn <code className="text-sky-300">rw_prot</code> (<code className="text-slate-300">Ver 1.0.1</code>, tối đa 5 điểm/gói, theo dõi ACK) hoặc JSON phẳng
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setEditingDevice(null);
            setShowDeviceModal(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-[#0F172A] text-xs font-bold rounded-lg transition-colors cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
          Thêm Trạm USR-M100
        </button>
      </div>

      {/* Main Split View */}
      <div className="grid grid-cols-1 lg:grid-cols-[290px_1fr] gap-5 items-start">
        {/* Left: Devices List */}
        <div className="glass-panel rounded-xl border border-slate-800 p-3 space-y-2.5">
          <div className="flex items-center justify-between px-1.5">
            <span className="font-heading text-xs font-bold uppercase tracking-wider text-slate-400">
              Danh sách Trạm ({devices.length})
            </span>
          </div>

          {isLoading ? (
            <div className="py-8 text-center text-xs text-slate-400 font-mono">Đang tải...</div>
          ) : devices.length === 0 ? (
            <div className="py-6 px-3 text-center text-xs text-slate-400 space-y-2">
              <p>Chưa có trạm USR-M100 nào.</p>
              <p className="text-slate-500">
                Bấm &ldquo;Thêm Trạm USR-M100&rdquo; và có thể nạp nhanh từ nhóm Tag MQTT (DAPCAU / DAUHAN...).
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {devices.map((dev) => {
                const isSel = activeDevice?.id === dev.id && rightTab === 'buffer';
                return (
                  <div
                    key={dev.id}
                    onClick={() => {
                      setSelectedDeviceId(dev.id);
                      setRightTab('buffer');
                      setSelectedPoints(new Set());
                    }}
                    className={`rounded-xl p-3 border transition-colors cursor-pointer space-y-1.5 ${
                      isSel
                        ? 'bg-emerald-500/12 border-emerald-500/45'
                        : 'bg-[#0F172A]/70 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-heading font-bold text-xs text-slate-100 leading-snug">
                        {dev.name}
                      </div>
                      <span
                        className={`w-2 h-2 rounded-full mt-1 shrink-0 ${
                          dev.mqtt_connected ? 'bg-emerald-400' : 'bg-red-400'
                        }`}
                        title={dev.mqtt_connected ? 'MQTT Online' : 'MQTT Offline'}
                      />
                    </div>

                    <div className="text-[11px] font-mono text-sky-300 truncate" title={dev.sub_topic}>
                      SUB: {dev.sub_topic}
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <div className="flex items-center gap-1.5">
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-300">
                          {dev.payload_mode}
                        </span>
                        {dev.auto_sync_enabled && (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/40 text-[10px] font-mono text-emerald-300">
                            Auto-Sync
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingDevice(dev);
                            setShowDeviceModal(true);
                          }}
                          className="p-1 text-slate-400 hover:text-sky-400 rounded cursor-pointer"
                          title="Sửa cấu hình trạm"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Xóa trạm '${dev.name}'?`)) {
                              deleteDevMutation.mutate(dev.id);
                            }
                          }}
                          className="p-1 text-slate-400 hover:text-red-400 rounded cursor-pointer"
                          title="Xóa trạm"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Buffer Control OR Quick Adhoc Publish */}
        <div className="glass-panel rounded-xl border border-slate-800 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRightTab('buffer')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                  rightTab === 'buffer'
                    ? 'bg-emerald-500 text-[#0F172A]'
                    : 'bg-[#0F172A] text-slate-300 border border-slate-700 hover:text-slate-100'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                Vùng Đệm &amp; Điều Khiển Trạm
              </button>
              <button
                type="button"
                onClick={() => setRightTab('adhoc')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                  rightTab === 'adhoc'
                    ? 'bg-sky-500 text-[#0F172A]'
                    : 'bg-[#0F172A] text-slate-300 border border-slate-700 hover:text-slate-100'
                }`}
              >
                <Zap className="w-3.5 h-3.5" />
                Gửi Nhanh Tùy Chỉnh (Quick Publish)
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-300 bg-[#0F172A] border border-slate-700 rounded-lg cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5 text-sky-400" />
              {showPreview ? 'Ẩn Preview JSON' : 'Xem Preview JSON'}
            </button>
          </div>

          {rightTab === 'buffer' ? (
            !activeDevice ? (
              <div className="py-10 text-center text-xs text-slate-400 space-y-2">
                <Radio className="w-9 h-9 mx-auto opacity-30" />
                <p>Hãy chọn hoặc tạo một Trạm USR-M100 bên trái để điều khiển vùng đệm.</p>
                <p className="text-slate-500">Hoặc chuyển sang tab &ldquo;Gửi Nhanh Tùy Chỉnh&rdquo; để publish lệnh ngay.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Device Info Bar */}
                <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0F172A]/80 border border-slate-800 rounded-xl p-3 text-xs">
                  <div className="space-y-0.5">
                    <div className="font-heading font-bold text-slate-100 flex items-center flex-wrap gap-2">
                      <span>{activeDevice.name}</span>
                      <StatusBadge status={activeDevice.mqtt_connected ? 'connected' : 'disconnected'} size="sm" />
                      <button
                        type="button"
                        onClick={() =>
                          updateDevMutation.mutate({
                            id: activeDevice.id,
                            data: { auto_sync_enabled: !activeDevice.auto_sync_enabled },
                          })
                        }
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border cursor-pointer transition-colors ${
                          activeDevice.auto_sync_enabled
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/25'
                            : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                        }`}
                        title="Bật/tắt tự động publish khi giá trị Tag nguồn thay đổi"
                      >
                        <Power className="w-3 h-3" />
                        {activeDevice.auto_sync_enabled
                          ? 'Auto-Sync: BẬT (chỉ gửi khi đổi)'
                          : 'Auto-Sync: TẮT'}
                      </button>
                    </div>
                    <div className="font-mono text-[11px] text-slate-400">
                      Kênh: <span className="text-slate-200">{activeDevice.mqtt_name}</span> • SUB:{' '}
                      <span className="text-sky-300">{activeDevice.sub_topic}</span>
                      {activeDevice.pub_topic && (
                        <>
                          {' '}• PUB: <span className="text-emerald-300">{activeDevice.pub_topic}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowTagPicker(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-sky-300 bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/40 rounded-lg cursor-pointer"
                    >
                      <Link2 className="w-3.5 h-3.5" />
                      Chọn Tag từ phần mềm
                    </button>
                    <button
                      type="button"
                      onClick={() => setPointModalState({ mode: 'add', point: null })}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 rounded-lg cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Thêm điểm
                    </button>
                  </div>
                </div>

                {/* Points Buffer Table */}
                <div className="overflow-x-auto border border-slate-800 rounded-xl">
                  <table className="w-full text-xs">
                    <thead className="bg-[#0F172A]/90 border-b border-slate-800 text-slate-400">
                      <tr>
                        <th className="px-3 py-2.5 w-8 text-center">
                          <input
                            type="checkbox"
                            checked={
                              activeDevice.points.length > 0 &&
                              selectedPoints.size === activeDevice.points.length
                            }
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedPoints(new Set(activeDevice.points.map((p) => p.name)));
                              } else {
                                setSelectedPoints(new Set());
                              }
                            }}
                            className="accent-emerald-500 rounded cursor-pointer"
                          />
                        </th>
                        <th className="px-3 py-2.5 text-left font-semibold">Điểm (M100 Name)</th>
                        <th className="px-3 py-2.5 text-left font-semibold">Tag Nguồn (Auto-Sync)</th>
                        <th className="px-3 py-2.5 text-left font-semibold">Feedback Thực Tế</th>
                        <th className="px-3 py-2.5 text-left font-semibold">Vùng Đệm / Đã Gửi</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80">
                      {activeDevice.points.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                            Chưa có điểm nào. Bấm &ldquo;Chọn Tag từ phần mềm&rdquo; hoặc &ldquo;Thêm điểm&rdquo; để khai báo biến <code className="text-sky-300">DO1, DO2...</code>
                          </td>
                        </tr>
                      ) : (
                        activeDevice.points.map((pt) => {
                          const draftVal = getDraftValue(activeDevice, pt);
                          const isBoolOn =
                            pt.data_type === 'bool' &&
                            ['1', 'true', 'on'].includes(String(draftVal).toLowerCase());
                          const isChanged = pointsValuesDifferClient(
                            draftVal,
                            pt.last_sent_value,
                            pt.data_type,
                            activeDevice.value_as_string,
                            pt.deadband || 0
                          );
                          return (
                            <tr key={pt.name} className="hover:bg-slate-800/40">
                              <td className="px-3 py-2.5 text-center">
                                <input
                                  type="checkbox"
                                  checked={selectedPoints.has(pt.name)}
                                  onChange={(e) => {
                                    setSelectedPoints((prev) => {
                                      const next = new Set(prev);
                                      if (e.target.checked) next.add(pt.name);
                                      else next.delete(pt.name);
                                      return next;
                                    });
                                  }}
                                  className="accent-emerald-500 rounded cursor-pointer"
                                />
                              </td>
                              <td className="px-3 py-2.5">
                                <div className="font-mono font-bold text-slate-100">{pt.name}</div>
                                <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                                  <span>{pt.label}</span>
                                  <span className="px-1 py-0.2 rounded bg-slate-800 text-slate-400 font-mono text-[10px]">
                                    {pt.data_type}
                                  </span>
                                  {Number(pt.deadband) > 0 && (
                                    <span className="px-1 rounded bg-slate-800 text-sky-300 font-mono text-[10px]">
                                      ±{pt.deadband}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-2.5">
                                {pt.source_tag_id ? (
                                  <div className="space-y-0.5">
                                    <div className="text-[11px] font-medium text-sky-300 truncate max-w-[200px]" title={pt.source_tag_label || `Tag #${pt.source_tag_id}`}>
                                      {pt.source_tag_label || `Tag #${pt.source_tag_id}`}
                                    </div>
                                    <div className="flex items-center gap-1.5 font-mono text-[11px]">
                                      <span className="text-slate-100 font-bold">
                                        {pt.source_value !== null && pt.source_value !== undefined
                                          ? String(pt.source_value)
                                          : '—'}
                                      </span>
                                      {pt.source_quality && (
                                        <StatusBadge status={pt.source_quality} size="sm" />
                                      )}
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-slate-500 italic text-[11px]">Thủ công</span>
                                )}
                              </td>
                              <td className="px-3 py-2.5 font-mono">
                                {pt.feedback_tag_id ? (
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-slate-100 font-bold">
                                      {pt.feedback_value !== null && pt.feedback_value !== undefined
                                        ? String(pt.feedback_value)
                                        : '—'}
                                    </span>
                                    {pt.feedback_quality && (
                                      <StatusBadge status={pt.feedback_quality} size="sm" />
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-slate-500 italic text-[11px]">Chưa gắn tag</span>
                                )}
                              </td>
                              <td className="px-3 py-2.5 space-y-1">
                                {pt.data_type === 'bool' ? (
                                  <div className="inline-flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => handleQuickToggleAndPublish(pt, 1)}
                                      className={`px-2.5 py-1 rounded text-[11px] font-bold cursor-pointer border ${
                                        isBoolOn
                                          ? 'bg-emerald-500 text-[#0F172A] border-emerald-400'
                                          : 'bg-[#0F172A] text-slate-300 border-slate-700 hover:border-emerald-500/50'
                                      }`}
                                    >
                                      BẬT (1)
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleQuickToggleAndPublish(pt, 0)}
                                      className={`px-2.5 py-1 rounded text-[11px] font-bold cursor-pointer border ${
                                        !isBoolOn
                                          ? 'bg-slate-600 text-white border-slate-500'
                                          : 'bg-[#0F172A] text-slate-300 border-slate-700 hover:border-slate-500'
                                      }`}
                                    >
                                      TẮT (0)
                                    </button>
                                  </div>
                                ) : (
                                  <input
                                    value={draftVal ?? ''}
                                    onChange={(e) => setDraftValue(activeDevice.id, pt.name, e.target.value)}
                                    className="w-32 bg-[#0F172A] border border-slate-700 rounded-lg px-2.5 py-1 text-slate-100 font-mono block"
                                  />
                                )}
                                <div className="text-[10px] font-mono flex items-center gap-1.5">
                                  <span className="text-slate-500">
                                    Đã gửi:{' '}
                                    {pt.last_sent_value !== null && pt.last_sent_value !== undefined
                                      ? String(pt.last_sent_value)
                                      : 'chưa gửi'}
                                  </span>
                                  <span
                                    className={`px-1 rounded font-sans font-semibold ${
                                      isChanged
                                        ? 'bg-amber-500/15 text-amber-300 border border-amber-500/35'
                                        : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                                    }`}
                                  >
                                    {isChanged ? 'Đã đổi' : 'Chưa đổi'}
                                  </span>
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-right">
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleQuickToggleAndPublish(pt, draftVal)}
                                    disabled={publishMutation.isPending}
                                    className="px-2 py-1 text-[11px] font-semibold bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/40 rounded cursor-pointer inline-flex items-center gap-1"
                                    title={`Publish riêng điểm ${pt.name}`}
                                  >
                                    <Send className="w-3 h-3" />
                                    Gửi
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setPointModalState({ mode: 'edit', point: pt })}
                                    className="p-1 text-slate-400 hover:text-sky-400 cursor-pointer"
                                    title="Sửa điểm"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeletePoint(pt.name)}
                                    className="p-1 text-slate-400 hover:text-red-400 cursor-pointer"
                                    title="Xóa điểm"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Action Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                    <label className="inline-flex items-center gap-1.5 text-slate-200 font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        checked={onlyChanged}
                        onChange={(e) => setOnlyChanged(e.target.checked)}
                        className="accent-emerald-500 rounded cursor-pointer"
                      />
                      <span>Chỉ gửi điểm có thay đổi</span>
                    </label>
                    <span className="text-slate-600">|</span>
                    <span>
                      {selectedPoints.size > 0
                        ? `Đang chọn ${selectedPoints.size} điểm để Publish lô.`
                        : `Gửi ${activeDevice.points.length} điểm của trạm (tự chia lô 5 điểm/gói).`}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSaveDeviceBuffer}
                      disabled={saveBufferMutation.isPending || activeDevice.points.length === 0}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg cursor-pointer disabled:opacity-40"
                    >
                      <Save className="w-3.5 h-3.5" />
                      Lưu vùng đệm
                    </button>

                    {activeDevice.payload_mode === 'rw_prot' && (
                      <button
                        type="button"
                        onClick={() =>
                          queryMutation.mutate({
                            id: activeDevice.id,
                            payload: {
                              point_names:
                                selectedPoints.size > 0 ? Array.from(selectedPoints) : null,
                            },
                          })
                        }
                        disabled={queryMutation.isPending || activeDevice.points.length === 0}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-sky-300 bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/40 rounded-lg cursor-pointer disabled:opacity-40"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Query (r_data)
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={handlePublishBatch}
                      disabled={publishMutation.isPending || activeDevice.points.length === 0}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-[#0F172A] rounded-lg cursor-pointer disabled:opacity-40"
                    >
                      <Send className="w-3.5 h-3.5" />
                      Publish Lô ({selectedPoints.size > 0 ? selectedPoints.size : activeDevice.points.length})
                    </button>
                  </div>
                </div>
              </div>
            )
          ) : (
            /* Quick Adhoc Publish Form */
            <form onSubmit={handleSendAdhoc} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Kết nối MQTT *</label>
                  <select
                    value={effectiveAdhocConnId}
                    onChange={(e) => setAdhocConnId(e.target.value)}
                    className="w-full bg-[#0F172A] border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
                  >
                    {mqttConnections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.connected ? 'Online' : 'Offline'})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Topic Publish Đích *</label>
                  <input
                    required
                    value={adhocTopic}
                    onChange={(e) => setAdhocTopic(e.target.value)}
                    placeholder="VD: BNW/QLM/VAN/DAPCAU/SUB"
                    className="w-full bg-[#0F172A] border border-slate-700 rounded-lg px-3 py-2 text-sky-300 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Định dạng</label>
                  <select
                    value={adhocMode}
                    onChange={(e) => setAdhocMode(e.target.value)}
                    className="w-full bg-[#0F172A] border border-slate-700 rounded-lg px-2.5 py-2 text-slate-100"
                  >
                    <option value="rw_prot">rw_prot</option>
                    <option value="flat_json">flat_json</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Ver</label>
                  <input
                    value={adhocVer}
                    onChange={(e) => setAdhocVer(e.target.value)}
                    className="w-full bg-[#0F172A] border border-slate-700 rounded-lg px-2.5 py-2 text-slate-100 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">QoS</label>
                  <select
                    value={adhocQos}
                    onChange={(e) => setAdhocQos(e.target.value)}
                    className="w-full bg-[#0F172A] border border-slate-700 rounded-lg px-2.5 py-2 text-slate-100"
                  >
                    <option value="0">0</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                  </select>
                </div>
                <div className="flex items-end pb-2">
                  <label className="inline-flex items-center gap-1.5 text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={adhocAsString}
                      onChange={(e) => setAdhocAsString(e.target.checked)}
                      className="accent-emerald-500 rounded"
                    />
                    <span>Value chuỗi</span>
                  </label>
                </div>
                <div className="flex items-end pb-2">
                  <label className="inline-flex items-center gap-1.5 text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={adhocRetain}
                      onChange={(e) => setAdhocRetain(e.target.checked)}
                      className="accent-emerald-500 rounded"
                    />
                    <span>Retain</span>
                  </label>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-200">Danh sách ghi (w_data)</span>
                  <button
                    type="button"
                    onClick={() =>
                      setAdhocWItems((prev) => [
                        ...prev,
                        { name: `DO${prev.length + 1}`, value: '1', data_type: 'bool' },
                      ])
                    }
                    className="text-emerald-400 hover:text-emerald-300 font-semibold cursor-pointer inline-flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Thêm dòng
                  </button>
                </div>

                {adhocWItems.map((it, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_1fr_110px_32px] gap-2 items-center">
                    <input
                      value={it.name}
                      onChange={(e) =>
                        setAdhocWItems((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, name: e.target.value } : row))
                        )
                      }
                      placeholder="Tên biến (vd: DO1)"
                      className="bg-[#0F172A] border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono"
                    />
                    <input
                      value={it.value}
                      onChange={(e) =>
                        setAdhocWItems((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, value: e.target.value } : row))
                        )
                      }
                      placeholder="Giá trị (vd: 1)"
                      className="bg-[#0F172A] border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono"
                    />
                    <select
                      value={it.data_type}
                      onChange={(e) =>
                        setAdhocWItems((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, data_type: e.target.value } : row))
                        )
                      }
                      className="bg-[#0F172A] border border-slate-700 rounded-lg px-2 py-1.5 text-slate-100"
                    >
                      <option value="bool">bool</option>
                      <option value="int">int</option>
                      <option value="float">float</option>
                      <option value="string">string</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => setAdhocWItems((prev) => prev.filter((_, i) => i !== idx))}
                      className="p-1.5 text-slate-400 hover:text-red-400 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              {adhocMode === 'rw_prot' && (
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Danh sách đọc kèm r_data (ngăn cách dấu phẩy, tùy chọn)
                  </label>
                  <input
                    value={adhocRItemsText}
                    onChange={(e) => setAdhocRItemsText(e.target.value)}
                    placeholder="VD: DI1, DI2, AP1"
                    className="w-full bg-[#0F172A] border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono"
                  />
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={adhocMutation.isPending}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-[#0F172A] rounded-lg cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  {adhocMutation.isPending ? 'Đang gửi...' : 'Publish Ngay'}
                </button>
              </div>
            </form>
          )}

          {/* Live JSON Payload Preview */}
          {showPreview && previewPackets.length > 0 && (
            <div className="bg-[#080D1A] border border-slate-800 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-mono text-slate-400">
                  Preview JSON ({previewPackets.length} gói) → Topic:{' '}
                  <span className="text-sky-300">
                    {rightTab === 'adhoc' ? adhocTopic || '—' : activeDevice?.sub_topic || '—'}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={handleCopyPreview}
                  className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 cursor-pointer"
                >
                  <Copy className="w-3 h-3" /> Copy JSON
                </button>
              </div>
              <pre className="text-[11px] font-mono text-amber-300 overflow-x-auto max-h-52">
                {previewPackets.length === 1
                  ? JSON.stringify(previewPackets[0], null, 2)
                  : JSON.stringify(previewPackets, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* Command & ACK History Table */}
      <div className="glass-panel rounded-xl border border-slate-800 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-sm font-bold text-slate-100 flex items-center gap-2">
            <Clock className="w-4 h-4 text-sky-400" />
            Lịch sử Publish &amp; Phản hồi ACK từ USR-M100
          </h2>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => refetchHistory()}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" /> Làm mới
            </button>
            {history.length > 0 && (
              <button
                type="button"
                onClick={() => clearHistMutation.mutate()}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-red-300 bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 rounded-lg cursor-pointer"
              >
                <Trash2 className="w-3 h-3" /> Xóa lịch sử
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto border border-slate-800 rounded-xl">
          <table className="w-full text-xs">
            <thead className="bg-[#0F172A]/80 border-b border-slate-800 text-slate-400">
              <tr>
                <th className="px-3.5 py-2.5 text-left font-semibold">Thời gian</th>
                <th className="px-3.5 py-2.5 text-left font-semibold">Trạm / Nguồn</th>
                <th className="px-3.5 py-2.5 text-left font-semibold">Topic &amp; ID</th>
                <th className="px-3.5 py-2.5 text-left font-semibold">Payload Gửi</th>
                <th className="px-3.5 py-2.5 text-left font-semibold">Trạng thái ACK</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {history.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                    Chưa có lệnh điều khiển nào được gửi trong phiên làm việc hiện tại.
                  </td>
                </tr>
              ) : (
                history.map((h) => (
                  <tr key={h.entry_id} className="hover:bg-slate-800/35 align-top">
                    <td className="px-3.5 py-2.5 font-mono text-slate-300 whitespace-nowrap">
                      {new Date(h.ts * 1000).toLocaleTimeString('vi-VN')}
                    </td>
                    <td className="px-3.5 py-2.5">
                      <div className="font-semibold text-slate-100">{h.device_name}</div>
                      <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-slate-400">
                        {h.trigger}
                      </span>
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-[11px]">
                      <div className="text-sky-300">{h.topic}</div>
                      <div className="text-slate-500">id: {h.msg_id}</div>
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-[11px] text-amber-300 max-w-md break-all">
                      {JSON.stringify(h.payload)}
                    </td>
                    <td className="px-3.5 py-2.5">
                      {!h.publish_ok ? (
                        <span className="inline-flex items-center gap-1 text-red-300 text-[11px]">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          {h.error || 'Publish lỗi'}
                        </span>
                      ) : h.ack_status === 'ok' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 text-[11px]">
                          <CheckCircle2 className="w-3 h-3" /> M100 OK (err: 0)
                        </span>
                      ) : h.ack_status === 'error' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/15 text-red-300 border border-red-500/40 text-[11px]">
                          <AlertTriangle className="w-3 h-3" /> M100 Báo Lỗi
                        </span>
                      ) : h.ack_status === 'pending' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/40 text-[11px]">
                          <Clock className="w-3 h-3" /> Đã gửi · Chờ ACK
                        </span>
                      ) : (
                        <span className="text-emerald-400 text-[11px]">Đã Publish OK</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Device Create/Edit Modal */}
      {showDeviceModal && (
        <DeviceFormModal
          key={editingDevice?.id || 'new'}
          device={editingDevice}
          mqttConnections={mqttConnections}
          allTags={allTags}
          allGroups={allGroups}
          saving={createDevMutation.isPending || updateDevMutation.isPending}
          onClose={() => {
            setShowDeviceModal(false);
            setEditingDevice(null);
          }}
          onSave={(data) => {
            if (editingDevice) updateDevMutation.mutate({ id: editingDevice.id, data });
            else createDevMutation.mutate(data);
          }}
        />
      )}

      {/* Point Add/Edit Modal */}
      {pointModalState && (
        <PointModal
          key={pointModalState.point?.name || 'new-point'}
          point={pointModalState.point}
          allTags={allTags}
          connections={connections}
          onClose={() => setPointModalState(null)}
          onSave={handleSavePoint}
        />
      )}

      {/* Pick Existing Software Tags Modal */}
      {showTagPicker && activeDevice && (
        <TagPickerModal
          existingNames={new Set((activeDevice.points || []).map((p) => p.name))}
          connections={connections}
          allTags={allTags}
          onClose={() => setShowTagPicker(false)}
          onConfirm={handleAddTagsFromPicker}
        />
      )}
    </div>
  );
}
