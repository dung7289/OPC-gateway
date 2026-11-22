import React, { useState, useEffect, useCallback } from 'react';
import { 
  X, Folder, ArrowUp, CheckSquare, Square, 
  Trash2, RefreshCw, Plus, Search, Sparkles, Database, Check
} from 'lucide-react';
import { browseOpcDa, scanOpcDaTags } from '../api/connections';
import { importTagsBatch } from '../api/tags';
import toast from 'react-hot-toast';

export default function OpcDaBrowserModal({ connections = [], initialConnectionId = null, targetParentGroup = '', onClose, onSuccess }) {
  // Filter for OPC DA connections
  const opcDaConnections = connections.filter((c) => c.protocol === 'opc_da');

  const [selectedConnId, setSelectedConnId] = useState(
    initialConnectionId || (opcDaConnections[0]?.id ? String(opcDaConnections[0].id) : '')
  );

  // Thư mục cha đích (nếu mở từ thư mục trong Gateway hoặc người dùng chỉ định)
  const [customParentGroup, setCustomParentGroup] = useState(targetParentGroup || '');

  // Navigation state
  const [currentPath, setCurrentPath] = useState(''); // e.g. "plc/Main"
  const [branches, setBranches] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [leafFilter, setLeafFilter] = useState('');
  const [loadingBrowse, setLoadingBrowse] = useState(false);

  // Selected leaves in left pane
  const [selectedLeafNames, setSelectedLeafNames] = useState(new Set());

  // Right pane: Candidates to import
  // item: { name, item_id, group, data_type, scan_rate_ms }
  const [importCandidates, setImportCandidates] = useState([]);
  const [globalScanRate, setGlobalScanRate] = useState(100);
  const [loadingScanAll, setLoadingScanAll] = useState(false);
  const [importing, setImporting] = useState(false);

  const loadBrowse = useCallback(async (path) => {
    if (!selectedConnId) return;
    setLoadingBrowse(true);
    try {
      const res = await browseOpcDa(selectedConnId, path);
      setCurrentPath(res.path || '');
      setBranches(res.branches || []);
      setLeaves(res.leaves || []);
      setSelectedLeafNames(new Set());
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Không thể duyệt cây OPC DA. Hãy kiểm tra kết nối.');
    } finally {
      setLoadingBrowse(false);
    }
  }, [selectedConnId]);

  // Load root when connection changes
  useEffect(() => {
    if (selectedConnId) {
      queueMicrotask(() => {
        loadBrowse('');
      });
    }
  }, [selectedConnId, loadBrowse]);

  const handleEnterBranch = (branchName) => {
    const newPath = currentPath ? `${currentPath}/${branchName}` : branchName;
    loadBrowse(newPath);
  };

  const handleGoUp = () => {
    if (!currentPath) return;
    const parts = currentPath.split('/');
    parts.pop();
    loadBrowse(parts.join('/'));
  };

  const handleGoRoot = () => {
    loadBrowse('');
  };

  // Toggle selection for a leaf
  const toggleLeaf = (name) => {
    setSelectedLeafNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const selectAllLeaves = () => {
    if (selectedLeafNames.size === filteredLeaves.length) {
      setSelectedLeafNames(new Set());
    } else {
      setSelectedLeafNames(new Set(filteredLeaves.map((l) => l.name)));
    }
  };

  const getLeafGroup = () => {
    return (customParentGroup || '').trim();
  };

  // Add selected leaves to right pane
  const handleAddSelectedLeaves = () => {
    if (selectedLeafNames.size === 0) {
      toast.error('Vui lòng tích chọn ít nhất 1 tag');
      return;
    }
    const targetGrp = getLeafGroup();
    const toAdd = leaves
      .filter((l) => selectedLeafNames.has(l.name))
      .map((l) => ({
        name: l.name,
        item_id: l.item_id,
        group: targetGrp,
        data_type: l.data_type || 'float32',
        scan_rate_ms: globalScanRate,
      }));

    mergeCandidates(toAdd);
    setSelectedLeafNames(new Set());
    toast.success(`Đã thêm ${toAdd.length} tag vào danh sách chuẩn bị nhập`);
  };

  // Add all leaves in current branch
  const handleAddAllInBranch = () => {
    if (leaves.length === 0) {
      toast.error('Thư mục hiện tại không có tag nào');
      return;
    }
    const targetGrp = getLeafGroup();
    const toAdd = leaves.map((l) => ({
      name: l.name,
      item_id: l.item_id,
      group: targetGrp,
      data_type: l.data_type || 'float32',
      scan_rate_ms: globalScanRate,
    }));
    mergeCandidates(toAdd);
    toast.success(`Đã thêm ${toAdd.length} tag vào danh sách chuẩn bị nhập`);
  };

  // Scan and add all tags inside a specific branch into the selected target folder only
  const handleAddBranch = async (branchName, e) => {
    if (e) e.stopPropagation();
    if (!selectedConnId) return;
    const branchPath = currentPath ? `${currentPath}/${branchName}` : branchName;
    const targetGrp = getLeafGroup();
    try {
      toast.loading(`Đang quét tag trong mục '${branchName}'...`, { id: `scan-branch-${branchName}` });
      const res = await scanOpcDaTags(selectedConnId, branchPath, 500);
      toast.dismiss(`scan-branch-${branchName}`);
      if (res.tags && res.tags.length > 0) {
        const mapped = res.tags.map((t) => ({
          ...t,
          group: targetGrp,
          scan_rate_ms: globalScanRate,
        }));
        mergeCandidates(mapped);
        toast.success(`Đã thêm ${mapped.length} tag vào thư mục '${targetGrp || 'Gốc'}'!`);
      } else {
        toast.info(`Không tìm thấy tag nào trong mục '${branchName}'`);
      }
    } catch (err) {
      toast.dismiss(`scan-branch-${branchName}`);
      toast.error(`Lỗi khi quét mục '${branchName}': ` + (err.response?.data?.detail || err.message));
    }
  };

  // Scan all tags in the server into the selected target folder only
  const handleScanAll = async () => {
    if (!selectedConnId) return;
    setLoadingScanAll(true);
    const targetGrp = getLeafGroup();
    try {
      toast.loading('Đang tự động quét toàn bộ cây OPC DA...', { id: 'scan-opc' });
      const res = await scanOpcDaTags(selectedConnId, currentPath, 500);
      toast.dismiss('scan-opc');
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
      toast.dismiss('scan-opc');
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
           l.item_id.toLowerCase().includes(leafFilter.trim().toLowerCase());
  });

  const selectedConn = opcDaConnections.find((c) => String(c.id) === String(selectedConnId));

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl h-[88vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-gray-200 bg-gray-50/80">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 text-blue-700 rounded-lg">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                Duyệt & Nhập Tag OPC DA (Classic)
                <span className="text-xs font-normal px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-full">
                  Kepware / Phoenix Contact
                </span>
              </h2>
              <p className="text-xs text-gray-500">
                Duyệt cây địa chỉ (Address Space) của OPC DA Server và nhập hàng loạt vào Gateway
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
            <span className="text-gray-600 font-medium">OPC DA Connection:</span>
            <select
              value={selectedConnId}
              onChange={(e) => setSelectedConnId(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white font-medium text-gray-800 focus:ring-2 focus:ring-blue-500 outline-none"
            >
              {opcDaConnections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.config?.server_prog_id || 'OPC DA'})
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
              title="Tự động duyệt tất cả các nhánh và gom tất cả tags"
            >
              <Sparkles className={`w-3.5 h-3.5 ${loadingScanAll ? 'animate-spin' : ''}`} />
              {loadingScanAll ? 'Đang quét...' : 'Quét toàn bộ OPC Server'}
            </button>
            <button
              onClick={() => loadBrowse(currentPath)}
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
                <button
                  onClick={handleGoRoot}
                  className="hover:text-blue-600 font-bold hover:underline cursor-pointer"
                  title="Về gốc (Root)"
                >
                  Root
                </button>
                {currentPath.split('/').filter(Boolean).map((seg, idx, arr) => (
                  <React.Fragment key={idx}>
                    <span className="text-gray-400">/</span>
                    <button
                      onClick={() => loadBrowse(arr.slice(0, idx + 1).join('/'))}
                      className="hover:text-blue-600 hover:underline cursor-pointer font-medium"
                    >
                      {seg}
                    </button>
                  </React.Fragment>
                ))}
              </div>
              <div className="flex items-center gap-1">
                {currentPath && (
                  <button
                    onClick={handleGoUp}
                    className="flex items-center gap-1 px-2 py-1 text-gray-600 hover:bg-gray-100 rounded border border-gray-200 cursor-pointer text-[11px]"
                    title="Lên một cấp"
                  >
                    <ArrowUp className="w-3 h-3" /> Lên thư mục
                  </button>
                )}
              </div>
            </div>

            {/* Filter Input */}
            <div className="px-4 py-2 border-b border-gray-200 bg-white flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-gray-400" />
              <input
                type="text"
                placeholder="Lọc tag theo tên (*)..."
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
                  <RefreshCw className="w-6 h-6 animate-spin mb-2 text-blue-500" />
                  Đang đọc cây địa chỉ...
                </div>
              ) : (
                <>
                  {/* Sub-Branches (Folders) */}
                  {branches.length > 0 && (
                    <div>
                      <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                        <Folder className="w-3.5 h-3.5 text-amber-500" /> Thư mục con ({branches.length})
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {branches.map((b) => (
                          <div
                            key={b}
                            className="flex items-center justify-between gap-1 px-3 py-2 text-xs bg-white border border-gray-200 hover:border-blue-400 hover:bg-blue-50/40 rounded-lg transition-all group shadow-xs"
                          >
                            <button
                              type="button"
                              onClick={() => handleEnterBranch(b)}
                              className="flex items-center gap-2 text-left truncate flex-1 min-w-0 cursor-pointer"
                              title={`Mở xem thư mục ${b}`}
                            >
                              <Folder className="w-4 h-4 text-amber-500 group-hover:text-blue-600 shrink-0" />
                              <span className="truncate font-semibold text-gray-800 group-hover:text-blue-700">
                                {b}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleAddBranch(b, e)}
                              className="shrink-0 px-2 py-1 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-600 hover:text-white rounded border border-blue-200 transition-colors cursor-pointer"
                              title={`Tạo thư mục '${b}' và lấy toàn bộ tag trong mục này`}
                            >
                              + Thêm mục
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Leaves (Tags) */}
                  <div>
                    <div className="flex items-center justify-between text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                      <span className="flex items-center gap-1">
                        <Database className="w-3.5 h-3.5 text-blue-500" /> Tags trong thư mục ({filteredLeaves.length})
                      </span>
                      {filteredLeaves.length > 0 && (
                        <button
                          onClick={selectAllLeaves}
                          className="text-blue-600 hover:underline normal-case font-normal text-xs cursor-pointer"
                        >
                          {selectedLeafNames.size === filteredLeaves.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                        </button>
                      )}
                    </div>

                    {filteredLeaves.length === 0 ? (
                      <div className="text-center py-8 text-xs text-gray-400 bg-white rounded-lg border border-dashed border-gray-200">
                        {branches.length > 0 
                          ? 'Thư mục này chỉ chứa thư mục con. Hãy bấm vào một thư mục con ở trên để xem tag.' 
                          : 'Không có tag nào tại đây.'}
                      </div>
                    ) : (
                      <div className="space-y-1 bg-white border border-gray-200 rounded-lg p-2 max-h-72 overflow-y-auto">
                        {filteredLeaves.map((l) => {
                          const isChecked = selectedLeafNames.has(l.name);
                          return (
                            <div
                              key={l.item_id}
                              onClick={() => toggleLeaf(l.name)}
                              className={`flex items-center justify-between p-2 rounded text-xs cursor-pointer transition-colors ${
                                isChecked ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50 border border-transparent'
                              }`}
                            >
                              <div className="flex items-center gap-2 truncate pr-2">
                                <button type="button" className="text-gray-400 hover:text-blue-600 shrink-0">
                                  {isChecked ? (
                                    <CheckSquare className="w-4 h-4 text-blue-600" />
                                  ) : (
                                    <Square className="w-4 h-4 text-gray-300" />
                                  )}
                                </button>
                                <div className="truncate">
                                  <div className="font-medium text-gray-900 truncate">{l.name}</div>
                                  <div className="font-mono text-[10px] text-gray-400 truncate">{l.item_id}</div>
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
                Đang chọn: <strong>{selectedLeafNames.size}</strong> tag
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleAddSelectedLeaves}
                  disabled={selectedLeafNames.size === 0}
                  className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-40 cursor-pointer flex items-center gap-1 shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5" /> Thêm tag đã chọn &gt;&gt;
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
                    className="w-28 px-1.5 py-0.5 text-xs text-blue-700 border border-gray-200 rounded outline-none focus:ring-1 focus:ring-blue-500 font-semibold"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const targetGrp = customParentGroup.trim();
                      setImportCandidates((prev) => prev.map((c) => ({ ...c, group: targetGrp })));
                      toast.success(`Đã gán toàn bộ tag vào thư mục '${targetGrp || 'Gốc'}'`);
                    }}
                    className="px-2 py-0.5 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 cursor-pointer whitespace-nowrap"
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
                    className="w-16 px-1.5 py-0.5 text-xs font-mono font-bold text-blue-700 border border-gray-200 rounded text-center outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <span className="text-[11px] text-gray-500">ms</span>
                  <button
                    type="button"
                    onClick={() => {
                      setImportCandidates(prev => prev.map(c => ({ ...c, scan_rate_ms: globalScanRate })));
                      toast.success(`Đã đặt chu kỳ ${globalScanRate}ms cho tất cả tag`);
                    }}
                    className="px-2 py-0.5 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 cursor-pointer whitespace-nowrap"
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
                  <Database className="w-10 h-10 text-gray-300 mb-2" />
                  <p className="font-medium text-gray-600">Chưa có tag nào được chọn</p>
                  <p className="text-gray-400 mt-1 max-w-xs">
                    Hãy duyệt cây thư mục bên trái, tích chọn các tag cần nhập và bấm <strong>"Thêm tag đã chọn"</strong> hoặc bấm <strong>"Quét toàn bộ OPC Server"</strong>.
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
                        <th className="py-2 px-3">OPC ITEM ID (ADDRESS)</th>
                        <th className="py-2 px-2 text-center w-8"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {importCandidates.map((c, idx) => (
                        <tr key={c.item_id + idx} className="hover:bg-blue-50/30">
                          <td className="py-1.5 px-3">
                            <input
                              type="text"
                              value={c.name}
                              onChange={(e) => updateCandidate(idx, 'name', e.target.value)}
                              className="border border-gray-200 rounded px-1.5 py-1 text-xs font-medium w-full text-gray-900 focus:ring-1 focus:ring-blue-500 outline-none"
                            />
                          </td>
                          <td className="py-1.5 px-3">
                            <input
                              type="text"
                              value={c.group}
                              onChange={(e) => updateCandidate(idx, 'group', e.target.value)}
                              className="border border-gray-200 rounded px-1.5 py-1 text-xs text-amber-700 bg-amber-50/50 w-full focus:ring-1 focus:ring-blue-500 outline-none"
                            />
                          </td>
                          <td className="py-1.5 px-3">
                            <select
                              value={c.data_type}
                              onChange={(e) => updateCandidate(idx, 'data_type', e.target.value)}
                              className="border border-gray-200 rounded px-1.5 py-1 text-xs bg-white focus:ring-1 focus:ring-blue-500 outline-none"
                            >
                              <option value="float32">float32</option>
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
                              className="border border-gray-200 rounded px-1 py-1 text-xs font-mono font-medium text-center w-16 text-blue-700 focus:ring-1 focus:ring-blue-500 outline-none"
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
                Tổng cộng: <strong className="text-blue-700 text-sm">{importCandidates.length}</strong> tag sẽ được thêm vào
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
                  className="px-5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1.5 shadow-sm"
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
