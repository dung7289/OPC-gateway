import client from './client';

export const fetchHistoryConfig = () => client.get('/api/history/config').then((r) => r.data);
export const updateHistoryConfig = (data) => client.put('/api/history/config', data).then((r) => r.data);
export const sampleHistoryNow = () => client.post('/api/history/sample-now').then((r) => r.data);
export const queryTagHistory = ({ tagId, hours = 1, limit = 1000 }) =>
  client
    .get('/api/history/query', { params: { tag_id: tagId, hours, limit } })
    .then((r) => r.data);
export const clearTagHistory = (tagId = null) =>
  client
    .delete('/api/history/clear', tagId ? { params: { tag_id: tagId } } : undefined)
    .then((r) => r.data);
