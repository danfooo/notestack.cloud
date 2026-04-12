import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import { authApi } from '../api/auth';
import { useAuthStore } from '../stores/authStore';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

export function SignupPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('invite') || '';
  const login = useAuthStore(s => s.login);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await authApi.signup({ email, password, display_name: name, invite_token: inviteToken });
      setSuccess(true);
    } catch (err: any) {
      const code = err.response?.data?.error;
      if (code === 'INVITE_REQUIRED') setError('A valid invite token is required.');
      else if (code === 'EMAIL_EXISTS_UNVERIFIED') setError('This email is already registered but unverified. Check your inbox.');
      else setError(err.response?.data?.error || 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async (credential: string) => {
    try {
      const res = await authApi.google({ credential, invite_token: inviteToken });
      login(res.data.user, res.data.token);
      navigate('/');
    } catch (err: any) {
      const code = err.response?.data?.error;
      if (code === 'INVITE_REQUIRED') setError('A valid invite token is required for new accounts.');
      else setError('Google sign-in failed');
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm text-center">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
            <div className="text-4xl mb-4">📬</div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Check your email</h2>
            <p className="text-gray-500 text-sm">We sent a verification link to <strong>{email}</strong>. Click the link to activate your account.</p>
            <Link to="/login" className="block mt-6 text-amber-600 hover:text-amber-700 text-sm">
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">brains</h1>
          <p className="text-gray-500 text-sm">Create your account</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Sign up</h2>

          {!inviteToken && (
            <div className="mb-4 p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">
              You need an invite link to sign up.
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Name"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Your name"
              required
              autoFocus
            />
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              required
              minLength={8}
            />
            {inviteToken && (
              <div className="text-xs text-gray-500 bg-gray-50 px-3 py-2 rounded">
                Invite code: <code className="font-mono">{inviteToken.slice(0, 8)}…</code>
              </div>
            )}
            <Button type="submit" className="w-full" loading={loading} disabled={!inviteToken}>
              Create account
            </Button>
          </form>

          {inviteToken && (
            <>
              <div className="mt-6 relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-white text-gray-400">or</span>
                </div>
              </div>

              <div className="mt-4 flex justify-center">
                <GoogleLogin
                  onSuccess={c => c.credential && handleGoogle(c.credential)}
                  onError={() => setError('Google sign-in failed')}
                  text="signup_with"
                  shape="rectangular"
                  theme="outline"
                />
              </div>
            </>
          )}

          <p className="mt-6 text-center text-sm text-gray-500">
            Already have an account?{' '}
            <Link to="/login" className="text-amber-600 hover:text-amber-700 font-medium">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
