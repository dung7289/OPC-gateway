import client from './client';

export const fetchUsrM100Devices = () =>
  client.get('/api/usr-m100/devices').then((r) => r.data);

export const createUsrM100Device = (data) =>
  client.post('/api/usr-m100/devices', data).then((r) => r.data);

export const updateUsrM100Device = (deviceId, data) =>
  client.put(`/api/usr-m100/devices/${deviceId}`, data).then((r) => r.data);

export const deleteUsrM100Device = (deviceId) =>
  client.delete(`/api/usr-m100/devices/${deviceId}`).then((r) => r.data);

export const updateUsrM100Buffer = (deviceId, values) =>
  client.post(`/api/usr-m100/devices/${deviceId}/buffer`, { values }).then((r) => r.data);

export const publishUsrM100Device = (deviceId, payload = {}) =>
  client.post(`/api/usr-m100/devices/${deviceId}/publish`, payload).then((r) => r.data);

export const queryUsrM100Device = (deviceId, payload = {}) =>
  client.post(`/api/usr-m100/devices/${deviceId}/query`, payload).then((r) => r.data);

export const publishUsrM100Raw = (payload) =>
  client.post('/api/usr-m100/publish-raw', payload).then((r) => r.data);

export const fetchUsrM100History = (deviceId = null, limit = 50) =>
  client
    .get('/api/usr-m100/history', {
      params: deviceId ? { device_id: deviceId, limit } : { limit },
    })
    .then((r) => r.data);

export const clearUsrM100History = (deviceId = null) =>
  client
    .delete('/api/usr-m100/history', deviceId ? { params: { device_id: deviceId } } : undefined)
    .then((r) => r.data);
