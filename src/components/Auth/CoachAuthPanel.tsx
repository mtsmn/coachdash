import React, { useState } from 'react';
import { AlertTriangle, Lock, LogOut, ShieldCheck, UserCheck } from 'lucide-react';
import {
  isSupabaseBrowserConfigured,
  signInCoachWithPassword,
  signOutCoach,
} from '../../integrations/supabaseClient';

export type CoachAuthStatus = 'signed_out' | 'signed_in' | 'expired' | 'unauthorized';

export interface VerifiedCoachIdentity {
  id: string;
  email: string;
  fullName: string;
  organizationName: string;
  role: 'owner_coach';
}

interface CoachAuthPanelProps {
  appMode: 'demo' | 'production';
  authStatus: CoachAuthStatus;
  verifiedCoach: VerifiedCoachIdentity | null;
  authErrorMessage: string | null;
  onAuthSessionEstablished: (accessToken: string) => Promise<boolean | void>;
  onSignedOut: () => void;
  onSwitchToDemoMode?: () => void;
  onClose?: () => void;
}

export const CoachAuthPanel: React.FC<CoachAuthPanelProps> = ({
  appMode,
  authStatus,
  verifiedCoach,
  authErrorMessage,
  onAuthSessionEstablished,
  onSignedOut,
  onSwitchToDemoMode,
  onClose,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const supabaseConfigured = isSupabaseBrowserConfigured();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setFormError(null);
    setSubmitting(true);

    try {
      const result = await signInCoachWithPassword(email, password);
      if (!result.ok) {
        setFormError(result.error);
        return;
      }

      setPassword('');
      await onAuthSessionEstablished(result.session.access_token);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    setSubmitting(true);
    await signOutCoach();
    onSignedOut();
    setSubmitting(false);
  };

  const badge =
    authStatus === 'signed_in'
      ? {
          label: 'Signed In · Server-Verified Owner Coach',
          cls: 'bg-emerald-50 text-emerald-800 border-emerald-200',
        }
      : authStatus === 'expired'
      ? {
          label: 'Session Expired · Re-authentication Required',
          cls: 'bg-amber-50 text-amber-800 border-amber-200',
        }
      : authStatus === 'unauthorized'
      ? {
          label: 'Unauthorized Account (HTTP 403)',
          cls: 'bg-rose-50 text-rose-800 border-rose-200',
        }
      : {
          label: 'Signed Out',
          cls: 'bg-slate-100 text-slate-700 border-slate-200',
        };

  return (
    <div className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-navy-900" />
            <h2 className="font-display text-base font-bold text-navy-900">
              Mythical Mile Coaching — Owner Sign-In
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Single-coach server authentication via Supabase Auth (Email + Password). Production endpoints require a verified owner-coach JWT.
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Close
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold ${badge.cls}`}>
          {authStatus === 'signed_in' ? (
            <ShieldCheck className="h-3.5 w-3.5" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5" />
          )}
          <span>{badge.label}</span>
        </span>
        <span className="font-mono text-[11px] text-slate-500">
          Mode: {appMode === 'production' ? 'Production (Fail-Closed)' : 'Demo Mode'}
        </span>
      </div>

      {!supabaseConfigured && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          Supabase client environment variables (<code className="font-mono">VITE_SUPABASE_URL</code> and{' '}
          <code className="font-mono">VITE_SUPABASE_ANON_KEY</code>) are not configured. Production sign-in is disabled until configured; Demo Mode remains available.
        </div>
      )}

      {(authErrorMessage || formError) && (
        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          {formError ?? authErrorMessage}
        </div>
      )}

      {authStatus === 'signed_in' && verifiedCoach ? (
        <div className="mt-4 space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs">
            <div className="flex items-center gap-2 font-semibold text-navy-900">
              <UserCheck className="h-4 w-4 text-emerald-700" />
              <span>{verifiedCoach.fullName}</span>
            </div>
            <p className="mt-1 font-mono text-slate-600">{verifiedCoach.email}</p>
            <p className="mt-1 text-slate-500">
              {verifiedCoach.organizationName} · Role: <code className="font-mono">{verifiedCoach.role}</code> (Server-Verified)
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleSignOut}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Sign Out</span>
            </button>

            {appMode === 'production' && onSwitchToDemoMode && (
              <button
                type="button"
                onClick={onSwitchToDemoMode}
                className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Switch to Demo Mode
              </button>
            )}
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label htmlFor="coach-auth-email" className="block text-xs font-semibold text-slate-700">
              Coach Email
            </label>
            <input
              id="coach-auth-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="coach@mythicalmile.com"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-navy-900 focus:border-navy-900 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="coach-auth-password" className="block text-xs font-semibold text-slate-700">
              Password
            </label>
            <input
              id="coach-auth-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-navy-900 focus:border-navy-900 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <button
              type="submit"
              disabled={!supabaseConfigured || submitting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-4 py-2 text-xs font-semibold text-white hover:bg-navy-800 disabled:opacity-50"
            >
              <Lock className="h-3.5 w-3.5" />
              <span>{submitting ? 'Signing In...' : 'Sign In as Owner Coach'}</span>
            </button>

            {appMode === 'production' && onSwitchToDemoMode && (
              <button
                type="button"
                onClick={onSwitchToDemoMode}
                className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Use Demo Mode Instead
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
};
