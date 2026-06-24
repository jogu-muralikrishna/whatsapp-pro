import React, { useState, useEffect, useRef } from "react";
import { Phone, Send, Settings, Trash2, ShieldAlert } from "lucide-react";
import { SecretAdminPanel } from "./components/SecretAdminPanel";

// Session Management
const getSessionId = () => {
  let sid = localStorage.getItem('wp_session_id');
  if (!sid) {
    sid = crypto.randomUUID();
    localStorage.setItem('wp_session_id', sid);
  }
  return sid;
};

const SESSION_ID = getSessionId();

async function apiFetch(url: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('x-session-id', SESSION_ID);
  return fetch(url, { ...options, headers });
}

function App() {
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [isAdminOpen, setIsAdminOpen] = useState(false);

  const connectUser = async () => {
    if (!selectedUserId) return alert("Enter Phone Number");
    await apiFetch('/api/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: selectedUserId })
    });
  };

  return (
    <div className="min-h-screen bg-[#0b141a] text-white">
      {/* User Selector */}
      <div className="p-4 border-b border-white/10 flex gap-3">
        <input
          type="text"
          placeholder="+1234567890"
          value={selectedUserId}
          onChange={(e) => setSelectedUserId(e.target.value)}
          className="bg-[#202c33] px-4 py-2 rounded-lg flex-1"
        />
        <button onClick={connectUser} className="bg-[#00a884] px-6 py-2 rounded-lg font-bold">
          Connect
        </button>
        <button onClick={() => setIsAdminOpen(true)} className="bg-rose-600 px-4 py-2 rounded-lg">
          Admin
        </button>
      </div>

      {/* Main UI */}
      <div className="p-6">
        <h1 className="text-2xl font-black">WhatsApp Pro - Multi User</h1>
        <p className="text-sm text-white/60">Current Session: {selectedUserId || 'None'}</p>
      </div>

      {isAdminOpen && (
        <SecretAdminPanel 
          onClose={() => setIsAdminOpen(false)} 
          currentPhoneNumber={selectedUserId} 
        />
      )}
    </div>
  );
}

export default App;
