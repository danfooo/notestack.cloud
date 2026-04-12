import React, { useState, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../../api/auth';
import { useAuthStore } from '../../stores/authStore';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';

export function ProfileSettings() {
  const navigate = useNavigate();
  const { user, setUser, logout } = useAuthStore();
  const [name, setName] = useState(user?.display_name || '');
  const [saved, setSaved] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const updateMutation = useMutation({
    mutationFn: () => authApi.updateMe({ display_name: name }),
    onSuccess: (res) => { setUser(res.data); setSaved(true); setTimeout(() => setSaved(false), 2000); },
  });

  const avatarMutation = useMutation({
    mutationFn: (file: File) => authApi.uploadAvatar(file),
    onSuccess: async () => {
      const res = await authApi.me();
      setUser(res.data);
    },
  });

  const deleteAvatarMutation = useMutation({
    mutationFn: () => authApi.deleteAvatar(),
    onSuccess: async () => {
      const res = await authApi.me();
      setUser(res.data);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => authApi.deleteMe(),
    onSuccess: () => { logout(); navigate('/login'); },
  });

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Profile</h2>
        <p className="text-sm text-gray-500">Manage your personal information</p>
      </div>

      {/* Avatar */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">Avatar</label>
        <div className="flex items-center gap-4">
          {user?.avatar_url ? (
            <img src={user.avatar_url} alt="" className="w-16 h-16 rounded-full object-cover" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-amber-500 flex items-center justify-center text-white text-2xl font-semibold">
              {user?.display_name[0]?.toUpperCase()}
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} loading={avatarMutation.isPending}>
              Change photo
            </Button>
            {user?.avatar_url && (
              <Button variant="ghost" size="sm" onClick={() => deleteAvatarMutation.mutate()}>
                Remove
              </Button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) avatarMutation.mutate(file);
            }}
          />
        </div>
      </div>

      {/* Display name */}
      <div className="space-y-4">
        <Input
          label="Display name"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Your name"
        />
        <div className="flex items-center gap-3">
          <Button onClick={() => updateMutation.mutate()} loading={updateMutation.isPending}>
            Save changes
          </Button>
          {saved && <span className="text-sm text-green-600">Saved!</span>}
        </div>
      </div>

      {/* Email */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
        <p className="text-sm text-gray-900">{user?.email}</p>
      </div>

      {/* Danger zone */}
      <div className="border border-red-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-red-700 mb-2">Danger Zone</h3>
        <p className="text-sm text-gray-500 mb-4">Permanently delete your account and all associated data. This cannot be undone.</p>
        {deleteConfirm ? (
          <div className="flex gap-3">
            <Button variant="danger" onClick={() => deleteMutation.mutate()} loading={deleteMutation.isPending}>
              Yes, delete my account
            </Button>
            <Button variant="secondary" onClick={() => setDeleteConfirm(false)}>Cancel</Button>
          </div>
        ) : (
          <Button variant="danger" onClick={() => setDeleteConfirm(true)}>Delete account</Button>
        )}
      </div>
    </div>
  );
}
