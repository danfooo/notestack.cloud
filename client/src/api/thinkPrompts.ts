import api from './client';

export interface ThinkPrompt {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  prompt_text: string;
  output_type: string;
  scope: string;
  trigger: string[];
  schedule: string | null;
  model: string;
  enabled: number;
  created_at: number;
  updated_at: number;
}

export const thinkPromptsApi = {
  list: () => api.get<ThinkPrompt[]>('/think-prompts'),

  create: (data: Partial<ThinkPrompt>) =>
    api.post<ThinkPrompt>('/think-prompts', data),

  update: (id: string, data: Partial<ThinkPrompt>) =>
    api.patch<ThinkPrompt>(`/think-prompts/${id}`, data),

  delete: (id: string) => api.delete(`/think-prompts/${id}`),

  run: (id: string, noteId?: string) =>
    api.post<{ run_id: string; status: string }>(`/think-prompts/${id}/run`, { note_id: noteId }),

  fire: (trigger: string) =>
    api.post<{ fired: number; run_ids: string[] }>('/think-prompts/fire', { trigger }),
};

export const thinkRunsApi = {
  list: (params?: { prompt_id?: string; limit?: number }) =>
    api.get<any[]>('/think-runs', { params }),

  get: (id: string) => api.get<any>(`/think-runs/${id}`),
};
