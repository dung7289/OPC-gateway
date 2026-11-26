import client from './client';

export const fetchTags = async (connectionId) => {
  const params = connectionId ? { connection_id: connectionId } : {};
  const { data } = await client.get('/api/tags', { params });
  return data;
};

export const createTag = async (data) => {
  const { data: res } = await client.post('/api/tags', data);
  return res;
};

export const updateTag = async (id, data) => {
  const { data: res } = await client.put(`/api/tags/${id}`, data);
  return res;
};

export const deleteTag = async (id) => {
  const { data } = await client.delete(`/api/tags/${id}`);
  return data;
};

export const writeTagValue = async (id, value) => {
  const { data } = await client.post(`/api/tags/${id}/write`, { value });
  return data;
};

export const importTagsBatch = async (tagsList) => {
  const { data } = await client.post('/api/tags/batch', tagsList);
  return data;
};

export const fetchTagGroups = async (connectionId) => {
  const params = connectionId ? { connection_id: connectionId } : {};
  const { data } = await client.get('/api/tags/groups', { params });
  return data;
};

export const createTagGroup = async (groupData) => {
  const { data } = await client.post('/api/tags/groups', groupData);
  return data;
};

export const deleteTagGroup = async (groupId) => {
  const { data } = await client.delete(`/api/tags/groups/${groupId}`);
  return data;
};

export const renameTagGroup = async (renameData) => {
  const { data } = await client.put('/api/tags/groups/rename', renameData);
  return data;
};

export const deleteTagGroupByName = async (connectionId, groupName, deleteTags = true) => {
  const { data } = await client.delete('/api/tags/groups/by-name', {
    params: { connection_id: connectionId, group_name: groupName, delete_tags: deleteTags },
  });
  return data;
};

export const scanJsonTags = async (scanData) => {
  const { data } = await client.post('/api/tags/auto-generate/scan', scanData);
  return data;
};

export const pasteTags = async (tagIds, targetConnectionId, targetGroup = '') => {
  const { data } = await client.post('/api/tags/paste', {
    tag_ids: tagIds,
    target_connection_id: targetConnectionId,
    target_group: targetGroup || '',
  });
  return data;
};

export const pasteTagGroup = async (
  sourceConnectionId,
  sourceGroup,
  targetConnectionId,
  targetParentGroup = ''
) => {
  const { data } = await client.post('/api/tags/groups/paste', {
    source_connection_id: sourceConnectionId,
    source_group: sourceGroup,
    target_connection_id: targetConnectionId,
    target_parent_group: targetParentGroup || '',
  });
  return data;
};

export const bulkUpdateTags = async (payload) => {
  const { data } = await client.post('/api/tags/bulk-update', payload);
  return data;
};

export const findReplaceTags = async (payload) => {
  const { data } = await client.post('/api/tags/find-replace', payload);
  return data;
};

export const parseS7Text = async (payload) => {
  const { data } = await client.post('/api/tags/s7/parse', payload);
  return data;
};

export const parseS7File = async (file, { db_number, default_group, scan_rate_ms } = {}) => {
  const fd = new FormData();
  fd.append('file', file);
  if (db_number !== '' && db_number !== null && db_number !== undefined) {
    fd.append('db_number', String(db_number));
  }
  if (default_group) {
    fd.append('default_group', default_group);
  }
  if (scan_rate_ms) {
    fd.append('scan_rate_ms', String(scan_rate_ms));
  }
  const { data } = await client.post('/api/tags/s7/parse-file', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
};

