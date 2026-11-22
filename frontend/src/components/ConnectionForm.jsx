import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { createConnection, updateConnection, fetchOpcDaServers, testConnectionConfig } from '../api/connections';
import toast from 'react-hot-toast';

const PROTOCOLS = [
  { value: 'modbus_tcp', label: 'Modbus TCP' },
  { value: 'modbus_rtu', label: 'Modbus RTU' },
  { value: 's7', label: 'Siemens S7' },
  { value: 'mqtt', label: 'MQTT' },
  { value: 'opcua', label: 'OPC-UA' },
  { value: 'opc_da', label: 'OPC DA (Classic)' },
  { value: 'internal', label: 'Internal / Virtual (Memory, Simulator & Công thức)' },
];

function FieldRow({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-gray-700">{label}</label>
      {children}
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

export default function ConnectionForm({ connection, onSuccess, onClose }) {
  const isEdit = !!connection;

  const [form, setForm] = useState(() => {
    const base = {
      name: '',
      protocol: 'modbus_tcp',
      host: '',
      port: '502',
      // Modbus TCP
      rack: '',
      slot: '',
      // Modbus RTU
      serial_port: 'COM1',
      baudrate: '9600',
      // MQTT
      broker_url: '',
      username: '',
      password: '',
      client_id: '',
      // OPC-UA
      endpoint_url: '',
      security_mode: 'None',
      // OPC DA
      server_prog_id: 'Kepware.KEPServerEX.V6',
      update_rate_ms: '500',
    };
    if (!connection) return base;
    return {
      ...base,
      ...connection,
      protocol: connection.protocol || 'modbus_tcp',
      port: connection.port ? String(connection.port) : '',
      ...(connection.config || {}),
    };
  });
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // { connected, message }
  const [discoveredServers, setDiscoveredServers] = useState([]);

  useEffect(() => {
    fetchOpcDaServers()
      .then((srvs) => {
        if (srvs && srvs.length > 0) {
          setDiscoveredServers(srvs);
          if (!connection) {
            setForm((f) => ({ ...f, server_prog_id: srvs[0] }));
          }
        }
      })
      .catch(() => {});
  }, [connection]);

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const payload = buildPayload(form);
      const res = await testConnectionConfig(payload);
      setTestResult(res);
    } catch (err) {
      setTestResult({ connected: false, message: err.response?.data?.detail || err.message || 'Test thất bại' });
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = buildPayload(form);
      if (isEdit) {
        await updateConnection(connection.id, payload);
        toast.success('Connection updated successfully');
      } else {
        await createConnection(payload);
        toast.success('Connection created successfully');
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
            {isEdit ? 'Edit Connection' : 'Add Connection'}
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <FieldRow label="Name *">
            <Input
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. PLC Line 1"
            />
          </FieldRow>

          <FieldRow label="Protocol *">
            <Select value={form.protocol} onChange={(e) => set('protocol', e.target.value)}>
              {PROTOCOLS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </Select>
          </FieldRow>

          {/* Internal / Virtual Driver info */}
          {form.protocol === 'internal' && (
            <div className="bg-teal-500/10 border border-teal-500/35 rounded-lg p-3 text-xs text-teal-200 space-y-1">
              <p className="font-semibold text-teal-300">Kênh Nội Bộ (Virtual / Memory / Công thức)</p>
              <p>Không cần IP hay PLC. Sau khi tạo kênh, bạn có thể thêm Tag với cú pháp:</p>
              <ul className="list-disc pl-4 font-mono text-[11px] space-y-0.5 text-slate-300">
                <li><code>MEM:SETPOINT=3.5</code> — Tag bộ nhớ (đọc/ghi từ Web &amp; SCADA)</li>
                <li><code>SIM:SINE(0,100,20)</code> / <code>SIM:RANDOM(10,50)</code> / <code>SIM:TOGGLE(5)</code> — Giả lập tín hiệu</li>
                <li><code>=FLOW_1 + FLOW_2</code> hoặc <code>=(AP1 + AP2) / 2</code> — Tag công thức tính từ tag khác</li>
              </ul>
            </div>
          )}

          {/* Host/Port - shown for TCP/S7 */}
          {['modbus_tcp', 's7'].includes(form.protocol) && (
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <FieldRow label="Host (IP Address) *">
                  <Input
                    required
                    value={form.host}
                    onChange={(e) => set('host', e.target.value)}
                    placeholder="192.168.1.10"
                  />
                </FieldRow>
              </div>
              <FieldRow label="Port *">
                <Input
                  required
                  type="number"
                  value={form.port}
                  onChange={(e) => set('port', e.target.value)}
                  placeholder={form.protocol === 's7' ? '102' : '502'}
                />
              </FieldRow>
            </div>
          )}

          {/* Modbus RTU */}
          {form.protocol === 'modbus_rtu' && (
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="Serial Port *">
                <Input
                  required
                  value={form.serial_port}
                  onChange={(e) => set('serial_port', e.target.value)}
                  placeholder="COM1 or /dev/ttyUSB0"
                />
              </FieldRow>
              <FieldRow label="Baudrate">
                <Select value={form.baudrate} onChange={(e) => set('baudrate', e.target.value)}>
                  {['2400', '4800', '9600', '19200', '38400', '57600', '115200'].map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </Select>
              </FieldRow>
            </div>
          )}

          {/* Siemens S7 Rack/Slot */}
          {form.protocol === 's7' && (
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="Rack">
                <Input
                  type="number"
                  value={form.rack}
                  onChange={(e) => set('rack', e.target.value)}
                  placeholder="0"
                />
              </FieldRow>
              <FieldRow label="Slot">
                <Input
                  type="number"
                  value={form.slot}
                  onChange={(e) => set('slot', e.target.value)}
                  placeholder="1"
                />
              </FieldRow>
            </div>
          )}

          {/* MQTT fields */}
          {form.protocol === 'mqtt' && (
            <>
              <FieldRow label="Broker URL *">
                <Input
                  required
                  value={form.broker_url}
                  onChange={(e) => set('broker_url', e.target.value)}
                  placeholder="mqtt://broker.hivemq.com:1883"
                />
              </FieldRow>
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label="Username">
                  <Input
                    value={form.username}
                    onChange={(e) => set('username', e.target.value)}
                    placeholder="optional"
                  />
                </FieldRow>
                <FieldRow label="Password">
                  <Input
                    type="password"
                    value={form.password}
                    onChange={(e) => set('password', e.target.value)}
                    placeholder="optional"
                  />
                </FieldRow>
              </div>
              <FieldRow label="Client ID">
                <Input
                  value={form.client_id}
                  onChange={(e) => set('client_id', e.target.value)}
                  placeholder="optional"
                />
              </FieldRow>
            </>
          )}

          {/* OPC-UA fields */}
          {form.protocol === 'opcua' && (
            <>
              <FieldRow label="Endpoint URL *">
                <Input
                  required
                  value={form.endpoint_url}
                  onChange={(e) => set('endpoint_url', e.target.value)}
                  placeholder="opc.tcp://192.168.1.50:4840"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Ví dụ: opc.tcp://localhost:49320 (Kepware) · opc.tcp://localhost:4840 (Phoenix Contact / IndustrialGateway UA)
                </p>
              </FieldRow>
              <FieldRow label="Security Mode">
                <Select value={form.security_mode} onChange={(e) => set('security_mode', e.target.value)}>
                  {['None', 'Sign', 'SignAndEncrypt'].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </Select>
              </FieldRow>
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label="Username (tùy chọn)">
                  <Input
                    value={form.username || ''}
                    onChange={(e) => set('username', e.target.value)}
                    placeholder="optional"
                  />
                </FieldRow>
                <FieldRow label="Password (tùy chọn)">
                  <Input
                    type="password"
                    value={form.password || ''}
                    onChange={(e) => set('password', e.target.value)}
                    placeholder="optional"
                  />
                </FieldRow>
              </div>
            </>
          )}

          {/* OPC DA (Classic) fields */}
          {form.protocol === 'opc_da' && (
            <>
              <FieldRow label="Server ProgID (OPC Server) *">
                <Input
                  required
                  list="opc-da-servers-list"
                  value={form.server_prog_id || ''}
                  onChange={(e) => set('server_prog_id', e.target.value)}
                  placeholder="Kepware.KEPServerEX.V6 hoặc Matrikon.OPC.Simulation.1"
                />
                <datalist id="opc-da-servers-list">
                  {discoveredServers.map((s) => (
                    <option key={s} value={s}>{s} (Đã phát hiện trên máy)</option>
                  ))}
                  <option value="Kepware.KEPServerEX.V6">Kepware.KEPServerEX.V6</option>
                  <option value="Kepware.KEPServerEX.V5">Kepware.KEPServerEX.V5</option>
                  <option value="PhoenixContact.AX-Server.21">PhoenixContact.AX-Server.21</option>
                  <option value="PhoenixContact.AX-Server">PhoenixContact.AX-Server</option>
                  <option value="Matrikon.OPC.Simulation.1">Matrikon.OPC.Simulation.1</option>
                  <option value="Schneider-Aut.OFS">Schneider-Aut.OFS</option>
                  <option value="RSLinx OPC Server">RSLinx OPC Server</option>
                  <option value="OPC.SimaticNET">OPC.SimaticNET</option>
                </datalist>
                <p className="text-xs text-gray-500 mt-1">
                  Chọn server được phát hiện từ danh sách hoặc nhập tên ProgID bất kỳ.
                </p>
              </FieldRow>
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label="Host (mặc định localhost)">
                  <Input
                    value={form.host || ''}
                    onChange={(e) => set('host', e.target.value)}
                    placeholder="localhost"
                  />
                </FieldRow>
                <FieldRow label="Update Rate (ms)">
                  <Input
                    type="number"
                    value={form.update_rate_ms || '500'}
                    onChange={(e) => set('update_rate_ms', e.target.value)}
                    placeholder="500"
                  />
                </FieldRow>
              </div>
            </>
          )}

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
              type="button"
              onClick={handleTest}
              disabled={testing}
              className="px-4 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
            >
              {testing ? 'Đang test...' : '⚡ Test Connection'}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? 'Saving...' : isEdit ? 'Update' : 'Create'}
            </button>
          </div>
          {/* Test result display */}
          {testResult && (
            <div className={`mt-2 p-3 rounded-lg text-sm font-medium ${testResult.connected ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
              {testResult.connected ? '✅ ' : '❌ '}{testResult.message}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

function buildPayload(form) {
  const config = {};

  if (form.protocol === 'modbus_tcp') {
    if (form.rack) config.rack = parseInt(form.rack, 10);
    if (form.slot) config.slot = parseInt(form.slot, 10);
  } else if (form.protocol === 'modbus_rtu') {
    config.serial_port = form.serial_port;
    config.baudrate = parseInt(form.baudrate, 10) || 9600;
  } else if (form.protocol === 's7') {
    config.rack = parseInt(form.rack, 10) || 0;
    config.slot = parseInt(form.slot, 10) || 1;
  } else if (form.protocol === 'mqtt') {
    config.broker_url = form.broker_url;
    if (form.username) config.username = form.username;
    if (form.password) config.password = form.password;
    if (form.client_id) config.client_id = form.client_id;
  } else if (form.protocol === 'opcua') {
    config.endpoint = form.endpoint_url || form.endpoint || '';
    config.endpoint_url = config.endpoint;  // keep both for compatibility
    config.security_mode = form.security_mode;
    if (form.username) config.username = form.username;
    if (form.password) config.password = form.password;
  } else if (form.protocol === 'opc_da') {
    config.server_prog_id = form.server_prog_id || 'Kepware.KEPServerEX.V6';
    config.update_rate_ms = parseInt(form.update_rate_ms, 10) || 500;
  }

  return {
    name: form.name.trim(),
    protocol: form.protocol,
    host: form.host ? form.host.trim() : null,
    port: form.port ? parseInt(form.port, 10) : null,
    config: config,
    enabled: true,
  };
}
