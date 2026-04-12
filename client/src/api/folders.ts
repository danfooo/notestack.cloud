import api from './client';

export interface Folder {
  id: string;
  user_id: string;
  parent_id: string | null;
  name: string;
  position: number;
  created_at: number;
  updated_at: number;
  children?: Folder[];
}

export const foldersApi = {
  list: () => api.get<Folder[]>('/folders'),

  create: (data: { name: string; parent_id?: string; position?: number }) =>
    api.post<Folder>('/folders', data),

  update: (id: string, data: { name?: string; parent_id?: string; position?: number }) =>
    api.patch<Folder>(`/folders/${id}`, data),

  delete: (id: string) => api.delete(`/folders/${id}`),
};
