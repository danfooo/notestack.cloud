import React from 'react';

const DEFAULT_SHORTCUTS = [
  { action: 'Bold', key: '⌘B' },
  { action: 'Italic', key: '⌘I' },
  { action: 'Underline', key: '⌘U' },
  { action: 'Strikethrough', key: '⌘⇧X' },
  { action: 'Heading 1', key: '⌘⌥1' },
  { action: 'Heading 2', key: '⌘⌥2' },
  { action: 'Heading 3', key: '⌘⌥3' },
  { action: 'Bullet list', key: '⌘⇧8' },
  { action: 'Numbered list', key: '⌘⇧7' },
  { action: 'Checklist', key: '⌘⇧9' },
  { action: 'Code block', key: '⌘⌥C' },
  { action: 'Link', key: '⌘K' },
  { action: 'Undo', key: '⌘Z' },
  { action: 'Redo', key: '⌘⇧Z' },
  { action: 'Save', key: '⌘S' },
  { action: 'New note', key: '⌘N' },
  { action: 'Toggle raw mode', key: '⌘⇧R' },
  { action: 'Toggle sidebar', key: '⌘\\' },
];

export function ShortcutSettings() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Keyboard Shortcuts</h2>
        <p className="text-sm text-gray-500">Default shortcuts (Google Docs style). Custom overrides coming soon.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left px-4 py-3 text-gray-500 font-medium">Action</th>
              <th className="text-right px-4 py-3 text-gray-500 font-medium">Shortcut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {DEFAULT_SHORTCUTS.map(s => (
              <tr key={s.action} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-700">{s.action}</td>
                <td className="px-4 py-3 text-right">
                  <kbd className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs font-mono">{s.key}</kbd>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
