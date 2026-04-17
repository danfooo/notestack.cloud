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
  private: number;
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

export function inferTitle(body: string | null): string {
  if (!body) return '';
  try {
    const doc = JSON.parse(body);
    const first = doc.content?.[0];
    if (!first) return '';
    const texts: string[] = [];
    const walk = (node: any) => {
      if (node.type === 'text' && node.text) texts.push(node.text);
      if (node.content) node.content.forEach(walk);
    };
    walk(first);
    return texts.join('').trim();
  } catch { return ''; }
}

export function getBodySnippet(body: string | null, skipFirst = false): string {
  if (!body) return '';
  try {
    const doc = JSON.parse(body);
    const blocks = (doc.content ?? []).slice(skipFirst ? 1 : 0);
    const texts: string[] = [];
    const walk = (node: any) => {
      if (node.type === 'text' && node.text) texts.push(node.text);
      if (node.content) node.content.forEach(walk);
    };
    blocks.forEach(walk);
    const full = texts.join(' ').trim();
    return full.slice(0, 100) + (full.length > 100 ? '…' : '');
  } catch { return ''; }
}
