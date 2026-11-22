import client from './client';

export const downloadBackup = () => client.get('/api/system/backup').then((r) => r.data);
export const restoreBackup = (payload) => client.post('/api/system/restore', payload).then((r) => r.data);
export const fetchAutostart = () => client.get('/api/system/autostart').then((r) => r.data);
export const setAutostart = (enabled) => client.post('/api/system/autostart', { enabled }).then((r) => r.data);
