import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import { 
  Plus, 
  Edit2, 
  Trash2, 
  PenLine, 
  Tag as TagIcon, 
  Search, 
  X, 
  Folder, 
  FolderOpen, 
  FolderPlus,
  Download, 
  Upload, 
  FileSpreadsheet,
  Layers,
  ChevronRight,
  ChevronDown,
  Sparkles,
  Network,
  Database,
  Copy,
  ClipboardPaste,
  Lock,
  Replace,
  SlidersHorizontal,
  Cpu
} from 'lucide-react';
import { 
  fetchTags, 
  deleteTag, 
  writeTagValue, 
  importTagsBatch,
  fetchTagGroups,
  createTagGroup,
  renameTagGroup,
  deleteTagGroupByName,
  pasteTags,
  pasteTagGroup
} from '../api/tags';
import { fetchConnections } from '../api/connections';
import TagForm from '../components/TagForm';
import AutoTagModal from '../components/AutoTagModal';
import OpcDaBrowserModal from '../components/OpcDaBrowserModal';
import OpcUaBrowserModal from '../components/OpcUaBrowserModal';
import BulkEditModal from '../components/BulkEditModal';
import FindReplaceModal from '../components/FindReplaceModal';
import S7ImportModal from '../components/S7ImportModal';
import StatusBadge from '../components/StatusBadge';
import useStore from '../store/useStore';
import { formatValue } from '../utils/helpers';

// Modal tạo Thư mục (Group) mới - hỗ trợ thư mục con đa cấp (Nested Subfolders)
function CreateGroupModal({ connections, defaultConnId, initialParentGroup, existingGroups = [], onClose, onSuccess }) {
  const [connectionId, setConnectionId] = useState(defaultConnId || connections[0]?.id || '');
  const [parentGroup, setParentGroup] = useState(initialParentGroup || '');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  // Danh sách thư mục cha khả dụng (loại bỏ 'default')
  const availableParents = useMemo(() => {
    return Array.from(
      new Set(
        existingGroups
          .filter((g) => g && g.toLowerCase() !== 'default')
          .sort()
      )
    );
  }, [existingGroups]);

  const fullPath = useMemo(() => {
    const trimmed = name.trim();
    if (!trimmed) return parentGroup || '';
    return parentGroup ? `${parentGroup}/${trimmed}` : trimmed;
  }, [parentGroup, name]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    const finalName = parentGroup ? `${parentGroup}/${name.trim()}` : name.trim();
    try {
      await createTagGroup({
        connection_id: parseInt(connectionId, 10),
        name: finalName,
        description: description.trim(),
      });
      toast.success(`Đã tạo thư mục '${finalName}' thành công`);
      onSuccess?.(parseInt(connectionId, 10), finalName);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || err.message || 'Lỗi khi tạo thư mục');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <FolderPlus className="w-5 h-5 text-amber-500" /> Tạo Thư Mục {parentGroup ? 'Con' : ''} (Group)
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg cursor-pointer">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1">Thuộc Kết Nối (Channel) *</label>
            <select
              value={connectionId}
              onChange={(e) => setConnectionId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500"
            >
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.protocol.toUpperCase()})
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-gray-700">Thư Mục Cha (Parent Folder)</label>
              {parentGroup && (
                <button
                  type="button"
                  onClick={() => setParentGroup('')}
                  className="text-[11px] text-blue-600 hover:underline cursor-pointer"
                >
                  Đặt làm gốc (Root)
                </button>
              )}
            </div>
            <select
              value={parentGroup}
              onChange={(e) => setParentGroup(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500"
            >
              <option value="">-- [Thư mục gốc (Root - Không có cha)] --</option>
              {availableParents.map((g) => (
                <option key={g} value={g}>
                  📂 {g}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1">
              {parentGroup ? 'Tên Thư Mục Con *' : 'Tên Thư Mục *'}
            </label>
            <input
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={parentGroup ? "ví dụ: May_1, Tram_2..." : "ví dụ: Area_1, Khu_Vuc_A..."}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Đường dẫn thư mục hoàn chỉnh */}
          <div className="bg-blue-50/70 border border-blue-200 rounded-lg p-2.5 text-xs text-blue-900 flex items-start gap-2">
            <Folder className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <span className="text-gray-500 block text-[11px]">Đường dẫn thư mục đầy đủ:</span>
              <span className="font-mono font-bold text-blue-800 break-all">
                {fullPath || '(chưa nhập tên)'}
              </span>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1">Mô tả (tùy chọn)</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ghi chú về thư mục này..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            >
              {loading ? 'Đang tạo...' : 'Tạo Thư Mục'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Modal Đổi tên Thư mục (Rename Group)
function RenameGroupModal({ connectionId, currentName, connName, onClose, onSuccess }) {
  const [newName, setNewName] = useState(currentName);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newName.trim() || newName.trim() === currentName) {
      onClose();
      return;
    }
    setLoading(true);
    try {
      const res = await renameTagGroup({
        connection_id: connectionId,
        old_name: currentName,
        new_name: newName.trim(),
      });
      toast.success(res.message || `Đã đổi tên thành '${newName.trim()}'`);
      onSuccess?.(connectionId, newName.trim());
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || err.message || 'Lỗi khi đổi tên thư mục');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <Edit2 className="w-5 h-5 text-blue-600" /> Đổi Tên Thư Mục
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg cursor-pointer">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Kênh: <strong>{connName}</strong> • Tên cũ: <span className="font-mono text-amber-600 font-semibold">{currentName}</span>
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1">Tên Thư Mục Mới *</label>
            <input
              autoFocus
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nhập tên mới..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-[11px] text-gray-400 mt-1 block">
              Tất cả các tag trong thư mục này sẽ tự động cập nhật theo tên mới.
            </span>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading || !newName.trim()}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            >
              {loading ? 'Đang lưu...' : 'Lưu Tên Mới'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Modal Xác nhận Xóa Thư mục (Delete Group)
function DeleteGroupConfirmModal({ connectionId, groupName, connName, tagCount, onClose, onSuccess }) {
  const [deleteTags, setDeleteTags] = useState(true);
  const [loading, setLoading] = useState(false);
  const isDefault = (groupName || '').toLowerCase() === 'default';

  const handleConfirm = async () => {
    setLoading(true);
    try {
      const res = await deleteTagGroupByName(connectionId, groupName, deleteTags);
      toast.success(res.message || `Đã xóa thư mục '${groupName}'`);
      onSuccess?.(connectionId);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || err.message || 'Lỗi khi xóa thư mục');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-red-600 flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-red-600" /> Xác Nhận Xóa Thư Mục
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg cursor-pointer">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>
        <p className="text-xs text-gray-700 mb-3">
          Bạn có chắc chắn muốn xóa thư mục <strong className="text-amber-700 font-mono text-sm">'{groupName}'</strong> của kênh <strong>'{connName}'</strong>?
        </p>

        {tagCount === 0 ? (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-600 mb-4">
            Thư mục này hiện đang trống (0 tags).
          </div>
        ) : (
          <>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 mb-3">
              Thư mục này hiện đang chứa <strong>{tagCount} tags</strong>.
            </div>
            {!isDefault ? (
              <>
                <label className="flex items-center gap-2 text-xs text-gray-700 mb-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deleteTags}
                    onChange={(e) => setDeleteTags(e.target.checked)}
                    className="rounded text-red-600 focus:ring-red-500"
                  />
                  <span>Xóa luôn toàn bộ {tagCount} tags trong thư mục này</span>
                </label>
                {!deleteTags && (
                  <p className="text-[11px] text-gray-500 mb-4 italic">
                    * Các tags sẽ được giữ lại ở kênh chính (không thuộc thư mục nào).
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-red-600 mb-4 font-medium">
                * Khi xóa thư mục 'default', toàn bộ {tagCount} tags bên trong cũng sẽ được xóa. (Nếu muốn giữ tags dưới tên thư mục khác, hãy dùng nút Đổi tên thư mục).
              </p>
            )}
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors cursor-pointer"
          >
            Hủy
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={handleConfirm}
            className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
          >
            {loading ? 'Đang xóa...' : 'Xóa Thư Mục'}
          </button>
        </div>
      </div>
    </div>
  );
}

function WriteValueDialog({ tag, onClose }) {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await writeTagValue(tag.id, value);
      toast.success(`Value written to ${tag.name}`);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || err.message || 'Write failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 shadow-2xl max-w-sm w-full mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">Write Value</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-3">
          Tag: <strong>{tag.name}</strong> ({tag.data_type})
        </p>
        <form onSubmit={handleSubmit}>
          {tag.data_type === 'bool' ? (
            <div className="flex gap-3 mb-4">
              <button
                type="button"
                onClick={() => setValue('1')}
                className={`flex-1 py-2 rounded-lg font-semibold text-sm border transition-colors cursor-pointer ${
                  value === '1'
                    ? 'bg-green-600 text-white border-green-600'
                    : 'bg-gray-50 text-gray-700 border-gray-300 hover:bg-gray-100'
                }`}
              >
                TRUE (1)
              </button>
              <button
                type="button"
                onClick={() => setValue('0')}
                className={`flex-1 py-2 rounded-lg font-semibold text-sm border transition-colors cursor-pointer ${
                  value === '0'
                    ? 'bg-red-600 text-white border-red-600'
                    : 'bg-gray-50 text-gray-700 border-gray-300 hover:bg-gray-100'
                }`}
              >
                FALSE (0)
              </button>
            </div>
          ) : (
            <input
              autoFocus
              required
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={`Enter ${tag.data_type} value`}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || value === ''}
              className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            >
              {loading ? 'Writing...' : 'Write'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Helper xây dựng cây thư mục lồng nhau (Hierarchical Subfolder Tree)
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
    if (t.tag_group && t.tag_group.trim()) {
      ensureNode(t.tag_group.trim());
    }
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

// Recursive Tree Node component cho từng thư mục trong cây
function TreeNode({
  node,
  conn,
  depth = 0,
  selectedTree,
  onSelectGroup,
  onAddSubfolder,
  onCopy,
  onRename,
  onDelete,
  collapsedNodes,
  onToggleCollapse,
}) {
  const nodeKey = `${conn.id}:${node.fullPath}`;
  const hasChildren = node.children && node.children.length > 0;
  const isCollapsed = collapsedNodes.has(nodeKey);
  const isSelected =
    selectedTree.type === 'group' &&
    selectedTree.connId === conn.id &&
    selectedTree.group === node.fullPath;

  return (
    <div className="space-y-0.5">
      <div
        className={`group/item w-full flex items-center justify-between rounded px-2 py-1 transition-colors ${
          isSelected
            ? 'bg-blue-600 text-white font-semibold shadow-xs'
            : 'text-gray-600 hover:bg-gray-100'
        }`}
        style={{ paddingLeft: `${Math.max(6, depth * 14 + 6)}px` }}
      >
        <div className="flex items-center gap-1 flex-1 min-w-0">
          {/* Chevron mở/thu gọn thư mục con */}
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => onToggleCollapse(nodeKey, e)}
              className={`p-0.5 rounded hover:bg-black/10 cursor-pointer ${
                isSelected ? 'text-white' : 'text-gray-400 hover:text-gray-700'
              }`}
              title={isCollapsed ? 'Mở rộng thư mục' : 'Thu gọn thư mục'}
            >
              {isCollapsed ? (
                <ChevronRight className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 shrink-0" />
              )}
            </button>
          ) : (
            <span className="w-3.5 h-3.5 inline-block shrink-0" />
          )}

          {/* Nút bấm chọn thư mục */}
          <button
            type="button"
            onClick={() => onSelectGroup(conn.id, node.fullPath)}
            className="flex items-center gap-1.5 truncate text-left text-xs flex-1 cursor-pointer min-w-0"
            title={node.fullPath}
          >
            {hasChildren && !isCollapsed ? (
              <FolderOpen
                className={`w-3.5 h-3.5 shrink-0 ${
                  isSelected ? 'text-white' : 'text-amber-500'
                }`}
              />
            ) : (
              <Folder
                className={`w-3.5 h-3.5 shrink-0 ${
                  isSelected ? 'text-white' : 'text-amber-500'
                }`}
              />
            )}
            <span className="truncate">{node.name}</span>
          </button>
        </div>

        {/* Nút thao tác nhanh & Số lượng tags */}
        <div className="flex items-center gap-1 pl-1 shrink-0">
          <div className="hidden group-hover/item:flex items-center gap-0.5">
            {/* Nút Tạo thư mục con */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAddSubfolder(conn.id, node.fullPath);
              }}
              className={`p-1 rounded hover:bg-black/10 transition-colors cursor-pointer ${
                isSelected
                  ? 'text-white hover:text-white'
                  : 'text-gray-400 hover:text-amber-600'
              }`}
              title={`Tạo thư mục con bên trong '${node.fullPath}'`}
            >
              <FolderPlus className="w-3 h-3" />
            </button>

            {/* Nút Copy thư mục */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCopy(conn.id, node.fullPath);
              }}
              className={`p-1 rounded hover:bg-black/10 transition-colors cursor-pointer ${
                isSelected
                  ? 'text-white hover:text-white'
                  : 'text-gray-400 hover:text-emerald-400'
              }`}
              title={`Copy thư mục '${node.fullPath}'`}
            >
              <Copy className="w-3 h-3" />
            </button>

            {/* Nút Đổi tên */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRename(conn.id, node.fullPath, conn.name);
              }}
              className={`p-1 rounded hover:bg-black/10 transition-colors cursor-pointer ${
                isSelected
                  ? 'text-white hover:text-white'
                  : 'text-gray-400 hover:text-blue-600'
              }`}
              title={`Đổi tên thư mục '${node.fullPath}'`}
            >
              <Edit2 className="w-3 h-3" />
            </button>

            {/* Nút Xóa */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(conn.id, node.fullPath, conn.name, node.totalCount);
              }}
              className={`p-1 rounded hover:bg-black/10 transition-colors cursor-pointer ${
                isSelected
                  ? 'text-white hover:text-white'
                  : 'text-gray-400 hover:text-red-600'
              }`}
              title={`Xóa thư mục '${node.fullPath}'`}
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>

          <span
            className={`text-[10px] font-mono px-1 rounded ${
              isSelected ? 'text-blue-100 bg-blue-700/50' : 'text-gray-400'
            }`}
            title={
              node.totalCount !== node.directCount
                ? `${node.directCount} tag trực tiếp, tổng ${node.totalCount} tag bao gồm thư mục con`
                : `${node.totalCount} tags`
            }
          >
            {node.totalCount}
          </span>
        </div>
      </div>

      {/* Đệ quy hiển thị các thư mục con nếu không bị thu gọn */}
      {hasChildren && !isCollapsed && (
        <div className="space-y-0.5 border-l border-gray-200/60 ml-2.5">
          {node.children.map((child) => (
            <TreeNode
              key={child.fullPath}
              node={child}
              conn={conn}
              depth={depth + 1}
              selectedTree={selectedTree}
              onSelectGroup={onSelectGroup}
              onAddSubfolder={onAddSubfolder}
              onCopy={onCopy}
              onRename={onRename}
              onDelete={onDelete}
              collapsedNodes={collapsedNodes}
              onToggleCollapse={onToggleCollapse}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Tags() {
  const queryClient = useQueryClient();
  const tagValues = useStore((s) => s.tagValues);

  const [showForm, setShowForm] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [createGroupParent, setCreateGroupParent] = useState(null);
  const [createGroupConnId, setCreateGroupConnId] = useState(null);
  const [showAutoTag, setShowAutoTag] = useState(false);
  const [showOpcDaBrowser, setShowOpcDaBrowser] = useState(false);
  const [showOpcUaBrowser, setShowOpcUaBrowser] = useState(false);
  const [editTag, setEditTag] = useState(null);
  const [writeTag, setWriteTag] = useState(null);
  const [search, setSearch] = useState('');
  const [renameGroup, setRenameGroup] = useState(null); // { connId, groupName, connName }
  const [deleteGroupTarget, setDeleteGroupTarget] = useState(null); // { connId, groupName, connName, count }

  // Copy / Paste Clipboard (tags hoặc thư mục) + chọn nhiều tag
  const [clipboard, setClipboard] = useState(null); // { type: 'tags', tagIds, label } | { type: 'group', connId, groupName }
  const [selectedTagIds, setSelectedTagIds] = useState(() => new Set());
  const [pasting, setPasting] = useState(false);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [showS7Import, setShowS7Import] = useState(false);
  
  // Quản lý thu gọn/mở rộng thư mục
  const [collapsedNodes, setCollapsedNodes] = useState(() => new Set());

  const handleToggleCollapse = (nodeKey, e) => {
    if (e) e.stopPropagation();
    setCollapsedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeKey)) next.delete(nodeKey);
      else next.add(nodeKey);
      return next;
    });
  };

  const openCreateGroup = (connId, parentGroup = null) => {
    setCreateGroupConnId(connId || selectedTree.connId || connections[0]?.id);
    setCreateGroupParent(parentGroup);
    setShowCreateGroup(true);
  };

  // Tree selection: { type: 'all' | 'connection' | 'group', connId: number, group: string }
  const [selectedTree, setSelectedTree] = useState({ type: 'all', connId: null, group: null });

  const fileInputRef = useRef(null);

  const { data: connections = [] } = useQuery({
    queryKey: ['connections'],
    queryFn: fetchConnections,
  });

  const { data: tags = [], isLoading } = useQuery({
    queryKey: ['tags'],
    queryFn: () => fetchTags(),
    refetchInterval: 2500,
  });

  const { data: explicitGroups = [] } = useQuery({
    queryKey: ['tagGroups'],
    queryFn: () => fetchTagGroups(),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteTag,
    onSuccess: () => {
      toast.success('Đã xóa tag');
      queryClient.invalidateQueries({ queryKey: ['tags'] });
    },
    onError: (err) => toast.error(err.message || 'Xóa thất bại'),
  });

  const connMap = useMemo(() => {
    return Object.fromEntries(connections.map((c) => [c.id, c]));
  }, [connections]);

  // Merge explicitly created folders and groups derived from tags
  const treeData = useMemo(() => {
    const map = {};
    connections.forEach((c) => {
      map[c.id] = { connection: c, groups: new Set() };
    });

    // Add explicit groups from database
    explicitGroups.forEach((g) => {
      if (!map[g.connection_id]) {
        map[g.connection_id] = { connection: { id: g.connection_id, name: `Conn #${g.connection_id}` }, groups: new Set() };
      }
      if (g.name && g.name.trim()) {
        map[g.connection_id].groups.add(g.name.trim());
      }
    });

    // Add groups from tags
    tags.forEach((t) => {
      const connId = t.connection_id;
      const groupName = (t.tag_group || '').trim();
      if (groupName) {
        if (!map[connId]) {
          map[connId] = { connection: { id: connId, name: `Conn #${connId}` }, groups: new Set() };
        }
        map[connId].groups.add(groupName);
      }
    });

    return Object.values(map).map((item) => {
      const groupList = Array.from(item.groups).sort();
      const connTags = tags.filter((t) => t.connection_id === item.connection.id);
      const folderTree = buildFolderTree(groupList, connTags);
      return {
        ...item,
        groups: groupList,
        folderTree,
      };
    });
  }, [connections, tags, explicitGroups]);

  // List of group names for datalist autocomplete
  const currentConnGroups = useMemo(() => {
    const currentConnId = selectedTree.connId || connections[0]?.id;
    const target = treeData.find((t) => t.connection.id === currentConnId);
    return target ? target.groups : [];
  }, [treeData, selectedTree, connections]);

  // Filter tags based on tree selection and search text (supports hierarchical parent folder matching)
  const filteredTags = useMemo(() => {
    return tags.filter((t) => {
      if (selectedTree.type === 'connection') {
        if (t.connection_id !== selectedTree.connId) return false;
      } else if (selectedTree.type === 'group') {
        if (t.connection_id !== selectedTree.connId) return false;
        const tg = (t.tag_group || '').trim();
        if (tg !== selectedTree.group && !tg.startsWith(selectedTree.group + '/')) return false;
      }

      if (search.trim()) {
        const q = search.toLowerCase();
        const matchName = t.name.toLowerCase().includes(q);
        const matchAddr = t.address.toLowerCase().includes(q);
        const matchDesc = (t.description || '').toLowerCase().includes(q);
        const matchGroup = (t.tag_group || '').toLowerCase().includes(q);
        if (!matchName && !matchAddr && !matchDesc && !matchGroup) return false;
      }

      return true;
    });
  }, [tags, selectedTree, search]);

  // -------------------------------------------------------------
  // COPY / PASTE TAGS & FOLDERS (Ctrl+C / Ctrl+V)
  // -------------------------------------------------------------
  const toggleSelectTag = (tagId) => {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    const allIds = filteredTags.map((t) => t.id);
    const allSelected = allIds.length > 0 && allIds.every((id) => selectedTagIds.has(id));
    if (allSelected) {
      setSelectedTagIds(new Set());
    } else {
      setSelectedTagIds(new Set(allIds));
    }
  };

  const handleCopyTags = useCallback((ids, label) => {
    if (!ids || ids.length === 0) return;
    setClipboard({ type: 'tags', tagIds: ids, label: label || `${ids.length} tag` });
    toast.success(`Đã copy ${label || `${ids.length} tag`} (bấm Paste hoặc Ctrl+V để dán)`);
  }, []);

  const handleCopyGroup = useCallback((connId, groupName) => {
    if (!connId || !groupName) return;
    setClipboard({ type: 'group', connId, groupName });
    toast.success(`Đã copy thư mục '${groupName}' (bấm Paste hoặc Ctrl+V để dán)`);
  }, []);

  const handlePaste = useCallback(async () => {
    if (!clipboard || pasting) return;

    const targetConnId = selectedTree.connId || (clipboard.type === 'group' ? clipboard.connId : connections[0]?.id);
    if (!targetConnId) {
      toast.error('Vui lòng chọn một kênh (Connection) đích trước khi dán');
      return;
    }

    setPasting(true);
    try {
      if (clipboard.type === 'tags') {
        const targetGroup = selectedTree.type === 'group' ? (selectedTree.group || '') : '';
        const res = await pasteTags(clipboard.tagIds, targetConnId, targetGroup);
        toast.success(res.message || `Đã dán ${res.created_count} tag!`);
        queryClient.invalidateQueries({ queryKey: ['tags'] });
        queryClient.invalidateQueries({ queryKey: ['tagGroups'] });
      } else if (clipboard.type === 'group') {
        // Nếu đang đứng đúng thư mục vừa copy trên cùng kênh -> dán cùng cấp (tạo bản sao tăng chỉ số)
        // Nếu đang chọn thư mục khác -> dán làm thư mục con của thư mục đang chọn
        // Nếu đang chọn kênh -> dán ở cấp gốc của kênh đó
        let targetParent = '';
        if (selectedTree.type === 'group' && selectedTree.group) {
          if (selectedTree.connId === clipboard.connId && selectedTree.group === clipboard.groupName) {
            const parts = clipboard.groupName.split('/').filter(Boolean);
            targetParent = parts.slice(0, -1).join('/');
          } else {
            targetParent = selectedTree.group;
          }
        }
        const res = await pasteTagGroup(clipboard.connId, clipboard.groupName, targetConnId, targetParent);
        toast.success(res.message || `Đã dán thư mục '${res.new_group}'!`);
        queryClient.invalidateQueries({ queryKey: ['tags'] });
        queryClient.invalidateQueries({ queryKey: ['tagGroups'] });
        if (res.new_group) {
          setSelectedTree({ type: 'group', connId: targetConnId, group: res.new_group });
        }
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || err.message || 'Lỗi khi dán');
    } finally {
      setPasting(false);
    }
  }, [clipboard, pasting, selectedTree, connections, queryClient, setSelectedTree]);

  // Hỗ trợ phím tắt Ctrl+C / Ctrl+V khi không gõ trong ô nhập liệu
  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        if (selectedTagIds.size > 0) {
          e.preventDefault();
          handleCopyTags(Array.from(selectedTagIds));
        } else if (selectedTree.type === 'group' && selectedTree.connId && selectedTree.group) {
          e.preventDefault();
          handleCopyGroup(selectedTree.connId, selectedTree.group);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        if (clipboard) {
          e.preventDefault();
          handlePaste();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedTagIds, selectedTree, clipboard, handleCopyTags, handleCopyGroup, handlePaste]);

  // -------------------------------------------------------------
  // EXCEL EXPORT
  // -------------------------------------------------------------
  const handleExportExcel = () => {
    if (tags.length === 0) {
      toast.error('Chưa có tag nào để xuất!');
      return;
    }

    const dataToExport = (selectedTree.type === 'all' ? tags : filteredTags).map((t) => {
      const conn = connMap[t.connection_id];
      const tv = tagValues[t.id];
      const grp = (t.tag_group || '').trim();
      const scadaName = t.scada_name || (grp ? `${grp}.${t.name}` : t.name);
      const opcuaNodeId = `ns=2;s=${conn?.name || 'plc'}.${scadaName}`;

      return {
        'ID': t.id,
        'Connection Name': conn?.name || `ID ${t.connection_id}`,
        'Connection ID': t.connection_id,
        'Tag Group (Thư mục)': grp,
        'Tag Name': t.name,
        'Tên SCADA / Kepware Path': scadaName,
        'OPC-UA NodeId': opcuaNodeId,
        'Address': t.address,
        'Data Type': t.data_type,
        'Scan Rate (ms)': t.scan_rate_ms,
        'Access (rw/ro)': t.access || 'rw',
        'Unit': t.unit || '',
        'Scale Type': t.scale_type || 'none',
        'Log Enabled': t.log_enabled === false ? 'FALSE' : 'TRUE',
        'Current Value': tv?.value !== undefined ? tv.value : (t.current_value !== null ? t.current_value : ''),
        'Quality': tv?.quality || t.quality || 'Unknown',
        'Description': t.description || '',
      };
    });

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tags');
    XLSX.writeFile(wb, `IndustrialGateway_Tags_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success('Xuất file Excel thành công!');
  };

  // -------------------------------------------------------------
  // EXCEL TEMPLATE DOWNLOAD
  // -------------------------------------------------------------
  const handleDownloadTemplate = () => {
    const currentConn = connMap[selectedTree.connId] || connections[0];
    const targetConnId = currentConn?.id || 2;
    const targetConnName = currentConn?.name || 'plc';
    const targetGroup = selectedTree.group || 'BOM_1';

    const templateData = [
      {
        'Connection ID': targetConnId,
        'Connection Name (Ghi chú)': targetConnName,
        'Tag Group (Thư mục)': 'BOM_1',
        'Tag Name': 'ACK',
        'Address': 'DB21.DBX23.0',
        'Data Type (bool/int16/int32/float32/string)': 'bool',
        'Scan Rate (ms)': 100,
        'Description': 'Xác nhận Bơm 1 -> SCADA: BOM_1.ACK',
      },
      {
        'Connection ID': targetConnId,
        'Connection Name (Ghi chú)': targetConnName,
        'Tag Group (Thư mục)': 'BOM_1',
        'Tag Name': 'TIME',
        'Address': 'DB21.DBD158',
        'Data Type (bool/int16/int32/float32/string)': 'float32',
        'Scan Rate (ms)': 100,
        'Description': 'Thời gian chạy Bơm 1 -> SCADA: BOM_1.TIME',
      },
      {
        'Connection ID': targetConnId,
        'Connection Name (Ghi chú)': targetConnName,
        'Tag Group (Thư mục)': 'BOM_2',
        'Tag Name': 'ACK',
        'Address': 'DB22.DBX23.0',
        'Data Type (bool/int16/int32/float32/string)': 'bool',
        'Scan Rate (ms)': 100,
        'Description': 'Xác nhận Bơm 2 -> SCADA: BOM_2.ACK',
      },
      {
        'Connection ID': targetConnId,
        'Connection Name (Ghi chú)': targetConnName,
        'Tag Group (Thư mục)': 'BOM_2',
        'Tag Name': 'TIME',
        'Address': 'DB22.DBD158',
        'Data Type (bool/int16/int32/float32/string)': 'float32',
        'Scan Rate (ms)': 100,
        'Description': 'Thời gian chạy Bơm 2 -> SCADA: BOM_2.TIME',
      },
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tag_Template');
    XLSX.writeFile(wb, `Mau_Nhap_Tag_${targetGroup}.xlsx`);
    toast.success('Đã tải file mẫu Excel');
  };

  // -------------------------------------------------------------
  // EXCEL IMPORT WITH DEDUPLICATION & TARGET FOLDER ASSIGNMENT
  // -------------------------------------------------------------
  const handleImportFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const rawJson = XLSX.utils.sheet_to_json(ws);

        if (!rawJson || rawJson.length === 0) {
          toast.error('File Excel không có dữ liệu!');
          return;
        }

        const validTags = [];
        // Nếu đang chọn một group hoặc connection cụ thể, tự gán nếu trong excel thiếu
        const fallbackConnId = selectedTree.connId || connections[0]?.id;
        const fallbackGroup = selectedTree.group || '';

        for (const row of rawJson) {
          const connId = parseInt(row['Connection ID'] || row['connection_id']) || fallbackConnId;
          const tagName = String(row['Tag Name'] || row['name'] || '').trim();
          const address = String(row['Address'] || row['address'] || '').trim();
          const dataType = String(row['Data Type (bool/int16/int32/float32/string)'] || row['Data Type'] || row['data_type'] || 'float32').trim().toLowerCase();
          
          // Thư mục đích: nếu trong Excel có cột thì lấy theo Excel, nếu trống thì vào thư mục đang đứng
          let tagGroup = String(row['Tag Group (Thư mục)'] || row['Tag Group'] || row['tag_group'] || '').trim();
          if (!tagGroup) {
            tagGroup = fallbackGroup;
          }

          const scanRate = parseInt(row['Scan Rate (ms)'] || row['scan_rate_ms']) || 100;
          const desc = String(row['Description'] || row['description'] || '');
          const rawAccess = String(row['Access (rw/ro)'] || row['access'] || 'rw').trim().toLowerCase();
          const access = rawAccess === 'ro' ? 'ro' : 'rw';
          const unit = String(row['Unit'] || row['unit'] || '').trim();
          const rawScale = String(row['Scale Type'] || row['scale_type'] || 'none').trim().toLowerCase();
          const scaleType = ['none', 'linear', 'factor'].includes(rawScale) ? rawScale : 'none';
          const rawLog = row['Log Enabled'] !== undefined ? row['Log Enabled'] : row['log_enabled'];
          const logEnabled = rawLog === undefined
            ? true
            : !['false', '0', 'no', 'off'].includes(String(rawLog).trim().toLowerCase());

          if (connId && tagName && address) {
            validTags.push({
              connection_id: connId,
              name: tagName,
              address: address,
              data_type: dataType,
              tag_group: tagGroup,
              scan_rate_ms: scanRate,
              description: desc,
              access: access,
              unit: unit,
              scale_type: scaleType,
              log_enabled: logEnabled,
              enabled: true,
            });
          }
        }

        if (validTags.length === 0) {
          toast.error('Không tìm thấy dòng dữ liệu hợp lệ trong Excel!');
          return;
        }

        toast.loading(`Đang nhập ${validTags.length} tags...`, { id: 'importing' });
        const res = await importTagsBatch(validTags);
        
        toast.success(
          res.message || `Đã import xong: ${res.count} tag mới, bỏ qua ${res.skipped} tag trùng lặp!`, 
          { id: 'importing', duration: 4000 }
        );
        queryClient.invalidateQueries({ queryKey: ['tags'] });
        queryClient.invalidateQueries({ queryKey: ['tagGroups'] });
      } catch (err) {
        toast.error('Lỗi khi đọc file Excel: ' + err.message, { id: 'importing' });
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsBinaryString(file);
  };

  return (
    <div className="space-y-4">
      {/* Top action bar (Sticky pinned beneath top header) */}
      <div className="sticky top-14 z-20 glass-panel rounded-xl shadow-md p-3.5 mb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition-all">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Layers className="w-5 h-5 text-blue-600" /> Tag Management
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Quản lý cây thư mục Channels & Groups giống Kepware • Nhập xuất Excel chống trùng lặp tag
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Nút Tạo Thư Mục Mới */}
          <button
            onClick={() => openCreateGroup(selectedTree.connId, null)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors cursor-pointer"
            title="Tạo thêm thư mục (Group) mới cho Connection"
          >
            <FolderPlus className="w-4 h-4 text-amber-600" />
            + Thư Mục Mới
          </button>

          {/* Nút Tải Mẫu Excel */}
          <button
            onClick={handleDownloadTemplate}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors cursor-pointer"
            title="Tải file Excel mẫu đúng thư mục đang chọn"
          >
            <Download className="w-3.5 h-3.5 text-gray-500" />
            File Mẫu
          </button>

          {/* Nút Import Excel */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImportFile}
            accept=".xlsx, .xls, .csv"
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 rounded-lg transition-colors cursor-pointer"
            title="Nhập tags từ Excel (tự động phân vào thư mục & bỏ qua tag trùng lặp)"
          >
            <Upload className="w-3.5 h-3.5 text-green-600" />
            Import Excel
          </button>

          {/* Nút Export Excel */}
          <button
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors cursor-pointer"
            title="Xuất tags ra file Excel"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-blue-600" />
            Export Excel
          </button>

          {/* Nút Auto Tag (MQTT / JSON) Kepware Style */}
          <button
            onClick={() => setShowAutoTag(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg transition-colors cursor-pointer shadow-2xs"
            title="Tự động quét Topic MQTT và trích xuất các node trong JSON để tạo Tag giống Kepware"
          >
            <Sparkles className="w-4 h-4 text-purple-600" />
            Auto Tag (JSON)
          </button>

          {/* Nút Duyệt & Scan Tag OPC DA (Classic) */}
          <button
            onClick={() => setShowOpcDaBrowser(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-cyan-700 bg-cyan-50 hover:bg-cyan-100 border border-cyan-200 rounded-lg transition-colors cursor-pointer shadow-2xs"
            title="Duyệt cây địa chỉ OPC DA (Kepware / Phoenix Contact) và import tags vào Gateway"
          >
            <Database className="w-4 h-4 text-cyan-600" />
            Scan OPC DA
          </button>

          {/* Nút Duyệt & Scan Tag OPC UA */}
          <button
            onClick={() => setShowOpcUaBrowser(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors cursor-pointer shadow-2xs"
            title="Duyệt cây NodeId OPC-UA và import tags vào Gateway"
          >
            <Network className="w-4 h-4 text-indigo-600" />
            Scan OPC UA
          </button>

          {/* Nút Import từ file lập trình Siemens TIA Portal (S7) */}
          <button
            onClick={() => setShowS7Import(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors cursor-pointer shadow-2xs"
            title="Import hàng loạt Tag từ file TIA Portal (.db, .xlsx, .xml) hoặc dán bảng Offset DB"
          >
            <Cpu className="w-4 h-4 text-amber-600" />
            Import TIA S7
          </button>

          {/* Add Tag */}
          <button
            onClick={() => { setEditTag(null); setShowForm(true); }}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm cursor-pointer ml-1"
          >
            <Plus className="w-4 h-4" />
            Add Tag
          </button>
        </div>
      </div>

      {/* Main Container: 2 Cột (Trái: Treeview Thư mục, Phải: Table Danh sách) */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-start">
        
        {/* CỘT TRÁI: KEPWARE TREEVIEW (CHANNELS & FOLDERS) */}
        <div className="lg:col-span-1 bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3 sticky top-[125px] max-h-[calc(100vh-145px)] overflow-y-auto">
          <div className="flex items-center justify-between pb-2 border-b border-gray-100">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
              <Folder className="w-4 h-4 text-amber-500" /> Channels & Groups
            </span>
            <button
              onClick={() => openCreateGroup(selectedTree.connId, null)}
              className="p-1 hover:bg-amber-50 rounded text-amber-600 cursor-pointer"
              title="Tạo thêm thư mục mới"
            >
              <FolderPlus className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-1 text-sm">
            {/* Mục Tất Cả */}
            <button
              onClick={() => setSelectedTree({ type: 'all', connId: null, group: null })}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors cursor-pointer ${
                selectedTree.type === 'all'
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-500" /> Tất cả Tags
              </span>
              <span className="text-xs text-gray-400 font-mono">{tags.length}</span>
            </button>

            {/* Danh sách Channel / Connection */}
            {treeData.map(({ connection, folderTree }) => {
              const isConnSelected = selectedTree.type === 'connection' && selectedTree.connId === connection.id;
              const countTagsInConn = tags.filter((t) => t.connection_id === connection.id).length;

              return (
                <div key={connection.id} className="space-y-0.5 pt-1">
                  {/* Channel Row */}
                  <div className="flex items-center justify-between group/conn">
                    <button
                      onClick={() => setSelectedTree({ type: 'connection', connId: connection.id, group: null })}
                      className={`flex-1 flex items-center justify-between px-3 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                        isConnSelected
                          ? 'bg-blue-100 text-blue-800 font-semibold'
                          : 'text-gray-800 hover:bg-gray-100'
                      }`}
                    >
                      <span className="flex items-center gap-2 truncate font-semibold text-xs">
                        <FolderOpen className="w-4 h-4 text-amber-500 flex-shrink-0" />
                        {connection.name}
                      </span>
                      <span className="text-xs text-gray-400 font-mono">{countTagsInConn}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => openCreateGroup(connection.id, null)}
                      className="hidden group-hover/conn:block p-1 hover:bg-amber-100 text-amber-700 rounded transition-colors ml-1 cursor-pointer"
                      title={`Tạo thư mục trong kênh '${connection.name}'`}
                    >
                      <FolderPlus className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Hierarchical Subfolders (Cây thư mục con Kepware) */}
                  <div className="pl-1 space-y-0.5">
                    {folderTree.length === 0 ? (
                      <div className="pl-6 py-1 text-[11px] text-gray-400 italic">
                        Chưa có thư mục
                      </div>
                    ) : (
                      folderTree.map((node) => (
                        <TreeNode
                          key={node.fullPath}
                          node={node}
                          conn={connection}
                          depth={0}
                          selectedTree={selectedTree}
                          onSelectGroup={(connId, grp) => setSelectedTree({ type: 'group', connId, group: grp })}
                          onAddSubfolder={(connId, parentGrp) => openCreateGroup(connId, parentGrp)}
                          onCopy={handleCopyGroup}
                          onRename={(connId, grp, cName) => setRenameGroup({ connId, groupName: grp, connName: cName })}
                          onDelete={(connId, grp, cName, count) => setDeleteGroupTarget({ connId, groupName: grp, connName: cName, count })}
                          collapsedNodes={collapsedNodes}
                          onToggleCollapse={handleToggleCollapse}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* CỘT PHẢI: BẢNG DANH SÁCH TAGS CỦA THƯ MỤC ĐANG CHỌN */}
        <div className="lg:col-span-3 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
          {/* Thanh breadcrumb & Tìm kiếm */}
          <div className="p-3 border-b border-gray-100 bg-gray-50/50 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
              <span className="font-semibold text-gray-700">Vị trí:</span>

              {/* Breadcrumb: Root / All Tags */}
              <button
                type="button"
                onClick={() => setSelectedTree({ type: 'all', connId: null, group: null })}
                className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                  selectedTree.type === 'all'
                    ? 'bg-blue-600 text-white font-semibold shadow-2xs'
                    : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-100'
                }`}
              >
                Tất cả Tags
              </button>

              {/* Breadcrumb: Connection / Channel */}
              {selectedTree.connId && (
                <>
                  <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                  <button
                    type="button"
                    onClick={() => setSelectedTree({ type: 'connection', connId: selectedTree.connId, group: null })}
                    className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                      selectedTree.type === 'connection'
                        ? 'bg-blue-600 text-white font-semibold shadow-2xs'
                        : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    Kênh: {connMap[selectedTree.connId]?.name || selectedTree.connId}
                  </button>
                </>
              )}

              {/* Breadcrumb: Nested Subfolders hierarchy */}
              {selectedTree.type === 'group' && selectedTree.group && (
                (() => {
                  const segments = selectedTree.group.split('/').filter(Boolean);
                  let accum = '';
                  return segments.map((seg, idx) => {
                    accum = accum ? `${accum}/${seg}` : seg;
                    const pathAtStep = accum;
                    const isLast = idx === segments.length - 1;
                    return (
                      <React.Fragment key={pathAtStep}>
                        <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                        <button
                          type="button"
                          onClick={() => setSelectedTree({ type: 'group', connId: selectedTree.connId, group: pathAtStep })}
                          className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                            isLast
                              ? 'bg-blue-600 text-white font-semibold shadow-2xs'
                              : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-100'
                          }`}
                          title={`Xem thư mục '${pathAtStep}'`}
                        >
                          <Folder className="w-3 h-3 inline mr-1 -mt-0.5" aria-hidden="true" />
                          {seg}
                        </button>
                      </React.Fragment>
                    );
                  });
                })()
              )}

              {/* Nút Thao tác Thư mục nhanh trên breadcrumb */}
              {selectedTree.type === 'group' && selectedTree.group && (
                <div className="flex items-center gap-1 ml-1.5">
                  <button
                    type="button"
                    onClick={() => openCreateGroup(selectedTree.connId, selectedTree.group)}
                    className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded transition-colors cursor-pointer shadow-2xs"
                    title={`Tạo thư mục con bên trong '${selectedTree.group}'`}
                  >
                    <FolderPlus className="w-3 h-3 text-amber-600" />
                    + Thư mục con
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setRenameGroup({
                        connId: selectedTree.connId,
                        groupName: selectedTree.group,
                        connName: connMap[selectedTree.connId]?.name,
                      })
                    }
                    className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded transition-colors cursor-pointer shadow-2xs"
                    title="Đổi tên thư mục đang chọn"
                  >
                    <Edit2 className="w-3 h-3 text-blue-600" />
                    Đổi tên
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setDeleteGroupTarget({
                        connId: selectedTree.connId,
                        groupName: selectedTree.group,
                        connName: connMap[selectedTree.connId]?.name,
                        count: filteredTags.length,
                      })
                    }
                    className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded transition-colors cursor-pointer shadow-2xs"
                    title="Xóa thư mục đang chọn"
                  >
                    <Trash2 className="w-3 h-3 text-red-600" />
                    Xóa
                  </button>
                </div>
              )}

              <span className="text-gray-400 font-mono text-[11px] ml-1">({filteredTags.length} tags)</span>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm tên, địa chỉ tag..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Thanh Công Cụ Thao Tác Nhanh (Folder / Connection Action Bar) */}
          <div className="px-3 py-2 bg-[#131C2E] border-b border-slate-700/70 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Add Tag */}
              <button
                onClick={() => { setEditTag(null); setShowForm(true); }}
                className="flex items-center gap-1 px-3 py-1 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-2xs cursor-pointer"
                title={selectedTree.type === 'group' ? `Thêm Tag vào thư mục '${selectedTree.group}'` : 'Thêm Tag mới'}
              >
                <Plus className="w-3.5 h-3.5" />
                Add Tag
              </button>

              {/* Tạo Thư Mục Mới / Thư Mục Con */}
              <button
                onClick={() => openCreateGroup(selectedTree.connId, selectedTree.type === 'group' ? selectedTree.group : null)}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors cursor-pointer"
                title={selectedTree.type === 'group' ? `Tạo thư mục con bên trong '${selectedTree.group}'` : "Tạo thêm thư mục (Group) mới cho Kênh này"}
              >
                <FolderPlus className="w-3.5 h-3.5 text-amber-600" />
                {selectedTree.type === 'group' ? '+ Thư Mục Con' : '+ Thư Mục'}
              </button>

              {/* Import Excel */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-green-800 bg-green-50 hover:bg-green-100 border border-green-200 rounded-lg transition-colors cursor-pointer"
                title="Nhập tags từ Excel"
              >
                <Upload className="w-3.5 h-3.5 text-green-600" />
                Import Excel
              </button>

              {/* Export Excel */}
              <button
                onClick={handleExportExcel}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors cursor-pointer"
                title="Xuất tags ra file Excel"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-blue-600" />
                Export Excel
              </button>

              {/* Nút Scan theo giao thức của Connection đang chọn */}
              {selectedTree.connId && connMap[selectedTree.connId]?.protocol === 'opc_da' && (
                <button
                  onClick={() => setShowOpcDaBrowser(true)}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-cyan-800 bg-cyan-50 hover:bg-cyan-100 border border-cyan-200 rounded-lg transition-colors cursor-pointer"
                  title="Duyệt cây OPC DA và tạo thư mục tự động"
                >
                  <Database className="w-3.5 h-3.5 text-cyan-600" />
                  Scan OPC DA
                </button>
              )}

              {selectedTree.connId && connMap[selectedTree.connId]?.protocol === 'opcua' && (
                <button
                  onClick={() => setShowOpcUaBrowser(true)}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors cursor-pointer"
                  title="Duyệt cây OPC UA và tạo thư mục tự động"
                >
                  <Network className="w-3.5 h-3.5 text-indigo-600" />
                  Scan OPC UA
                </button>
              )}

              {selectedTree.connId && connMap[selectedTree.connId]?.protocol === 'mqtt' && (
                <button
                  onClick={() => setShowAutoTag(true)}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-purple-800 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg transition-colors cursor-pointer"
                  title="Tự động trích xuất tag từ MQTT JSON"
                >
                  <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                  Auto Tag (JSON)
                </button>
              )}

              {/* Copy các tag đang chọn */}
              {selectedTagIds.size > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => handleCopyTags(Array.from(selectedTagIds))}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 rounded-lg transition-colors cursor-pointer"
                    title="Copy các tag đã tích chọn (Ctrl+C)"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Copy ({selectedTagIds.size} tag)
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowBulkEdit(true)}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-amber-300 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 rounded-lg transition-colors cursor-pointer"
                    title="Chỉnh sửa hàng loạt các tag đang chọn"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    Sửa hàng loạt
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowFindReplace(true)}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-sky-300 bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/40 rounded-lg transition-colors cursor-pointer"
                    title="Tìm &amp; thay thế tên/địa chỉ/thư mục trên các tag đang chọn"
                  >
                    <Replace className="w-3.5 h-3.5" />
                    Tìm &amp; Thay
                  </button>
                </>
              )}

              {/* Copy thư mục đang đứng */}
              {selectedTree.type === 'group' && selectedTree.group && (
                <button
                  type="button"
                  onClick={() => handleCopyGroup(selectedTree.connId, selectedTree.group)}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-sky-300 bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/40 rounded-lg transition-colors cursor-pointer"
                  title={`Copy toàn bộ thư mục '${selectedTree.group}'`}
                >
                  <Copy className="w-3.5 h-3.5" />
                  Copy Thư Mục
                </button>
              )}

              {/* Nút Paste từ clipboard */}
              {clipboard && (
                <button
                  type="button"
                  disabled={pasting}
                  onClick={handlePaste}
                  className="flex items-center gap-1 px-3 py-1 text-xs font-bold text-[#0F172A] bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-colors shadow-xs cursor-pointer disabled:opacity-50"
                  title="Dán vào vị trí đang chọn (Ctrl+V). Tự động tăng chỉ số nếu trùng tên!"
                >
                  <ClipboardPaste className="w-3.5 h-3.5" />
                  {pasting
                    ? 'Đang dán...'
                    : clipboard.type === 'tags'
                    ? `Paste ${clipboard.label}`
                    : `Paste '${clipboard.groupName.split('/').pop()}'`}
                </button>
              )}
            </div>

            <div className="text-[11px] text-gray-500 font-medium">
              Đang xem: <span className="font-semibold text-gray-700">{filteredTags.length}</span> / {tags.length} tags
            </div>
          </div>

          {/* Bảng Tags */}
          <div className="overflow-x-auto">
            {isLoading ? (
              <div className="flex items-center justify-center h-48 text-gray-400">
                <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filteredTags.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-gray-400">
                <TagIcon className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-xs">Chưa có tag nào trong thư mục này.</p>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => { setEditTag(null); setShowForm(true); }}
                    className="text-xs text-blue-600 hover:underline cursor-pointer"
                  >
                    + Thêm Tag mới
                  </button>
                  <span className="text-gray-300">•</span>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs text-green-600 hover:underline cursor-pointer"
                  >
                    Import từ Excel
                  </button>
                </div>
              </div>
            ) : (
              <table className="w-full text-left text-xs min-w-[740px]">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 uppercase font-semibold">
                  <tr>
                    <th className="pl-4 pr-2 py-2.5 w-8">
                      <input
                        type="checkbox"
                        checked={filteredTags.length > 0 && filteredTags.every((t) => selectedTagIds.has(t.id))}
                        onChange={toggleSelectAllFiltered}
                        aria-label="Chọn tất cả tag đang hiển thị"
                        className="rounded accent-emerald-500 cursor-pointer"
                      />
                    </th>
                    <th className="px-4 py-2.5">Tag Name</th>
                    <th className="px-4 py-2.5">Thư Mục (Group)</th>
                    <th className="px-4 py-2.5">Tên SCADA (Kepware)</th>
                    <th className="px-4 py-2.5">Connection</th>
                    <th className="px-4 py-2.5">Address</th>
                    <th className="px-4 py-2.5">Type</th>
                    <th className="px-4 py-2.5">Value</th>
                    <th className="px-4 py-2.5">Quality</th>
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredTags.map((tag) => {
                    const tv = tagValues[tag.id];
                    const conn = connMap[tag.connection_id];
                    const val = tv?.value !== undefined ? tv.value : tag.current_value;
                    const quality = tv?.quality || tag.quality || 'Unknown';
                    const grp = (tag.tag_group || '').trim();
                    const scadaName = tag.scada_name || (grp ? `${grp}.${tag.name}` : tag.name);
                    const isChecked = selectedTagIds.has(tag.id);

                    return (
                      <tr key={tag.id} className={`hover:bg-blue-50/40 transition-colors ${isChecked ? 'bg-emerald-500/10' : ''}`}>
                        <td className="pl-4 pr-2 py-2.5">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleSelectTag(tag.id)}
                            aria-label={`Chọn tag ${tag.name}`}
                            className="rounded accent-emerald-500 cursor-pointer"
                          />
                        </td>
                        <td className="px-4 py-2.5 font-bold text-gray-900">
                          <div className="flex items-center flex-wrap gap-1.5">
                            <span>{tag.name}</span>
                            {tag.access === 'ro' && (
                              <span
                                className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/40"
                                title="Read-Only (Cấm ghi từ Client)"
                              >
                                RO
                              </span>
                            )}
                            {tag.scale_type && tag.scale_type !== 'none' && (
                              <span
                                className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-sky-500/15 text-sky-300 border border-sky-500/40"
                                title={`Scaling: ${tag.scale_type}`}
                              >
                                Scale
                              </span>
                            )}
                            {tag.log_enabled === false ? null : (
                              <span
                                className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/40"
                                title="Bật ghi lịch sử (Historian)"
                              >
                                Log
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          {grp ? (
                            <span className="bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded text-[11px] font-mono">
                              {grp}
                            </span>
                          ) : (
                            <span className="text-gray-400 text-xs italic">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <code className="text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded font-mono font-bold text-[11px]" title={`OPC UA: ns=2;s=${conn?.name || 'plc'}.${scadaName}`}>
                            {scadaName}
                          </code>
                        </td>
                        <td className="px-4 py-2.5 text-gray-600 font-medium">{conn?.name || '—'}</td>
                        <td className="px-4 py-2.5 font-mono text-gray-600">{tag.address}</td>
                        <td className="px-4 py-2.5">
                          <span className="bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded font-mono">
                            {tag.data_type}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-bold text-gray-900 font-mono text-sm">
                          {val !== null && val !== undefined ? formatValue(val, tag.data_type) : '—'}
                          {val !== null && val !== undefined && tag.unit ? (
                            <span className="ml-1 text-xs font-normal text-slate-400">{tag.unit}</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusBadge status={quality} size="sm" />
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => handleCopyTags([tag.id], `'${tag.name}'`)}
                              className="p-1 text-gray-400 hover:text-emerald-400 hover:bg-emerald-500/15 rounded transition-colors cursor-pointer"
                              title={`Copy tag '${tag.name}'`}
                              aria-label={`Copy tag ${tag.name}`}
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            {tag.access === 'ro' ? (
                              <span
                                className="p-1 text-amber-400/70 cursor-not-allowed"
                                title="Tag chỉ đọc (Read-Only)"
                                aria-label={`Tag ${tag.name} chỉ đọc`}
                              >
                                <Lock className="w-3.5 h-3.5" />
                              </span>
                            ) : (
                              <button
                                onClick={() => setWriteTag(tag)}
                                className="p-1 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded transition-colors cursor-pointer"
                                title="Ghi giá trị điều khiển"
                              >
                                <PenLine className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              onClick={() => { setEditTag(tag); setShowForm(true); }}
                              className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors cursor-pointer"
                              title="Sửa"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                if (window.confirm(`Xóa tag '${tag.name}'?`)) {
                                  deleteMutation.mutate(tag.id);
                                }
                              }}
                              className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer"
                              title="Xóa"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Forms & Dialogs */}
      {showForm && (
        <TagForm
          tag={editTag}
          connections={connections}
          defaultConnectionId={selectedTree.connId}
          defaultGroup={selectedTree.group || ''}
          existingGroups={currentConnGroups}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['tags'] });
            setShowForm(false);
            setEditTag(null);
          }}
          onClose={() => { setShowForm(false); setEditTag(null); }}
        />
      )}

      {showCreateGroup && (
        <CreateGroupModal
          connections={connections}
          defaultConnId={createGroupConnId || selectedTree.connId || connections[0]?.id}
          initialParentGroup={createGroupParent}
          existingGroups={currentConnGroups}
          onSuccess={(connId, groupName) => {
            queryClient.invalidateQueries({ queryKey: ['tagGroups'] });
            setSelectedTree({ type: 'group', connId, group: groupName });
          }}
          onClose={() => {
            setShowCreateGroup(false);
            setCreateGroupParent(null);
          }}
        />
      )}

      {showAutoTag && (
        <AutoTagModal
          connections={connections}
          defaultConnId={selectedTree.connId}
          defaultGroup={selectedTree.group !== 'default' ? selectedTree.group : ''}
          onClose={() => setShowAutoTag(false)}
          onSuccess={(connId, group) => {
            queryClient.invalidateQueries({ queryKey: ['tags'] });
            queryClient.invalidateQueries({ queryKey: ['tagGroups'] });
            if (connId && group) {
              setSelectedTree({ type: 'group', connId, group });
            }
          }}
        />
      )}

      {showOpcDaBrowser && (
        <OpcDaBrowserModal
          connections={connections}
          initialConnectionId={selectedTree.connId}
          targetParentGroup={selectedTree.type === 'group' ? selectedTree.group : ''}
          onClose={() => setShowOpcDaBrowser(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['tags'] });
            queryClient.invalidateQueries({ queryKey: ['tagGroups'] });
          }}
        />
      )}

      {showOpcUaBrowser && (
        <OpcUaBrowserModal
          connections={connections}
          initialConnectionId={selectedTree.connId}
          targetParentGroup={selectedTree.type === 'group' ? selectedTree.group : ''}
          onClose={() => setShowOpcUaBrowser(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['tags'] });
            queryClient.invalidateQueries({ queryKey: ['tagGroups'] });
          }}
        />
      )}

      {renameGroup && (
        <RenameGroupModal
          connectionId={renameGroup.connId}
          currentName={renameGroup.groupName}
          connName={renameGroup.connName}
          onClose={() => setRenameGroup(null)}
          onSuccess={(connId, newName) => {
            queryClient.invalidateQueries({ queryKey: ['tags'] });
            queryClient.invalidateQueries({ queryKey: ['tagGroups'] });
            if (selectedTree.type === 'group' && selectedTree.group === renameGroup.groupName) {
              setSelectedTree({ type: 'group', connId, group: newName });
            }
          }}
        />
      )}

      {deleteGroupTarget && (
        <DeleteGroupConfirmModal
          connectionId={deleteGroupTarget.connId}
          groupName={deleteGroupTarget.groupName}
          connName={deleteGroupTarget.connName}
          tagCount={deleteGroupTarget.count}
          onClose={() => setDeleteGroupTarget(null)}
          onSuccess={(connId) => {
            queryClient.invalidateQueries({ queryKey: ['tags'] });
            queryClient.invalidateQueries({ queryKey: ['tagGroups'] });
            if (selectedTree.type === 'group' && selectedTree.group === deleteGroupTarget.groupName) {
              setSelectedTree({ type: 'connection', connId, group: null });
            }
          }}
        />
      )}

      {writeTag && (
        <WriteValueDialog tag={writeTag} onClose={() => setWriteTag(null)} />
      )}

      {showBulkEdit && (
        <BulkEditModal
          tagIds={Array.from(selectedTagIds)}
          existingGroups={currentConnGroups}
          onClose={() => setShowBulkEdit(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['tags'] });
            queryClient.invalidateQueries({ queryKey: ['tagGroups'] });
          }}
        />
      )}

      {showFindReplace && (
        <FindReplaceModal
          tagIds={Array.from(selectedTagIds)}
          onClose={() => setShowFindReplace(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['tags'] });
            queryClient.invalidateQueries({ queryKey: ['tagGroups'] });
          }}
        />
      )}

      {showS7Import && (
        <S7ImportModal
          connections={connections}
          defaultConnId={selectedTree.connId}
          defaultGroup={selectedTree.type === 'group' ? selectedTree.group : ''}
          onClose={() => setShowS7Import(false)}
          onSuccess={(connId, grp) => {
            queryClient.invalidateQueries({ queryKey: ['tags'] });
            queryClient.invalidateQueries({ queryKey: ['tagGroups'] });
            if (connId) {
              setSelectedTree(
                grp ? { type: 'group', connId, group: grp } : { type: 'connection', connId, group: null }
              );
            }
          }}
        />
      )}
    </div>
  );
}
