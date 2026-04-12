import React, { useEffect, useState } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { authApi } from '../api/auth';
import { useAuthStore } from '../stores/authStore';
import { Spinner } from '../components/ui/Spinner';

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const navigate = useNavigate();
  const login = useAuthStore(s => s.login);
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) { setStatus('error'); setError('Missing token'); return; }
    authApi.verifyEmail(token)
      .then(res => {
        login(res.data.user, res.data.token);
        setStatus('success');
        setTimeout(() => navigate('/'), 2000);
      })
      .catch(err => {
        setStatus('error');
        setError(err.response?.data?.error === 'INVALID_OR_EXPIRED'
          ? 'This verification link has expired or is invalid.'
          : 'Verification failed. Please try again.');
      });
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm text-center">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          {status === 'loading' && (
            <>
              <Spinner size="lg" className="mx-auto mb-4" />
              <p className="text-gray-600">Verifying your email...</p>
            </>
          )}
          {status === 'success' && (
            <>
              <div className="text-4xl mb-4">✅</div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Email verified!</h2>
              <p className="text-gray-500 text-sm">Redirecting you to brains...</p>
            </>
          )}
          {status === 'error' && (
            <>
              <div className="text-4xl mb-4">❌</div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Verification failed</h2>
              <p className="text-gray-500 text-sm mb-6">{error}</p>
              <Link to="/login" className="text-amber-600 hover:text-amber-700 text-sm">
                Back to sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
