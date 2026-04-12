import api from './client';

export const authApi = {
  signup: (data: { email: string; password: string; display_name: string; invite_token: string }) =>
    api.post('/auth/signup', data),

  login: (data: { email: string; password: string }) =>
    api.post<{ token: string; user: any }>('/auth/login', data),

  google: (data: { credential: string; invite_token?: string }) =>
    api.post<{ token: string; user: any }>('/auth/google', data),

  verifyEmail: (token: string) =>
    api.post<{ token: string; user: any }>('/auth/verify-email', { token }),

  resendVerification: (email: string) =>
    api.post('/auth/resend-verification', { email }),

  forgotPassword: (email: string) =>
    api.post('/auth/forgot-password', { email }),

  resetPassword: (token: string, password: string) =>
    api.post<{ token: string; user: any }>('/auth/reset-password', { token, password }),

  me: () => api.get<any>('/auth/me'),

  updateMe: (data: { display_name?: string }) =>
    api.put<any>('/auth/me', data),

  deleteMe: () => api.delete('/auth/me'),

  uploadAvatar: (file: File) => {
    const form = new FormData();
    form.append('avatar', file);
    return api.put<{ avatar_url: string }>('/auth/avatar', form);
  },

  deleteAvatar: () => api.delete<any>('/auth/avatar'),
};
