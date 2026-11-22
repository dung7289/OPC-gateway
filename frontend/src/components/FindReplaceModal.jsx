import React, { useState } from 'react';
import { X, Replace, Eye } from 'lucide-react';
import toast from 'react-hot-toast';
import { findReplaceTags } from '../api/tags';

export default function FindReplaceModal({ tagIds = [], onClose, onSuccess }) {
  const [field, setField] = useState('address');
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);

  const runAction = async (dryRun) => {
    if (!findText) {
      toast.error('Vui lòng nhập chuỗi cần tìm');
      return;
    }
    setLoading(true);
    try {
      const res = await findReplaceTags({
        tag_ids: tagIds,
        field,
        find_text: findText,
        replace_text: replaceText,
        case_sensitive: caseSensitive,
        dry_run: dryRun,
      });
      if (dryRun) {
        setPreview(res);
        if (res.matched_count === 0) {
          toast('Không tìm thấy tag nào khớp chuỗi này');
        }
      } else {
        toast.success(res.message);
        onSuccess?.();
        onClose();
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || err.message || 'Lỗi Find & Replace');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/65 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="glass-panel rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-700">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800">
          <h3 className="font-heading font-bold text-slate-100 text-sm flex items-center gap-2">
            <Replace className="w-4 h-4 text-sky-400" />
            Tìm &amp; Thay Thế Hàng Loạt ({tagIds.length} tag đã chọn)
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-slate-300 font-semibold block mb-1">Trường áp dụng</label>
              <select
                value={field}
                onChange={(e) => { setField(e.target.value); setPreview(null); }}
                className="w-full rounded-lg px-2.5 py-2 border cursor-pointer"
              >
                <option value="address">Address (Địa chỉ PLC / OPC)</option>
                <option value="name">Tag Name (Tên thẻ)</option>
                <option value="tag_group">Tag Group (Thư mục)</option>
                <option value="description">Description (Ghi chú)</option>
              </select>
            </div>
            <div>
              <label className="text-slate-300 font-semibold block mb-1">Tìm chuỗi (Find) *</label>
              <input
                type="text"
                value={findText}
                onChange={(e) => { setFindText(e.target.value); setPreview(null); }}
                placeholder="vd: TRAM_1 hoặc DB21"
                className="w-full rounded-lg px-2.5 py-2 border font-mono"
              />
            </div>
            <div>
              <label className="text-slate-300 font-semibold block mb-1">Thay bằng (Replace)</label>
              <input
                type="text"
                value={replaceText}
                onChange={(e) => { setReplaceText(e.target.value); setPreview(null); }}
                placeholder="vd: TRAM_2 hoặc DB22"
                className="w-full rounded-lg px-2.5 py-2 border font-mono"
              />
            </div>
          </div>

          <label className="inline-flex items-center gap-2 text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(e) => { setCaseSensitive(e.target.checked); setPreview(null); }}
              className="accent-emerald-500 cursor-pointer"
            />
            <span>Phân biệt chữ HOA / thường (Case sensitive)</span>
          </label>

          {preview && (
            <div className="border border-slate-700 rounded-lg overflow-hidden">
              <div className="bg-[#0F172A] px-3 py-2 text-[11px] font-semibold text-slate-300 border-b border-slate-800">
                Xem trước thay đổi ({preview.matched_count} tag khớp):
              </div>
              {preview.changes.length === 0 ? (
                <div className="p-4 text-center text-slate-400">Không có giá trị nào chứa "{findText}".</div>
              ) : (
                <div className="max-h-60 overflow-y-auto">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-[#11192A] text-slate-400">
                      <tr>
                        <th className="px-3 py-1.5">Tag</th>
                        <th className="px-3 py-1.5">Giá trị cũ</th>
                        <th className="px-3 py-1.5">Giá trị mới</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {preview.changes.map((c) => (
                        <tr key={c.id}>
                          <td className="px-3 py-1.5 font-semibold text-slate-200">{c.tag_name}</td>
                          <td className="px-3 py-1.5 font-mono text-red-300 line-through">{c.old_value}</td>
                          <td className="px-3 py-1.5 font-mono text-emerald-300 font-semibold">{c.new_value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg cursor-pointer"
          >
            Hủy
          </button>
          <button
            type="button"
            disabled={loading || !findText}
            onClick={() => runAction(true)}
            className="px-4 py-2 text-xs font-semibold text-sky-300 bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/40 rounded-lg cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
          >
            <Eye className="w-3.5 h-3.5" />
            Xem Trước
          </button>
          <button
            type="button"
            disabled={loading || !findText}
            onClick={() => runAction(false)}
            className="px-4 py-2 text-xs font-bold text-[#0F172A] bg-emerald-500 hover:bg-emerald-400 rounded-lg cursor-pointer disabled:opacity-40"
          >
            {loading ? 'Đang thay thế...' : 'Áp Dụng Thay Thế'}
          </button>
        </div>
      </div>
    </div>
  );
}
