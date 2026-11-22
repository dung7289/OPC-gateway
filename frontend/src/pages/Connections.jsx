import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Edit2, Trash2, RefreshCw, Plug, Sparkles, Database, Network, AlertTriangle, Power } from 'lucide-react';
import {
  fetchConnections,
  deleteConnection,
  reconnectConnection,
  updateConnection,
} from '../api/connections';
import ConnectionForm from '../components/ConnectionForm';
import AutoTagModal from '../components/AutoTagModal';
import OpcDaBrowserModal from '../components/OpcDaBrowserModal';
import OpcUaBrowserModal from '../components/OpcUaBrowserModal';
import StatusBadge from '../components/StatusBadge';
import { getProtocolColor } from '../utils/helpers';

function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="glass-panel rounded-xl p-6 shadow-2xl max-w-sm w-full border border-slate-700">
        <h3 className="font-heading font-bold text-slate-100 mb-2">Xác Nhận Xóa</h3>
        <p className="text-xs text-slate-300 mb-5 leading-relaxed">{message}</p>
        <div className="flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-xs font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors cursor-pointer"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors cursor-pointer"
          >
            Xóa Kênh
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Connections() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editConn, setEditConn] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [autoTagConn, setAutoTagConn] = useState(null);
  const [opcDaConn, setOpcDaConn] = useState(null);
  const [opcUaConn, setOpcUaConn] = useState(null);

  const { data: connections = [], isLoading, isError, error } = useQuery({
    queryKey: ['connections'],
    queryFn: fetchConnections,
    refetchInterval: 10000,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteConnection,
    onSuccess: () => {
      toast.success('Đã xóa kết nối');
      queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
    onError: (err) => toast.error(err.message || 'Xóa thất bại'),
  });

  const reconnectMutation = useMutation({
    mutationFn: reconnectConnection,
    onSuccess: () => {
      toast.success('Đang kết nối lại...');
      queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
    onError: (err) => toast.error(err.message || 'Kết nối lại thất bại'),
  });

  const toggleEnableMutation = useMutation({
    mutationFn: ({ id, enabled }) => updateConnection(id, { enabled }),
    onSuccess: (_, vars) => {
      toast.success(vars.enabled ? 'Đã bật kênh kết nối' : 'Đã tạm tắt kênh kết nối');
      queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
    onError: (err) => toast.error(err.response?.data?.detail || err.message || 'Thao tác thất bại'),
  });

  const handleFormSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['connections'] });
    setShowForm(false);
    setEditConn(null);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-bold text-slate-100">Connections</h1>
          <p className="text-xs text-slate-400 mt-0.5">Quản lý kết nối PLC, Modbus, MQTT, OPC-DA & OPC-UA</p>
        </div>
        <button
          type="button"
          onClick={() => { setEditConn(null); setShowForm(true); }}
          className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-[#0F172A] text-xs font-bold rounded-lg transition-colors shadow-sm cursor-pointer"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          Add Connection
        </button>
      </div>

      {/* Error */}
      {isError && (
        <div className="bg-red-500/15 border border-red-500/40 rounded-xl p-4 flex items-center gap-3 text-red-200">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" aria-hidden="true" />
          <p className="text-sm">{error?.message || 'Cannot connect to backend'}</p>
        </div>
      )}

      {/* Table */}
      <div className="glass-panel rounded-xl shadow-md overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-slate-400">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              <p className="text-xs font-mono">Loading connections...</p>
            </div>
          </div>
        ) : connections.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400">
            <Plug className="w-10 h-10 mb-3 opacity-30" aria-hidden="true" />
            <p className="text-sm">Chưa có kết nối nào. Bấm "Add Connection" để bắt đầu.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[680px]">
              <thead className="bg-[#0F172A]/80 border-b border-slate-800">
                <tr>
                  <th className="text-left px-5 py-3 font-heading text-xs font-semibold text-slate-400 uppercase tracking-wider">Name</th>
                  <th className="text-left px-5 py-3 font-heading text-xs font-semibold text-slate-400 uppercase tracking-wider">Protocol</th>
                  <th className="text-left px-5 py-3 font-heading text-xs font-semibold text-slate-400 uppercase tracking-wider">Endpoint / Host</th>
                  <th className="text-left px-5 py-3 font-heading text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                  <th className="text-left px-5 py-3 font-heading text-xs font-semibold text-slate-400 uppercase tracking-wider">Tags (_System)</th>
                  <th className="text-right px-5 py-3 font-heading text-xs font-semibold text-slate-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {connections.map((conn) => (
                  <tr key={conn.id} className="hover:bg-slate-800/45 transition-colors">
                    <td className="px-5 py-3.5 font-heading font-semibold text-slate-100 text-xs">{conn.name}</td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex px-2.5 py-0.5 rounded-full font-mono text-[11px] font-semibold ${getProtocolColor(conn.protocol)}`}>
                        {conn.protocol}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-300 font-mono text-xs">
                      {conn.host && conn.port
                        ? `${conn.host}:${conn.port}`
                        : conn.config?.broker_url || conn.config?.endpoint_url || conn.config?.serial_port || conn.broker_url || '—'}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {conn.enabled === false ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-700/80 text-slate-300 border border-slate-600">
                            Disabled
                          </span>
                        ) : (
                          <StatusBadge
                            status={conn.connected ? 'connected' : 'disconnected'}
                            size="sm"
                          />
                        )}
                        {conn.enabled !== false && conn.demoted && (
                          <span
                            className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/40"
                            title="Driver đang tự giãn chu kỳ thử kết nối lại (Auto-Demoted)"
                          >
                            Auto-Demoted
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs">
                      <span className="text-emerald-400 font-semibold">{conn.good_count ?? 0}</span>
                      <span className="text-slate-500"> / </span>
                      <span className="text-slate-200">{conn.tag_count ?? 0}</span>
                      <span className="text-slate-400 ml-1">Good</span>
                      {(conn.bad_count ?? 0) > 0 && (
                        <span className="ml-2 text-[11px] text-amber-400">({conn.bad_count} Bad)</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1">
                        {conn.protocol === 'mqtt' && (
                          <button
                            type="button"
                            onClick={() => setAutoTagConn(conn)}
                            className="p-1.5 text-violet-400 hover:text-violet-300 hover:bg-violet-500/15 rounded-lg transition-colors cursor-pointer"
                            title="Tự động quét Topic tạo Tag (Kepware style)"
                            aria-label={`Auto Tag JSON cho ${conn.name}`}
                          >
                            <Sparkles className="w-4 h-4" />
                          </button>
                        )}
                        {conn.protocol === 'opc_da' && (
                          <button
                            type="button"
                            onClick={() => setOpcDaConn(conn)}
                            className="p-1.5 text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/15 rounded-lg transition-colors cursor-pointer"
                            title="Duyệt và nhập tag từ OPC DA Server (Kepware / Phoenix Contact)"
                            aria-label={`Quét OPC DA cho ${conn.name}`}
                          >
                            <Database className="w-4 h-4" />
                          </button>
                        )}
                        {conn.protocol === 'opcua' && (
                          <button
                            type="button"
                            onClick={() => setOpcUaConn(conn)}
                            className="p-1.5 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/15 rounded-lg transition-colors cursor-pointer"
                            title="Duyệt và nhập tag từ OPC-UA Server"
                            aria-label={`Quét OPC UA cho ${conn.name}`}
                          >
                            <Network className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            toggleEnableMutation.mutate({
                              id: conn.id,
                              enabled: conn.enabled === false,
                            })
                          }
                          disabled={toggleEnableMutation.isPending}
                          className={`p-1.5 rounded-lg transition-colors disabled:opacity-50 cursor-pointer ${
                            conn.enabled === false
                              ? 'text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/15'
                              : 'text-emerald-400 hover:text-amber-400 hover:bg-amber-500/15'
                          }`}
                          title={conn.enabled === false ? 'Bật kênh kết nối' : 'Tạm tắt kênh kết nối'}
                          aria-label={conn.enabled === false ? `Bật ${conn.name}` : `Tắt ${conn.name}`}
                        >
                          <Power className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => { setEditConn(conn); setShowForm(true); }}
                          className="p-1.5 text-slate-400 hover:text-sky-400 hover:bg-sky-500/15 rounded-lg transition-colors cursor-pointer"
                          title="Chỉnh sửa"
                          aria-label={`Chỉnh sửa ${conn.name}`}
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => reconnectMutation.mutate(conn.id)}
                          disabled={reconnectMutation.isPending}
                          className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/15 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                          title="Kết nối lại"
                          aria-label={`Kết nối lại ${conn.name}`}
                        >
                          <RefreshCw className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(conn)}
                          className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/15 rounded-lg transition-colors cursor-pointer"
                          title="Xóa"
                          aria-label={`Xóa ${conn.name}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {showForm && (
        <ConnectionForm
          connection={editConn}
          onSuccess={handleFormSuccess}
          onClose={() => { setShowForm(false); setEditConn(null); }}
        />
      )}

      {autoTagConn && (
        <AutoTagModal
          connections={connections}
          defaultConnId={autoTagConn.id}
          onClose={() => setAutoTagConn(null)}
          onSuccess={() => {
            setAutoTagConn(null);
            queryClient.invalidateQueries({ queryKey: ['connections'] });
          }}
        />
      )}

      {opcDaConn && (
        <OpcDaBrowserModal
          connections={connections}
          initialConnectionId={opcDaConn.id}
          onClose={() => setOpcDaConn(null)}
          onSuccess={() => {
            setOpcDaConn(null);
            queryClient.invalidateQueries({ queryKey: ['connections'] });
          }}
        />
      )}

      {opcUaConn && (
        <OpcUaBrowserModal
          connections={connections}
          initialConnectionId={opcUaConn.id}
          onClose={() => setOpcUaConn(null)}
          onSuccess={() => {
            setOpcUaConn(null);
            queryClient.invalidateQueries({ queryKey: ['connections'] });
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Bạn có chắc muốn xóa kênh "${confirmDelete.name}"? Toàn bộ tags thuộc kênh này cũng sẽ bị xóa.`}
          onConfirm={() => {
            deleteMutation.mutate(confirmDelete.id);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
