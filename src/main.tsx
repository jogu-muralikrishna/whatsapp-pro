import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import AuthScreen from './components/AuthScreen.tsx';
import { auth } from './lib/firebaseClient';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import './index.css';

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
    return (
      <AuthScreen
        onLogin={(id, em) => {
          setUid(id);
          setEmail(em);
        }}
      />
    );
  }

  return (
    <App
      userId={uid}
      userEmail={email}
      onLogout={() => {
        signOut(auth);
        setUid(null);
        setEmail(null);
      }}
    />
  );
}

createRoot(document.getElementById('root')!).render(<Root />);
