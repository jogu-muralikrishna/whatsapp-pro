import React, { useState } from 'react';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { ref, set } from 'firebase/database';
import { auth, db } from '../lib/firebaseClient';
import { Shield, RefreshCw, X } from 'lucide-react';

interface Props {
  onLogin: (uid: string, email: string) => void;
}

export default function AuthScreen({ onLogin }: Props) {
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
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await set(ref(db, `users/${cred.user.uid}`), {
          email: cred.user.email,
          createdAt: Date.now(),
          uid: cred.user.uid,
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
        <div className="h-1 bg-[#00e676] w-full shadow-[0_0_15px_#00e676]" />
        <div className="p-8">
          <div className="flex items-center justify-center mb-8 mt-2">
            <div className="p-4 bg-[#00e676] rounded-2xl shadow-xl shadow-[#00e676]/20 rotate-3 hover:rotate-0 transition-transform">
              <Shield className="w-8 h-8 text-white" />
            </div>
          </div>

          <h1 className="text-3xl font-black text-white tracking-tight italic text-center mb-1">
            WHATSAPP PRO
          </h1>
          <p className="text-[#00e676]/60 text-center mb-8 text-[10px] font-black uppercase tracking-[0.3em]">
            Encrypted Command Engine
          </p>

          <div className="flex gap-1 mb-6 bg-zinc-900 p-1 rounded-xl">
            <button
              onClick={() => { setMode('login'); setError(null); }}
              className={`flex-1 py-3 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                mode === 'login' ? 'bg-[#00e676] text-black' : 'text-slate-400 hover:text-white'
              }`}
            >
              Login
            </button>
            <button
              onClick={() => { setMode('register'); setError(null); }}
              className={`flex-1 py-3 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                mode === 'register' ? 'bg-[#00e676] text-black' : 'text-slate-400 hover:text-white'
              }`}
            >
              Register
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold text-[#00e676]/50 uppercase tracking-widest mb-2 ml-1">
                Email Address
              </label>
              <input
                type="email"
                placeholder="your@email.com"
                className="w-full px-4 py-4 bg-[#121214] border border-white/5 rounded-xl text-white placeholder:text-white/20 outline-none focus:border-[#00e676] transition-all font-mono text-sm"
                value={email}
                onChange={e => setEmail(e.target.value)}
                disabled={loading}
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-[#00e676]/50 uppercase tracking-widest mb-2 ml-1">
                Password {mode === 'register' && <span className="text-white/20">(min 6 chars)</span>}
              </label>
              <input
                type="password"
                placeholder="••••••••"
                className="w-full px-4 py-4 bg-[#121214] border border-white/5 rounded-xl text-white placeholder:text-white/20 outline-none focus:border-[#00e676] transition-all font-mono text-sm"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyPress={e => e.key === 'Enter' && handleSubmit()}
                disabled={loading}
              />
            </div>

            {error && (
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3">
                <X className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <p className="text-red-500 text-[10px] font-bold leading-tight">{error}</p>
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={loading || !email || !password}
              className="w-full bg-[#00e676] text-black font-black py-4 rounded-xl hover:opacity-90 disabled:opacity-20 transition-all shadow-xl shadow-[#00e676]/10 text-xs uppercase tracking-widest flex items-center justify-center gap-3 mt-2"
            >
              {loading && <RefreshCw className="w-4 h-4 animate-spin text-black" />}
              {loading ? 'Processing...' : mode === 'login' ? 'Login to System 🔐' : 'Create Account 💎'}
            </button>

            <p className="text-center text-[9px] text-white/20 font-bold uppercase tracking-widest pt-2">
              {mode === 'login'
                ? "Don't have an account? Switch to Register above."
                : 'Already registered? Switch to Login above.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
