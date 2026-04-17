import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Note, inferTitle } from '../../api/notes';
import { foldersApi, Folder } from '../../api/folders';

interface Props {
  note: Note;
  position: { x: number; y: number };
  onClose: () => void;
  onSave: (updates: { title?: string | null; folder_id?: string | null; tags?: string[]; archived?: boolean; private?: boolean }) => void;
}

export function NoteContextMenu({ note, position, onClose, onSave }: Props) {
  const [title, setTitle] = useState(note.title || '');
  const [folderId, setFolderId] = useState<string | null>(note.folder_id);
  const [tagsInput, setTagsInput] = useState(note.tags.join(', '));
  const panelRef = useRef<HTMLDivElement>(null);

  const { data: foldersRes } = useQuery({
    queryKey: ['folders'],
    queryFn: () => foldersApi.list().then(r => r.data),
  });
  const folders: Folder[] = foldersRes ?? [];

  // Close on click-outside and Escape
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const handleSave = () => {
    const tags = tagsInput
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);
    onSave({ title: title.trim() || null, folder_id: folderId, tags });
  };

  // Clamp position to viewport
  const PANEL_W = 280;
  const PANEL_H = 320;
  const left = Math.min(position.x, window.innerWidth - PANEL_W - 8);
  const top = Math.min(position.y, window.innerHeight - PANEL_H - 8);

  const inferred = inferTitle(note.body) || 'Untitled';

  return ReactDOM.createPortal(
    <div
      ref={panelRef}
      style={{ position: 'fixed', left, top, width: PANEL_W, zIndex: 9999 }}
      className="bg-white border border-gray-200 rounded-lg shadow-lg p-4 flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Title</label>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={inferred}
          className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 placeholder-gray-300"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Folder</label>
        <select
          value={folderId ?? ''}
          onChange={e => setFolderId(e.target.value || null)}
          className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 bg-white"
        >
          <option value="">(No folder)</option>
          {folders.map(f => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Tags</label>
        <input
          type="text"
          value={tagsInput}
          onChange={e => setTagsInput(e.target.value)}
          placeholder="tag1, tag2, ..."
          className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 placeholder-gray-300"
        />
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => { onSave({ archived: !note.archived }); onClose(); }}
          className="flex-1 px-3 py-1.5 text-xs border border-gray-200 rounded hover:bg-gray-50 transition-colors text-gray-700"
        >
          {note.archived ? 'Unarchive' : 'Archive'}
        </button>
        <button
          onClick={() => { onSave({ private: !note.private }); onClose(); }}
          className={`flex-1 px-3 py-1.5 text-xs border rounded transition-colors ${note.private ? 'border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}
        >
          {note.private ? 'Remove private' : 'Make private'}
        </button>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          className="px-3 py-1.5 text-sm bg-amber-500 hover:bg-amber-600 text-white rounded transition-colors"
        >
          Save
        </button>
      </div>
    </div>,
    document.body,
  );
}
