import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { auth, db } from './lib/firebaseClient';
import { onAuthStateChanged, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { ref, set } from 'firebase/database';
import './index.css';

function AuthScreen({ onLogin }: { onLogin: (uid: string, email: string) => void }) {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (mode === 'forgot') {
      if (!email.trim()) return;
      setLoading(true); setError(null); setSuccess(null);
      try {
        await sendPasswordResetEmail(auth, email.trim());
        setSuccess('Password reset email sent! Check your inbox.');
      } catch (e: any) {
        const msg = e.message || '';
        if (msg.includes('user-not-found') || msg.includes('invalid-credential')) setError('No account found with this email.');
        else if (msg.includes('invalid-email')) setError('Please enter a valid email address.');
        else setError(msg.replace('Firebase: ', ''));
      } finally { setLoading(false); }
      return;
    }
    if (!email.trim() || !password.trim()) return;
    setLoading(true); setError(null); setSuccess(null);
    try {
      if (mode === 'register') {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        const username = cred.user.email!.split('@')[0];
        await set(ref(db, `users/${username}`), { email: cred.user.email, createdAt: Date.now(), uid: cred.user.uid });
        onLogin(cred.user.uid, cred.user.email!);
      } else {
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        onLogin(cred.user.uid, cred.user.email!);
      }
    } catch (e: any) {
      const msg = e.message || '';
      if (msg.includes('email-already-in-use')) setError('Email already registered. Please login.');
      else if (msg.includes('wrong-password') || msg.includes('invalid-credential')) setError('Wrong email or password.');
      else if (msg.includes('weak-password')) setError('Password must be at least 6 characters.');
      else if (msg.includes('invalid-email')) setError('Please enter a valid email address.');
      else setError(msg.replace('Firebase: ', ''));
    } finally { setLoading(false); }
  };

  const inputStyle: React.CSSProperties = { width: '100%', padding: '14px 16px', background: '#121214', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '10px', color: '#fff', fontSize: '14px', outline: 'none', boxSizing: 'border-box' };
  const labelStyle: React.CSSProperties = { display: 'block', color: 'rgba(0,230,118,0.5)', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '2px', marginBottom: '6px' };

  return (
    <div style={{ minHeight: '100vh', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div style={{ width: '100%', maxWidth: '400px', background: '#0a0a0c', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)', overflow: 'hidden' }}>
        <div style={{ height: '4px', background: '#00e676' }} />
        <div style={{ padding: '32px' }}>
          <h1 style={{ color: '#fff', fontWeight: 900, fontSize: '24px', textAlign: 'center', marginBottom: '4px' }}>WHATSAPP PRO</h1>
          <p style={{ color: '#00e676', textAlign: 'center', fontSize: '10px', fontWeight: 700, letterSpacing: '3px', textTransform: 'uppercase', marginBottom: '24px' }}>Encrypted Command Engine</p>

          {/* Toggle — hide on forgot mode */}
          {mode !== 'forgot' && (
            <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', background: '#111', padding: '4px', borderRadius: '10px' }}>
              <button onClick={() => { setMode('login'); setError(null); setSuccess(null); }} style={{ flex: 1, padding: '10px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 900, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '2px', background: mode === 'login' ? '#00e676' : 'transparent', color: mode === 'login' ? '#000' : '#aaa' }}>Login</button>
              <button onClick={() => { setMode('register'); setError(null); setSuccess(null); }} style={{ flex: 1, padding: '10px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 900, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '2px', background: mode === 'register' ? '#00e676' : 'transparent', color: mode === 'register' ? '#000' : '#aaa' }}>Register</button>
            </div>
          )}

          {/* Forgot password header */}
          {mode === 'forgot' && (
            <div style={{ marginBottom: '20px', textAlign: 'center' }}>
              <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px', marginBottom: '4px' }}>Enter your registered email.</p>
              <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '11px' }}>We'll send a reset link.</p>
            </div>
          )}

          {/* Email */}
          <div style={{ marginBottom: '12px' }}>
            <label style={labelStyle}>Email Address</label>
            <input type="email" placeholder="your@email.com" value={email} onChange={e => setEmail(e.target.value)} disabled={loading} style={inputStyle} />
          </div>

          {/* Password — hide on forgot mode */}
          {mode !== 'forgot' && (
            <div style={{ marginBottom: '16px' }}>
              <label style={labelStyle}>Password {mode === 'register' && <span style={{ color: 'rgba(255,255,255,0.2)' }}>(min 6 chars)</span>}</label>
              <input type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSubmit()} disabled={loading} style={inputStyle} />
            </div>
          )}

          {/* Forgot password link — only on login mode */}
          {mode === 'login' && (
            <div style={{ textAlign: 'right', marginBottom: '16px', marginTop: '-8px' }}>
              <button onClick={() => { setMode('forgot'); setError(null); setSuccess(null); }} style={{ background: 'none', border: 'none', color: '#00e676', fontSize: '11px', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>
                Forgot Password?
              </button>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ padding: '12px 16px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '10px', color: '#f87171', fontSize: '11px', fontWeight: 700, marginBottom: '16px' }}>
              {error}
            </div>
          )}

          {/* Success */}
          {success && (
            <div style={{ padding: '12px 16px', background: 'rgba(0,230,118,0.1)', border: '1px solid rgba(0,230,118,0.2)', borderRadius: '10px', color: '#00e676', fontSize: '11px', fontWeight: 700, marginBottom: '16px' }}>
              {success}
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={loading || !email.trim() || (mode !== 'forgot' && !password.trim())}
            style={{ width: '100%', padding: '16px', background: '#00e676', border: 'none', borderRadius: '10px', color: '#000', fontWeight: 900, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '2px', cursor: 'pointer', opacity: loading || !email.trim() || (mode !== 'forgot' && !password.trim()) ? 0.3 : 1 }}
          >
            {loading ? 'Processing...' : mode === 'login' ? 'Login 🔐' : mode === 'register' ? 'Create Account 💎' : 'Send Reset Email 📧'}
          </button>

          {/* Back to login from forgot */}
          {mode === 'forgot' && (
            <button onClick={() => { setMode('login'); setError(null); setSuccess(null); }} style={{ width: '100%', marginTop: '12px', padding: '12px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: 'rgba(255,255,255,0.4)', fontWeight: 700, fontSize: '11px', cursor: 'pointer' }}>
              ← Back to Login
            </button>
          )}

          <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '2px', marginTop: '16px' }}>
            {mode === 'login' ? "No account? Switch to Register above." : mode === 'register' ? 'Already registered? Switch to Login above.' : ''}
          </p>
        </div>
      </div>
    </div>
  );
}

function Root() {
  const [uid, setUid] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setUid(user?.uid ?? null);
      setEmail(user?.email ?? null);
      setChecking(false);
    });
    return () => unsub();
  }, []);

  if (checking) {
    return (
      <div style={{ minHeight: '100vh', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: '32px', height: '32px', border: '2px solid #00e676', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  if (!uid || !email) {
    return <AuthScreen onLogin={(id, em) => { setUid(id); setEmail(em); }} />;
  }

  return (
    <App
      userId={uid}
      userEmail={email}
      onLogout={() => { signOut(auth); setUid(null); setEmail(null); }}
    />
  );
}

createRoot(document.getElementById('root')!).render(<Root />);

// ── PWA Install Banner ──
(function () {
  let deferredPrompt: any = null;

  window.addEventListener('beforeinstallprompt', (e: any) => {
    e.preventDefault();
    deferredPrompt = e;

    // Show banner if not already installed
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    const banner = document.createElement('div');
    banner.id = 'pwa-install-banner';
    banner.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;flex:1">
        <img src="/icon-72x72.png" style="width:40px;height:40px;border-radius:10px" />
        <div>
          <div style="color:#fff;font-weight:900;font-size:13px">Install WhatsApp Pro</div>
          <div style="color:rgba(255,255,255,0.4);font-size:11px">Add to home screen for app experience</div>
        </div>
      </div>
      <button id="pwa-install-btn" style="background:#00e676;color:#000;border:none;padding:10px 18px;border-radius:10px;font-weight:900;font-size:11px;text-transform:uppercase;cursor:pointer;white-space:nowrap">Install</button>
      <button id="pwa-dismiss-btn" style="background:transparent;color:rgba(255,255,255,0.3);border:none;padding:8px;cursor:pointer;font-size:18px">✕</button>
    `;
    document.body.appendChild(banner);

    document.getElementById('pwa-install-btn')?.addEventListener('click', () => {
      deferredPrompt?.prompt();
      deferredPrompt?.userChoice.then(() => { banner.remove(); deferredPrompt = null; });
    });

    document.getElementById('pwa-dismiss-btn')?.addEventListener('click', () => banner.remove());
  });
})();
