import React, { useState, useRef } from 'react';
import api from '../../api/client';
import { Button } from '../../components/ui/Button';

export function ImportSettings() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    setError('');
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post('/import/apple-notes', form);
      setJobId(res.data.job_id);
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
        setJob(res.data);
        if (res.data.status === 'done' || res.data.status === 'error') {
          clearInterval(interval);
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

        {!job ? (
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
        ) : (
          <div>
            {job.status === 'running' || job.status === 'pending' ? (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-700">Importing notes...</span>
                  <span className="text-sm text-gray-500">{job.imported}/{job.total}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500 transition-all duration-500 rounded-full"
                    style={{ width: `${job.progress || 5}%` }}
                  />
                </div>
              </div>
            ) : job.status === 'done' ? (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h4 className="font-medium text-green-900 mb-2">Import complete!</h4>
                <ul className="text-sm text-green-700 space-y-1">
                  <li>✓ {job.imported} notes imported</li>
                  <li>✓ {job.folders_created} folders created</li>
                </ul>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-3"
                  onClick={() => { setJob(null); setJobId(null); }}
                >
                  Import another file
                </Button>
              </div>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <h4 className="font-medium text-red-900 mb-1">Import failed</h4>
                <p className="text-sm text-red-700">{job.error}</p>
                <Button size="sm" variant="secondary" className="mt-3" onClick={() => { setJob(null); setJobId(null); }}>
                  Try again
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
