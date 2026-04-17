import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Note } from '../../api/notes';
import { foldersApi, Folder } from '../../api/folders';

interface Props {
  notes: Note[];
  onClose: () => void;
  onAction: (updates: { id: string; data: Record<string, any> }[]) => Promise<void>;
  onDelete: (ids: string[]) => Promise<void>;
}

function TagChip({ tag, count, onRemove }: { tag: string; count: number; onRemove: () => void }) {
  return (
    <button
      onClick={onRemove}
      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-gray-100 hover:bg-red-50 hover:text-red-700 text-gray-600 border border-transparent hover:border-red-200 transition-colors group"
      title={`Remove "${tag}" from all notes that have it`}
    >
      <span>{tag}</span>
      <span className="text-gray-400 group-hover:text-red-400">×{count}</span>
    </button>
  );
}

type ToggleState = 'all' | 'none' | 'mixed';

function AttributeRow({
  label,
  state,
  counts,
  total,
  onEnable,
  onDisable,
  color = 'amber',
}: {
  label: string;
  state: ToggleState;
  counts: { on: number; off: number };
  total: number;
  onEnable: () => void;
  onDisable: () => void;
  color?: 'amber' | 'violet' | 'blue';
}) {
  const colorMap = {
    amber: 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100',
    violet: 'border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100',
    blue: 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100',
  };
  const activeClass = colorMap[color];

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm text-gray-700">{label}</span>
        <span className="text-xs text-gray-400">
          {counts.on === 0 ? 'none' : counts.on === total ? 'all' : `${counts.on} of ${total}`}
        </span>
      </div>
      <div className="flex gap-1 flex-shrink-0">
        <button
          onClick={onEnable}
          disabled={state === 'all'}
          className={`px-2.5 py-1 text-xs rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${state === 'all' ? activeClass : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
        >
          On
        </button>
        <button
          onClick={onDisable}
          disabled={state === 'none'}
          className={`px-2.5 py-1 text-xs rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${state === 'none' ? 'border-gray-300 bg-gray-100 text-gray-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
        >
          Off
        </button>
      </div>
    </div>
  );
}

export function BulkActionsMenu({ notes, onClose, onAction, onDelete }: Props) {
  const [addTagInput, setAddTagInput] = useState('');
  const [targetFolderId, setTargetFolderId] = useState<string>('__none__');
  const [deleteStage, setDeleteStage] = useState<'idle' | 'confirm'>('idle');
  const [isWorking, setIsWorking] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const { data: foldersRes } = useQuery({
    queryKey: ['folders'],
    queryFn: () => foldersApi.list().then(r => r.data),
  });
  const folders: Folder[] = foldersRes ?? [];

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

  // Tag frequency map
  const tagFrequency = useMemo(() => {
    const freq = new Map<string, number>();
    for (const note of notes) {
      for (const tag of note.tags) {
        freq.set(tag, (freq.get(tag) ?? 0) + 1);
      }
    }
    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1]);
  }, [notes]);

  // Attribute state
  const archivedCount = notes.filter(n => n.archived).length;
  const privateCount = notes.filter(n => n.private).length;
  const pinnedCount = notes.filter(n => n.pinned).length;
  const total = notes.length;

  const toggState = (count: number): ToggleState =>
    count === 0 ? 'none' : count === total ? 'all' : 'mixed';

  const run = async (label: string, updates: { id: string; data: Record<string, any> }[]) => {
    setIsWorking(true);
    setStatusMessage(null);
    try {
      await onAction(updates);
      setStatusMessage(`Done — ${label}`);
      setTimeout(() => setStatusMessage(null), 2500);
    } finally {
      setIsWorking(false);
    }
  };

  const handleRemoveTag = (tag: string) => {
    const updates = notes
      .filter(n => n.tags.includes(tag))
      .map(n => ({ id: n.id, data: { tags: n.tags.filter(t => t !== tag) } }));
    run(`removed "${tag}" from ${updates.length} notes`, updates);
  };

  const handleAddTag = () => {
    const tag = addTagInput.trim().toLowerCase();
    if (!tag) return;
    const updates = notes
      .filter(n => !n.tags.includes(tag))
      .map(n => ({ id: n.id, data: { tags: [...n.tags, tag] } }));
    if (updates.length === 0) {
      setStatusMessage(`All notes already have "${tag}"`);
      setTimeout(() => setStatusMessage(null), 2000);
      return;
    }
    run(`added "${tag}" to ${updates.length} notes`, updates);
    setAddTagInput('');
  };

  const handleSetAttribute = (attr: 'archived' | 'private' | 'pinned', value: boolean) => {
    const updates = notes
      .filter(n => Boolean(n[attr]) !== value)
      .map(n => ({ id: n.id, data: { [attr]: value } }));
    const verb = value ? (attr === 'archived' ? 'archived' : attr === 'private' ? 'made private' : 'pinned') :
      (attr === 'archived' ? 'unarchived' : attr === 'private' ? 'made public' : 'unpinned');
    run(`${verb} ${updates.length} notes`, updates);
  };

  const handleMoveFolder = () => {
    if (targetFolderId === '__keep__') return;
    const folder_id = targetFolderId === '__none__' ? null : targetFolderId;
    const updates = notes
      .filter(n => n.folder_id !== folder_id)
      .map(n => ({ id: n.id, data: { folder_id } }));
    if (updates.length === 0) {
      setStatusMessage('All notes already in that folder');
      setTimeout(() => setStatusMessage(null), 2000);
      return;
    }
    const dest = folder_id ? (folders.find(f => f.id === folder_id)?.name ?? 'folder') : 'no folder';
    run(`moved ${updates.length} notes to ${dest}`, updates);
  };

  const handleDelete = async () => {
    setIsWorking(true);
    try {
      await onDelete(notes.map(n => n.id));
      onClose();
    } finally {
      setIsWorking(false);
    }
  };

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/20">
      <div
        ref={panelRef}
        className="bg-white border border-gray-200 rounded-xl shadow-xl w-80 max-h-[90vh] overflow-y-auto flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-900 text-sm">Bulk actions</h3>
            <p className="text-xs text-gray-500">{total} note{total !== 1 ? 's' : ''} selected</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col gap-4 p-4">
          {/* Status */}
          {statusMessage && (
            <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
              {statusMessage}
            </div>
          )}

          {/* Tags — remove */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Tags in selection</label>
            {tagFrequency.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No tags in these notes</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {tagFrequency.map(([tag, count]) => (
                  <TagChip key={tag} tag={tag} count={count} onRemove={() => handleRemoveTag(tag)} />
                ))}
              </div>
            )}
            <p className="text-xs text-gray-400">Click a tag to remove it from all notes that have it</p>
          </div>

          {/* Tags — add */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Add tag to all</label>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={addTagInput}
                onChange={e => setAddTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddTag(); }}
                placeholder="tag name"
                className="flex-1 text-sm border border-gray-200 rounded px-2 py-1.5 outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 placeholder-gray-300"
              />
              <button
                onClick={handleAddTag}
                disabled={!addTagInput.trim() || isWorking}
                className="px-3 py-1.5 text-xs bg-amber-500 hover:bg-amber-600 text-white rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Add
              </button>
            </div>
          </div>

          <hr className="border-gray-100" />

          {/* Attributes */}
          <div className="flex flex-col gap-2.5">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Attributes</label>
            <AttributeRow
              label="Archived"
              state={toggState(archivedCount)}
              counts={{ on: archivedCount, off: total - archivedCount }}
              total={total}
              onEnable={() => handleSetAttribute('archived', true)}
              onDisable={() => handleSetAttribute('archived', false)}
              color="amber"
            />
            <AttributeRow
              label="Private"
              state={toggState(privateCount)}
              counts={{ on: privateCount, off: total - privateCount }}
              total={total}
              onEnable={() => handleSetAttribute('private', true)}
              onDisable={() => handleSetAttribute('private', false)}
              color="violet"
            />
            <AttributeRow
              label="Pinned"
              state={toggState(pinnedCount)}
              counts={{ on: pinnedCount, off: total - pinnedCount }}
              total={total}
              onEnable={() => handleSetAttribute('pinned', true)}
              onDisable={() => handleSetAttribute('pinned', false)}
              color="blue"
            />
          </div>

          <hr className="border-gray-100" />

          {/* Move to folder */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Move to folder</label>
            <div className="flex gap-1.5">
              <select
                value={targetFolderId}
                onChange={e => setTargetFolderId(e.target.value)}
                className="flex-1 text-sm border border-gray-200 rounded px-2 py-1.5 outline-none focus:border-amber-400 bg-white"
              >
                <option value="__keep__">— pick a folder —</option>
                <option value="__none__">No folder</option>
                {folders.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
              <button
                onClick={handleMoveFolder}
                disabled={targetFolderId === '__keep__' || isWorking}
                className="px-3 py-1.5 text-xs bg-amber-500 hover:bg-amber-600 text-white rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Move
              </button>
            </div>
          </div>

          <hr className="border-gray-100" />

          {/* Delete */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Danger zone</label>
            {deleteStage === 'idle' ? (
              <button
                onClick={() => setDeleteStage('confirm')}
                className="w-full px-3 py-2 text-sm text-red-600 border border-red-200 rounded hover:bg-red-50 transition-colors"
              >
                Delete {total} note{total !== 1 ? 's' : ''}…
              </button>
            ) : (
              <div className="flex flex-col gap-2 bg-red-50 border border-red-200 rounded p-3">
                <p className="text-xs text-red-700 font-medium">
                  Permanently delete {total} note{total !== 1 ? 's' : ''}? This cannot be undone.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDeleteStage('idle')}
                    className="flex-1 px-3 py-1.5 text-xs border border-gray-200 rounded hover:bg-gray-50 transition-colors text-gray-700"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={isWorking}
                    className="flex-1 px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded transition-colors disabled:opacity-60"
                  >
                    {isWorking ? 'Deleting…' : 'Yes, delete'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Working overlay hint */}
        {isWorking && (
          <div className="absolute inset-0 rounded-xl bg-white/60 flex items-center justify-center pointer-events-none">
            <div className="text-sm text-gray-500 font-medium">Working…</div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
