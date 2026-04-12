import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { thinkPromptsApi, thinkRunsApi, ThinkPrompt } from '../../api/thinkPrompts';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';

function PromptForm({ prompt, onSave, onCancel }: {
  prompt?: Partial<ThinkPrompt>;
  onSave: (data: Partial<ThinkPrompt>) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<{
    name: string; description: string; prompt_text: string; output_type: string;
    scope: string; trigger: string; schedule: string; model: string; enabled: number;
  }>({
    name: prompt?.name || '',
    description: prompt?.description || '',
    prompt_text: prompt?.prompt_text || '',
    output_type: prompt?.output_type || 'free',
    scope: prompt?.scope || 'note',
    trigger: prompt?.trigger || 'manual',
    schedule: prompt?.schedule || '',
    model: prompt?.model || 'claude-opus-4-6',
    enabled: prompt?.enabled !== 0 ? 1 : 0,
  });

  const set = (key: string, val: any) => setForm(f => ({ ...f, [key]: val }));

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
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Trigger</label>
          <select value={form.trigger} onChange={e => set('trigger', e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none">
            <option value="manual">Manual</option>
            <option value="on_save">On save</option>
            <option value="scheduled">Scheduled</option>
          </select>
        </div>
        {form.trigger === 'scheduled' && (
          <Input label="Cron schedule" value={form.schedule} onChange={e => set('schedule', e.target.value)} placeholder="0 8 * * 1" />
        )}
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="enabled" checked={form.enabled === 1} onChange={e => set('enabled', e.target.checked ? 1 : 0)} className="rounded" />
        <label htmlFor="enabled" className="text-sm text-gray-700">Enabled</label>
      </div>
      <div className="flex gap-3 pt-2">
        <Button onClick={() => onSave(form)}>Save</Button>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

export function ThinkPromptsSettings() {
  const queryClient = useQueryClient();
  const [editingPrompt, setEditingPrompt] = useState<Partial<ThinkPrompt> | null>(null);
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
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['think-prompts'] }); setEditingPrompt(null); },
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
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Think Prompts</h2>
          <p className="text-sm text-gray-500">Prompts that Claude uses to analyze your notes</p>
        </div>
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
        {prompts.map((prompt: ThinkPrompt) => (
          editingPrompt?.id === prompt.id ? (
            <div key={prompt.id} className="bg-white rounded-xl border border-amber-200 p-5">
              <PromptForm
                prompt={editingPrompt}
                onSave={(data) => updateMutation.mutate({ ...data, id: prompt.id })}
                onCancel={() => setEditingPrompt(null)}
              />
            </div>
          ) : (
            <div key={prompt.id} className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm text-gray-900">{prompt.name}</span>
                    <Badge variant={prompt.enabled ? 'green' : 'gray'}>{prompt.enabled ? 'on' : 'off'}</Badge>
                    <Badge>{prompt.trigger}</Badge>
                    <Badge variant="blue">{prompt.output_type}</Badge>
                  </div>
                  {prompt.description && (
                    <p className="text-xs text-gray-500">{prompt.description}</p>
                  )}
                  {prompt.schedule && (
                    <p className="text-xs text-gray-400 mt-1">Schedule: <code>{prompt.schedule}</code></p>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-4">
                  {prompt.trigger === 'manual' && (
                    <Button variant="secondary" size="sm" onClick={() => runMutation.mutate(prompt.id)} loading={runMutation.isPending}>
                      Run
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setEditingPrompt(prompt)}>Edit</Button>
                  <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate(prompt.id)}>Delete</Button>
                </div>
              </div>
            </div>
          )
        ))}
      </div>

      {/* Run history */}
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
