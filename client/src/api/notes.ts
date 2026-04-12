import api from './client';

export interface Note {
  id: string;
  user_id: string;
  title: string | null;
  body: string | null;
  body_text: string | null;
  folder_id: string | null;
  pinned: number;
  archived: number;
  deleted_at: number | null;
  created_at: number;
  updated_at: number;
  tags: string[];
}

export interface NoteListParams {
  folder_id?: string;
  tag?: string;
  q?: string;
  archived?: boolean | 'all';
  limit?: number;
  offset?: number;
}

export const notesApi = {
  list: (params: NoteListParams = {}) =>
    api.get<Note[]>('/notes', { params }),

  get: (id: string) =>
    api.get<Note>(`/notes/${id}`),

  create: (data: Partial<Note>) =>
    api.post<Note>('/notes', data),

  update: (id: string, data: Partial<Note> & { tags?: string[] }) =>
    api.patch<Note>(`/notes/${id}`, data),

  delete: (id: string) =>
    api.delete(`/notes/${id}`),

  revisions: (id: string) =>
    api.get<any[]>(`/notes/${id}/revisions`),

  restoreRevision: (noteId: string, revId: string) =>
    api.post<Note>(`/notes/${noteId}/revisions/${revId}/restore`),
};
