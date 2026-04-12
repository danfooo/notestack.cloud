import api from './client';

export interface Thought {
  id: string;
  user_id: string;
  type: 'summary' | 'todo' | 'connection' | 'theme' | 'free';
  title: string | null;
  body: string | null;
  source_note_id: string | null;
  source_anchor: string | null;
  prompt_id: string | null;
  run_id: string | null;
  superseded_by: string | null;
  created_at: number;
  note_title?: string | null;
}

export const thoughtsApi = {
  list: (params?: { type?: string; note_id?: string; limit?: number; offset?: number }) =>
    api.get<Thought[]>('/thoughts', { params }),

  get: (id: string) => api.get<Thought>(`/thoughts/${id}`),

  delete: (id: string) => api.delete(`/thoughts/${id}`),
};
