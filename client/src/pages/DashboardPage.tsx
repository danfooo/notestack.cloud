import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { dashboardApi } from '../api/dashboard';
import { inferTitle } from '../api/notes';
import { ThoughtTypeBadge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';

export function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => dashboardApi.get().then(r => r.data),
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <div className="max-w-4xl mx-auto px-8 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Pinned notes */}
          {(data?.pinned_notes?.length ?? 0) > 0 && (
            <section className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Pinned</h2>
              <div className="space-y-2">
                {data!.pinned_notes.map((note: any) => (
                  <Link key={note.id} to={`/notes/${note.id}`} className="block hover:bg-gray-50 -mx-2 px-2 py-1.5 rounded-lg">
                    <div className="font-medium text-sm text-gray-900">{note.title || inferTitle(note.body) || 'Untitled'}</div>
                    {note.body_text && (
                      <div className="text-xs text-gray-500 truncate">{note.body_text.slice(0, 80)}</div>
                    )}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Recent notes */}
          <section className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Recent</h2>
              <Link to="/notes" className="text-xs text-amber-600 hover:text-amber-700">View all</Link>
            </div>
            <div className="space-y-2">
              {(data?.recent_notes ?? []).map((note: any) => (
                <Link key={note.id} to={`/notes/${note.id}`} className="block hover:bg-gray-50 -mx-2 px-2 py-1.5 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-sm text-gray-900 truncate">{note.title || inferTitle(note.body) || 'Untitled'}</div>
                    <span className="text-xs text-gray-400 ml-2 flex-shrink-0">
                      {formatDistanceToNow(new Date(note.updated_at * 1000), { addSuffix: false })}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </section>

          {/* Active todos */}
          {(data?.active_todos?.length ?? 0) > 0 && (
            <section className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Active Todos</h2>
              <div className="space-y-2">
                {data!.active_todos.map((todo: any) => (
                  <div key={todo.id} className="flex items-start gap-2">
                    <div className="w-4 h-4 rounded border-2 border-amber-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="text-sm text-gray-900">{todo.title || todo.body?.slice(0, 80)}</div>
                      {todo.source_note_id && (
                        <div className="text-xs text-gray-400 mt-0.5">from: {todo.note_title || inferTitle(todo.note_body) || 'Untitled'}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Recent thoughts */}
          {(data?.recent_thoughts?.length ?? 0) > 0 && (
            <section className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Recent Thoughts</h2>
                <Link to="/thoughts" className="text-xs text-amber-600 hover:text-amber-700">View all</Link>
              </div>
              <div className="space-y-3">
                {data!.recent_thoughts.map((thought: any) => (
                  <div key={thought.id} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <ThoughtTypeBadge type={thought.type} />
                      {thought.title && <span className="text-sm font-medium text-gray-900">{thought.title}</span>}
                    </div>
                    {thought.body && (
                      <p className="text-xs text-gray-500 line-clamp-2">{thought.body}</p>
                    )}
                    {thought.source_note_id && (
                      <Link to={`/notes/${thought.source_note_id}`} className="text-xs text-amber-600 hover:text-amber-700">
                        View in note →
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Themes */}
          {(data?.themes?.length ?? 0) > 0 && (
            <section className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Themes</h2>
              <div className="space-y-2">
                {data!.themes.map((theme: any) => (
                  <div key={theme.id}>
                    <div className="font-medium text-sm text-gray-900">{theme.title}</div>
                    {theme.body && <div className="text-xs text-gray-500">{theme.body.slice(0, 120)}</div>}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {!data?.recent_notes?.length && !data?.recent_thoughts?.length && (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-4">🧠</div>
            <p className="text-base font-medium mb-2">Your dashboard is empty</p>
            <p className="text-sm">Start writing notes and Claude will surface insights here.</p>
          </div>
        )}
      </div>
    </div>
  );
}
