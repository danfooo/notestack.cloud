import api from './client';

export const dashboardApi = {
  get: () => api.get<{
    pinned_notes: any[];
    recent_notes: any[];
    active_todos: any[];
    recent_thoughts: any[];
    themes: any[];
  }>('/dashboard'),
};
