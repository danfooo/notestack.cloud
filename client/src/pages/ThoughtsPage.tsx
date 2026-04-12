import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { thoughtsApi } from '../api/thoughts';
import { ThoughtTypeBadge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';

const TYPES = ['all', 'summary', 'todo', 'connection', 'theme', 'free'];

export function ThoughtsPage() {
  const [typeFilter, setTypeFilter] = useState('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: thoughts = [], isLoading } = useQuery({
    queryKey: ['thoughts', typeFilter],
    queryFn: () => thoughtsApi.list({
      type: typeFilter !== 'all' ? typeFilter : undefined,
      limit: 100,
    }).then(r => r.data),
  });

  const toggle = (id: string) => setExpanded(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <div className="max-w-3xl mx-auto px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Thoughts</h1>
        </div>

        {/* Type filter */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {TYPES.map(type => (
            <button
              key={type}
              onClick={() => setTypeFilter(type)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors capitalize ${
                typeFilter === type
                  ? 'bg-amber-500 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
              }`}
            >
              {type}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex justify-center pt-8">
            <Spinner size="lg" />
          </div>
        ) : thoughts.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-4">💭</div>
            <p className="text-sm">No thoughts yet. Save some notes and Claude will start thinking!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {thoughts.map((thought: any) => (
              <div key={thought.id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <button
                  onClick={() => toggle(thought.id)}
                  className="w-full text-left px-5 py-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      <ThoughtTypeBadge type={thought.type} />
                      <div className="flex-1 min-w-0">
                        {thought.title && (
                          <div className="font-medium text-sm text-gray-900 mb-1">{thought.title}</div>
                        )}
                        <p className={`text-sm text-gray-600 ${expanded.has(thought.id) ? '' : 'line-clamp-2'}`}>
                          {thought.body}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs text-gray-400">
                        {formatDistanceToNow(new Date(thought.created_at * 1000), { addSuffix: true })}
                      </span>
                      <svg
                        className={`w-4 h-4 text-gray-400 transition-transform ${expanded.has(thought.id) ? 'rotate-180' : ''}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                </button>

                {expanded.has(thought.id) && (
                  <div className="px-5 pb-4 border-t border-gray-50 pt-3">
                    {thought.source_note_id && (
                      <div className="flex items-center gap-2 mb-3">
                        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <Link
                          to={`/notes/${thought.source_note_id}`}
                          className="text-xs text-amber-600 hover:text-amber-700"
                        >
                          View in note: {thought.note_title || 'Untitled'} →
                        </Link>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
