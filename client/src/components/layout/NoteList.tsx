import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { notesApi, Note, inferTitle, getBodySnippet } from '../../api/notes';
import { useUiStore } from '../../stores/uiStore';
import { Spinner } from '../ui/Spinner';
import { NoteContextMenu } from './NoteContextMenu';
import { QueryBuilder } from './QueryBuilder';
import {
  QueryGroup, emptyGroup, isQueryEmpty, serializeQuery, evaluateQuery,
} from '../../lib/noteQuery';

interface NoteListProps {
  selectedNoteId?: string;
}

export function NoteList({ selectedNoteId }: NoteListProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeView, selectedFolderId } = useUiStore();
  const [filterQuery, setFilterQuery] = useState<QueryGroup>(emptyGroup);
  const [contextMenu, setContextMenu] = useState<{ note: Note; x: number; y: number } | null>(null);

  const hasFilter = !isQueryEmpty(filterQuery);
  const filterKey = serializeQuery(filterQuery);

  // When filtering, fetch everything and evaluate client-side.
  // When not filtering, use existing view-based server params.
  const fetchParams = useMemo((): Record<string, any> => {
    if (hasFilter) return { archived: 'all', limit: 500 };
    const p: Record<string, any> = {};
    if (activeView === 'folder' && selectedFolderId) p.folder_id = selectedFolderId;
    if (activeView === 'archived') p.archived = true;
    return p;
  }, [hasFilter, activeView, selectedFolderId]);

  const { data: notes = [], isLoading } = useQuery({
    queryKey: ['notes', activeView, selectedFolderId, filterKey],
    queryFn: () => notesApi.list(fetchParams).then(r => r.data),
  });

  const filteredNotes = useMemo(() => {
    if (hasFilter) return notes.filter((n: Note) => evaluateQuery(filterQuery, n));
    if (activeView === 'pinned')   return notes.filter((n: Note) => n.pinned);
    if (activeView === 'archived') return notes.filter((n: Note) => n.archived);
    return notes.filter((n: Note) => !n.archived);
  }, [notes, hasFilter, filterQuery, activeView]);

  const createMutation = useMutation({
    mutationFn: () => notesApi.create({
      body: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }),
      folder_id: selectedFolderId || undefined,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      navigate(`/notes/${res.data.id}`);
    },
  });

  const getViewTitle = () => {
    if (hasFilter) return 'Filter results';
    switch (activeView) {
      case 'all':      return 'All Notes';
      case 'pinned':   return 'Pinned';
      case 'archived': return 'Archived';
      case 'folder':   return 'Folder';
      default:         return 'Notes';
    }
  };

  return (
    <div className="h-full flex flex-col bg-gray-50 border-r border-gray-200">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 space-y-2">
        <div className="flex items-center justify-between">
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

        <QueryBuilder value={filterQuery} onChange={setFilterQuery} />
      </div>

      {/* Note list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex justify-center pt-8">
            <Spinner />
          </div>
        ) : filteredNotes.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-400">
            {hasFilter ? 'No notes match this filter' : 'No notes yet'}
          </div>
        ) : (
          filteredNotes.map((note: Note) => (
            <NoteCard
              key={note.id}
              note={note}
              selected={note.id === selectedNoteId}
              onClick={() => navigate(`/notes/${note.id}`)}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ note, x: e.clientX, y: e.clientY });
              }}
            />
          ))
        )}
      </div>

      {contextMenu && (
        <NoteContextMenu
          note={contextMenu.note}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
          onSave={(updates) =>
            notesApi.update(contextMenu.note.id, updates as any)
              .then(() => queryClient.invalidateQueries({ queryKey: ['notes'] }))
              .then(() => setContextMenu(null))
          }
        />
      )}
    </div>
  );
}

function NoteCard({
  note, selected, onClick, onContextMenu,
}: {
  note: Note;
  selected: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const snippet = getBodySnippet(note.body, !note.title);

  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
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
            {note.private ? (
              <svg className="w-3 h-3 text-violet-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            ) : null}
            <span className="font-medium text-sm text-gray-900 truncate">
              {note.title || inferTitle(note.body) || 'Untitled'}
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
