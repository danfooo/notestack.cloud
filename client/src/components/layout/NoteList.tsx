import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { notesApi, Note } from '../../api/notes';
import { useUiStore } from '../../stores/uiStore';
import { Spinner } from '../ui/Spinner';

interface NoteListProps {
  selectedNoteId?: string;
}

export function NoteList({ selectedNoteId }: NoteListProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeView, selectedFolderId, searchQuery, setSearchQuery } = useUiStore();
  const [localSearch, setLocalSearch] = useState(searchQuery);

  const params: Record<string, any> = {};
  if (activeView === 'folder' && selectedFolderId) params.folder_id = selectedFolderId;
  if (activeView === 'pinned') params.folder_id = undefined; // handled in filter
  if (activeView === 'archived') params.archived = true;
  if (localSearch) params.q = localSearch;

  const { data: notes = [], isLoading } = useQuery({
    queryKey: ['notes', activeView, selectedFolderId, localSearch],
    queryFn: () => notesApi.list(params).then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: () => notesApi.create({
      title: '',
      body: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }),
      folder_id: selectedFolderId || undefined,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      navigate(`/notes/${res.data.id}`);
    },
  });

  const filteredNotes = activeView === 'pinned'
    ? notes.filter((n: Note) => n.pinned)
    : activeView === 'archived'
    ? notes.filter((n: Note) => n.archived)
    : notes.filter((n: Note) => !n.archived);

  const getViewTitle = () => {
    switch (activeView) {
      case 'all': return 'All Notes';
      case 'pinned': return 'Pinned';
      case 'archived': return 'Archived';
      case 'folder': return 'Folder';
      default: return 'Notes';
    }
  };

  return (
    <div className="h-full flex flex-col bg-gray-50 border-r border-gray-200">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-medium text-gray-900 text-sm">{getViewTitle()}</h2>
          <button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            className="text-amber-600 hover:text-amber-700 p-1 rounded transition-colors"
            title="New note (⌘N)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
        {/* Search */}
        <input
          value={localSearch}
          onChange={e => { setLocalSearch(e.target.value); setSearchQuery(e.target.value); }}
          placeholder="Search notes..."
          className="w-full px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 placeholder-gray-400"
        />
      </div>

      {/* Note list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex justify-center pt-8">
            <Spinner />
          </div>
        ) : filteredNotes.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-400">
            {localSearch ? 'No notes match your search' : 'No notes yet'}
          </div>
        ) : (
          filteredNotes.map((note: Note) => (
            <NoteCard
              key={note.id}
              note={note}
              selected={note.id === selectedNoteId}
              onClick={() => navigate(`/notes/${note.id}`)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function NoteCard({ note, selected, onClick }: { note: Note; selected: boolean; onClick: () => void }) {
  const snippet = note.body_text
    ? note.body_text.slice(0, 100) + (note.body_text.length > 100 ? '…' : '')
    : '';

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-gray-100 transition-colors hover:bg-white ${
        selected ? 'bg-amber-50 border-l-2 border-l-amber-500' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            {note.pinned ? (
              <svg className="w-3 h-3 text-amber-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z" />
              </svg>
            ) : null}
            <span className="font-medium text-sm text-gray-900 truncate">
              {note.title || 'Untitled'}
            </span>
          </div>
          {snippet && (
            <p className="text-xs text-gray-500 line-clamp-2">{snippet}</p>
          )}
          {note.tags && note.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {note.tags.slice(0, 3).map(tag => (
                <span key={tag} className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">
          {formatDistanceToNow(new Date(note.updated_at * 1000), { addSuffix: false })}
        </span>
      </div>
    </button>
  );
}
