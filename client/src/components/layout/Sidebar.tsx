import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { foldersApi, Folder } from '../../api/folders';
import { useUiStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { Button } from '../ui/Button';

interface FolderItemProps {
  folder: Folder;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function FolderItem({ folder, depth, selectedId, onSelect }: FolderItemProps) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = (folder.children?.length ?? 0) > 0;

  return (
    <div>
      <button
        onClick={() => onSelect(folder.id)}
        className={`w-full flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors group ${
          selectedId === folder.id
            ? 'bg-amber-500/20 text-amber-300'
            : 'text-gray-300 hover:bg-white/10 hover:text-white'
        }`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        {hasChildren && (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(x => !x); }}
            className="text-gray-500 hover:text-gray-300 flex-shrink-0"
          >
            <svg className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
          </button>
        )}
        {!hasChildren && <span className="w-3 flex-shrink-0" />}
        <svg className="w-3.5 h-3.5 flex-shrink-0 opacity-60" fill="currentColor" viewBox="0 0 20 20">
          <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
        </svg>
        <span className="truncate">{folder.name}</span>
      </button>
      {expanded && hasChildren && (
        <div>
          {folder.children!.map(child => (
            <FolderItem
              key={child.id}
              folder={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeView, selectedFolderId, setActiveView, setSelectedFolder, toggleSidebar } = useUiStore();
  const user = useAuthStore(s => s.user);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);

  const { data: folders = [] } = useQuery({
    queryKey: ['folders'],
    queryFn: () => foldersApi.list().then(r => r.data),
  });

  const createFolderMutation = useMutation({
    mutationFn: (name: string) => foldersApi.create({ name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      setNewFolderName('');
      setShowNewFolder(false);
    },
  });

  const navItems = [
    {
      id: 'all', label: 'All Notes', icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ), onClick: () => { setActiveView('all'); navigate('/notes'); }
    },
    {
      id: 'dashboard', label: 'Dashboard', icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      ), onClick: () => { setActiveView('dashboard'); navigate('/dashboard'); }
    },
    {
      id: 'thoughts', label: 'Thoughts', icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      ), onClick: () => { setActiveView('thoughts'); navigate('/thoughts'); }
    },
    {
      id: 'pinned', label: 'Pinned', icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
        </svg>
      ), onClick: () => { setActiveView('pinned'); navigate('/notes'); }
    },
    {
      id: 'archived', label: 'Archived', icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
        </svg>
      ), onClick: () => { setActiveView('archived'); navigate('/notes'); }
    },
  ];

  return (
    <div className="h-full flex flex-col bg-gray-900 text-gray-100 select-none">
      {/* Header */}
      <div className="px-4 py-4 flex items-center justify-between border-b border-white/10">
        <span className="font-semibold text-white text-base">notestack.cloud</span>
        <button onClick={toggleSidebar} className="text-gray-400 hover:text-white p-1 rounded">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
          </svg>
        </button>
      </div>

      {/* Navigation */}
      <div className="px-2 py-2 flex-1 overflow-y-auto">
        <div className="space-y-0.5 mb-4">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={item.onClick}
              className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                activeView === item.id
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'text-gray-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>

        {/* Folders */}
        <div className="mb-2">
          <div className="flex items-center justify-between px-3 py-1">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Folders</span>
            <button
              onClick={() => setShowNewFolder(true)}
              className="text-gray-500 hover:text-gray-300 p-0.5 rounded transition-colors"
              title="New folder"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>

          {showNewFolder && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (newFolderName.trim()) createFolderMutation.mutate(newFolderName.trim());
              }}
              className="px-3 py-1"
            >
              <input
                autoFocus
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                onBlur={() => { if (!newFolderName.trim()) setShowNewFolder(false); }}
                onKeyDown={e => { if (e.key === 'Escape') setShowNewFolder(false); }}
                placeholder="Folder name"
                className="w-full bg-white/10 text-white text-sm px-2 py-1 rounded outline-none placeholder-gray-500 border border-white/20"
              />
            </form>
          )}

          {folders.map(folder => (
            <FolderItem
              key={folder.id}
              folder={folder}
              depth={0}
              selectedId={selectedFolderId}
              onSelect={(id) => {
                setSelectedFolder(id);
                navigate('/notes');
              }}
            />
          ))}
        </div>
      </div>

      {/* User footer */}
      <div className="px-4 py-3 border-t border-white/10">
        <button
          onClick={() => navigate('/settings')}
          className="w-full flex items-center gap-2.5 text-sm text-gray-400 hover:text-white transition-colors"
        >
          {user?.avatar_url ? (
            <img src={user.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover" />
          ) : (
            <div className="w-6 h-6 rounded-full bg-amber-500 flex items-center justify-center text-white text-xs font-semibold">
              {user?.display_name[0]?.toUpperCase()}
            </div>
          )}
          <span className="truncate">{user?.display_name}</span>
          <svg className="w-4 h-4 ml-auto flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
