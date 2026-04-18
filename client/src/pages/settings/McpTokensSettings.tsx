import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { settingsApi } from '../../api/settings';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';

function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative group">
      <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 text-xs overflow-x-auto pr-20 whitespace-pre-wrap break-all font-mono">
        {command}
      </pre>
      <button
        onClick={copy}
        className="absolute top-3 right-3 text-xs px-2.5 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  );
}

export function McpTokensSettings() {
  const queryClient = useQueryClient();
  const [tokenName, setTokenName] = useState('');
  const [newToken, setNewToken] = useState<{ name: string; token: string } | null>(null);

  const { data: tokens = [] } = useQuery({
    queryKey: ['mcp-tokens'],
    queryFn: () => settingsApi.getMcpTokens().then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => settingsApi.createMcpToken(name),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['mcp-tokens'] });
      setNewToken({ name: res.data.name, token: res.data.token });
      setTokenName('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => settingsApi.deleteMcpToken(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mcp-tokens'] }),
  });

  const APP_URL = window.location.origin;
  const mcpUrl = `${APP_URL}/mcp`;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">MCP Tokens</h2>
        <p className="text-sm text-gray-500">Generate tokens to connect Claude Code to your notestack knowledge base.</p>
      </div>

      {/* Setup instructions */}
      <div className="bg-gray-50 rounded-xl p-5 border border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Setup instructions</h3>
        <p className="text-sm text-gray-600 mb-3">
          Generate a token below, then run this command in your terminal:
        </p>
        <CopyableCommand command={`claude mcp add notestack --transport http ${mcpUrl} --header "Authorization: Bearer YOUR_TOKEN_HERE"`} />
      </div>

      {/* New token was just created */}
      {newToken && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-amber-900 mb-1">Token created — copy it now!</h3>
          <p className="text-xs text-amber-700 mb-3">This token is shown once and cannot be retrieved again.</p>
          <CopyableCommand command={`claude mcp add notestack --transport http ${mcpUrl} --header "Authorization: Bearer ${newToken.token}"`} />
          <button onClick={() => setNewToken(null)} className="mt-3 text-sm text-amber-700 hover:text-amber-900">
            Dismiss
          </button>
        </div>
      )}

      {/* Create new token */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Generate new token</h3>
        <div className="flex gap-3">
          <Input
            value={tokenName}
            onChange={e => setTokenName(e.target.value)}
            placeholder="Token name (e.g. Claude Code)"
            className="flex-1"
            onKeyDown={e => { if (e.key === 'Enter' && tokenName.trim()) createMutation.mutate(tokenName.trim()); }}
          />
          <Button
            onClick={() => tokenName.trim() && createMutation.mutate(tokenName.trim())}
            loading={createMutation.isPending}
            disabled={!tokenName.trim()}
          >
            Generate
          </Button>
        </div>
      </div>

      {/* Token list */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Active tokens</h3>
        {tokens.length === 0 ? (
          <p className="text-sm text-gray-400">No tokens yet.</p>
        ) : (
          <div className="space-y-2">
            {tokens.map((token: any) => (
              <div key={token.id} className="bg-white rounded-lg border border-gray-100 px-4 py-3 flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm text-gray-900">{token.name}</div>
                  <div className="text-xs text-gray-400">
                    Created {formatDistanceToNow(new Date(token.created_at * 1000), { addSuffix: true })}
                    {token.last_used_at && ` · Last used ${formatDistanceToNow(new Date(token.last_used_at * 1000), { addSuffix: true })}`}
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
        )}
      </div>
    </div>
  );
}
