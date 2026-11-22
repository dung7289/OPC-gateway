import React, { useState } from 'react';
import { 
  Sparkles, 
  X, 
  Search, 
  CheckSquare, 
  Square, 
  Folder, 
  Code, 
  Radio, 
  CheckCircle2
} from 'lucide-react';
import toast from 'react-hot-toast';
import { scanJsonTags, importTagsBatch } from '../api/tags';

export default function AutoTagModal({ 
  connections, 
  defaultConnId, 
  defaultGroup, 
  onClose, 
  onSuccess 
}) {
  // Select initial connection: prefer MQTT connection if available
  const initialConn = 
    connections.find((c) => c.id === defaultConnId) ||
    connections.find((c) => c.protocol === 'mqtt') ||
    connections[0];

  const [connectionId, setConnectionId] = useState(initialConn?.id || '');
  const [topic, setTopic] = useState('');
  const [groupName, setGroupName] = useState(defaultGroup || '');
  const [jsonPayload, setJsonPayload] = useState('');
  const [showJsonInput, setShowJsonInput] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Scan results
  const [candidates, setCandidates] = useState([]);
  const [selectedIndices, setSelectedIndices] = useState(new Set());

  const currentConn = connections.find((c) => c.id === parseInt(connectionId, 10));
  const isMqtt = currentConn?.protocol === 'mqtt';

  // Auto infer group name from topic when typing topic
  const handleTopicChange = (val) => {
    setTopic(val);
    if (!groupName || groupName === 'default') {
      const parts = val.replace(/\\/g, '/').split('/').filter(Boolean);
      if (parts.length > 0) {
        setGroupName(parts[parts.length - 1]);
      }
    }
  };

  // Preset sample JSON
  const handleLoadSampleJson = () => {
    const sample = {
      ACK: true,
      AL: false,
      CUR: 12.5,
      ER: false,
      FON: true,
      FREQ: 50.0,
      LR: false,
      MA: true,
      MO: true,
      POW: 150.2,
      STS: 1,
      TIME: 1234.5,
    };
    setJsonPayload(JSON.stringify(sample, null, 2));
    setShowJsonInput(true);
    if (!topic) setTopic('GIABINH/TRAM2/BOM_1');
    if (!groupName) setGroupName('BOM_1');
  };

  // Trigger scan
  const handleScan = async (useLiveMqtt = false) => {
    if (!connectionId) {
      toast.error('Vui lòng chọn kết nối');
      return;
    }

    if (useLiveMqtt && !topic.trim()) {
      toast.error('Vui lòng nhập MQTT Topic để quét từ Broker');
      return;
    }

    if (!useLiveMqtt && !jsonPayload.trim() && !topic.trim()) {
      toast.error('Vui lòng nhập Topic hoặc dán chuỗi JSON mẫu để quét');
      return;
    }

    setScanning(true);

    try {
      const payload = {
        connection_id: parseInt(connectionId, 10),
        topic: topic.trim(),
        default_group: groupName.trim() || undefined,
        timeout_seconds: 5.0,
        json_payload: useLiveMqtt ? '' : jsonPayload.trim() || undefined,
      };

      const res = await scanJsonTags(payload);
      setCandidates(res.candidates || []);
      // Select all by default
      setSelectedIndices(new Set((res.candidates || []).map((_, i) => i)));
      toast.success(res.message || `Đã tìm thấy ${res.candidates?.length} tag!`);
    } catch (err) {
      const msg = err.response?.data?.detail || err.message || 'Lỗi khi quét dữ liệu';
      toast.error(msg, { duration: 5000 });
    } finally {
      setScanning(false);
    }
  };

  // Toggle selection
  const toggleSelectAll = () => {
    if (selectedIndices.size === candidates.length) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(candidates.map((_, i) => i)));
    }
  };

  const toggleSelectOne = (idx) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  // Update candidate field in place
  const updateCandidate = (idx, field, val) => {
    setCandidates((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [field]: val };
      if (field === 'tag_group' || field === 'name') {
        const g = field === 'tag_group' ? val : copy[idx].tag_group;
        const n = field === 'name' ? val : copy[idx].name;
        copy[idx].scada_name = g && g.toLowerCase() !== 'default' ? `${g}.${n}` : n;
      }
      return copy;
    });
  };

  // Submit and create batch tags
  const handleCreateTags = async () => {
    const selected = candidates.filter((_, idx) => selectedIndices.has(idx));
    if (selected.length === 0) {
      toast.error('Vui lòng chọn ít nhất 1 tag để tạo');
      return;
    }

    setGenerating(true);
    try {
      const tagsToCreate = selected.map((c) => ({
        connection_id: parseInt(connectionId, 10),
        name: c.name.trim(),
        address: c.address.trim(),
        data_type: c.data_type,
        scan_rate_ms: c.scan_rate_ms || 100,
        enabled: true,
        tag_group: c.tag_group.trim() || 'default',
        description: c.description || `Auto-generated from ${c.json_path}`,
      }));

      const res = await importTagsBatch(tagsToCreate);
      toast.success(res.message || `Đã tạo thành công ${res.count} tag!`);
      onSuccess?.(parseInt(connectionId, 10), groupName);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || err.message || 'Lỗi khi tạo tags');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden my-auto border border-gray-100">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-blue-50/70 via-indigo-50/40 to-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 text-base flex items-center gap-2">
                Tự Động Tạo Tag Từ JSON Node
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                  Kepware Style
                </span>
              </h3>
              <p className="text-xs text-gray-500">
                Nhập Topic MQTT để quét gói tin trực tiếp hoặc dán chuỗi JSON để tự động phân rã các node thành Tags
              </p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-1.5 hover:bg-gray-100 text-gray-400 hover:text-gray-600 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          
          {/* Form Settings */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-gray-50/70 p-4 rounded-xl border border-gray-200/80">
            {/* Connection Selector */}
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1">
                Kênh Kết Nối (Channel) *
              </label>
              <select
                value={connectionId}
                onChange={(e) => setConnectionId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs bg-white focus:ring-2 focus:ring-blue-500"
              >
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.protocol.toUpperCase()})
                  </option>
                ))}
              </select>
              <span className="text-[11px] text-gray-400 mt-1 block">
                {isMqtt ? '✓ Giao thức MQTT (Hỗ trợ Live Scan)' : 'Giao thức PLC (Quét từ JSON mẫu)'}
              </span>
            </div>

            {/* MQTT Topic */}
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1">
                MQTT Topic {isMqtt && '*'}
              </label>
              <input
                type="text"
                value={topic}
                onChange={(e) => handleTopicChange(e.target.value)}
                placeholder="ví dụ: GIABINH/TRAM2/BOM_1"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs bg-white focus:ring-2 focus:ring-blue-500 font-mono"
              />
              <span className="text-[11px] text-gray-400 mt-1 block">
                Topic lắng nghe hoặc prefix địa chỉ tag
              </span>
            </div>

            {/* Default Tag Group */}
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1">
                Thư Mục (Tag Group) Mặc Định
              </label>
              <div className="relative">
                <Folder className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-amber-500" />
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="ví dụ: BOM_1, TRAM_2..."
                  className="w-full border border-gray-300 rounded-lg pl-8 pr-3 py-2 text-xs bg-white focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <span className="text-[11px] text-gray-400 mt-1 block">
                Tự động gán các node con vào thư mục này
              </span>
            </div>
          </div>

          {/* Collapsible Manual JSON Input */}
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-gray-50 px-4 py-2.5 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowJsonInput(!showJsonInput)}
                className="text-xs font-semibold text-gray-700 flex items-center gap-2 hover:text-blue-600 transition-colors cursor-pointer"
              >
                <Code className="w-4 h-4 text-gray-500" />
                {showJsonInput ? '▼ Ẩn chuỗi JSON mẫu' : '► Dán chuỗi JSON mẫu (Tùy chọn - Dùng khi Broker offline)'}
              </button>

              <button
                type="button"
                onClick={handleLoadSampleJson}
                className="text-[11px] font-medium text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
              >
                + Điền JSON mẫu thử nghiệm (BOM_1)
              </button>
            </div>

            {showJsonInput && (
              <div className="p-4 bg-white border-t border-gray-200 space-y-2">
                <textarea
                  value={jsonPayload}
                  onChange={(e) => setJsonPayload(e.target.value)}
                  rows={6}
                  placeholder={`{\n  "ACK": true,\n  "CUR": 12.5,\n  "FREQ": 50.0,\n  "STS": 1\n}`}
                  className="w-full border border-gray-300 rounded-lg p-3 text-xs font-mono bg-gray-900 text-green-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-[11px] text-gray-500 block">
                  Hệ thống hỗ trợ cả JSON dạng phẳng hoặc lồng nhau nhiều cấp (Nested objects / Arrays).
                </span>
              </div>
            )}
          </div>

          {/* Scan Action Buttons */}
          <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
            {isMqtt && (
              <button
                type="button"
                disabled={scanning}
                onClick={() => handleScan(true)}
                className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              >
                <Radio className={`w-4 h-4 ${scanning ? 'animate-pulse text-purple-600' : 'text-purple-600'}`} />
                {scanning ? 'Đang chờ gói tin từ Broker...' : '📡 Quét Trực Tiếp Từ Broker MQTT'}
              </button>
            )}

            <button
              type="button"
              disabled={scanning}
              onClick={() => handleScan(false)}
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm cursor-pointer disabled:opacity-50"
            >
              <Search className="w-4 h-4" />
              {scanning ? 'Đang phân tích JSON...' : '🔍 Phân Tích JSON & Quét Node'}
            </button>
          </div>

          {/* Results Candidate Table */}
          {candidates.length > 0 && (
            <div className="space-y-3 pt-3 border-t border-gray-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <span className="text-xs font-bold text-gray-800">
                    Kết quả quét: {candidates.length} tags tìm thấy
                  </span>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
                    Đã chọn {selectedIndices.size} / {candidates.length}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium cursor-pointer"
                >
                  {selectedIndices.size === candidates.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                </button>
              </div>

              {/* Table */}
              <div className="border border-gray-200 rounded-xl overflow-x-auto max-h-72">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold sticky top-0 z-10">
                    <tr>
                      <th className="py-2.5 px-3 w-10 text-center">
                        <button type="button" onClick={toggleSelectAll} className="cursor-pointer">
                          {selectedIndices.size === candidates.length ? (
                            <CheckSquare className="w-4 h-4 text-blue-600" />
                          ) : (
                            <Square className="w-4 h-4 text-gray-400" />
                          )}
                        </button>
                      </th>
                      <th className="py-2.5 px-3">Tên Tag</th>
                      <th className="py-2.5 px-3">Thư Mục (Group)</th>
                      <th className="py-2.5 px-3">Tên SCADA / OPC-UA</th>
                      <th className="py-2.5 px-3">Kiểu Dữ Liệu</th>
                      <th className="py-2.5 px-3">Địa Chỉ Đọc (Address)</th>
                      <th className="py-2.5 px-3">Giá Trị Mẫu</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {candidates.map((c, idx) => {
                      const isSelected = selectedIndices.has(idx);
                      return (
                        <tr 
                          key={idx} 
                          className={`hover:bg-blue-50/40 transition-colors ${
                            isSelected ? 'bg-white' : 'bg-gray-50/60 opacity-60'
                          }`}
                        >
                          <td className="py-2 px-3 text-center">
                            <button
                              type="button"
                              onClick={() => toggleSelectOne(idx)}
                              className="cursor-pointer"
                            >
                              {isSelected ? (
                                <CheckSquare className="w-4 h-4 text-blue-600" />
                              ) : (
                                <Square className="w-4 h-4 text-gray-400" />
                              )}
                            </button>
                          </td>
                          <td className="py-2 px-3 font-semibold text-gray-900">
                            <input
                              type="text"
                              value={c.name}
                              onChange={(e) => updateCandidate(idx, 'name', e.target.value)}
                              className="w-24 border border-gray-200 rounded px-1.5 py-1 text-xs focus:ring-1 focus:ring-blue-500"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="text"
                              value={c.tag_group}
                              onChange={(e) => updateCandidate(idx, 'tag_group', e.target.value)}
                              className="w-24 border border-gray-200 rounded px-1.5 py-1 text-xs focus:ring-1 focus:ring-blue-500 font-medium text-amber-700"
                            />
                          </td>
                          <td className="py-2 px-3 font-mono text-[11px] text-blue-600 font-semibold">
                            {c.scada_name}
                          </td>
                          <td className="py-2 px-3">
                            <select
                              value={c.data_type}
                              onChange={(e) => updateCandidate(idx, 'data_type', e.target.value)}
                              className="border border-gray-200 rounded px-1.5 py-1 text-xs focus:ring-1 focus:ring-blue-500 bg-white"
                            >
                              <option value="bool">bool</option>
                              <option value="int16">int16</option>
                              <option value="uint16">uint16</option>
                              <option value="int32">int32 (ABCD)</option>
                              <option value="int32_swap">int32_swap (CDAB)</option>
                              <option value="float32">float32 (ABCD)</option>
                              <option value="float32_swap">float32_swap (CDAB) ★</option>
                              <option value="float32_be">float32_be (BADC)</option>
                              <option value="float32_le">float32_le (DCBA)</option>
                              <option value="string">string</option>
                            </select>
                          </td>
                          <td className="py-2 px-3 font-mono text-[11px] text-gray-600 truncate max-w-xs" title={c.address}>
                            {c.address}
                          </td>
                          <td className="py-2 px-3 font-mono text-[11px] text-green-700 font-medium">
                            {c.sample_value !== '' ? String(c.sample_value) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
          <div className="text-xs text-gray-500">
            {candidates.length > 0 ? (
              <span>
                Sẵn sàng tạo <strong>{selectedIndices.size}</strong> tags vào Connection #{connectionId}
              </span>
            ) : (
              <span>Nhập topic hoặc dán JSON và ấn "Phân Tích" để bắt đầu</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-gray-700 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg transition-colors cursor-pointer"
            >
              Hủy
            </button>

            <button
              type="button"
              disabled={generating || candidates.length === 0 || selectedIndices.size === 0}
              onClick={handleCreateTags}
              className="flex items-center gap-2 px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-all shadow-sm hover:shadow-md cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CheckCircle2 className="w-4 h-4" />
              {generating ? 'Đang tạo tags...' : `✓ Tạo ${selectedIndices.size} Tags Tự Động`}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
