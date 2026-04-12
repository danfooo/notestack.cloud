import api from './client';

export const settingsApi = {
  get: () => api.get<{ shortcuts: Record<string, string> }>('/settings'),

  update: (data: { shortcuts?: Record<string, string> }) =>
    api.patch<{ shortcuts: Record<string, string> }>('/settings', data),

  getMcpTokens: () =>
    api.get<Array<{ id: string; name: string; created_at: number; last_used_at: number | null }>>('/settings/mcp-tokens'),

  createMcpToken: (name: string) =>
    api.post<{ id: string; name: string; token: string; created_at: number }>('/settings/mcp-tokens', { name }),

  deleteMcpToken: (id: string) => api.delete(`/settings/mcp-tokens/${id}`),
};
