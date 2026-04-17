import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { settingsApi } from '../../api/settings';
import { Button } from '../../components/ui/Button';

function CopyBlock({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div>
      {label && <p className="text-xs font-medium text-gray-500 mb-1.5">{label}</p>}
      <div className="relative">
        <pre className="bg-gray-900 text-gray-100 rounded-lg p-3.5 text-xs overflow-x-auto pr-20 whitespace-pre-wrap break-all font-mono leading-relaxed">
          {value}
        </pre>
        <button
          onClick={copy}
          className="absolute top-2.5 right-2.5 text-xs px-2.5 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export function McpTokensSettings() {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [newToken, setNewToken] = useState<{ token: string } | null>(null);

  const { data: tokens = [] } = useQuery({
    queryKey: ['mcp-tokens'],
    queryFn: () => settingsApi.getMcpTokens().then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => settingsApi.createMcpToken(name),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['mcp-tokens'] });
      setNewToken({ token: res.data.token });
      setConfirming(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => settingsApi.deleteMcpToken(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mcp-tokens'] }),
  });

  const APP_URL = window.location.origin;
  const mcpUrl = `${APP_URL}/mcp`;

  const handleGenerate = () => {
    const name = `Access code ${tokens.length + 1}`;
    createMutation.mutate(name);
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">MCP Tokens</h2>
        <p className="text-sm text-gray-500">Generate tokens to connect Claude Code to your notestack.cloud knowledge base.</p>
      </div>

      {/* Setup instructions */}
      <div className="bg-gray-50 rounded-xl p-5 border border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Setup instructions</h3>
        <p className="text-sm text-gray-600 mb-3">Add this to your <code className="bg-gray-200 px-1 rounded">~/.claude/settings.json</code>:</p>
        <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 text-xs overflow-x-auto">
{`{
  "mcpServers": {
    "notestack": {
      "type": "http",
      "url": "${APP_URL}/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN_HERE"
      }
    }
  }
}`}
        </pre>
      </div>

      {/* New token was just created */}
      {newToken && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 space-y-4">
          <div>
            <p className="text-sm font-semibold text-green-900 mb-0.5">Your access code is ready</p>
            <p className="text-xs text-green-700">Copy it now — it won't be shown again.</p>
          </div>
          <CopyBlock
            label="Claude Code (run in terminal)"
            value={`claude mcp add notestack --transport http ${mcpUrl} --header "Authorization: Bearer ${newToken.token}"`}
          />
          <CopyBlock
            label="Other MCP-compatible tools (add to your MCP config)"
            value={`"notestack": {\n  "url": "${mcpUrl}",\n  "headers": { "Authorization": "Bearer ${newToken.token}" }\n}`}
          />
          <button onClick={() => setNewToken(null)} className="text-xs text-green-700 hover:text-green-900">
            Dismiss
          </button>
        </div>
      )}

      {/* Careful warning if tokens exist */}
      {tokens.length > 0 && !newToken && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3.5">
          <p className="text-sm font-semibold text-amber-800 mb-0.5">Careful!</p>
          <p className="text-xs text-amber-700">
            Each access code gives full read and write access to your notes. Anyone who has a code can use it.
            Revoke any codes you no longer use.
          </p>
        </div>
      )}

      {/* Generate flow */}
      {!confirming ? (
        <Button onClick={() => setConfirming(true)}>
          Generate access code
        </Button>
      ) : (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 space-y-4">
          <div>
            <p className="text-sm font-semibold text-gray-900 mb-1">Before you continue</p>
            <p className="text-sm text-gray-600">
              This access code gives any AI assistant full access to read and write your notes.
              Anyone who has it can use it — treat it like a password and don't share it publicly.
            </p>
          </div>
          <div className="flex gap-3">
            <Button onClick={handleGenerate} loading={createMutation.isPending}>
              I understand, generate code
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Token list */}
      {tokens.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Active access codes</h3>
          <div className="space-y-2">
            {tokens.map((token: any) => (
              <div key={token.id} className="bg-white rounded-lg border border-gray-100 px-4 py-3 flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm text-gray-900">{token.name}</div>
                  <div className="text-xs text-gray-400">
                    Created {formatDistanceToNow(new Date(token.created_at * 1000), { addSuffix: true })}
                    {token.last_used_at
                      ? ` · Last used ${formatDistanceToNow(new Date(token.last_used_at * 1000), { addSuffix: true })}`
                      : ' · Never used'}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteMutation.mutate(token.id)}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                >
                  Revoke
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
