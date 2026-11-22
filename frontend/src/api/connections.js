import client from './client';

export const fetchConnections = async () => {
  const { data } = await client.get('/api/connections');
  return data;
};

export const createConnection = async (data) => {
  const { data: res } = await client.post('/api/connections', data);
  return res;
};

export const updateConnection = async (id, data) => {
  const { data: res } = await client.put(`/api/connections/${id}`, data);
  return res;
};

export const deleteConnection = async (id) => {
  const { data } = await client.delete(`/api/connections/${id}`);
  return data;
};

export const reconnectConnection = async (id) => {
  const { data } = await client.post(`/api/connections/${id}/reconnect`);
  return data;
};

export const testConnectionConfig = async (payload) => {
  const { data } = await client.post('/api/connections/test', payload);
  return data;
};

export const fetchOpcDaServers = async () => {
  const { data } = await client.get('/api/connections/opc-da/servers');
  return data?.servers || [];
};

export const browseOpcDa = async (connectionId, path = '') => {
  const { data } = await client.get(`/api/connections/${connectionId}/opc-da/browse`, {
    params: { path },
  });
  return data;
};

export const scanOpcDaTags = async (connectionId, path = '', maxTags = 500) => {
  const { data } = await client.get(`/api/connections/${connectionId}/opc-da/scan`, {
    params: { path, max_tags: maxTags },
  });
  return data;
};

export const browseOpcUa = async (connectionId, nodeId = '') => {
  const { data } = await client.get(`/api/connections/${connectionId}/opcua/browse`, {
    params: { node_id: nodeId },
  });
  return data;
};

export const scanOpcUaTags = async (connectionId, nodeId = '', maxTags = 500) => {
  const { data } = await client.get(`/api/connections/${connectionId}/opcua/scan`, {
    params: { node_id: nodeId, max_tags: maxTags },
  });
  return data;
};

