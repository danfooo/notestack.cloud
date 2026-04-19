import React, { useState, useRef, useEffect } from 'react';
import api from '../../api/client';
import { Button } from '../../components/ui/Button';

type ImportJob = {
  job_id: string;
  status: 'pending' | 'running' | 'done' | 'error';
  progress: number;
  total: number;
  imported: number;
  folders_created: number;
  skipped: number;
  error?: string;
  started_at: number;
  finished_at?: number;
};

function formatDate(unix: number) {
  return new Date(unix * 1000).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

export function ImportSettings() {
  const [activeJob, setActiveJob] = useState<ImportJob | null>(null);
  const [history, setHistory] = useState<ImportJob[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get('/import/history').then(r => setHistory(r.data)).catch(() => {});
  }, []);

  const handleUpload = async (file: File) => {
    setError('');
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post('/import/apple-notes', form);
      const job: ImportJob = { job_id: res.data.job_id, status: 'pending', progress: 0, total: 0, imported: 0, folders_created: 0, skipped: 0, started_at: Math.floor(Date.now() / 1000) };
      setActiveJob(job);
      pollJob(res.data.job_id);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const pollJob = (id: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await api.get(`/import/${id}`);
        setActiveJob(res.data);
        if (res.data.status === 'done' || res.data.status === 'error') {
          clearInterval(interval);
          setHistory(prev => [res.data, ...prev.filter(j => j.job_id !== id)]);
          setActiveJob(null);
        }
      } catch {
        clearInterval(interval);
      }
    }, 1500);
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Import</h2>
        <p className="text-sm text-gray-500">Import notes from other apps.</p>
      </div>

      {/* Apple Notes */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="text-2xl">🍎</div>
          <div>
            <h3 className="font-medium text-gray-900">Apple Notes</h3>
            <p className="text-sm text-gray-500">Import from an Apple Notes export zip file</p>
          </div>
        </div>

        <div className="text-sm text-gray-600 mb-4 space-y-1">
          <p className="font-medium text-gray-700">How to export from Apple Notes:</p>
          <ol className="list-decimal list-inside space-y-1 text-gray-500">
            <li>Open Apple Notes on Mac</li>
            <li>Select all notes or a folder</li>
            <li>File → Export as PDF or use Settings → Data & Privacy to export</li>
            <li>Upload the resulting zip file here</li>
          </ol>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
        )}

        {activeJob ? (
          activeJob.status === 'running' || activeJob.status === 'pending' ? (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-700">Importing notes...</span>
                <span className="text-sm text-gray-500">{activeJob.imported}/{activeJob.total}</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 transition-all duration-500 rounded-full"
                  style={{ width: `${activeJob.progress || 5}%` }}
                />
              </div>
            </div>
          ) : null
        ) : (
          <div>
            <Button
              onClick={() => fileRef.current?.click()}
              loading={uploading}
              variant="secondary"
            >
              Choose zip file...
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
              }}
            />
          </div>
        )}
      </div>

      {/* Import history */}
      {history.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Import history</h3>
          <div className="space-y-2">
            {history.map(job => (
              <div key={job.job_id} className="bg-white rounded-lg border border-gray-100 p-4 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {job.status === 'done' ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">Succeeded</span>
                    ) : job.status === 'error' ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">Failed</span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">In progress</span>
                    )}
                    <span className="text-xs text-gray-400">{formatDate(job.started_at)}</span>
                  </div>
                  {job.status === 'done' && (
                    <p className="text-sm text-gray-600">
                      {job.imported} notes imported · {job.folders_created} folders created
                      {job.skipped > 0 && ` · ${job.skipped} skipped`}
                    </p>
                  )}
                  {job.status === 'error' && (
                    <p className="text-sm text-red-600 truncate">{job.error}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
