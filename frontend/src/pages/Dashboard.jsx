import React, { useState, useEffect, useRef, useMemo, memo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { fetchTags, fetchTagGroups, writeTagValue } from '../api/tags';
import { fetchConnections } from '../api/connections';
import useStore from '../store/useStore';
import { useWebSocket } from '../hooks/useWebSocket';
import RealtimeChart from '../components/RealtimeChart';
import StatusBadge from '../components/StatusBadge';
import { formatTimestamp, formatValue, getProtocolColor } from '../utils/helpers';
import {
  Activity,
  Plug,
  Tag,
  Wifi,
  AlertTriangle,
  BarChart3,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Search,
  X,
  Layers,
  Lock,
  ChevronsUpDown,
  Network,
  PenLine,
} from 'lucide-react';

const MAX_CHARTS = 4;
const UNGROUPED_KEY = '__ungrouped__';

function resolveTagLive(tag, wsVal) {
  const value =
    wsVal?.value !== undefined && wsVal?.value !== null
      ? wsVal.value
      : tag.current_value !== null && tag.current_value !== undefined
      ? tag.current_value
      : null;

  const wsQuality = wsVal?.quality;
  const quality =
    wsQuality && wsQuality !== 'Unknown'
      ? wsQuality
      : tag.quality && tag.quality !== 'Unknown'
      ? tag.quality
      : wsQuality || tag.quality || 'Unknown';

  const timestamp = wsVal?.timestamp || tag.timestamp;
  return { value, quality, timestamp };
}

function buildFolderTree(groupNames, connTags) {
  const root = { children: {} };

  const ensureNode = (fullPath) => {
    if (!fullPath) return;
    const parts = fullPath.split('/').filter(Boolean);
    let curr = root;
    let accum = '';
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      accum = accum ? `${accum}/${part}` : part;
      if (!curr.children[part]) {
        curr.children[part] = {
          name: part,
          fullPath: accum,
          children: {},
        };
      }
      curr = curr.children[part];
    }
  };

  groupNames.forEach(ensureNode);
  connTags.forEach((t) => {
    const tg = (t.tag_group || '').trim();
    if (tg) ensureNode(tg);
  });

  const toList = (node) => {
    const list = Object.values(node.children);
    list.sort((a, b) => a.name.localeCompare(b.name));

    return list.map((child) => {
      const children = toList(child);
      const directCount = connTags.filter((t) => (t.tag_group || '').trim() === child.fullPath).length;
      const totalCount = connTags.filter((t) => {
        const tg = (t.tag_group || '').trim();
        return tg === child.fullPath || tg.startsWith(child.fullPath + '/');
      }).length;

      return {
        ...child,
        children,
        directCount,
        totalCount,
      };
    });
  };

  return toList(root);
}

function StatCard({ icon: Icon, label, value, sublabel, accentClass }) {
  return (
    <div className="glass-panel rounded-xl p-4 shadow-sm flex items-center gap-3.5 transition-colors duration-150 hover:border-slate-600/80">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border ${accentClass}`}>
        <Icon className="w-5 h-5" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-400 truncate">{label}</p>
        <p className="font-heading text-2xl font-bold text-slate-100 tabular-nums leading-tight mt-0.5">
          {value}
        </p>
        {sublabel && <p className="text-[11px] text-slate-400 mt-0.5 truncate">{sublabel}</p>}
      </div>
    </div>
  );
}

function FolderTreeNode({
  node,
  conn,
  depth = 0,
  selectedTree,
  onSelectGroup,
  collapsedTreeNodes,
  onToggleCollapse,
}) {
  const nodeKey = `grp:${conn.id}:${node.fullPath}`;
  const hasChildren = node.children && node.children.length > 0;
  const isCollapsed = collapsedTreeNodes.has(nodeKey);
  const isSelected =
    selectedTree.type === 'group' &&
    selectedTree.connId === conn.id &&
    selectedTree.group === node.fullPath;

  return (
    <div className="space-y-0.5">
      <div
        className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-colors cursor-pointer ${
          isSelected
            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-semibold'
            : 'text-slate-300 hover:bg-slate-800/70 border border-transparent'
        }`}
        style={{ paddingLeft: `${Math.max(8, depth * 14 + 8)}px` }}
        onClick={() => onSelectGroup(conn.id, node.fullPath)}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => onToggleCollapse(nodeKey, e)}
              className="p-0.5 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-700/60 cursor-pointer shrink-0"
              aria-label={isCollapsed ? `Mở rộng ${node.name}` : `Thu gọn ${node.name}`}
            >
              {isCollapsed ? (
                <ChevronRight className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}
          {isSelected ? (
            <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
          ) : (
            <Folder className="w-3.5 h-3.5 text-amber-400/90 shrink-0" aria-hidden="true" />
          )}
          <span className="truncate" title={node.fullPath}>
            {node.name}
          </span>
        </div>
        <span
          className={`text-[10px] font-mono px-1.5 py-0.5 rounded ml-1.5 shrink-0 ${
            isSelected ? 'bg-emerald-500/25 text-emerald-200' : 'bg-slate-800 text-slate-400'
          }`}
        >
          {node.totalCount}
        </span>
      </div>

      {hasChildren && !isCollapsed && (
        <div className="space-y-0.5 border-l border-slate-800 ml-3">
          {node.children.map((child) => (
            <FolderTreeNode
              key={child.fullPath}
              node={child}
              conn={conn}
              depth={depth + 1}
              selectedTree={selectedTree}
              onSelectGroup={onSelectGroup}
              collapsedTreeNodes={collapsedTreeNodes}
              onToggleCollapse={onToggleCollapse}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const TagTableRow = memo(function TagTableRow({
  tag,
  isSelected,
  chartLimitReached,
  isAdmin,
  onToggleChart,
  onOpenWrite,
}) {
  const wsVal = useStore((s) => s.tagValues[tag.id]);
  const { value: displayValue, quality: displayQuality, timestamp: displayTimestamp } = resolveTagLive(
    tag,
    wsVal
  );

  const valBoxRef = useRef(null);
  const initializedRef = useRef(false);
  const prevValueRef = useRef(displayValue);

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      prevValueRef.current = displayValue;
      return;
    }
    if (displayValue !== null && prevValueRef.current !== displayValue) {
      prevValueRef.current = displayValue;
      const el = valBoxRef.current;
      if (el) {
        el.classList.remove('value-flash');
        void el.offsetWidth;
        el.classList.add('value-flash');
      }
    } else {
      prevValueRef.current = displayValue;
    }
  }, [displayValue]);

  const pinDisabled = !isSelected && chartLimitReached;
  const isReadOnly = tag.access === 'ro';

  return (
    <tr
      className={`border-b border-slate-800/70 transition-colors ${
        isSelected ? 'bg-emerald-500/10 hover:bg-emerald-500/15' : 'hover:bg-slate-800/40'
      }`}
    >
      <td className="px-3 py-2 text-center">
        <button
          type="button"
          onClick={() => onToggleChart(tag.id)}
          disabled={pinDisabled}
          aria-pressed={isSelected}
          title={
            isSelected
              ? 'Bỏ ghim biểu đồ'
              : pinDisabled
              ? `Tối đa ${MAX_CHARTS} biểu đồ cùng lúc`
              : 'Ghim biểu đồ realtime'
          }
          className={`p-1.5 rounded-lg border transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
            isSelected
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
              : 'bg-slate-900/70 text-slate-400 border-slate-700/70 hover:text-emerald-300 hover:border-emerald-500/40'
          }`}
        >
          <BarChart3 className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </td>

      <td className="px-3 py-2 min-w-[150px]">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-slate-100 text-xs">{tag.name}</span>
          {isReadOnly && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] font-mono bg-amber-500/15 text-amber-300 border border-amber-500/30 px-1 py-0.5 rounded"
              title="Chỉ đọc (Read-Only)"
            >
              <Lock className="w-2.5 h-2.5" aria-hidden="true" />
              RO
            </span>
          )}
        </div>
        {tag.description && (
          <p className="text-[11px] text-slate-400 truncate max-w-[220px]" title={tag.description}>
            {tag.description}
          </p>
        )}
      </td>

      <td
        className="px-3 py-2 font-mono text-[11px] text-slate-400 max-w-[220px] truncate"
        title={tag.address}
      >
        {tag.address}
      </td>

      <td className="px-3 py-2 whitespace-nowrap">
        <div className="inline-flex items-baseline gap-1.5">
          <span
            ref={valBoxRef}
            className="inline-block rounded px-1.5 py-0.5 font-heading text-sm font-bold text-emerald-400 tabular-nums"
          >
            {displayValue !== null ? formatValue(displayValue, tag.data_type) : '—'}
          </span>
          {tag.unit && <span className="text-[11px] font-mono text-slate-400">{tag.unit}</span>}
        </div>
      </td>

      <td className="px-3 py-2 font-mono text-[11px] text-slate-400 whitespace-nowrap">
        {tag.data_type}
      </td>

      <td className="px-3 py-2 whitespace-nowrap">
        <StatusBadge status={displayQuality} size="sm" />
      </td>

      <td className="px-3 py-2 font-mono text-[11px] text-slate-400 whitespace-nowrap text-right">
        {formatTimestamp(displayTimestamp)}
      </td>

      <td className="px-3 py-2 text-center">
        {isReadOnly || !isAdmin ? (
          <span
            className="inline-flex p-1.5 text-slate-500"
            title={
              !isAdmin
                ? 'Chỉ tài khoản Admin mới được ghi giá trị'
                : 'Tag đang khóa Chỉ đọc (Read-Only)'
            }
          >
            <Lock className="w-3.5 h-3.5" aria-hidden="true" />
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onOpenWrite(tag, displayValue)}
            title={`Ghi giá trị xuống '${tag.name}'`}
            className="p-1.5 rounded-lg border bg-slate-900/70 text-slate-400 border-slate-700/70 hover:text-sky-300 hover:border-sky-500/40 transition-colors cursor-pointer"
          >
            <PenLine className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </td>
    </tr>
  );
});

function QuickWriteModal({ tag, initialValue, onClose, onSaved }) {
  const isBool = (tag.data_type || '').toLowerCase() === 'bool';
  const [val, setVal] = useState(
    initialValue !== null && initialValue !== undefined ? String(initialValue) : ''
  );
  const [saving, setSaving] = useState(false);

  const submitWrite = async (rawToWrite) => {
    setSaving(true);
    try {
      const dt = (tag.data_type || '').toLowerCase();
      let parsed = rawToWrite;
      if (dt === 'bool') {
        if (typeof rawToWrite === 'boolean') {
          parsed = rawToWrite;
        } else {
          const s = String(rawToWrite).trim().toLowerCase();
          parsed = s === '1' || s === 'true' || s === 'on';
        }
      } else if (dt.includes('int')) {
        parsed = parseInt(rawToWrite, 10);
        if (Number.isNaN(parsed)) throw new Error('Giá trị số nguyên không hợp lệ');
      } else if (dt.includes('float')) {
        parsed = parseFloat(rawToWrite);
        if (Number.isNaN(parsed)) throw new Error('Giá trị số thực không hợp lệ');
      }
      await writeTagValue(tag.id, parsed);
      toast.success(`Đã ghi '${String(parsed)}' xuống tag '${tag.name}'`);
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || err.message || 'Ghi giá trị thất bại');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="glass-panel rounded-2xl border border-slate-700 w-full max-w-sm p-5 shadow-2xl space-y-4 text-xs">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-heading font-bold text-slate-100 text-sm flex items-center gap-2">
              <PenLine className="w-4 h-4 text-sky-400" />
              Ghi giá trị xuống Tag
            </h3>
            <p className="text-[11px] font-mono text-slate-400 mt-0.5">
              {tag.tag_group ? `${tag.tag_group} / ` : ''}
              <span className="text-slate-200 font-semibold">{tag.name}</span> ({tag.data_type})
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-100 rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {isBool ? (
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              disabled={saving}
              onClick={() => submitWrite(true)}
              className="py-2.5 rounded-xl font-heading font-bold bg-emerald-500 hover:bg-emerald-400 text-[#0F172A] cursor-pointer disabled:opacity-40"
            >
              ON / TRUE (1)
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => submitWrite(false)}
              className="py-2.5 rounded-xl font-heading font-bold bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 cursor-pointer disabled:opacity-40"
            >
              OFF / FALSE (0)
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitWrite(val);
            }}
            className="space-y-3"
          >
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Giá trị mới {tag.unit ? `(${tag.unit})` : ''}
              </label>
              <input
                type="text"
                autoFocus
                value={val}
                onChange={(e) => setVal(e.target.value)}
                placeholder="Nhập giá trị cần ghi..."
                className="w-full bg-[#0F172A] border border-slate-700 rounded-lg px-3 py-2 font-mono text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={saving || val.trim() === ''}
                className="px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-[#0F172A] font-bold rounded-lg cursor-pointer disabled:opacity-40"
              >
                {saving ? 'Đang ghi...' : 'Ghi xuống thiết bị'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function FolderSectionHeader({
  section,
  isCollapsed,
  isExactScoped,
  onToggleSection,
  onFocusFolder,
}) {
  const { connection, folderKey, folderLabel, goodCount, totalCount } = section;
  const allGood = totalCount > 0 && goodCount === totalCount;
  const noneGood = goodCount === 0;
  const healthBadgeClass = allGood
    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35'
    : noneGood
    ? 'bg-red-500/15 text-red-300 border-red-500/35'
    : 'bg-amber-500/15 text-amber-300 border-amber-500/35';

  return (
    <tr
      onClick={() => onToggleSection(section.key)}
      className="bg-slate-800/75 hover:bg-slate-800 border-y border-slate-700/80 cursor-pointer transition-colors select-none"
    >
      <td colSpan={8} className="px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {isCollapsed ? (
              <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
            )}
            {isCollapsed ? (
              <Folder className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
            ) : (
              <FolderOpen className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
            )}
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded font-semibold ${getProtocolColor(
                connection?.protocol
              )}`}
            >
              {connection?.name || `Conn #${section.connectionId}`}
            </span>
            <span className="font-heading text-xs font-bold text-slate-100 truncate">
              {folderLabel}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!isExactScoped && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onFocusFolder(section.connectionId, folderKey);
                }}
                className="text-[11px] font-medium text-sky-300 hover:text-sky-200 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 rounded px-2 py-0.5 cursor-pointer transition-colors"
              >
                Lọc thư mục
              </button>
            )}
            <span
              className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full border ${healthBadgeClass}`}
              title="Số tag Good / Tổng số tag trong thư mục"
            >
              {goodCount}/{totalCount} Good
            </span>
          </div>
        </div>
      </td>
    </tr>
  );
}

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { isConnected } = useWebSocket();
  const tagValues = useStore((s) => s.tagValues);
  const isAdmin = useStore((s) => s.user?.role === 'admin');

  const { data: connections = [] } = useQuery({
    queryKey: ['connections'],
    queryFn: fetchConnections,
    refetchInterval: 30000,
  });

  const { data: tags = [], isLoading, isError } = useQuery({
    queryKey: ['tags'],
    queryFn: () => fetchTags(),
    refetchInterval: 30000,
  });

  const { data: explicitGroups = [] } = useQuery({
    queryKey: ['tagGroups'],
    queryFn: () => fetchTagGroups(),
    refetchInterval: 30000,
  });

  const [selectedTagIds, setSelectedTagIds] = useState([]);
  const [selectedTree, setSelectedTree] = useState({ type: 'all', connId: null, group: null });
  const [collapsedTreeNodes, setCollapsedTreeNodes] = useState(() => new Set());
  const [collapsedTableGroups, setCollapsedTableGroups] = useState(() => new Set());
  const [searchText, setSearchText] = useState('');
  const [qualityFilter, setQualityFilter] = useState('all'); // 'all' | 'good' | 'bad'
  const [writeTarget, setWriteTarget] = useState(null); // { tag, initialValue }

  const connMap = useMemo(
    () => Object.fromEntries(connections.map((c) => [c.id, c])),
    [connections]
  );

  const toggleTagChart = (tagId) => {
    setSelectedTagIds((prev) => {
      if (prev.includes(tagId)) return prev.filter((id) => id !== tagId);
      if (prev.length >= MAX_CHARTS) return prev;
      return [...prev, tagId];
    });
  };

  const handleToggleTreeNode = (nodeKey, e) => {
    if (e) e.stopPropagation();
    setCollapsedTreeNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeKey)) next.delete(nodeKey);
      else next.add(nodeKey);
      return next;
    });
  };

  const handleToggleTableSection = (sectionKey) => {
    setCollapsedTableGroups((prev) => {
      const next = new Set(prev);
      if (next.has(sectionKey)) next.delete(sectionKey);
      else next.add(sectionKey);
      return next;
    });
  };

  // Build Channel + Nested Folder Tree for Sidebar
  const treeData = useMemo(() => {
    const map = {};
    connections.forEach((c) => {
      map[c.id] = { connection: c, groups: new Set() };
    });

    explicitGroups.forEach((g) => {
      if (!map[g.connection_id]) {
        map[g.connection_id] = {
          connection: { id: g.connection_id, name: `Conn #${g.connection_id}`, protocol: '' },
          groups: new Set(),
        };
      }
      const gName = (g.name || '').trim();
      if (gName) map[g.connection_id].groups.add(gName);
    });

    tags.forEach((t) => {
      if (!map[t.connection_id]) {
        map[t.connection_id] = {
          connection: { id: t.connection_id, name: `Conn #${t.connection_id}`, protocol: '' },
          groups: new Set(),
        };
      }
      const gName = (t.tag_group || '').trim();
      if (gName) map[t.connection_id].groups.add(gName);
    });

    return Object.values(map)
      .map((item) => {
        const groupList = Array.from(item.groups).sort();
        const connTags = tags.filter((t) => t.connection_id === item.connection.id);
        const folderTree = buildFolderTree(groupList, connTags);
        const ungroupedCount = connTags.filter((t) => !(t.tag_group || '').trim()).length;
        return {
          connection: item.connection,
          totalCount: connTags.length,
          ungroupedCount,
          folderTree,
        };
      })
      .sort((a, b) => (a.connection.name || '').localeCompare(b.connection.name || ''));
  }, [connections, tags, explicitGroups]);

  // Filter tags by tree scope, quality filter, and search query
  const filteredTags = useMemo(() => {
    const qLower = searchText.trim().toLowerCase();

    return tags.filter((t) => {
      const tg = (t.tag_group || '').trim();

      if (selectedTree.type === 'connection') {
        if (t.connection_id !== selectedTree.connId) return false;
      } else if (selectedTree.type === 'group') {
        if (t.connection_id !== selectedTree.connId) return false;
        if (selectedTree.group === UNGROUPED_KEY) {
          if (tg !== '') return false;
        } else if (tg !== selectedTree.group && !tg.startsWith(selectedTree.group + '/')) {
          return false;
        }
      }

      if (qualityFilter !== 'all') {
        const { quality } = resolveTagLive(t, tagValues[t.id]);
        if (qualityFilter === 'good' && quality !== 'Good') return false;
        if (qualityFilter === 'bad' && quality === 'Good') return false;
      }

      if (qLower) {
        const connName = (connMap[t.connection_id]?.name || '').toLowerCase();
        const match =
          (t.name || '').toLowerCase().includes(qLower) ||
          (t.address || '').toLowerCase().includes(qLower) ||
          (t.description || '').toLowerCase().includes(qLower) ||
          tg.toLowerCase().includes(qLower) ||
          connName.includes(qLower);
        if (!match) return false;
      }

      return true;
    });
  }, [tags, selectedTree, qualityFilter, searchText, tagValues, connMap]);

  // Group filtered tags by (connection_id, folder)
  const groupedSections = useMemo(() => {
    const bucket = new Map();

    filteredTags.forEach((t) => {
      const folderKey = (t.tag_group || '').trim() || UNGROUPED_KEY;
      const sectionKey = `${t.connection_id}::${folderKey}`;
      if (!bucket.has(sectionKey)) {
        bucket.set(sectionKey, {
          key: sectionKey,
          connectionId: t.connection_id,
          connection: connMap[t.connection_id],
          folderKey,
          folderLabel:
            folderKey === UNGROUPED_KEY
              ? '(Chưa phân thư mục)'
              : folderKey.split('/').join(' / '),
          tags: [],
          goodCount: 0,
          totalCount: 0,
        });
      }
      const sec = bucket.get(sectionKey);
      sec.tags.push(t);
      sec.totalCount += 1;
      if (resolveTagLive(t, tagValues[t.id]).quality === 'Good') {
        sec.goodCount += 1;
      }
    });

    const list = Array.from(bucket.values());
    list.sort((a, b) => {
      const ca = a.connection?.name || `Conn #${a.connectionId}`;
      const cb = b.connection?.name || `Conn #${b.connectionId}`;
      const cmpConn = ca.localeCompare(cb);
      if (cmpConn !== 0) return cmpConn;
      if (a.folderKey === UNGROUPED_KEY && b.folderKey !== UNGROUPED_KEY) return 1;
      if (a.folderKey !== UNGROUPED_KEY && b.folderKey === UNGROUPED_KEY) return -1;
      return a.folderKey.localeCompare(b.folderKey);
    });

    list.forEach((sec) => {
      sec.tags.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    });

    return list;
  }, [filteredTags, connMap, tagValues]);

  const connectedCount = connections.filter((c) => c.connected).length;
  const goodQualityCount = tags.filter(
    (t) => resolveTagLive(t, tagValues[t.id]).quality === 'Good'
  ).length;

  const allGroupsCollapsed =
    groupedSections.length > 0 &&
    groupedSections.every((s) => collapsedTableGroups.has(s.key));

  const handleToggleAllSections = () => {
    if (allGroupsCollapsed) {
      setCollapsedTableGroups(new Set());
    } else {
      setCollapsedTableGroups(new Set(groupedSections.map((s) => s.key)));
    }
  };

  const scopeTitle = useMemo(() => {
    if (selectedTree.type === 'all') return 'Tất cả Tag';
    const cName = connMap[selectedTree.connId]?.name || `Conn #${selectedTree.connId}`;
    if (selectedTree.type === 'connection') return `${cName} — Tất cả thư mục`;
    if (selectedTree.group === UNGROUPED_KEY) return `${cName} / (Chưa phân thư mục)`;
    return `${cName} / ${selectedTree.group.split('/').join(' / ')}`;
  }, [selectedTree, connMap]);

  return (
    <div className="space-y-5">
      {/* Backend error banner */}
      {isError && (
        <div className="bg-red-500/15 border border-red-500/40 rounded-xl p-4 flex items-center gap-3 text-red-200">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" aria-hidden="true" />
          <span className="text-sm font-medium">
            Không thể kết nối Backend. Vui lòng kiểm tra tiến trình Industrial Gateway đang chạy.
          </span>
        </div>
      )}

      {/* KPI Stats bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatCard
          icon={Plug}
          label="Connections"
          value={connections.length}
          sublabel={`${connectedCount} online`}
          accentClass="bg-sky-500/15 text-sky-400 border-sky-500/30"
        />
        <StatCard
          icon={Tag}
          label="Total Tags"
          value={tags.length}
          sublabel={`${groupedSections.length} thư mục đang hiển thị`}
          accentClass="bg-violet-500/15 text-violet-400 border-violet-500/30"
        />
        <StatCard
          icon={Activity}
          label="Good Quality"
          value={goodQualityCount}
          sublabel={tags.length ? `${Math.round((goodQualityCount / tags.length) * 100)}% healthy` : '0%'}
          accentClass="bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
        />
        <StatCard
          icon={Wifi}
          label="WebSocket Stream"
          value={isConnected ? 'Live' : 'Offline'}
          sublabel={isConnected ? 'Realtime telemetry' : 'Reconnecting...'}
          accentClass={
            isConnected
              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
              : 'bg-red-500/15 text-red-400 border-red-500/30'
          }
        />
      </div>

      {/* Pinned Realtime Charts */}
      {selectedTagIds.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-emerald-400" aria-hidden="true" />
              <h2 className="font-heading text-base font-bold text-slate-100">
                Realtime Charts ({selectedTagIds.length}/{MAX_CHARTS})
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setSelectedTagIds([])}
              className="inline-flex items-center gap-1.5 text-xs text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg px-2.5 py-1 cursor-pointer transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Bỏ ghim tất cả
            </button>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {selectedTagIds.map((tagId) => {
              const tag = tags.find((t) => t.id === tagId);
              if (!tag) return null;
              const connName = connMap[tag.connection_id]?.name || `Conn #${tag.connection_id}`;
              const folderPrefix = (tag.tag_group || '').trim() ? `${tag.tag_group} / ` : '';
              return (
                <div key={tagId} className="space-y-1.5">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[11px] font-mono text-slate-400 truncate">
                      {connName} &bull; {folderPrefix}
                      <span className="text-slate-200 font-semibold">{tag.name}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleTagChart(tagId)}
                      className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-red-300 cursor-pointer"
                      aria-label={`Bỏ ghim biểu đồ ${tag.name}`}
                    >
                      <X className="w-3.5 h-3.5" />
                      Bỏ ghim
                    </button>
                  </div>
                  <RealtimeChart tagId={tagId} tagName={`${connName} — ${tag.name}`} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main 2-Pane Folder-Grouped Live Table */}
      <div className="grid grid-cols-1 lg:grid-cols-[270px_1fr] gap-4 items-start">
        {/* Left Sidebar: Folder Tree */}
        <aside className="glass-panel rounded-xl border border-slate-800 p-3 space-y-2 lg:sticky lg:top-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
          <div className="flex items-center justify-between px-1.5 pb-1.5 border-b border-slate-800/80">
            <h2 className="font-heading text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
              Cây Thư Mục
            </h2>
            <span className="text-[10px] font-mono text-slate-400">
              {connections.length} kênh
            </span>
          </div>

          <button
            type="button"
            onClick={() => setSelectedTree({ type: 'all', connId: null, group: null })}
            className={`w-full flex items-center justify-between rounded-lg px-2.5 py-2 text-xs transition-colors cursor-pointer ${
              selectedTree.type === 'all'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-semibold'
                : 'text-slate-200 hover:bg-slate-800/70 border border-transparent'
            }`}
          >
            <span className="flex items-center gap-2">
              <Layers className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
              Tất cả Tag
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
              {tags.length}
            </span>
          </button>

          <div className="space-y-1.5 pt-1">
            {treeData.map(({ connection, totalCount, ungroupedCount, folderTree }) => {
              const connKey = `conn:${connection.id}`;
              const isConnCollapsed = collapsedTreeNodes.has(connKey);
              const isConnSelected =
                selectedTree.type === 'connection' && selectedTree.connId === connection.id;
              const hasTreeChildren = folderTree.length > 0 || ungroupedCount > 0;

              return (
                <div key={connection.id} className="space-y-0.5">
                  <div
                    onClick={() =>
                      setSelectedTree({ type: 'connection', connId: connection.id, group: null })
                    }
                    className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-colors cursor-pointer ${
                      isConnSelected
                        ? 'bg-sky-500/20 text-sky-200 border border-sky-500/40 font-semibold'
                        : 'text-slate-200 hover:bg-slate-800/70 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      {hasTreeChildren ? (
                        <button
                          type="button"
                          onClick={(e) => handleToggleTreeNode(connKey, e)}
                          className="p-0.5 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-700/60 cursor-pointer shrink-0"
                          aria-label={isConnCollapsed ? `Mở rộng ${connection.name}` : `Thu gọn ${connection.name}`}
                        >
                          {isConnCollapsed ? (
                            <ChevronRight className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                          )}
                        </button>
                      ) : (
                        <span className="w-4 shrink-0" />
                      )}
                      <Network
                        className={`w-3.5 h-3.5 shrink-0 ${
                          connection.connected ? 'text-emerald-400' : 'text-slate-500'
                        }`}
                        aria-hidden="true"
                      />
                      <span className="truncate font-semibold">{connection.name}</span>
                    </div>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 ml-1.5 shrink-0">
                      {totalCount}
                    </span>
                  </div>

                  {hasTreeChildren && !isConnCollapsed && (
                    <div className="space-y-0.5 border-l border-slate-800 ml-3 pl-0.5">
                      {folderTree.map((node) => (
                        <FolderTreeNode
                          key={node.fullPath}
                          node={node}
                          conn={connection}
                          depth={0}
                          selectedTree={selectedTree}
                          onSelectGroup={(connId, fullPath) =>
                            setSelectedTree({ type: 'group', connId, group: fullPath })
                          }
                          collapsedTreeNodes={collapsedTreeNodes}
                          onToggleCollapse={handleToggleTreeNode}
                        />
                      ))}

                      {ungroupedCount > 0 && (
                        <div
                          onClick={() =>
                            setSelectedTree({
                              type: 'group',
                              connId: connection.id,
                              group: UNGROUPED_KEY,
                            })
                          }
                          className={`flex items-center justify-between rounded-lg px-2 py-1.5 pl-6 text-xs transition-colors cursor-pointer ${
                            selectedTree.type === 'group' &&
                            selectedTree.connId === connection.id &&
                            selectedTree.group === UNGROUPED_KEY
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-semibold'
                              : 'text-slate-400 hover:bg-slate-800/70 border border-transparent'
                          }`}
                        >
                          <span className="flex items-center gap-1.5 truncate">
                            <Folder className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
                            <span className="truncate italic">(Chưa phân thư mục)</span>
                          </span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 ml-1.5 shrink-0">
                            {ungroupedCount}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        {/* Right Pane: Toolbar + Folder-Grouped Live Table */}
        <div className="glass-panel rounded-xl border border-slate-800 overflow-hidden min-w-0">
          {/* Toolbar */}
          <div className="p-3.5 border-b border-slate-800 bg-[#0F172A]/60 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="font-heading text-sm font-bold text-slate-100 truncate">
                {scopeTitle}
              </h2>
              <span className="text-[11px] font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full shrink-0">
                {filteredTags.length} tag
              </span>
              {selectedTagIds.length > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full shrink-0">
                  <BarChart3 className="w-3 h-3" aria-hidden="true" />
                  {selectedTagIds.length}/{MAX_CHARTS}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Search input */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Tìm tên tag, địa chỉ, thư mục..."
                  className="bg-[#0F172A] border border-slate-700 rounded-lg pl-8 pr-7 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 w-52 focus:outline-none focus:border-emerald-500"
                />
                {searchText && (
                  <button
                    type="button"
                    onClick={() => setSearchText('')}
                    className="p-0.5 text-slate-400 hover:text-slate-200 absolute right-1.5 top-1/2 -translate-y-1/2 cursor-pointer"
                    aria-label="Xóa từ khóa tìm kiếm"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Quality filter pills */}
              <div className="inline-flex rounded-lg border border-slate-700 bg-[#0F172A] p-0.5 text-[11px]">
                {[
                  { id: 'all', label: 'Tất cả' },
                  { id: 'good', label: 'Good' },
                  { id: 'bad', label: 'Lỗi' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setQualityFilter(opt.id)}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                      qualityFilter === opt.id
                        ? opt.id === 'bad'
                          ? 'bg-red-500/25 text-red-300'
                          : opt.id === 'good'
                          ? 'bg-emerald-500/25 text-emerald-300'
                          : 'bg-slate-700 text-slate-100'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Collapse / Expand All Folder Sections */}
              {groupedSections.length > 0 && (
                <button
                  type="button"
                  onClick={handleToggleAllSections}
                  className="inline-flex items-center gap-1.5 text-xs text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg px-2.5 py-1.5 cursor-pointer transition-colors"
                >
                  <ChevronsUpDown className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                  {allGroupsCollapsed ? 'Mở rộng tất cả' : 'Thu gọn tất cả'}
                </button>
              )}
            </div>
          </div>

          {/* Loading / Empty / Table */}
          {isLoading ? (
            <div className="flex items-center justify-center h-48 text-slate-400">
              <div className="text-center">
                <div className="w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <p className="text-xs font-mono">Đang tải dữ liệu Live Tags...</p>
              </div>
            </div>
          ) : groupedSections.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <Tag className="w-9 h-9 mx-auto mb-2.5 opacity-30" aria-hidden="true" />
              <p className="text-sm font-medium text-slate-300">
                {tags.length === 0
                  ? 'Chưa có tag nào được cấu hình. Hãy vào trang Tags để thêm hoặc quét OPC.'
                  : 'Không có tag nào khớp với thư mục hoặc bộ lọc hiện tại.'}
              </p>
              {tags.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTree({ type: 'all', connId: null, group: null });
                    setSearchText('');
                    setQualityFilter('all');
                  }}
                  className="mt-3 px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg cursor-pointer"
                >
                  Đặt lại bộ lọc
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-auto max-h-[calc(100vh-230px)]">
              <table className="w-full text-xs">
                <thead className="bg-[#11192A] border-b border-slate-800 text-slate-400 sticky top-0 z-10">
                  <tr>
                    <th className="px-3 py-2.5 w-14 text-center font-semibold">Biểu đồ</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Tên Tag</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Địa chỉ</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Giá trị Live</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Kiểu</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Chất lượng</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Cập nhật</th>
                    <th className="px-3 py-2.5 w-14 text-center font-semibold">Ghi</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedSections.map((section) => {
                    const isCollapsed = collapsedTableGroups.has(section.key);
                    const isExactScoped =
                      selectedTree.type === 'group' &&
                      selectedTree.connId === section.connectionId &&
                      selectedTree.group === section.folderKey;

                    return (
                      <React.Fragment key={section.key}>
                        <FolderSectionHeader
                          section={section}
                          isCollapsed={isCollapsed}
                          isExactScoped={isExactScoped}
                          onToggleSection={handleToggleTableSection}
                          onFocusFolder={(connId, folderKey) =>
                            setSelectedTree({ type: 'group', connId, group: folderKey })
                          }
                        />
                        {!isCollapsed &&
                          section.tags.map((tag) => (
                            <TagTableRow
                              key={tag.id}
                              tag={tag}
                              isSelected={selectedTagIds.includes(tag.id)}
                              chartLimitReached={selectedTagIds.length >= MAX_CHARTS}
                              isAdmin={isAdmin}
                              onToggleChart={toggleTagChart}
                              onOpenWrite={(t, curVal) =>
                                setWriteTarget({ tag: t, initialValue: curVal })
                              }
                            />
                          ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {isAdmin && writeTarget && (
        <QuickWriteModal
          tag={writeTarget.tag}
          initialValue={writeTarget.initialValue}
          onClose={() => setWriteTarget(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['tags'] })}
        />
      )}
    </div>
  );
}
