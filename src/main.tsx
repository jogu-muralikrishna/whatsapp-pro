import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { auth, db } from './lib/firebaseClient';
import { onAuthStateChanged, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { ref, set } from 'firebase/database';
import { Shield, RefreshCw, X } from 'lucide-react';
import './index.css';

function AuthScreen({ onLogin }: { onLogin: (uid: string, email: string) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!email || !password) return;
    setLoading(true);
    setError(null);
    try {
      if (mode === 'register') {
       const username = cred.user.email!.split('@')[0];
        await set(ref(db, `users/${username}`), {
          email: cred.user.email,
          password: password,
        });
        onLogin(cred.user.uid, cred.user.email!);
      } else {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        onLogin(cred.user.uid, cred.user.email!);
      }
    } catch (e: any) {
      const msg = e.message || '';
      if (msg.includes('email-already-in-use')) setError('Email already registered. Please login.');
      else if (msg.includes('wrong-password') || msg.includes('invalid-credential')) setError('Wrong email or password.');
      else if (msg.includes('weak-password')) setError('Password must be at least 6 characters.');
      else if (msg.includes('invalid-email')) setError('Please enter a valid email address.');
      else setError(msg.replace('Firebase: ', ''));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#0a0a0c] rounded-2xl border border-white/5 shadow-2xl overflow-hidden">
        <div className="h-1 bg-[#00e676] w-full" />
        <div className="p-8">
          <div className="flex items-center justify-center mb-8 mt-2">
            <div className="p-4 bg-[#00e676] rounded-2xl rotate-3 hover:rotate-0 transition-transform">
              <Shield className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight italic text-center mb-1">WHATSAPP PRO</h1>
          <p className="text-[#00e676]/60 text-center mb-8 text-[10px] font-black uppercase tracking-[0.3em]">Encrypted Command Engine</p>
          <div className="flex gap-1 mb-6 bg-zinc-900 p-1 rounded-xl">
            <button onClick={() => { setMode('login'); setError(null); }} className={`flex-1 py-3 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${mode === 'login' ? 'bg-[#00e676] text-black' : 'text-slate-400 hover:text-white'}`}>Login</button>
            <button onClick={() => { setMode('register'); setError(null); }} className={`flex-1 py-3 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${mode === 'register' ? 'bg-[#00e676] text-black' : 'text-slate-400 hover:text-white'}`}>Register</button>
          </div>
          <div className="space-y-4">
            <input type="email" placeholder="your@email.com" className="w-full px-4 py-4 bg-[#121214] border border-white/5 rounded-xl text-white placeholder:text-white/20 outline-none focus:border-[#00e676] transition-all text-sm" value={email} onChange={e => setEmail(e.target.value)} disabled={loading} />
            <input type="password" placeholder="••••••••" className="w-full px-4 py-4 bg-[#121214] border border-white/5 rounded-xl text-white placeholder:text-white/20 outline-none focus:border-[#00e676] transition-all text-sm" value={password} onChange={e => setPassword(e.target.value)} onKeyPress={e => e.key === 'Enter' && handleSubmit()} disabled={loading} />
            {error && (
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3">
                <X className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <p className="text-red-500 text-[10px] font-bold leading-tight">{error}</p>
              </div>
            )}
            <button onClick={handleSubmit} disabled={loading || !email || !password} className="w-full bg-[#00e676] text-black font-black py-4 rounded-xl hover:opacity-90 disabled:opacity-20 transition-all text-xs uppercase tracking-widest flex items-center justify-center gap-3">
              {loading && <RefreshCw className="w-4 h-4 animate-spin text-black" />}
              {loading ? 'Processing...' : mode === 'login' ? 'Login to System 🔐' : 'Create Account 💎'}
            </button>
          </div>
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
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#00e676] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!uid || !email) {
    return <AuthScreen onLogin={(id, em) => { setUid(id); setEmail(em); }} />;
  }

  return <App userId={uid} userEmail={email} onLogout={() => { signOut(auth); setUid(null); setEmail(null); }} />;
}

createRoot(document.getElementById('root')!).render(<Root />);
