import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { notesApi } from '../api/notes';
import { NoteList } from '../components/layout/NoteList';
import { NoteEditor } from '../components/editor/NoteEditor';
import { useUiStore } from '../stores/uiStore';
import { Spinner } from '../components/ui/Spinner';

export function NotesPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { setSelectedNote } = useUiStore();

  useEffect(() => {
    setSelectedNote(id || null);
  }, [id, setSelectedNote]);

  const { data: note, isLoading } = useQuery({
    queryKey: ['note', id],
    queryFn: () => notesApi.get(id!).then(r => r.data),
    enabled: !!id,
  });

  // Keyboard shortcut: Cmd+N to create new note
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        navigate('/notes');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);

  return (
    <div className="h-full flex">
      {/* Note list pane */}
      <div className="w-72 flex-shrink-0">
        <NoteList selectedNoteId={id} />
      </div>

      {/* Editor pane */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {id ? (
          isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Spinner size="lg" />
            </div>
          ) : note ? (
            <NoteEditor key={note.id} note={note} />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400">
              Note not found
            </div>
          )
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
            <svg className="w-12 h-12 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm">Select a note or create a new one</p>
            <p className="text-xs text-gray-300">⌘N to create new note</p>
          </div>
        )}
      </div>
    </div>
  );
}
