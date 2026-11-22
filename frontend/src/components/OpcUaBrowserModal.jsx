import React, { useState, useEffect, useCallback } from 'react';
import { 
  X, Folder, ArrowUp, CheckSquare, Square, 
  Trash2, RefreshCw, Plus, Search, Sparkles, Network, Check
} from 'lucide-react';
import { browseOpcUa, scanOpcUaTags } from '../api/connections';
import { importTagsBatch } from '../api/tags';
import toast from 'react-hot-toast';

export default function OpcUaBrowserModal({ connections = [], initialConnectionId = null, targetParentGroup = '', onClose, onSuccess }) {
  // Filter for OPC UA connections
  const opcUaConnections = connections.filter((c) => c.protocol === 'opcua');

  const [selectedConnId, setSelectedConnId] = useState(
    initialConnectionId || (opcUaConnections[0]?.id ? String(opcUaConnections[0].id) : '')
  );

  // Thư mục cha đích (nếu mở từ thư mục trong Gateway hoặc người dùng chỉ định)
  const [customParentGroup, setCustomParentGroup] = useState(targetParentGroup || '');

  // Navigation state: history of [{ name, node_id }]
  const [navHistory, setNavHistory] = useState([{ name: 'Objects', node_id: 'i=85' }]);
  const currentNode = navHistory[navHistory.length - 1] || { name: 'Objects', node_id: 'i=85' };

  const [branches, setBranches] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [leafFilter, setLeafFilter] = useState('');
  const [loadingBrowse, setLoadingBrowse] = useState(false);

  // Selected leaves in left pane
  const [selectedLeafIds, setSelectedLeafIds] = useState(new Set());

  // Right pane: Candidates to import
  // item: { name, item_id, group, data_type, scan_rate_ms }
  const [importCandidates, setImportCandidates] = useState([]);
  const [globalScanRate, setGlobalScanRate] = useState(100);
  const [loadingScanAll, setLoadingScanAll] = useState(false);
  const [importing, setImporting] = useState(false);

  const loadBrowse = useCallback(async (nodeId, resetHistory = false) => {
    if (!selectedConnId) return;
    setLoadingBrowse(true);
    try {
      const res = await browseOpcUa(selectedConnId, nodeId || 'i=85');
      if (resetHistory) {
        setNavHistory([{ name: 'Objects', node_id: 'i=85' }]);
      }
      setBranches(res.branches || []);
      setLeaves(res.leaves || []);
      setSelectedLeafIds(new Set());
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Không thể duyệt cây OPC-UA. Hãy kiểm tra kết nối.');
    } finally {
      setLoadingBrowse(false);
    }
  }, [selectedConnId]);

  // Load root when connection changes
  useEffect(() => {
    if (selectedConnId) {
      queueMicrotask(() => {
        loadBrowse('i=85', true);
      });
    }
  }, [selectedConnId, loadBrowse]);

  const handleEnterBranch = (branch) => {
    setNavHistory((prev) => [...prev, { name: branch.name, node_id: branch.node_id }]);
    loadBrowse(branch.node_id);
  };

  const handleGoUp = () => {
    if (navHistory.length <= 1) return;
    const nextHistory = navHistory.slice(0, navHistory.length - 1);
    setNavHistory(nextHistory);
    const target = nextHistory[nextHistory.length - 1];
    loadBrowse(target.node_id);
  };

  const handleGoHistoryIndex = (index) => {
    const nextHistory = navHistory.slice(0, index + 1);
    setNavHistory(nextHistory);
    const target = nextHistory[nextHistory.length - 1];
    loadBrowse(target.node_id);
  };

  // Toggle selection for a leaf
  const toggleLeaf = (nodeId) => {
    setSelectedLeafIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const selectAllLeaves = () => {
    if (selectedLeafIds.size === filteredLeaves.length) {
      setSelectedLeafIds(new Set());
    } else {
      setSelectedLeafIds(new Set(filteredLeaves.map((l) => l.node_id)));
    }
  };

  const getLeafGroup = () => {
    return (customParentGroup || '').trim();
  };

  // Add selected leaves to right pane
  const handleAddSelectedLeaves = () => {
    if (selectedLeafIds.size === 0) {
      toast.error('Vui lòng tích chọn ít nhất 1 biến');
      return;
    }
    const targetGrp = getLeafGroup();
    const toAdd = leaves
      .filter((l) => selectedLeafIds.has(l.node_id))
      .map((l) => ({
        name: l.name,
        item_id: l.node_id,
        group: targetGrp,
        data_type: l.data_type || 'float32',
        scan_rate_ms: globalScanRate,
      }));

    mergeCandidates(toAdd);
    setSelectedLeafIds(new Set());
    toast.success(`Đã thêm ${toAdd.length} tag vào danh sách chuẩn bị nhập`);
  };

  // Add all leaves in current branch
  const handleAddAllInBranch = () => {
    if (leaves.length === 0) {
      toast.error('Thư mục hiện tại không có biến nào');
      return;
    }
    const targetGrp = getLeafGroup();
    const toAdd = leaves.map((l) => ({
      name: l.name,
      item_id: l.node_id,
      group: targetGrp,
      data_type: l.data_type || 'float32',
      scan_rate_ms: globalScanRate,
    }));
    mergeCandidates(toAdd);
    toast.success(`Đã thêm ${toAdd.length} tag vào danh sách chuẩn bị nhập`);
  };

  // Scan and add all tags inside a specific branch into the selected target folder only
  const handleAddBranch = async (branch, e) => {
    if (e) e.stopPropagation();
    if (!selectedConnId) return;
    const targetGrp = getLeafGroup();
    try {
      toast.loading(`Đang quét biến trong mục '${branch.name}'...`, { id: `scan-branch-${branch.node_id}` });
      const res = await scanOpcUaTags(selectedConnId, branch.node_id, 500);
      toast.dismiss(`scan-branch-${branch.node_id}`);
      if (res.tags && res.tags.length > 0) {
        const mapped = res.tags.map((t) => ({
          ...t,
          group: targetGrp,
          scan_rate_ms: globalScanRate,
        }));
        mergeCandidates(mapped);
        toast.success(`Đã thêm ${mapped.length} tag vào thư mục '${targetGrp || 'Gốc'}'!`);
      } else {
        toast.info(`Không tìm thấy biến nào trong mục '${branch.name}'`);
      }
    } catch (err) {
      toast.dismiss(`scan-branch-${branch.node_id}`);
      toast.error(`Lỗi khi quét mục '${branch.name}': ` + (err.response?.data?.detail || err.message));
    }
  };

  // Scan all tags in the OPC UA server into the selected target folder only
  const handleScanAll = async () => {
    if (!selectedConnId) return;
    setLoadingScanAll(true);
    const targetGrp = getLeafGroup();
    try {
      toast.loading('Đang tự động quét toàn bộ cây OPC-UA...', { id: 'scan-opcua' });
      const res = await scanOpcUaTags(selectedConnId, currentNode.node_id, 500);
      toast.dismiss('scan-opcua');
      if (res.tags && res.tags.length > 0) {
        const mapped = res.tags.map((t) => ({
          ...t,
          group: targetGrp,
          scan_rate_ms: globalScanRate,
        }));
        mergeCandidates(mapped);
        toast.success(`Đã tìm thấy và thêm ${res.tags.length} tag vào thư mục '${targetGrp || 'Gốc'}'!`);
      } else {
        toast.info('Không tìm thấy tag nào trong nhánh này.');
      }
    } catch (err) {
      toast.dismiss('scan-opcua');
      toast.error(err.response?.data?.detail || 'Lỗi khi quét toàn bộ tag');
    } finally {
      setLoadingScanAll(false);
    }
  };

  const mergeCandidates = (newItems) => {
    setImportCandidates((prev) => {
      const existingIds = new Set(prev.map((c) => c.item_id));
      const filtered = newItems.filter((item) => !existingIds.has(item.item_id));
      return [...prev, ...filtered];
    });
  };

  const removeCandidate = (idx) => {
    setImportCandidates((prev) => prev.filter((_, i) => i !== idx));
  };

  const clearAllCandidates = () => {
    setImportCandidates([]);
  };

  const updateCandidate = (idx, field, value) => {
    setImportCandidates((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  // Execute import
  const handleImport = async () => {
    if (importCandidates.length === 0) {
      toast.error('Danh sách tag đang trống');
      return;
    }
    if (!selectedConnId) {
      toast.error('Vui lòng chọn Connection');
      return;
    }

    setImporting(true);
    try {
      const payload = importCandidates.map((c) => {
        const finalGroup = c.group ? c.group.trim() : (customParentGroup || '').trim();
        return {
          connection_id: parseInt(selectedConnId, 10),
          name: c.name.trim(),
          tag_group: finalGroup,
          group_name: finalGroup,
          address: c.item_id.trim(),
          data_type: c.data_type || 'float32',
          scan_rate_ms: parseInt(c.scan_rate_ms, 10) || globalScanRate || 100,
          enabled: true,
        };
      });

      const res = await importTagsBatch(payload);
      const createdCount = res?.created?.length ?? importCandidates.length;
      toast.success(`Đã tạo thành công ${createdCount} tag vào hệ thống!`);
      onSuccess?.();
      onClose();
    } catch (err) {
      const msg = err.response?.data?.detail 
        ? (typeof err.response.data.detail === 'string' ? err.response.data.detail : JSON.stringify(err.response.data.detail))
        : err.message || 'Lỗi khi import tags';
      toast.error(msg);
    } finally {
      setImporting(false);
    }
  };

  // Filter leaves
  const filteredLeaves = leaves.filter((l) => {
    if (!leafFilter.trim() || leafFilter.trim() === '*') return true;
    return l.name.toLowerCase().includes(leafFilter.trim().toLowerCase()) ||
           l.node_id.toLowerCase().includes(leafFilter.trim().toLowerCase());
  });

  const selectedConn = opcUaConnections.find((c) => String(c.id) === String(selectedConnId));

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl h-[88vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-gray-200 bg-gray-50/80">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 text-indigo-700 rounded-lg">
              <Network className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                Duyệt & Nhập Tag OPC-UA
                <span className="text-xs font-normal px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full">
                  Node Tree Browser
                </span>
              </h2>
              <p className="text-xs text-gray-500">
                Duyệt cây NodeId của OPC-UA Server và nhập hàng loạt vào Gateway
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-200 rounded-lg transition-colors cursor-pointer">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Toolbar: Select Connection */}
        <div className="px-6 py-2.5 bg-white border-b border-gray-100 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-600 font-medium">OPC-UA Connection:</span>
            <select
              value={selectedConnId}
              onChange={(e) => setSelectedConnId(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white font-medium text-gray-800 focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              {opcUaConnections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.config?.endpoint_url || c.host || 'opc.tcp'})
                </option>
              ))}
            </select>
            {selectedConn && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${selectedConn.connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                {selectedConn.connected ? '● Đang kết nối' : '○ Chưa kết nối'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleScanAll}
              disabled={loadingScanAll || !selectedConnId}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 cursor-pointer shadow-sm"
              title="Tự động duyệt tất cả các Objects và gom tất cả Variables"
            >
              <Sparkles className={`w-3.5 h-3.5 ${loadingScanAll ? 'animate-spin' : ''}`} />
              {loadingScanAll ? 'Đang quét...' : 'Quét toàn bộ OPC-UA Server'}
            </button>
            <button
              onClick={() => loadBrowse(currentNode.node_id)}
              disabled={loadingBrowse}
              className="p-1.5 text-gray-600 hover:bg-gray-100 rounded-lg border border-gray-200 cursor-pointer"
              title="Làm mới"
            >
              <RefreshCw className={`w-4 h-4 ${loadingBrowse ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Main Split Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Pane: Browsing Address Space */}
          <div className="w-1/2 border-r border-gray-200 flex flex-col bg-gray-50/30">
            {/* Breadcrumb Path Bar */}
            <div className="px-4 py-2 border-b border-gray-200 bg-white flex items-center justify-between text-xs">
              <div className="flex items-center gap-1 text-gray-700 truncate font-mono">
                {navHistory.map((item, idx) => (
                  <React.Fragment key={item.node_id + idx}>
                    {idx > 0 && <span className="text-gray-400">/</span>}
                    <button
                      onClick={() => handleGoHistoryIndex(idx)}
                      className={`hover:text-indigo-600 hover:underline cursor-pointer ${
                        idx === navHistory.length - 1 ? 'font-bold text-gray-900' : 'font-medium text-gray-600'
                      }`}
                      title={item.node_id}
                    >
                      {item.name}
                    </button>
                  </React.Fragment>
                ))}
              </div>
              <div className="flex items-center gap-1">
                {navHistory.length > 1 && (
                  <button
                    onClick={handleGoUp}
                    className="flex items-center gap-1 px-2 py-1 text-gray-600 hover:bg-gray-100 rounded border border-gray-200 cursor-pointer text-[11px]"
                    title="Lên một cấp"
                  >
                    <ArrowUp className="w-3 h-3" /> Lên cấp
                  </button>
                )}
              </div>
            </div>

            {/* Filter Input */}
            <div className="px-4 py-2 border-b border-gray-200 bg-white flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-gray-400" />
              <input
                type="text"
                placeholder="Lọc biến theo tên hoặc NodeId (*)..."
                value={leafFilter}
                onChange={(e) => setLeafFilter(e.target.value)}
                className="w-full text-xs outline-none bg-transparent text-gray-700"
              />
              {leafFilter && (
                <button onClick={() => setLeafFilter('')} className="text-gray-400 hover:text-gray-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Content: Folders & Leaves */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {loadingBrowse ? (
                <div className="flex flex-col items-center justify-center h-48 text-gray-400 text-xs">
                  <RefreshCw className="w-6 h-6 animate-spin mb-2 text-indigo-500" />
                  Đang đọc cây NodeId...
                </div>
              ) : (
                <>
                  {/* Sub-Branches (Objects / Folders) */}
                  {branches.length > 0 && (
                    <div>
                      <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                        <Folder className="w-3.5 h-3.5 text-amber-500" /> Đối tượng / Thư mục con ({branches.length})
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {branches.map((b) => (
                          <div
                            key={b.node_id}
                            className="flex items-center justify-between gap-1 px-3 py-2 text-xs bg-white border border-gray-200 hover:border-indigo-400 hover:bg-indigo-50/40 rounded-lg transition-all group shadow-xs"
                          >
                            <button
                              type="button"
                              onClick={() => handleEnterBranch(b)}
                              className="flex items-center gap-2 text-left truncate flex-1 min-w-0 cursor-pointer"
                              title={`Mở xem thư mục ${b.name}`}
                            >
                              <Folder className="w-4 h-4 text-amber-500 group-hover:text-indigo-600 shrink-0" />
                              <div className="truncate">
                                <div className="truncate font-semibold text-gray-800 group-hover:text-indigo-700">
                                  {b.name}
                                </div>
                                <div className="truncate font-mono text-[10px] text-gray-400">
                                  {b.node_id}
                                </div>
                              </div>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleAddBranch(b, e)}
                              className="shrink-0 px-2 py-1 text-[11px] font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-600 hover:text-white rounded border border-indigo-200 transition-colors cursor-pointer"
                              title={`Tạo thư mục '${b.name}' và lấy toàn bộ tag trong mục này`}
                            >
                              + Thêm mục
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Leaves (Variables / Tags) */}
                  <div>
                    <div className="flex items-center justify-between text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                      <span className="flex items-center gap-1">
                        <Network className="w-3.5 h-3.5 text-indigo-500" /> Biến trong mục này ({filteredLeaves.length})
                      </span>
                      {filteredLeaves.length > 0 && (
                        <button
                          onClick={selectAllLeaves}
                          className="text-indigo-600 hover:underline normal-case font-normal text-xs cursor-pointer"
                        >
                          {selectedLeafIds.size === filteredLeaves.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                        </button>
                      )}
                    </div>

                    {filteredLeaves.length === 0 ? (
                      <div className="text-center py-8 text-xs text-gray-400 bg-white rounded-lg border border-dashed border-gray-200">
                        {branches.length > 0 
                          ? 'Mục này chỉ chứa các đối tượng con. Hãy bấm vào một đối tượng ở trên để xem biến.' 
                          : 'Không có biến nào tại đây.'}
                      </div>
                    ) : (
                      <div className="space-y-1 bg-white border border-gray-200 rounded-lg p-2 max-h-72 overflow-y-auto">
                        {filteredLeaves.map((l) => {
                          const isChecked = selectedLeafIds.has(l.node_id);
                          return (
                            <div
                              key={l.node_id}
                              onClick={() => toggleLeaf(l.node_id)}
                              className={`flex items-center justify-between p-2 rounded text-xs cursor-pointer transition-colors ${
                                isChecked ? 'bg-indigo-50 border border-indigo-200' : 'hover:bg-gray-50 border border-transparent'
                              }`}
                            >
                              <div className="flex items-center gap-2 truncate pr-2">
                                <button type="button" className="text-gray-400 hover:text-indigo-600 shrink-0">
                                  {isChecked ? (
                                    <CheckSquare className="w-4 h-4 text-indigo-600" />
                                  ) : (
                                    <Square className="w-4 h-4 text-gray-300" />
                                  )}
                                </button>
                                <div className="truncate">
                                  <div className="font-medium text-gray-900 truncate">{l.name}</div>
                                  <div className="font-mono text-[10px] text-gray-400 truncate">{l.node_id}</div>
                                </div>
                              </div>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 shrink-0 font-mono">
                                {l.data_type || 'float32'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Left Footer Action Buttons */}
            <div className="p-3 border-t border-gray-200 bg-white flex items-center gap-2 justify-between">
              <span className="text-xs text-gray-500">
                Đang chọn: <strong>{selectedLeafIds.size}</strong> biến
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleAddSelectedLeaves}
                  disabled={selectedLeafIds.size === 0}
                  className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-40 cursor-pointer flex items-center gap-1 shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5" /> Thêm biến đã chọn &gt;&gt;
                </button>
                <button
                  type="button"
                  onClick={handleAddAllInBranch}
                  disabled={leaves.length === 0}
                  className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-40 cursor-pointer"
                >
                  Thêm tất cả trong mục &gt;&gt;
                </button>
              </div>
            </div>
          </div>

          {/* Right Pane: Import Candidates */}
          <div className="w-1/2 flex flex-col bg-white">
            <div className="px-5 py-3 border-b border-gray-200 flex flex-wrap items-center justify-between gap-2 bg-gray-50/50">
              <div>
                <h3 className="text-sm font-semibold text-gray-800">
                  Danh sách Tag chuẩn bị nhập ({importCandidates.length})
                </h3>
                <p className="text-[11px] text-gray-500">
                  Có thể sửa Tên, Thư mục, Kiểu dữ liệu hoặc Chu kỳ quét trước khi lưu
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* Gán Thư mục cha cho tất cả */}
                <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-2 py-1 shadow-2xs">
                  <span className="text-[11px] text-gray-600 font-medium whitespace-nowrap">Thư mục:</span>
                  <input
                    type="text"
                    value={customParentGroup}
                    onChange={(e) => setCustomParentGroup(e.target.value)}
                    placeholder="đường dẫn thư mục..."
                    className="w-28 px-1.5 py-0.5 text-xs text-indigo-700 border border-gray-200 rounded outline-none focus:ring-1 focus:ring-indigo-500 font-semibold"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const targetGrp = customParentGroup.trim();
                      setImportCandidates((prev) => prev.map((c) => ({ ...c, group: targetGrp })));
                      toast.success(`Đã gán toàn bộ tag vào thư mục '${targetGrp || 'Gốc'}'`);
                    }}
                    className="px-2 py-0.5 text-[11px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded border border-indigo-200 cursor-pointer whitespace-nowrap"
                    title="Gán trực tiếp toàn bộ tag trong danh sách vào đúng thư mục này"
                  >
                    Gán tất cả
                  </button>
                </div>

                {/* Chu kỳ quét */}
                <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-2 py-1 shadow-2xs">
                  <span className="text-[11px] text-gray-600 font-medium whitespace-nowrap">Chu kỳ:</span>
                  <input
                    type="number"
                    min="50"
                    step="50"
                    value={globalScanRate}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10) || 100;
                      setGlobalScanRate(v);
                    }}
                    className="w-16 px-1.5 py-0.5 text-xs font-mono font-bold text-indigo-700 border border-gray-200 rounded text-center outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <span className="text-[11px] text-gray-500">ms</span>
                  <button
                    type="button"
                    onClick={() => {
                      setImportCandidates(prev => prev.map(c => ({ ...c, scan_rate_ms: globalScanRate })));
                      toast.success(`Đã đặt chu kỳ ${globalScanRate}ms cho tất cả tag`);
                    }}
                    className="px-2 py-0.5 text-[11px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded border border-indigo-200 cursor-pointer whitespace-nowrap"
                    title="Đặt chu kỳ quét này cho toàn bộ danh sách bên dưới"
                  >
                    Áp dụng
                  </button>
                </div>
                {importCandidates.length > 0 && (
                  <button
                    onClick={clearAllCandidates}
                    className="text-xs text-red-600 hover:text-red-700 hover:underline cursor-pointer flex items-center gap-1 ml-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Xóa tất cả
                  </button>
                )}
              </div>
            </div>

            {/* Candidates Table */}
            <div className="flex-1 overflow-y-auto p-4">
              {importCandidates.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-center text-gray-400 text-xs">
                  <Network className="w-10 h-10 text-gray-300 mb-2" />
                  <p className="font-medium text-gray-600">Chưa có biến nào được chọn</p>
                  <p className="text-gray-400 mt-1 max-w-xs">
                    Hãy duyệt cây NodeId bên trái, tích chọn các biến cần nhập và bấm <strong>"Thêm biến đã chọn"</strong> hoặc bấm <strong>"Quét toàn bộ OPC-UA Server"</strong>.
                  </p>
                </div>
              ) : (
                <div className="border border-gray-200 rounded-lg overflow-hidden shadow-xs">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold text-[11px]">
                      <tr>
                        <th className="py-2 px-3">TÊN TAG</th>
                        <th className="py-2 px-3">THƯ MỤC</th>
                        <th className="py-2 px-3">KIỂU DỮ LIỆU</th>
                        <th className="py-2 px-2 text-center w-20">CHU KỲ (MS)</th>
                        <th className="py-2 px-3">NODE ID (ADDRESS)</th>
                        <th className="py-2 px-2 text-center w-8"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {importCandidates.map((c, idx) => (
                        <tr key={c.item_id + idx} className="hover:bg-indigo-50/30">
                          <td className="py-1.5 px-3">
                            <input
                              type="text"
                              value={c.name}
                              onChange={(e) => updateCandidate(idx, 'name', e.target.value)}
                              className="border border-gray-200 rounded px-1.5 py-1 text-xs font-medium w-full text-gray-900 focus:ring-1 focus:ring-indigo-500 outline-none"
                            />
                          </td>
                          <td className="py-1.5 px-3">
                            <input
                              type="text"
                              value={c.group}
                              onChange={(e) => updateCandidate(idx, 'group', e.target.value)}
                              className="border border-gray-200 rounded px-1.5 py-1 text-xs text-amber-700 bg-amber-50/50 w-full focus:ring-1 focus:ring-indigo-500 outline-none"
                            />
                          </td>
                          <td className="py-1.5 px-3">
                            <select
                              value={c.data_type}
                              onChange={(e) => updateCandidate(idx, 'data_type', e.target.value)}
                              className="border border-gray-200 rounded px-1.5 py-1 text-xs bg-white focus:ring-1 focus:ring-indigo-500 outline-none"
                            >
                              <option value="float32">float32</option>
                              <option value="float64">float64</option>
                              <option value="bool">bool</option>
                              <option value="int16">int16</option>
                              <option value="int32">int32</option>
                              <option value="string">string</option>
                            </select>
                          </td>
                          <td className="py-1.5 px-2 text-center w-20">
                            <input
                              type="number"
                              min="50"
                              step="50"
                              value={c.scan_rate_ms || globalScanRate || 100}
                              onChange={(e) => updateCandidate(idx, 'scan_rate_ms', parseInt(e.target.value, 10) || 100)}
                              className="border border-gray-200 rounded px-1 py-1 text-xs font-mono font-medium text-center w-16 text-indigo-700 focus:ring-1 focus:ring-indigo-500 outline-none"
                            />
                          </td>
                          <td className="py-1.5 px-3 font-mono text-[10px] text-gray-500 truncate max-w-xs" title={c.item_id}>
                            {c.item_id}
                          </td>
                          <td className="py-1.5 px-2 text-center">
                            <button
                              type="button"
                              onClick={() => removeCandidate(idx)}
                              className="text-gray-400 hover:text-red-600 p-1 rounded"
                              title="Bỏ tag này"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Right Footer: Import Confirm Button */}
            <div className="p-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
              <span className="text-xs text-gray-600">
                Tổng cộng: <strong className="text-indigo-700 text-sm">{importCandidates.length}</strong> tag sẽ được thêm vào
              </span>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={importing || importCandidates.length === 0}
                  className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1.5 shadow-sm"
                >
                  <Check className="w-4 h-4" />
                  {importing ? 'Đang tạo tags...' : `Import ${importCandidates.length} Tags vào Gateway`}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
