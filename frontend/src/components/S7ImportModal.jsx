import React, { useState, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Cpu,
  X,
  Folder,
  FolderOpen,
  Database,
  Table2,
  Layers,
  Server,
  ArrowUp,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Search,
  CheckSquare,
  Square,
  Plus,
  Trash2,
  Upload,
  FileCode2,
  ClipboardPaste,
  Sparkles,
  RefreshCw,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  Copy,
  Check,
  FolderSearch,
  Play,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  fetchTiaEnv,
  browseLocalTiaFile,
  scanTiaProject,
  scanS7Files,
  parseS7Text,
  importTagsBatch,
} from '../api/tags';

const SAMPLE_TIA_DB = `TYPE "UDT_Bom"
VERSION : 0.1
   STRUCT
      Run : Bool;
      Fault : Bool;
      FrequencyHz : Real;   // Tan so bien tan
   END_STRUCT;
END_TYPE

DATA_BLOCK "DB_TramBom"
{ S7_Optimized_Access := 'FALSE' }
VERSION : 0.1
NON_RETAIN
   VAR
      AutoMode : Bool;   // Che do tu dong
      StartCmd : Bool;   // Lenh khoi dong
      StatusCode : Byte;   // Ma trang thai
      PressureSP : Real := 4.5;   // Ap suat dat (bar)
      Bom1 : "UDT_Bom";
      TempC : Array[1..2] of Real;   // Nhiet do cam bien
      StationName : String[20] := 'Tram-01';
   END_VAR
BEGIN
END_DATA_BLOCK`;

const GATEWAY_DATA_TYPES = ['bool', 'int16', 'uint16', 'int32', 'float32', 'float64', 'string'];

function collectAllLeaves(node) {
  if (!node) return [];
  const out = [...(node.leaves || [])];
  for (const ch of node.children || []) {
    out.push(...collectAllLeaves(ch));
  }
  return out;
}

function resolveNodePath(rootNode, navIds) {
  if (!rootNode) return [];
  const chain = [rootNode];
  let curr = rootNode;
  for (let i = 1; i < navIds.length; i += 1) {
    const next = (curr.children || []).find((c) => c.id === navIds[i]);
    if (!next) break;
    chain.push(next);
    curr = next;
  }
  return chain;
}

function buildTargetGroup(baseParent, leafGroup) {
  const base = (baseParent || '').trim().replace(/^\/+|\/+$/g, '');
  const leaf = (leafGroup || '').trim().replace(/^\/+|\/+$/g, '');
  if (!base) return leaf;
  if (!leaf) return base;
  if (leaf.toLowerCase() === base.toLowerCase() || leaf.toLowerCase().startsWith(`${base.toLowerCase()}/`)) {
    return leaf;
  }
  return `${base}/${leaf}`;
}

function BranchIcon({ kind }) {
  if (kind === 'plc') return <Server className="w-4 h-4 text-emerald-400 shrink-0" />;
  if (kind === 'category') return <FolderOpen className="w-4 h-4 text-sky-400 shrink-0" />;
  if (kind === 'db') return <Database className="w-4 h-4 text-amber-400 shrink-0" />;
  if (kind === 'tag_table') return <Table2 className="w-4 h-4 text-cyan-400 shrink-0" />;
  if (kind === 'struct') return <Layers className="w-4 h-4 text-violet-400 shrink-0" />;
  return <Folder className="w-4 h-4 text-amber-400 shrink-0" />;
}

export default function S7ImportModal({
  connections = [],
  defaultConnId = null,
  defaultGroup = '',
  onClose,
  onSuccess,
}) {
  const [connectionId, setConnectionId] = useState(() => {
    const initialConn =
      connections.find((c) => c.id === defaultConnId) ||
      connections.find((c) => c.protocol === 's7') ||
      connections[0];
    return initialConn?.id ? String(initialConn.id) : '';
  });
  const [targetParentGroup, setTargetParentGroup] = useState(defaultGroup || '');
  const [scanRateMs, setScanRateMs] = useState('100');

  const [sourceTab, setSourceTab] = useState('project'); // 'project' | 'files' | 'paste'
  const [sourceCollapsed, setSourceCollapsed] = useState(false);
  const [showOpennessGuide, setShowOpennessGuide] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);

  const [projectPath, setProjectPath] = useState('');
  const [dbNumberFallback, setDbNumberFallback] = useState('1');
  const [pasteText, setPasteText] = useState('');

  const [pickingLocal, setPickingLocal] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);

  const [scanMeta, setScanMeta] = useState(null);
  const [rootTree, setRootTree] = useState(null);
  const [navIds, setNavIds] = useState(['root']);
  const [searchText, setSearchText] = useState('');
  const [searchAllProject, setSearchAllProject] = useState(false);
  const [checkedLeafIds, setCheckedLeafIds] = useState(() => new Set());
  const [stagedTags, setStagedTags] = useState([]);

  const zapInputRef = useRef(null);
  const multiFilesInputRef = useRef(null);

  const {
    data: tiaEnv,
    isLoading: tiaEnvLoading,
    refetch: refetchTiaEnv,
  } = useQuery({
    queryKey: ['tia-env'],
    queryFn: fetchTiaEnv,
    staleTime: 10000,
  });

  const currentConn = connections.find((c) => String(c.id) === String(connectionId));
  const isS7Conn = currentConn?.protocol === 's7';

  const applyTreeResponse = (res) => {
    setScanMeta({
      project_name: res.project_name || res.db_name || 'TIA Project',
      tia_version: res.tia_version || res.detected_format || '',
      engine_used: res.engine_used || '',
      openness_required: Boolean(res.openness_required),
      warnings: res.warnings || [],
      total_tags: res.total_tags ?? (res.tree?.tag_count || 0),
      message: res.message || '',
    });

    if (res.openness_required) {
      setShowOpennessGuide(true);
    }

    const tree = res.tree || null;
    setRootTree(tree);

    // Auto-drill down cleanly if project root only wraps a single category without direct leaves
    if (tree && (tree.leaves || []).length === 0 && (tree.children || []).length === 1) {
      const firstChild = tree.children[0];
      setNavIds([tree.id, firstChild.id]);
    } else if (tree) {
      setNavIds([tree.id]);
    } else {
      setNavIds(['root']);
    }

    setCheckedLeafIds(new Set());
    setSearchText('');
    setSearchAllProject(false);

    const total = tree?.tag_count ?? res.candidates?.length ?? 0;
    if (total > 0) {
      toast.success(res.message || `Đã quét ${total} tag từ dự án TIA Portal`);
    } else if (res.warnings?.length) {
      toast.error(res.message || res.warnings[0]);
    } else {
      toast.error('Không tìm thấy tag nào trong nguồn đã chọn');
    }
  };

  const handleBrowseLocalFile = async () => {
    setPickingLocal(true);
    try {
      const res = await browseLocalTiaFile();
      if (!res?.cancelled && res?.path) {
        setProjectPath(res.path);
        const low = res.path.toLowerCase();
        if (/\.(ap\d+|zap\d+)(_\d+)?$/.test(low)) {
          await handleScanProject({ overridePath: res.path });
        }
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || err.message || 'Không mở được hộp thoại chọn file trên máy');
    } finally {
      setPickingLocal(false);
    }
  };

  const handleScanProject = async ({ overridePath = null, attachIdx = null } = {}) => {
    const targetPath = (overridePath !== null ? overridePath : projectPath).trim();
    if (attachIdx === null && !targetPath) {
      toast.error('Vui lòng chọn hoặc nhập đường dẫn file .ap11–.ap21 / .zapXX');
      return;
    }

    setScanning(true);
    try {
      const rate = parseInt(scanRateMs, 10) || 100;
      const res = await scanTiaProject({
        project_path: attachIdx !== null ? '' : targetPath,
        attach_process_index: attachIdx,
        scan_rate_ms: rate,
      });
      applyTreeResponse(res);
    } catch (err) {
      toast.error(err.response?.data?.detail || err.message || 'Lỗi quét dự án TIA Portal');
    } finally {
      setScanning(false);
    }
  };

  const handleUploadFiles = async (fileList) => {
    const arr = Array.from(fileList || []);
    if (arr.length === 0) return;

    setScanning(true);
    try {
      const parsedDb = parseInt(dbNumberFallback, 10);
      const res = await scanS7Files(arr, {
        db_number: Number.isFinite(parsedDb) && parsedDb > 0 ? parsedDb : undefined,
        scan_rate_ms: parseInt(scanRateMs, 10) || 100,
      });
      applyTreeResponse(res);
    } catch (err) {
      toast.error(err.response?.data?.detail || err.message || 'Lỗi đọc danh sách file TIA Portal');
    } finally {
      setScanning(false);
    }
  };

  const handleParsePaste = async (customText = null) => {
    const txt = customText !== null ? customText : pasteText;
    if (!txt.trim()) {
      toast.error('Vui lòng dán bảng DB hoặc mã Source TIA Portal');
      return;
    }

    setScanning(true);
    try {
      const parsedDb = parseInt(dbNumberFallback, 10);
      const res = await parseS7Text({
        text: txt,
        db_number: Number.isFinite(parsedDb) && parsedDb > 0 ? parsedDb : undefined,
        scan_rate_ms: parseInt(scanRateMs, 10) || 100,
      });
      applyTreeResponse(res);
    } catch (err) {
      toast.error(err.response?.data?.detail || err.message || 'Không thể phân tích nội dung đã dán');
    } finally {
      setScanning(false);
    }
  };

  const handleLoadSampleDb = async () => {
    setPasteText(SAMPLE_TIA_DB);
    await handleParsePaste(SAMPLE_TIA_DB);
  };

  const handleCopyGroupCmd = async () => {
    const cmd = tiaEnv?.openness_group_cmd || 'Add-LocalGroupMember -Group "Siemens TIA Openness" -Member "$env:USERNAME"';
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedCmd(true);
      toast.success('Đã copy lệnh PowerShell! Hãy chạy bằng PowerShell (Run as Administrator).');
      setTimeout(() => setCopiedCmd(false), 2500);
    } catch {
      toast.error('Không thể tự động copy, vui lòng bôi đen và Ctrl+C lệnh.');
    }
  };

  // Tree navigation derived state
  const breadcrumbNodes = useMemo(() => resolveNodePath(rootTree, navIds), [rootTree, navIds]);
  const currentNode = breadcrumbNodes[breadcrumbNodes.length - 1] || null;
  const allProjectLeaves = useMemo(() => collectAllLeaves(rootTree), [rootTree]);

  const { visibleBranches, visibleLeaves } = useMemo(() => {
    if (!rootTree || !currentNode) return { visibleBranches: [], visibleLeaves: [] };
    const q = searchText.trim().toLowerCase();

    if (searchAllProject && q) {
      const matches = allProjectLeaves.filter(
        (l) =>
          (l.name || '').toLowerCase().includes(q) ||
          (l.address || '').toLowerCase().includes(q) ||
          (l.tag_group || '').toLowerCase().includes(q) ||
          (l.description || '').toLowerCase().includes(q)
      );
      return { visibleBranches: [], visibleLeaves: matches };
    }

    const rawBranches = currentNode.children || [];
    const rawLeaves = currentNode.leaves || [];
    if (!q || q === '*') {
      return { visibleBranches: rawBranches, visibleLeaves: rawLeaves };
    }

    const filteredBranches = rawBranches.filter(
      (b) =>
        (b.name || '').toLowerCase().includes(q) ||
        (b.db_number && `db${b.db_number}`.includes(q))
    );
    const filteredLeaves = rawLeaves.filter(
      (l) =>
        (l.name || '').toLowerCase().includes(q) ||
        (l.address || '').toLowerCase().includes(q) ||
        (l.description || '').toLowerCase().includes(q)
    );
    return { visibleBranches: filteredBranches, visibleLeaves: filteredLeaves };
  }, [rootTree, currentNode, searchText, searchAllProject, allProjectLeaves]);

  const enterBranch = (childId) => {
    const activeIds = breadcrumbNodes.map((n) => n.id);
    setNavIds([...activeIds, childId]);
    setCheckedLeafIds(new Set());
    setSearchAllProject(false);
  };

  const handleGoUp = () => {
    if (breadcrumbNodes.length <= 1) return;
    setNavIds(breadcrumbNodes.slice(0, -1).map((n) => n.id));
    setCheckedLeafIds(new Set());
  };

  const handleBreadcrumbClick = (index) => {
    setNavIds(breadcrumbNodes.slice(0, index + 1).map((n) => n.id));
    setCheckedLeafIds(new Set());
    setSearchAllProject(false);
  };

  const toggleLeafCheck = (leafId) => {
    setCheckedLeafIds((prev) => {
      const next = new Set(prev);
      if (next.has(leafId)) next.delete(leafId);
      else next.add(leafId);
      return next;
    });
  };

  const allVisibleLeavesChecked =
    visibleLeaves.length > 0 && visibleLeaves.every((l) => checkedLeafIds.has(l.id));

  const toggleSelectAllLeaves = () => {
    setCheckedLeafIds((prev) => {
      const next = new Set(prev);
      if (allVisibleLeavesChecked) {
        visibleLeaves.forEach((l) => next.delete(l.id));
      } else {
        visibleLeaves.forEach((l) => next.add(l.id));
      }
      return next;
    });
  };

  const addLeavesToStage = (leavesList, sourceLabel = '') => {
    if (!leavesList || leavesList.length === 0) {
      toast.error('Không có biến nào trong mục này để thêm');
      return;
    }
    const fallbackRate = parseInt(scanRateMs, 10) || 100;
    let addedCount = 0;

    setStagedTags((prev) => {
      const seenKeys = new Set(prev.map((x) => `${x.address}::${x.tag_group}::${x.name}`));
      const next = [...prev];
      for (const l of leavesList) {
        const finalGroup = buildTargetGroup(targetParentGroup, l.tag_group);
        const key = `${l.address}::${finalGroup}::${l.name}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        addedCount += 1;
        next.push({
          uid: l.id || `${Date.now()}_${Math.random()}`,
          name: l.name,
          address: l.address,
          data_type: l.data_type || 'float32',
          tag_group: finalGroup,
          tia_type: l.tia_type || '',
          description: l.description || '',
          scan_rate_ms: l.scan_rate_ms || fallbackRate,
          optimized: Boolean(l.optimized),
        });
      }
      return next;
    });

    if (addedCount > 0) {
      toast.success(
        sourceLabel
          ? `Đã thêm ${addedCount} tag từ '${sourceLabel}' vào danh sách chuẩn bị`
          : `Đã thêm ${addedCount} tag vào danh sách chuẩn bị`
      );
    } else {
      toast('Các tag trong mục này đã có sẵn bên danh sách phải');
    }
  };

  const handleAddCheckedLeaves = () => {
    const chosen = visibleLeaves.filter((l) => checkedLeafIds.has(l.id));
    if (chosen.length === 0) {
      toast.error('Vui lòng tích chọn ít nhất 1 biến bên trái');
      return;
    }
    addLeavesToStage(chosen);
    setCheckedLeafIds(new Set());
  };

  const handleAddCurrentBranchAll = () => {
    if (!currentNode) return;
    const allInBranch = collectAllLeaves(currentNode);
    addLeavesToStage(allInBranch, currentNode.name);
  };

  const updateStagedTag = (idx, field, val) => {
    setStagedTags((prev) => prev.map((item, i) => (i === idx ? { ...item, [field]: val } : item)));
  };

  const removeStagedTag = (idx) => {
    setStagedTags((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleImport = async () => {
    const connInt = parseInt(connectionId, 10);
    if (!connInt) {
      toast.error('Vui lòng chọn kênh kết nối S7 đích');
      return;
    }
    const payload = stagedTags
      .map((t) => ({
        connection_id: connInt,
        name: (t.name || '').trim(),
        address: (t.address || '').trim(),
        data_type: t.data_type || 'float32',
        tag_group: (t.tag_group || '').trim(),
        group_name: (t.tag_group || '').trim(),
        scan_rate_ms: parseInt(t.scan_rate_ms, 10) || parseInt(scanRateMs, 10) || 100,
        description: t.description || '',
        access: 'rw',
        enabled: true,
      }))
      .filter((t) => t.name && t.address);

    if (payload.length === 0) {
      toast.error('Danh sách tag chuẩn bị Import đang trống');
      return;
    }

    setImporting(true);
    try {
      const res = await importTagsBatch(payload);
      const count = res?.count ?? res?.created?.length ?? payload.length;
      toast.success(res?.message || `Đã import thành công ${count} tag S7 vào Gateway`);
      onSuccess?.(connInt, payload[0]?.tag_group || '');
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || err.message || 'Import tag S7 thất bại');
    } finally {
      setImporting(false);
    }
  };

  const checkedVisibleCount = visibleLeaves.filter((l) => checkedLeafIds.has(l.id)).length;
  const installedList = tiaEnv?.installed_versions || [];
  const runningProcs = tiaEnv?.running_tia_processes || [];

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center z-50 p-3 sm:p-4">
      <div className="glass-panel rounded-2xl border border-slate-700 w-full max-w-6xl h-[92vh] flex flex-col overflow-hidden shadow-2xl text-xs">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-b border-slate-800 bg-[#0F172A]/90">
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/35 text-amber-400">
              <Cpu className="w-4 h-4" />
            </span>
            <div>
              <h3 className="font-heading font-bold text-slate-100 text-sm flex flex-wrap items-center gap-2">
                <span>Scan &amp; Duyệt Cây Dự Án TIA Portal (V11 – V21)</span>
                {rootTree && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    {rootTree.name} · {allProjectLeaves.length} tag
                  </span>
                )}
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Chọn file <code className="text-sky-300">.ap11–.ap21</code> /{' '}
                <code className="text-sky-300">.zapXX</code>, gắn TIA đang mở hoặc nạp file xuất{' '}
                <code className="text-sky-300">.db / .xml / .xlsx</code> rồi click duyệt cây 2 cột như Scan OPC.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* TIA Openness Environment Pill */}
            <button
              type="button"
              onClick={() => setShowOpennessGuide((v) => !v)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium cursor-pointer transition-colors ${
                tiaEnv?.openness_ready
                  ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300 hover:bg-emerald-500/20'
                  : installedList.length > 0
                  ? 'bg-amber-500/15 border-amber-500/35 text-amber-300 hover:bg-amber-500/20'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
              title="Xem trạng thái Siemens TIA Openness & hướng dẫn cấp quyền"
            >
              {tiaEnvLoading ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : tiaEnv?.openness_ready ? (
                <ShieldCheck className="w-3.5 h-3.5" />
              ) : (
                <ShieldAlert className="w-3.5 h-3.5" />
              )}
              <span>
                {tiaEnvLoading
                  ? 'Đang kiểm tra TIA...'
                  : tiaEnv?.openness_ready
                  ? `Openness Sẵn sàng (${installedList.map((v) => v.version).join(', ')})`
                  : installedList.length > 0
                  ? `Openness: ${installedList.map((v) => v.version).join(', ')} (Cần cấp quyền)`
                  : 'Chế độ Offline / Multi-File'}
              </span>
              {showOpennessGuide ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg cursor-pointer"
              aria-label="Đóng"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Expandable Openness Setup Box */}
        {showOpennessGuide && (
          <div className="px-5 py-3 bg-[#0B1120] border-b border-slate-800 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-slate-200 font-semibold">
                <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  Trạng thái Siemens TIA Openness trên máy:{' '}
                  <code className="text-sky-300">{tiaEnv?.current_user || 'Windows User'}</code>
                </span>
              </div>
              <button
                type="button"
                onClick={() => refetchTiaEnv()}
                className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[11px] cursor-pointer"
              >
                <RefreshCw className={`w-3 h-3 ${tiaEnvLoading ? 'animate-spin' : ''}`} />
                Kiểm tra lại
              </button>
            </div>

            {installedList.length > 0 ? (
              tiaEnv?.in_openness_group ? (
                <p className="text-[11px] text-emerald-300">
                  Tài khoản đã thuộc nhóm <strong>Siemens TIA Openness</strong>. Bạn có thể chọn trực tiếp file{' '}
                  <code>.ap14–.ap21</code> / <code>.zapXX</code> hoặc gắn vào TIA Portal đang mở (lần đầu TIA có thể hỏi popup xác nhận Openness, hãy chọn <strong>Yes to all</strong>).
                </p>
              ) : (
                <div className="space-y-1.5 text-[11px] text-slate-300">
                  <p>
                    Để đọc trực tiếp bên trong file <code>.ap14–.ap21</code> / <code>.zapXX</code> không cần mở thủ công, chỉ cần làm <strong>1 lần duy nhất</strong>: mở <strong>PowerShell (Run as Administrator)</strong> và chạy lệnh sau, sau đó Sign out / đăng nhập lại Windows:
                  </p>
                  <div className="flex items-center justify-between gap-2 bg-[#0F172A] border border-amber-500/35 rounded-lg px-3 py-1.5">
                    <code className="font-mono text-amber-300 break-all">
                      {tiaEnv?.openness_group_cmd || 'Add-LocalGroupMember -Group "Siemens TIA Openness" -Member "$env:USERNAME"'}
                    </code>
                    <button
                      type="button"
                      onClick={handleCopyGroupCmd}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 shrink-0 cursor-pointer"
                    >
                      {copiedCmd ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {copiedCmd ? 'Đã copy' : 'Copy lệnh'}
                    </button>
                  </div>
                </div>
              )
            ) : (
              <p className="text-[11px] text-slate-300">
                Máy này chưa cài TIA Portal Openness V14+. Bạn vẫn có thể chọn file <code>.zapXX</code> chứa source export, nạp nhiều file <code>.db/.udt/.xml/.xlsx</code>, hoặc dán bảng Offset DB từ TIA Portal (V11–V21).
              </p>
            )}
          </div>
        )}

        {/* Config & Source Strip */}
        <div className="px-5 py-3 border-b border-slate-800 bg-[#0F172A]/65 space-y-2.5">
          {/* Top config row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 items-end">
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Kênh Siemens S7 đích *
              </label>
              <select
                value={connectionId}
                onChange={(e) => setConnectionId(e.target.value)}
                className="w-full bg-[#1B2336] border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 outline-none focus:border-emerald-500"
              >
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.protocol.toUpperCase()} · {c.host || 'local'})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Thư mục cha đích (tùy chọn)
              </label>
              <input
                type="text"
                value={targetParentGroup}
                onChange={(e) => setTargetParentGroup(e.target.value)}
                placeholder="VD: TRAM_1 (để trống giữ theo cây DB)"
                className="w-full bg-[#1B2336] border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 placeholder:text-slate-500 outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Chu kỳ Scan mặc định (ms)
              </label>
              <input
                type="number"
                min={50}
                max={60000}
                value={scanRateMs}
                onChange={(e) => setScanRateMs(e.target.value)}
                className="w-full bg-[#1B2336] border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              {!isS7Conn && currentConn && (
                <span className="text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1 truncate">
                  Lưu ý: {currentConn.name} là {currentConn.protocol}
                </span>
              )}
              {rootTree && (
                <button
                  type="button"
                  onClick={() => setSourceCollapsed((v) => !v)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-medium cursor-pointer shrink-0"
                >
                  {sourceCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                  {sourceCollapsed ? 'Mở chọn file' : 'Thu gọn chọn file'}
                </button>
              )}
            </div>
          </div>

          {/* Collapsible Source Selector */}
          {!sourceCollapsed && (
            <div className="space-y-2 pt-1 border-t border-slate-800/80">
              {/* Source Tabs */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSourceTab('project')}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-semibold cursor-pointer transition-colors ${
                    sourceTab === 'project'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'bg-slate-800/70 text-slate-400 border border-slate-700 hover:text-slate-200'
                  }`}
                >
                  <FolderSearch className="w-3.5 h-3.5" />
                  Dự án TIA (.ap11–.ap21 / .zapXX)
                </button>
                <button
                  type="button"
                  onClick={() => setSourceTab('files')}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-semibold cursor-pointer transition-colors ${
                    sourceTab === 'files'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'bg-slate-800/70 text-slate-400 border border-slate-700 hover:text-slate-200'
                  }`}
                >
                  <Upload className="w-3.5 h-3.5" />
                  Nhiều file xuất (.db / .udt / .xml / .xlsx / .sdf)
                </button>
                <button
                  type="button"
                  onClick={() => setSourceTab('paste')}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-semibold cursor-pointer transition-colors ${
                    sourceTab === 'paste'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'bg-slate-800/70 text-slate-400 border border-slate-700 hover:text-slate-200'
                  }`}
                >
                  <ClipboardPaste className="w-3.5 h-3.5" />
                  Dán bảng DB / Source
                </button>
              </div>

              {/* Tab 1: TIA Project File (.apXX / .zapXX) + Running TIA Attach */}
              {sourceTab === 'project' && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={projectPath}
                      onChange={(e) => setProjectPath(e.target.value)}
                      placeholder="Nhập hoặc chọn đường dẫn file dự án TIA (VD: D:\PLC\TramBom\TramBom.ap16 hoặc .zap17)"
                      className="flex-1 min-w-[240px] bg-[#1B2336] border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100 font-mono placeholder:text-slate-500 outline-none focus:border-emerald-500"
                    />
                    <button
                      type="button"
                      onClick={handleBrowseLocalFile}
                      disabled={pickingLocal || scanning}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-100 font-semibold cursor-pointer disabled:opacity-50"
                      title="Mở hộp thoại Windows chọn file .ap11-.ap21 kèm đúng thư mục dự án trên máy"
                    >
                      <FolderSearch className="w-3.5 h-3.5 text-amber-400" />
                      {pickingLocal ? 'Đang mở hộp thoại...' : 'Chọn file trên máy'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleScanProject()}
                      disabled={scanning || !projectPath.trim()}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer disabled:opacity-50 shadow-sm"
                    >
                      {scanning ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                      {scanning ? 'Đang quét...' : 'Quét dự án'}
                    </button>

                    <input
                      ref={zapInputRef}
                      type="file"
                      accept=".zap11,.zap12,.zap13,.zap14,.zap15,.zap15_1,.zap16,.zap17,.zap18,.zap19,.zap20,.zap21"
                      onChange={(e) => {
                        if (e.target.files?.length) handleUploadFiles(e.target.files);
                        e.target.value = '';
                      }}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => zapInputRef.current?.click()}
                      disabled={scanning}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/35 text-sky-300 font-medium cursor-pointer disabled:opacity-50"
                      title="Dùng khi thao tác từ máy khác qua trình duyệt: tải file nén Project Archive (.zapXX)"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Tải file nén .zapXX
                    </button>
                  </div>

                  {runningProcs.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-1.5">
                      <span className="text-[11px] text-emerald-300 font-semibold">
                        Phát hiện TIA Portal đang mở:
                      </span>
                      {runningProcs.map((p) => (
                        <button
                          key={p.process_id}
                          type="button"
                          onClick={() => handleScanProject({ attachIdx: p.index })}
                          disabled={scanning}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold cursor-pointer disabled:opacity-50"
                        >
                          <Sparkles className="w-3 h-3" />
                          Quét TIA đang mở ({p.version || 'TIA'} ·{' '}
                          {p.project_path ? p.project_path.split(/[\\/]/).pop() : `PID ${p.process_id}`})
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Tab 2: Multi-file upload */}
              {sourceTab === 'files' && (
                <div className="flex flex-wrap items-center gap-2.5">
                  <input
                    ref={multiFilesInputRef}
                    type="file"
                    multiple
                    accept=".db,.scl,.awl,.udt,.xml,.xlsx,.sdf,.zap11,.zap12,.zap13,.zap14,.zap15,.zap15_1,.zap16,.zap17,.zap18,.zap19,.zap20,.zap21"
                    onChange={(e) => {
                      if (e.target.files?.length) handleUploadFiles(e.target.files);
                      e.target.value = '';
                    }}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => multiFilesInputRef.current?.click()}
                    disabled={scanning}
                    className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer disabled:opacity-50"
                  >
                    {scanning ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    Chọn nhiều file (.udt + .db / .xml / .xlsx / .sdf)
                  </button>

                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-400">Số DB mặc định (nếu source không ghi):</span>
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={dbNumberFallback}
                      onChange={(e) => setDbNumberFallback(e.target.value)}
                      className="w-20 bg-[#1B2336] border border-slate-700 rounded-lg px-2 py-1 text-slate-100 font-mono outline-none focus:border-emerald-500"
                    />
                  </div>
                  <span className="text-[11px] text-slate-400">
                    Mẹo: Chọn cùng lúc file <code className="text-sky-300">.udt</code> và các file <code className="text-sky-300">.db</code> để tự giải mã Offset lồng UDT.
                  </span>
                </div>
              )}

              {/* Tab 3: Paste / Sample DB */}
              {sourceTab === 'paste' && (
                <div className="space-y-2">
                  <textarea
                    rows={4}
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder="Dán các dòng bảng DB từ TIA Portal (Name / Data type / Offset) hoặc dán nội dung file .db / .scl / .xml..."
                    className="w-full bg-[#1B2336] border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono text-[11px] placeholder:text-slate-500 outline-none focus:border-emerald-500"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-400">Số DB (cho bảng dán / UDT):</span>
                      <input
                        type="number"
                        min={1}
                        max={65535}
                        value={dbNumberFallback}
                        onChange={(e) => setDbNumberFallback(e.target.value)}
                        className="w-20 bg-[#1B2336] border border-slate-700 rounded-lg px-2 py-1 text-slate-100 font-mono outline-none focus:border-emerald-500"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleLoadSampleDb}
                        disabled={scanning}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-amber-300 font-medium cursor-pointer disabled:opacity-50"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        Nạp mẫu TIA Portal DB
                      </button>
                      <button
                        type="button"
                        onClick={() => handleParsePaste()}
                        disabled={scanning || !pasteText.trim()}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer disabled:opacity-50"
                      >
                        {scanning ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileCode2 className="w-3.5 h-3.5" />}
                        Phân tích vào cây
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Warnings strip */}
          {scanMeta?.warnings?.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/35 rounded-lg px-3 py-2 space-y-1 max-h-24 overflow-y-auto">
              {scanMeta.warnings.map((w, idx) => (
                <div key={idx} className="flex items-start gap-1.5 text-[11px] text-amber-200 leading-snug">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Main 2-Pane Split Browser */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-slate-800 overflow-hidden">
          {/* LEFT PANE: Interactive TIA Project Tree */}
          <div className="flex flex-col min-h-0 bg-[#0B1120]/70">
            {/* Breadcrumb & Up Bar */}
            <div className="px-4 py-2 border-b border-slate-800 bg-[#0F172A] flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0 overflow-x-auto">
                <button
                  type="button"
                  onClick={handleGoUp}
                  disabled={breadcrumbNodes.length <= 1}
                  className="p-1 rounded border border-slate-700 bg-slate-800/80 text-slate-300 hover:text-white disabled:opacity-35 cursor-pointer shrink-0"
                  title="Lên một cấp"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                {rootTree ? (
                  <div className="flex items-center gap-1 text-[11px] font-mono truncate">
                    {breadcrumbNodes.map((b, idx) => (
                      <React.Fragment key={b.id}>
                        {idx > 0 && <ChevronRight className="w-3 h-3 text-slate-500 shrink-0" />}
                        <button
                          type="button"
                          onClick={() => handleBreadcrumbClick(idx)}
                          className={`truncate hover:underline cursor-pointer ${
                            idx === breadcrumbNodes.length - 1
                              ? 'font-bold text-emerald-300'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {b.name}
                        </button>
                      </React.Fragment>
                    ))}
                  </div>
                ) : (
                  <span className="text-[11px] text-slate-500 font-medium">
                    Cây Dự Án TIA Portal (chưa quét)
                  </span>
                )}
              </div>

              {currentNode && currentNode.tag_count > 0 && (
                <button
                  type="button"
                  onClick={handleAddCurrentBranchAll}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 text-emerald-300 text-[11px] font-semibold shrink-0 cursor-pointer"
                  title="Thêm toàn bộ tag bên trong nhánh đang xem sang danh sách chuẩn bị"
                >
                  <Plus className="w-3 h-3" />
                  Tất cả nhánh ({currentNode.tag_count})
                </button>
              )}
            </div>

            {/* Search Input */}
            <div className="px-4 py-2 border-b border-slate-800 bg-[#0F172A]/60 flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder={searchAllProject ? 'Tìm trên toàn bộ dự án...' : 'Lọc thư mục, DB hoặc tên/địa chỉ biến...'}
                className="flex-1 bg-transparent text-slate-100 placeholder:text-slate-500 outline-none text-xs"
              />
              {rootTree && (
                <button
                  type="button"
                  onClick={() => setSearchAllProject((v) => !v)}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold border cursor-pointer shrink-0 ${
                    searchAllProject
                      ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                  }`}
                >
                  Tìm toàn dự án
                </button>
              )}
              {searchText && (
                <button
                  type="button"
                  onClick={() => setSearchText('')}
                  className="text-slate-400 hover:text-slate-200 cursor-pointer"
                  aria-label="Xóa lọc"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Tree Body */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {scanning ? (
                <div className="flex flex-col items-center justify-center h-48 text-slate-400 gap-2">
                  <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
                  <span>Đang phân tích cấu trúc dự án TIA Portal...</span>
                </div>
              ) : !rootTree ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-6 text-slate-400 space-y-2.5">
                  <FolderSearch className="w-10 h-10 text-slate-600" />
                  <p className="font-semibold text-slate-300">Chưa có dữ liệu cây dự án</p>
                  <p className="text-[11px] leading-relaxed max-w-md">
                    Chọn file <code className="text-sky-300">.ap11–.ap21</code> / <code className="text-sky-300">.zapXX</code> ở phía trên, chọn nhiều file xuất (<code className="text-sky-300">.db / .xml / .xlsx</code>), hoặc sang tab <strong>Dán bảng DB / Source</strong> bấm <strong>Nạp mẫu TIA Portal DB</strong> để thử ngay.
                  </p>
                </div>
              ) : (
                <>
                  {/* Child Branches (PLC / Category / Folder / DB / TagTable / Struct) */}
                  {visibleBranches.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1">
                        Thư mục / Khối DB / Bảng Tag ({visibleBranches.length})
                      </div>
                      <div className="grid grid-cols-1 gap-1.5">
                        {visibleBranches.map((b) => (
                          <div
                            key={b.id}
                            onClick={() => enterBranch(b.id)}
                            className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#111827] hover:bg-[#1B2336] border border-slate-800 hover:border-emerald-500/45 transition-all cursor-pointer group"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <BranchIcon kind={b.kind} />
                              <span className="font-semibold text-slate-100 truncate">{b.name}</span>
                              {b.db_number && (
                                <span className="px-1.5 py-0.5 rounded bg-sky-500/15 border border-sky-500/30 text-sky-300 font-mono text-[10px] shrink-0">
                                  DB{b.db_number}
                                </span>
                              )}
                              {b.optimized && (
                                <span
                                  className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/35 text-amber-300 text-[10px] shrink-0"
                                  title="Đang bật Optimized block access trong TIA Portal — cần bỏ tích trong Properties trước khi PLC S7 cho phép đọc theo Offset."
                                >
                                  Optimized
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-[11px] font-mono text-slate-400">
                                {b.tag_count} tag
                              </span>
                              {b.tag_count > 0 && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    addLeavesToStage(collectAllLeaves(b), b.name);
                                  }}
                                  className="flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/35 text-[11px] font-semibold transition-colors cursor-pointer"
                                  title={`Thêm toàn bộ ${b.tag_count} tag trong '${b.name}'`}
                                >
                                  <Plus className="w-3 h-3" />
                                  Thêm nhánh
                                </button>
                              )}
                              <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-emerald-400" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Leaf Variables */}
                  {visibleLeaves.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between px-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          {searchAllProject && searchText.trim()
                            ? `Kết quả tìm kiếm (${visibleLeaves.length})`
                            : `Biến trực tiếp trong mục này (${visibleLeaves.length})`}
                        </span>
                      </div>
                      <div className="border border-slate-800 rounded-xl overflow-hidden bg-[#0F172A]/90">
                        <table className="w-full text-left border-collapse">
                          <thead className="bg-[#1B2336] border-b border-slate-800 text-[10px] uppercase text-slate-400">
                            <tr>
                              <th className="px-2.5 py-2 w-8">
                                <button
                                  type="button"
                                  onClick={toggleSelectAllLeaves}
                                  className="text-slate-300 hover:text-emerald-400 cursor-pointer flex items-center"
                                  title="Chọn / Bỏ chọn tất cả biến đang hiển thị"
                                >
                                  {allVisibleLeavesChecked ? (
                                    <CheckSquare className="w-4 h-4 text-emerald-400" />
                                  ) : (
                                    <Square className="w-4 h-4" />
                                  )}
                                </button>
                              </th>
                              <th className="px-2 py-2">Tên biến</th>
                              <th className="px-2 py-2">Địa chỉ S7</th>
                              <th className="px-2 py-2">Kiểu</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/70">
                            {visibleLeaves.map((leaf) => {
                              const checked = checkedLeafIds.has(leaf.id);
                              return (
                                <tr
                                  key={leaf.id}
                                  onClick={() => toggleLeafCheck(leaf.id)}
                                  className={`cursor-pointer transition-colors ${
                                    checked ? 'bg-emerald-500/10' : 'hover:bg-slate-800/60'
                                  }`}
                                >
                                  <td className="px-2.5 py-1.5">
                                    {checked ? (
                                      <CheckSquare className="w-4 h-4 text-emerald-400" />
                                    ) : (
                                      <Square className="w-4 h-4 text-slate-500" />
                                    )}
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <div className="font-semibold text-slate-100">{leaf.name}</div>
                                    <div className="text-[10px] text-slate-400 truncate max-w-[200px]">
                                      {leaf.description || leaf.tag_group}
                                    </div>
                                  </td>
                                  <td className="px-2 py-1.5 font-mono text-sky-300 font-semibold whitespace-nowrap">
                                    {leaf.address}
                                  </td>
                                  <td className="px-2 py-1.5 font-mono text-[11px] whitespace-nowrap">
                                    <span className="text-slate-300">{leaf.tia_type}</span>
                                    <span className="text-slate-500"> → </span>
                                    <span className="text-emerald-300">{leaf.data_type}</span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {visibleBranches.length === 0 && visibleLeaves.length === 0 && (
                    <div className="text-center text-slate-500 py-10">
                      Không có thư mục hay biến nào khớp điều kiện trong mục này.
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Left Pane Bottom Bar */}
            <div className="px-4 py-2.5 border-t border-slate-800 bg-[#0F172A] flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-400">
                Đã tích chọn <strong className="text-slate-200">{checkedVisibleCount}</strong> biến
              </span>
              <button
                type="button"
                onClick={handleAddCheckedLeaves}
                disabled={checkedVisibleCount === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Thêm {checkedVisibleCount} tag đã chọn →
              </button>
            </div>
          </div>

          {/* RIGHT PANE: Staged Import List */}
          <div className="flex flex-col min-h-0 bg-[#0F172A]/45">
            <div className="px-4 py-2 border-b border-slate-800 bg-[#0F172A] flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-100">
                Danh sách Tag chuẩn bị Import ({stagedTags.length})
              </span>
              {stagedTags.length > 0 && (
                <button
                  type="button"
                  onClick={() => setStagedTags([])}
                  className="text-[11px] text-rose-400 hover:text-rose-300 font-medium cursor-pointer"
                >
                  Xóa hết
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              {stagedTags.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-6 text-slate-500 space-y-2">
                  <Database className="w-9 h-9 text-slate-700" />
                  <p className="font-semibold text-slate-400">Chưa có tag nào được chọn</p>
                  <p className="text-[11px]">
                    Click vào các nhánh bên trái (Program Blocks / DB / Struct / PLC Tags), tích chọn biến hoặc nhấn{' '}
                    <span className="text-emerald-400 font-semibold">+ Thêm nhánh</span> để đưa vào đây.
                  </p>
                </div>
              ) : (
                <div className="border border-slate-800 rounded-xl overflow-hidden bg-[#0F172A]">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-[#1B2336] border-b border-slate-800 text-[10px] uppercase text-slate-400">
                      <tr>
                        <th className="px-2 py-2">Thư mục (Tag Group)</th>
                        <th className="px-2 py-2">Tên Tag</th>
                        <th className="px-2 py-2">Địa chỉ S7</th>
                        <th className="px-2 py-2">Kiểu GW</th>
                        <th className="px-2 py-2 w-14">ms</th>
                        <th className="px-2 py-2 w-8"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {stagedTags.map((t, idx) => (
                        <tr key={t.uid} className="hover:bg-slate-800/40">
                          <td className="px-2 py-1.5">
                            <input
                              type="text"
                              value={t.tag_group || ''}
                              onChange={(e) => updateStagedTag(idx, 'tag_group', e.target.value)}
                              className="w-full bg-[#1B2336] border border-slate-700/80 rounded px-1.5 py-0.5 text-[11px] text-amber-200 focus:border-emerald-500 outline-none"
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              type="text"
                              value={t.name || ''}
                              onChange={(e) => updateStagedTag(idx, 'name', e.target.value)}
                              className="w-full bg-[#1B2336] border border-slate-700/80 rounded px-1.5 py-0.5 text-[11px] text-slate-100 font-semibold focus:border-emerald-500 outline-none"
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              type="text"
                              value={t.address || ''}
                              onChange={(e) => updateStagedTag(idx, 'address', e.target.value)}
                              className="w-28 bg-[#1B2336] border border-slate-700/80 rounded px-1.5 py-0.5 text-[11px] text-sky-300 font-mono focus:border-emerald-500 outline-none"
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <select
                              value={t.data_type || 'float32'}
                              onChange={(e) => updateStagedTag(idx, 'data_type', e.target.value)}
                              className="bg-[#1B2336] border border-slate-700/80 rounded px-1.5 py-0.5 text-[11px] text-emerald-300 font-mono focus:border-emerald-500 outline-none"
                            >
                              {GATEWAY_DATA_TYPES.map((dt) => (
                                <option key={dt} value={dt}>
                                  {dt}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              type="number"
                              min={50}
                              max={60000}
                              value={t.scan_rate_ms || 100}
                              onChange={(e) => updateStagedTag(idx, 'scan_rate_ms', e.target.value)}
                              className="w-14 bg-[#1B2336] border border-slate-700/80 rounded px-1.5 py-0.5 text-[11px] text-slate-200 font-mono focus:border-emerald-500 outline-none"
                            />
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <button
                              type="button"
                              onClick={() => removeStagedTag(idx)}
                              className="p-1 text-slate-500 hover:text-rose-400 cursor-pointer"
                              title="Xóa tag khỏi danh sách"
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
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-[#0F172A] flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] text-slate-400">
            {currentConn ? (
              <span>
                Đích: <strong className="text-slate-200">{currentConn.name}</strong> ({currentConn.protocol.toUpperCase()})
                {stagedTags.some((t) => t.optimized) && (
                  <span className="ml-2 text-amber-300">
                    · Lưu ý: Có DB đang bật Optimized trong TIA Portal, hãy tắt Optimized block access trước khi kết nối PLC.
                  </span>
                )}
              </span>
            ) : (
              'Chưa có kết nối nào'
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 font-medium cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={importing || stagedTags.length === 0 || !connectionId}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-45 text-white font-semibold cursor-pointer shadow-sm"
            >
              <Cpu className="w-3.5 h-3.5" />
              {importing ? 'Đang Import...' : `Import ${stagedTags.length} Tag vào Gateway`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
