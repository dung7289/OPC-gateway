import client from './client';

export const loginApi = async (payload) => {
  const { data } = await client.post('/api/auth/login', payload);
  return data;
};

export const logoutApi = async () => {
  const { data } = await client.post('/api/auth/logout');
  return data;
};

export const fetchMeApi = async () => {
  const { data } = await client.get('/api/auth/me');
  return data;
};

export const changePasswordApi = async (payload) => {
  const { data } = await client.post('/api/auth/change-password', payload);
  return data;
};

export const fetchUsersApi = async () => {
  const { data } = await client.get('/api/auth/users');
  return data;
};

export const createUserApi = async (payload) => {
  const { data } = await client.post('/api/auth/users', payload);
  return data;
};

export const updateUserApi = async (userId, payload) => {
  const { data } = await client.put(`/api/auth/users/${userId}`, payload);
  return data;
};

export const deleteUserApi = async (userId) => {
  const { data } = await client.delete(`/api/auth/users/${userId}`);
  return data;
};
