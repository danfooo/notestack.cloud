import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { thoughtsApi } from '../api/thoughts';
import { thinkPromptsApi, thinkRunsApi, ThinkPrompt } from '../api/thinkPrompts';
import { inferTitle } from '../api/notes';
import { ThoughtTypeBadge, Badge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

// ── Thoughts tab ──────────────────────────────────────────────────────────────

const THOUGHT_TYPES = ['all', 'summary', 'todo', 'connection', 'theme', 'free'];

function ThoughtsTab() {
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
    <>
      <div className="flex gap-2 mb-6 flex-wrap">
        {THOUGHT_TYPES.map(type => (
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
        <div className="flex justify-center pt-8"><Spinner size="lg" /></div>
      ) : thoughts.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-4">💭</div>
          <p className="text-sm">No thoughts yet. Visit the dashboard to run prompts, or save notes with on-save prompts enabled.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {thoughts.map((thought: any) => (
            <div key={thought.id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <button onClick={() => toggle(thought.id)} className="w-full text-left px-5 py-4">
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
              {expanded.has(thought.id) && thought.source_note_id && (
                <div className="px-5 pb-4 border-t border-gray-50 pt-3">
                  <div className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <Link to={`/notes/${thought.source_note_id}`} className="text-xs text-amber-600 hover:text-amber-700">
                      View in note: {thought.note_title || inferTitle(thought.note_body) || 'Untitled'} →
                    </Link>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── Prompts tab ───────────────────────────────────────────────────────────────

const ALL_TRIGGERS = ['manual', 'on_save', 'on_dashboard', 'scheduled'] as const;
type TriggerKey = typeof ALL_TRIGGERS[number];

const TRIGGER_LABELS: Record<TriggerKey, string> = {
  manual: 'Manual',
  on_save: 'On save',
  on_dashboard: 'On dashboard',
  scheduled: 'Scheduled',
};

function PromptForm({ prompt, onSave, onCancel }: {
  prompt?: Partial<ThinkPrompt>;
  onSave: (data: Partial<ThinkPrompt>) => void;
  onCancel: () => void;
}) {
  const initialTriggers = Array.isArray(prompt?.trigger)
    ? prompt!.trigger
    : prompt?.trigger
      ? [prompt.trigger as unknown as string]
      : ['manual'];

  const [form, setForm] = useState({
    name: prompt?.name || '',
    description: prompt?.description || '',
    prompt_text: prompt?.prompt_text || '',
    output_type: prompt?.output_type || 'free',
    scope: prompt?.scope || 'note',
    triggers: initialTriggers as string[],
    schedule: prompt?.schedule || '',
    model: prompt?.model || 'claude-opus-4-6',
    enabled: prompt?.enabled !== 0 ? 1 : 0,
  });

  const set = (key: string, val: any) => setForm(f => ({ ...f, [key]: val }));

  const toggleTrigger = (t: string) => {
    set('triggers', form.triggers.includes(t)
      ? form.triggers.filter(x => x !== t)
      : [...form.triggers, t]
    );
  };

  return (
    <div className="space-y-4">
      <Input label="Name" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Extract todos" />
      <Input label="Description" value={form.description} onChange={e => set('description', e.target.value)} placeholder="Optional" />
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Prompt text</label>
        <textarea
          value={form.prompt_text}
          onChange={e => set('prompt_text', e.target.value)}
          rows={5}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
          placeholder="You are a helpful assistant..."
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Output type</label>
          <select value={form.output_type} onChange={e => set('output_type', e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none">
            <option value="free">Free</option>
            <option value="summary">Summary</option>
            <option value="todo">Todo</option>
            <option value="connection">Connection</option>
            <option value="theme">Theme</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Scope</label>
          <select value={form.scope} onChange={e => set('scope', e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none">
            <option value="note">Single note</option>
            <option value="all">All notes</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Triggers</label>
        <div className="flex flex-wrap gap-2">
          {ALL_TRIGGERS.map(t => (
            <label key={t} className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.triggers.includes(t)}
                onChange={() => toggleTrigger(t)}
                className="rounded accent-amber-500"
              />
              <span className="text-sm text-gray-700">{TRIGGER_LABELS[t]}</span>
            </label>
          ))}
        </div>
        {form.triggers.includes('scheduled') && (
          <div className="mt-3">
            <Input label="Cron schedule" value={form.schedule} onChange={e => set('schedule', e.target.value)} placeholder="0 8 * * 1" />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input type="checkbox" id="enabled" checked={form.enabled === 1} onChange={e => set('enabled', e.target.checked ? 1 : 0)} className="rounded" />
        <label htmlFor="enabled" className="text-sm text-gray-700">Enabled</label>
      </div>
      <div className="flex gap-3 pt-2">
        <Button onClick={() => onSave({ ...form, trigger: form.triggers, schedule: form.schedule || null } as any)}>Save</Button>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function PromptsTab() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);

  const { data: prompts = [] } = useQuery({
    queryKey: ['think-prompts'],
    queryFn: () => thinkPromptsApi.list().then(r => r.data),
  });

  const { data: runs = [] } = useQuery({
    queryKey: ['think-runs'],
    queryFn: () => thinkRunsApi.list({ limit: 20 }).then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<ThinkPrompt>) => thinkPromptsApi.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['think-prompts'] }); setIsNew(false); },
  });

  const updateMutation = useMutation({
    mutationFn: (data: Partial<ThinkPrompt> & { id: string }) => thinkPromptsApi.update(data.id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['think-prompts'] }); setEditingId(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => thinkPromptsApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['think-prompts'] }),
  });

  const runMutation = useMutation({
    mutationFn: (id: string) => thinkPromptsApi.run(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['think-runs'] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Prompts Claude uses to analyze your notes</p>
        <Button size="sm" onClick={() => setIsNew(true)}>New prompt</Button>
      </div>

      {isNew && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-medium text-gray-900 mb-4">New prompt</h3>
          <PromptForm
            onSave={(data) => createMutation.mutate(data)}
            onCancel={() => setIsNew(false)}
          />
        </div>
      )}

      <div className="space-y-3">
        {(prompts as ThinkPrompt[]).map((prompt) => (
          editingId === prompt.id ? (
            <div key={prompt.id} className="bg-white rounded-xl border border-amber-200 p-5">
              <PromptForm
                prompt={prompt}
                onSave={(data) => updateMutation.mutate({ ...data, id: prompt.id })}
                onCancel={() => setEditingId(null)}
              />
            </div>
          ) : (
            <div key={prompt.id} className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-medium text-sm text-gray-900">{prompt.name}</span>
                    <Badge variant={prompt.enabled ? 'green' : 'gray'}>{prompt.enabled ? 'on' : 'off'}</Badge>
                    {prompt.trigger.map(t => <Badge key={t}>{t}</Badge>)}
                    <Badge variant="blue">{prompt.output_type}</Badge>
                  </div>
                  {prompt.description && (
                    <p className="text-xs text-gray-500">{prompt.description}</p>
                  )}
                  {prompt.schedule && (
                    <p className="text-xs text-gray-400 mt-1">Schedule: <code>{prompt.schedule}</code></p>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                  {prompt.trigger.includes('manual') && (
                    <Button variant="secondary" size="sm" onClick={() => runMutation.mutate(prompt.id)} loading={runMutation.isPending}>
                      Run
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setEditingId(prompt.id)}>Edit</Button>
                  <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate(prompt.id)}>Delete</Button>
                </div>
              </div>
            </div>
          )
        ))}
      </div>

      {runs.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Recent runs</h3>
          <div className="space-y-2">
            {runs.map((run: any) => (
              <div key={run.id} className="bg-white rounded-lg border border-gray-100 px-4 py-3 flex items-center justify-between text-sm">
                <div>
                  <span className="font-medium text-gray-900">{run.prompt_name}</span>
                  <span className="text-gray-400 ml-2 text-xs">
                    {formatDistanceToNow(new Date(run.started_at * 1000), { addSuffix: true })}
                  </span>
                </div>
                <Badge variant={run.status === 'done' ? 'green' : run.status === 'error' ? 'red' : 'gray'}>
                  {run.status}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = 'thoughts' | 'prompts';

export function ThoughtsPage() {
  const [tab, setTab] = useState<Tab>('thoughts');

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <div className="max-w-3xl mx-auto px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Thoughts</h1>
          <div className="flex gap-1 bg-white border border-gray-200 rounded-lg p-1">
            <button
              onClick={() => setTab('thoughts')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${tab === 'thoughts' ? 'bg-amber-500 text-white font-medium' : 'text-gray-600 hover:text-gray-900'}`}
            >
              Thoughts
            </button>
            <button
              onClick={() => setTab('prompts')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${tab === 'prompts' ? 'bg-amber-500 text-white font-medium' : 'text-gray-600 hover:text-gray-900'}`}
            >
              Prompts
            </button>
          </div>
        </div>

        {tab === 'thoughts' ? <ThoughtsTab /> : <PromptsTab />}
      </div>
    </div>
  );
}
