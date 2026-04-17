import React, { useState, useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { notesApi, Note } from '../../api/notes';
import { getExtensions } from './extensions';
import { EditorToolbar } from './EditorToolbar';
import { Spinner } from '../ui/Spinner';

interface NoteEditorProps {
  note: Note;
}

export function NoteEditor({ note }: NoteEditorProps) {
  const queryClient = useQueryClient();
  const [rawMode, setRawMode] = useState(false);
  const [rawJson, setRawJson] = useState('');
  const [lastSaved, setLastSaved] = useState<Date | null>(note.updated_at ? new Date(note.updated_at * 1000) : null);
  const [saving, setSaving] = useState(false);
  const isFirstLoad = useRef(true);

  const updateMutation = useMutation({
    mutationFn: (data: { body?: string }) => notesApi.update(note.id, data),
    onSuccess: (res) => {
      queryClient.setQueryData(['note', note.id], res.data);
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      setLastSaved(new Date());
      setSaving(false);
    },
    onError: () => setSaving(false),
  });

  const editor = useEditor({
    extensions: getExtensions('Start writing...'),
    content: (() => {
      if (!note.body) return '';
      try { return JSON.parse(note.body); } catch { return note.body; }
    })(),
    onUpdate: ({ editor }) => {
      if (isFirstLoad.current) return;
      const json = JSON.stringify(editor.getJSON());
      debounceSaveRef.current(json);
    },
  });

  // Debounced save function using refs to avoid stale closures
  const debounceSaveRef = useRef<(body: string) => void>(() => {});

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    debounceSaveRef.current = (body: string) => {
      clearTimeout(timer);
      setSaving(true);
      timer = setTimeout(() => {
        updateMutation.mutate({ body });
      }, 1000);
    };
    return () => clearTimeout(timer);
  }, [note.id]);

  // Update editor content when note changes
  useEffect(() => {
    if (!editor) return;
    isFirstLoad.current = true;
    const content = note.body ? (() => { try { return JSON.parse(note.body!); } catch { return note.body!; } })() : '';
    editor.commands.setContent(content, false);
    setLastSaved(note.updated_at ? new Date(note.updated_at * 1000) : null);
    setTimeout(() => { isFirstLoad.current = false; }, 100);
  }, [note.id]);

  // Cmd+S save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (editor) {
          updateMutation.mutate({ body: JSON.stringify(editor.getJSON()) });
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'r') {
        e.preventDefault();
        setRawMode(m => !m);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editor]);

  const toggleRaw = () => {
    if (!editor) return;
    if (!rawMode) {
      setRawJson(JSON.stringify(editor.getJSON(), null, 2));
    } else {
      try {
        const parsed = JSON.parse(rawJson);
        const canonical = JSON.stringify(parsed);
        editor.commands.setContent(parsed, false);
        // Only save if the JSON was actually edited
        if (canonical !== JSON.stringify(editor.getJSON())) {
          updateMutation.mutate({ body: canonical });
        }
      } catch {
        // ignore invalid JSON
      }
    }
    setRawMode(m => !m);
  };

  if (!editor) return null;

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Toolbar */}
      <EditorToolbar editor={editor} />

      {/* Status bar */}
      <div className="px-10 pb-2 flex items-center gap-2 text-xs text-gray-400">
        {saving ? (
          <><Spinner size="sm" /><span>Saving...</span></>
        ) : lastSaved ? (
          <span>Saved {formatDistanceToNow(lastSaved, { addSuffix: true })}</span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={toggleRaw}
            className={`px-2 py-0.5 rounded text-xs transition-colors ${rawMode ? 'bg-amber-100 text-amber-700' : 'hover:bg-gray-100 text-gray-400 hover:text-gray-600'}`}
          >
            {rawMode ? 'Rich' : 'JSON'}
          </button>
        </div>
      </div>

      {/* Editor body */}
      <div className="flex-1 overflow-y-auto px-10 pb-20">
        {rawMode ? (
          <textarea
            value={rawJson}
            onChange={e => setRawJson(e.target.value)}
            className="w-full h-full min-h-96 font-mono text-sm text-gray-700 outline-none resize-none border border-gray-200 rounded p-3"
          />
        ) : (
          <EditorContent
            editor={editor}
            className="prose max-w-none text-gray-800 text-base leading-relaxed"
          />
        )}
      </div>
    </div>
  );
}
