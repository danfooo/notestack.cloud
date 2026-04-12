import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/client';
import { Spinner } from '../components/ui/Spinner';
import { Button } from '../components/ui/Button';

export function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const [status, setStatus] = useState<'loading' | 'valid' | 'invalid'>('loading');
  const [invite, setInvite] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) { setStatus('invalid'); setError('Invalid invite link'); return; }
    api.get(`/invites/${token}`)
      .then(res => {
        setInvite(res.data);
        setStatus('valid');
      })
      .catch(err => {
        const code = err.response?.data?.error;
        setStatus('invalid');
        setError(code === 'REVOKED' ? 'This invite has been revoked.'
          : code === 'EXPIRED' ? 'This invite has expired.'
          : 'Invalid invite link.');
      });
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
          {status === 'loading' && <Spinner size="lg" className="mx-auto" />}

          {status === 'valid' && (
            <>
              <div className="text-4xl mb-4">🧠</div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">You're invited!</h2>
              <p className="text-gray-500 text-sm mb-6">
                <strong>{invite.inviter_name}</strong> invited you to join brains — a personal knowledge system powered by AI.
              </p>
              <div className="space-y-3">
                <Link to={`/signup?invite=${token}`}>
                  <Button className="w-full">Create account</Button>
                </Link>
                <Link to={`/login`} className="block text-sm text-amber-600 hover:text-amber-700">
                  Already have an account? Sign in
                </Link>
              </div>
            </>
          )}

          {status === 'invalid' && (
            <>
              <div className="text-4xl mb-4">❌</div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Invalid invite</h2>
              <p className="text-gray-500 text-sm mb-6">{error}</p>
              <Link to="/login" className="text-amber-600 hover:text-amber-700 text-sm">
                Go to sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
