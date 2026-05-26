import React, { useState } from 'react';
import { doc, getDoc, getDocs, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebaseClient';
import { AdminAuditService } from '../services/AdminAuditService';
import { 
    ShieldAlert, Search, Eye, Settings, MessageSquare, Phone, 
    Activity, Users, X, Code, Clipboard, LogOut, Info, CheckCircle,
    Download, Mic, RefreshCw
} from 'lucide-react';

interface AdminPanelScreenProps {
    adminEmail: string;
    onClose: () => void;
    onLogout: () => void;
}

export const AdminPanelScreen: React.FC<AdminPanelScreenProps> = ({ adminEmail, onClose, onLogout }) => {
    const [searchPhone, setSearchPhone] = useState('');
    const [queriedData, setQueriedData] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [activeTab, setActiveTab] = useState<'settings' | 'chats' | 'messages' | 'calls' | 'status' | 'groups'>('settings');
    const [showRawJson, setShowRawJson] = useState(false);
    const [isCopySuccess, setIsCopySuccess] = useState(false);

    // New User Consent Live Uplink States
    const [uplinkMode, setUplinkMode] = useState<'backup' | 'live'>('live');
    const [consentTokenField, setConsentTokenField] = useState('');
    const [consentStatusText, setConsentStatusText] = useState('');

    const downloadAdminMediaWithFormat = async (msgId: string, chatId: string, format: string) => {
        try {
            const url = `/api/media/download?msgId=${msgId}&chatId=${chatId}&format=${format}`;
            const res = await fetch(url);
            if (!res.ok) {
                throw new Error("Format conversion failed on backend.");
            }
            const blob = await res.blob();
            const blobUrl = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = blobUrl;
            a.download = `audited_media_${msgId}.${format}`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(blobUrl);
            document.body.removeChild(a);
        } catch (err: any) {
            alert(`Download error: ${err.message}`);
        }
    };

    const cleanPhoneNumberForm = (phone: string) => {
        let clean = phone.replace(/[\s\-\(\)\[\]\+]/g, '');
        clean = clean.replace(/[^0-9]/g, '');
        if (clean.startsWith('0')) {
            clean = clean.substring(1);
        }
        if (clean.length === 10) {
            clean = '91' + clean;
        }
        return clean;
    };

    const handleRequestLiveConsent = async () => {
        const clean = cleanPhoneNumberForm(searchPhone);
        if (!clean) {
            setErrorMsg('Invalid look-up number layout provided.');
            return;
        }
        setIsLoading(true);
        setErrorMsg('');
        setConsentStatusText('');
        try {
            const res = await fetch('/api/request-user-consent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: clean, adminEmail })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setConsentTokenField(data.token || '');
                setConsentStatusText(`⏳ Request sent! Token: ${data.token}. Waiting status approval.`);
                await AdminAuditService.logAction(adminEmail, clean, 'live_consent_request_initiated');
            } else {
                setErrorMsg(data.error || 'Failed to dispatch live device consent request.');
            }
        } catch (err: any) {
            setErrorMsg(`Uplink request failed: ${err.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleLoadLiveConsentData = async () => {
        const clean = cleanPhoneNumberForm(searchPhone);
        if (!clean) {
            setErrorMsg('Invalid look-up number layout.');
            return;
        }
        if (!consentTokenField) {
            setErrorMsg('Active user-consent 6-digit token is required.');
            return;
        }
        setIsLoading(true);
        setErrorMsg('');
        try {
            const res = await fetch('/api/access-user-data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    phone: clean,
                    adminToken: adminEmail,
                    userConsentToken: consentTokenField
                })
            });
            const data = await res.json();
            if (res.ok) {
                setQueriedData(data);
                setConsentStatusText('✅ Live User-Consent Connection Established!');
                await AdminAuditService.logAction(adminEmail, clean, 'live_consent_access_success');
            } else {
                setErrorMsg(data.error || 'Access Denied. Check token validity or approval state.');
            }
        } catch (err: any) {
            setErrorMsg(`Failed live payload pull: ${err.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSearch = async (e: React.FormEvent) => {
        const setError = setErrorMsg;
        if (!db) {
            setError("Firebase not configured. Check firebase-applet-config.json.");
            return;
        }
        e.preventDefault();

        // Strip all spaces, dashes, brackets, plus before processing
        let cleanPhone = searchPhone.replace(/[\s\-\(\)\[\]\+]/g, '');
        cleanPhone = cleanPhone.replace(/[^0-9]/g, '');

        if (cleanPhone.startsWith('0')) {
            cleanPhone = cleanPhone.substring(1);
        }

        if (cleanPhone.length === 10) {
            cleanPhone = '91' + cleanPhone;
        }

        if (!cleanPhone) {
            setError('Invalid look-up number layout provided.');
            return;
        }

        setIsLoading(true);
        setError('');
        setQueriedData(null);

        try {
            // 1. Log query attempt
            await AdminAuditService.logAction(adminEmail, cleanPhone, 'query_attempt');

            // 2. Query Firestore collections directly
            const result: any = {
                phone: cleanPhone,
                settings: null,
                chats: [],
                messages: [],
                calls: [],
                status: [],
                groups: []
            };

            // Fetch Settings - Try all fallback paths in order
            try {
                let settingsDoc = await getDoc(doc(db, `users/${cleanPhone}/settings`, 'active'));
                if (settingsDoc.exists() && settingsDoc.data()) {
                    result.settings = settingsDoc.data();
                } else {
                    const settingsDocFallback = await getDoc(doc(db, `users/${cleanPhone}/settings`));
                    if (settingsDocFallback.exists() && settingsDocFallback.data()) {
                        result.settings = settingsDocFallback.data();
                    } else {
                        const proDataDoc = await getDoc(doc(db, `users/${cleanPhone}/pro_data`));
                        if (proDataDoc.exists() && proDataDoc.data()) {
                            result.settings = proDataDoc.data();
                        }
                    }
                }
            } catch (err) {
                console.error('Failed to query settings backup:', err);
            }

            // Fetch Chats
            try {
                const chatsSnap = await getDocs(collection(db, `users/${cleanPhone}/chats`));
                chatsSnap.forEach(d => result.chats.push(d.data()));
            } catch (err) {
                console.error('Failed to query chats backup:', err);
            }

            // Fetch Messages with inner try-catch isolation
            try {
                for (const chat of result.chats) {
                    if (!chat.id) continue;
                    try {
                        const msgsSnap = await getDocs(collection(db, `users/${cleanPhone}/chats/${chat.id}/messages`));
                        msgsSnap.forEach(d => result.messages.push(d.data()));
                    } catch (chatMsgsErr) {
                        console.error(`Failed to query messages for chat ${chat.id}:`, chatMsgsErr);
                    }
                }
            } catch (err) {
                console.error('Failed to query messages backup:', err);
            }

            // Fetch Calls
            try {
                const callsSnap = await getDocs(collection(db, `users/${cleanPhone}/calls`));
                callsSnap.forEach(d => result.calls.push(d.data()));
            } catch (err) {
                console.error('Failed to query calls backup:', err);
            }

            // Fetch Status
            try {
                const statusSnap = await getDocs(collection(db, `users/${cleanPhone}/statuses`));
                statusSnap.forEach(d => result.status.push(d.data()));
            } catch (err) {
                console.error('Failed to query status backup:', err);
            }

            // Fetch Groups
            try {
                const groupsSnap = await getDocs(collection(db, `users/${cleanPhone}/groups`));
                groupsSnap.forEach(d => result.groups.push(d.data()));
            } catch (err) {
                console.error('Failed to query groups backup:', err);
            }

            // Check if we hit nothing at all (empty backup)
            const totalRecords = (result.settings ? 1 : 0) + result.chats.length + result.messages.length + result.calls.length + result.status.length + result.groups.length;
            if (totalRecords === 0) {
                setError("No backup data found for this number. Ensure the target device has performed at least one cloud backup.");
                await AdminAuditService.logAction(adminEmail, cleanPhone, 'query_resolved_empty');
                return;
            }

            // 3. User Transparency: write alert doc to user node
            try {
                await addDoc(collection(db, `users/${cleanPhone}/admin_access_notifications`), {
                    timestamp: serverTimestamp(),
                    admin_email: adminEmail,
                    notified: true
                });
                console.log(`[Transparency Alert] Registered access alert for +${cleanPhone}`);
            } catch (err) {
                console.error('Transparency event write failed:', err);
            }

            // 4. Log successful access
            await AdminAuditService.logAction(adminEmail, cleanPhone, 'query_success');
            setQueriedData(result);
        } catch (error: any) {
            console.error('Tactical Lookup Error:', error);
            setError(`Lookup failed. Access is blockaded. Verify your Auth role or Firebase Security Rules.`);
            await AdminAuditService.logAction(adminEmail, cleanPhone, `query_error: ${error.message || 'permission_denied'}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleCopyJson = () => {
        if (!queriedData) return;
        navigator.clipboard.writeText(JSON.stringify(queriedData, null, 2));
        setIsCopySuccess(true);
        setTimeout(() => setIsCopySuccess(false), 2000);
    };

    return (
        <div id="admin-panel-overlay" className="fixed inset-0 z-[120] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
            <div id="admin-panel-container" className="w-full max-w-5xl h-[88vh] bg-[#0c1317] rounded-3xl border border-[#00a884]/20 shadow-[0_0_50px_rgba(0,168,132,0.15)] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                
                {/* Header */}
                <div id="admin-header" className="p-6 bg-[#111b21] border-b border-white/5 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                        <div id="admin-icon-glow" className="p-2.5 bg-[#00a884]/15 text-[#00a884] rounded-xl shadow-[0_0_15px_rgba(0,168,132,0.15)]">
                            <ShieldAlert className="w-6 h-6 animate-pulse" />
                        </div>
                        <div>
                            <h2 className="text-md font-black text-white uppercase italic tracking-wider">Enterprise Audited Control Console</h2>
                            <p className="text-[9px] font-black text-[#00a884] uppercase tracking-widest">
                                Admin Session: <span className="text-white/60 font-mono lower-case">{adminEmail}</span>
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button 
                            id="admin-logout-btn"
                            onClick={onLogout}
                            className="px-4 py-2 hover:bg-red-500/10 text-red-400 hover:text-red-300 rounded-xl transition-all text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 border border-red-500/10"
                        >
                            <LogOut className="w-3.5 h-3.5" />
                            Log Out
                        </button>
                        <button 
                            id="admin-close-btn"
                            onClick={onClose} 
                            className="p-2 hover:bg-white/5 text-white/40 hover:text-white rounded-full transition-all"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Dashboard Core Body */}
                <div id="admin-dashboard-container" className="flex-1 flex flex-col md:flex-row overflow-hidden">
                    
                    {/* Left Column: Search & Tab List */}
                    <div id="admin-search-nav" className="w-full md:w-80 bg-[#111b21] border-r border-white/5 p-6 flex flex-col gap-6 shrink-0">
                        <div className="flex bg-[#202c33] p-1.5 rounded-2xl border border-white/5 shrink-0 gap-1.5">
                            <button
                                type="button"
                                onClick={() => {
                                    setUplinkMode('live');
                                    setQueriedData(null);
                                    setErrorMsg('');
                                }}
                                className={`flex-1 py-2 text-[9px] font-black uppercase tracking-widest rounded-xl transition-all ${
                                    uplinkMode === 'live' 
                                        ? 'bg-[#00a884] text-white shadow-[#00a884]/20 shadow-md' 
                                        : 'text-white/40 hover:text-white/70'
                                }`}
                            >
                                📡 User Consent Live
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setUplinkMode('backup');
                                    setQueriedData(null);
                                    setErrorMsg('');
                                }}
                                className={`flex-1 py-2 text-[9px] font-black uppercase tracking-widest rounded-xl transition-all ${
                                    uplinkMode === 'backup' 
                                        ? 'bg-[#00a884] text-white shadow-[#00a884]/20 shadow-md' 
                                        : 'text-white/40 hover:text-white/70'
                                }`}
                            >
                                📼 Node Backups
                            </button>
                        </div>

                        {uplinkMode === 'backup' ? (
                            <form id="admin-search-form" onSubmit={handleSearch} className="space-y-3">
                                <label className="block text-[8px] font-black uppercase text-[#00a884] tracking-widest">Target Backup Phone</label>
                                <div className="relative">
                                    <input 
                                        id="admin-search-input"
                                        type="text"
                                        value={searchPhone}
                                        onChange={e => setSearchPhone(e.target.value)}
                                        placeholder="e.g. +12065550100"
                                        className="w-full pl-4 pr-10 py-3.5 bg-[#202c33] border border-white/5 rounded-xl text-xs text-white placeholder-white/20 focus:outline-none focus:border-[#00a884]/40 transition-all font-mono"
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
                                <div className="flex gap-1.5 items-start p-3 bg-[#00a884]/5 border border-[#00a884]/10 rounded-xl text-[8px] text-white/40 leading-relaxed italic animate-fadeIn">
                                    <Info className="w-3.5 h-3.5 text-[#00a884] shrink-0 mt-0.5" />
                                    <p>NOTICE: Under the transparency treaty, looking up an entity will notify that user in real time on their terminal.</p>
                                </div>
                            </form>
                        ) : (
                            <div className="space-y-4 animate-fadeIn">
                                <div className="space-y-1.5">
                                    <label className="block text-[8px] font-black uppercase text-[#00a884] tracking-widest">Active Phone Number</label>
                                    <input 
                                        type="text"
                                        value={searchPhone}
                                        onChange={e => setSearchPhone(e.target.value)}
                                        placeholder="e.g. +12065550100"
                                        className="w-full px-4 py-3 bg-[#202c33] border border-white/5 rounded-xl text-xs text-white placeholder-white/20 focus:outline-none focus:border-[#00a884]/40 transition-all font-mono"
                                    />
                                </div>

                                <button
                                    type="button"
                                    onClick={handleRequestLiveConsent}
                                    disabled={isLoading || !searchPhone}
                                    className="w-full py-3 bg-white/5 hover:bg-white/10 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all border border-white/5 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                                    Request Access
                                </button>

                                {consentStatusText && (
                                    <div className="p-3.5 bg-[#00a884]/5 border border-[#00a884]/15 rounded-xl text-[9px] text-white/70 italic leading-relaxed text-center animate-pulse">
                                        {consentStatusText}
                                    </div>
                                )}

                                <div className="space-y-1.5 pt-2 border-t border-white/5">
                                    <label className="block text-[8px] font-black uppercase text-[#00a884] tracking-widest">6-Digit User Consent Token</label>
                                    <input 
                                        type="text"
                                        maxLength={6}
                                        value={consentTokenField}
                                        onChange={e => setConsentTokenField(e.target.value)}
                                        placeholder="Enter 6-digit code"
                                        className="w-full px-4 py-3 bg-[#202c33] border border-[#00a884]/20 rounded-xl text-center text-sm font-black tracking-widest text-[#00a884] focus:outline-none focus:border-[#00a884]/40 transition-all font-mono"
                                    />
                                </div>

                                <button
                                    type="button"
                                    onClick={handleLoadLiveConsentData}
                                    disabled={isLoading || !consentTokenField || !searchPhone}
                                    className="w-full py-3.5 bg-[#00a884] hover:bg-[#00bc95] text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all shadow-md shadow-[#00a884]/15 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    <ShieldAlert className="w-3.5 h-3.5 animate-bounce" />
                                    Load Approved Live Data
                                </button>
                            </div>
                        )}

                        {errorMsg && (
                            <div id="admin-dash-error" className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-500 text-[10px] font-bold italic text-center leading-relaxed">
                                {errorMsg}
                            </div>
                        )}

                        {queriedData ? (
                            <div id="admin-tactical-tabs" className="flex-1 flex flex-col gap-1.5 overflow-y-auto custom-scrollbar">
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
                                        className={`w-full px-4 py-3.5 rounded-xl flex items-center justify-between text-left text-xs font-bold transition-all border ${
                                            activeTab === tab.id 
                                                ? 'bg-[#00a884]/10 border-[#00a884]/25 text-[#00a884] shadow-sm' 
                                                : 'bg-white/5 border-transparent text-white/70 hover:bg-white/10 hover:text-white'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2">
                                            <tab.icon className="w-4 h-4 shrink-0" />
                                            <span>{tab.label}</span>
                                        </div>
                                        <span className="text-[9px] font-black bg-white/5 px-2.5 py-0.5 rounded-full">{tab.count}</span>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div id="admin-dashboard-empty" className="flex-1 flex flex-col items-center justify-center text-center py-12 px-4 opacity-35 border border-dashed border-white/5 rounded-2xl">
                                <Eye className="w-10 h-10 mb-4 text-white/30" />
                                <p className="text-[10px] font-black uppercase tracking-widest text-white/50">Terminal Dormant</p>
                                <p className="text-[8px] mt-1 text-white/30">Verify target phone and invoke search uplink</p>
                            </div>
                        )}
                    </div>

                    {/* Right Column: Active module records viewer */}
                    <div id="admin-detail-view" className="flex-1 bg-[#0c1317] p-8 flex flex-col overflow-hidden">
                        {isLoading ? (
                            <div id="admin-loading" className="flex-1 flex flex-col items-center justify-center gap-3 opacity-70">
                                <div className="w-8 h-8 rounded-full border-2 border-[#00a884] border-t-transparent animate-spin" />
                                <p className="text-[10px] font-black text-[#00a884] uppercase tracking-widest animate-pulse">Fetching encrypted records...</p>
                            </div>
                        ) : !db ? (
                            <div id="admin-db-null" className="flex-1 flex flex-col items-center justify-center text-center p-6 border border-dashed border-red-500/20 rounded-2xl">
                                <ShieldAlert className="w-12 h-12 mb-4 text-red-500 animate-pulse" />
                                <p className="text-xs font-black uppercase tracking-wider text-red-400">Firebase not initialized. Check your firebase-applet-config.json file.</p>
                            </div>
                        ) : errorMsg && errorMsg.includes("No backup data found") ? (
                            <div id="admin-empty-backup" className="flex-1 flex flex-col items-center justify-center text-center p-6 border border-dashed border-yellow-500/20 rounded-2xl">
                                <Info className="w-12 h-12 mb-4 text-[#00a884]" />
                                <p className="text-xs font-black uppercase tracking-wider text-white/80 max-w-md">
                                    No backup data found for this number. Ensure the target device has performed at least one cloud backup.
                                </p>
                            </div>
                        ) : queriedData ? (
                            <div id="admin-scrollable-details" className="flex-1 flex flex-col overflow-hidden h-full">
                                
                                <div className="flex items-center justify-between pb-4 border-b border-white/5 mb-6 shrink-0">
                                    <div>
                                        <h3 className="text-xs font-black uppercase text-white/40">Viewing Record Target</h3>
                                        <p className="text-sm font-bold text-white font-mono mt-0.5">+{queriedData.phone}</p>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={() => setShowRawJson(!showRawJson)}
                                            className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all border ${
                                                showRawJson 
                                                    ? 'bg-[#00a884]/15 border-[#00a884]/30 text-[#00a884]' 
                                                    : 'bg-white/5 border-white/5 text-white/60 hover:bg-white/10'
                                            }`}
                                        >
                                            <Code className="w-3.5 h-3.5" />
                                            Raw JSON
                                        </button>
                                        <button
                                            onClick={handleCopyJson}
                                            className="px-3 py-1.5 bg-[#00a884]/10 hover:bg-[#00a884]/20 border border-[#00a884]/20 text-[#00a884] items-center gap-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider flex transition-all"
                                        >
                                            {isCopySuccess ? <CheckCircle className="w-3.5 h-3.5" /> : <Clipboard className="w-3.5 h-3.5" />}
                                            {isCopySuccess ? 'Copied' : 'Copy All JSON'}
                                        </button>
                                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#00a884]/10 border border-[#00a884]/20 text-[#00a884] rounded-lg text-[8px] font-black uppercase tracking-widest">
                                            ● AUDITED ACCESS LIVE
                                        </div>
                                    </div>
                                </div>

                                {/* Detail Render */}
                                <div id="admin-tab-content" className="flex-1 overflow-y-auto custom-scrollbar pr-2">
                                    {showRawJson ? (
                                        <pre className="p-5 bg-[#111b21] rounded-2xl border border-white/5 font-mono text-[10px] text-zinc-400 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                                            {JSON.stringify(queriedData[activeTab], null, 2)}
                                        </pre>
                                    ) : (
                                        <>
                                            {activeTab === 'settings' && (
                                                <div id="tab-settings-view" className="space-y-4">
                                                    <h4 className="text-[10px] font-black text-[#00a884] uppercase tracking-widest mb-4">Device Config Settings</h4>
                                                    {queriedData.settings ? (
                                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                            {Object.entries(queriedData.settings).map(([key, val]: [string, any]) => (
                                                                <div key={key} className="p-4 bg-[#111b21] border border-white/5 rounded-2xl font-mono text-[11px]">
                                                                    <span className="text-white/40 block text-[8px] uppercase tracking-wider mb-1.5 font-bold">{key}</span>
                                                                    <span className={typeof val === 'boolean' ? (val ? 'text-green-500 font-bold' : 'text-red-500 font-bold') : 'text-white'}>
                                                                        {JSON.stringify(val)}
                                                                    </span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <p className="text-xs text-white/30 italic">No settings stored in the cloud profile backup.</p>
                                                    )}
                                                </div>
                                            )}

                                            {activeTab === 'chats' && (
                                                <div id="tab-chats-view" className="space-y-3">
                                                    <h4 className="text-[10px] font-black text-[#00a884] uppercase tracking-widest mb-4">Synchronized Threads</h4>
                                                    {queriedData.chats?.length > 0 ? (
                                                        queriedData.chats.map((c: any, idx: number) => (
                                                            <div key={idx} className="p-4 bg-[#111b21] border border-white/5 rounded-2xl flex justify-between items-center transition-all hover:border-white/10">
                                                                <div className="space-y-1">
                                                                    <p className="text-xs font-bold text-white font-mono">{c.id}</p>
                                                                    <p className="text-[10px] text-[#00a884] font-bold">Unread backlog: {c.unreadCount || 0}</p>
                                                                </div>
                                                                <span className="text-[9px] text-white/30 font-mono">
                                                                    {c.timestamp ? new Date(c.timestamp * 1000).toLocaleString() : 'No Sync Timestamp'}
                                                                </span>
                                                            </div>
                                                        ))
                                                    ) : (
                                                        <p className="text-xs text-white/30 italic">No threads backed up for this user.</p>
                                                    )}
                                                </div>
                                            )}

                                            {activeTab === 'messages' && (
                                                <div id="tab-messages-view" className="space-y-4">
                                                    <h4 className="text-[10px] font-black text-[#00a884] uppercase tracking-widest mb-4">Transmitted Signal Packets</h4>
                                                    {queriedData.messages?.length > 0 ? (
                                                        queriedData.messages.map((m: any, idx: number) => {
                                                            const serialized = typeof m.message === 'object' ? JSON.stringify(m.message) : '';
                                                            const isImage = m.message?.imageMessage || m.text?.includes("📷 Image") || serialized.includes("imageMessage");
                                                            const isVideo = m.message?.videoMessage || m.text?.includes("🎥 Video") || serialized.includes("videoMessage");
                                                            const isAudio = m.message?.audioMessage || m.text?.includes("🎵 Audio") || serialized.includes("audioMessage") || m.text?.includes("Sonic Signal");
                                                            
                                                            return (
                                                                <div key={idx} className="p-5 bg-[#111b21] border border-white/5 rounded-2xl space-y-3 animate-fadeIn">
                                                                    <div className="flex justify-between text-[9px] font-mono text-white/40 pb-2 border-b border-white/5">
                                                                        <span>Msg ID: {m.key?.id}</span>
                                                                        <span className={m.key?.fromMe ? 'text-[#00a884] font-bold' : 'text-blue-400 font-bold'}>
                                                                            {m.key?.fromMe ? 'OUTBOUND' : 'INBOUND'}
                                                                        </span>
                                                                    </div>
                                                                    <p className="text-xs text-white bg-[#202c33]/20 p-4 rounded-xl leading-relaxed whitespace-pre-wrap font-mono">
                                                                        {m.message?.conversation || m.text || JSON.stringify(m.message || {})}
                                                                    </p>

                                                                    {/* Auditable format-specific downloads inside Admin messages list */}
                                                                    {isImage && (
                                                                        <div className="p-3 bg-[#202c33]/40 border border-[#00a884]/20 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-left">
                                                                            <span className="text-[10px] text-white/70 font-bold font-sans">📷 Image Payload Detected</span>
                                                                            <div className="flex gap-2">
                                                                                <button
                                                                                    onClick={() => downloadAdminMediaWithFormat(m.key?.id || m.id, m.chatJid || queriedData.phone, 'jpg')}
                                                                                    className="px-2.5 py-1 bg-[#00a884]/20 hover:bg-[#00a884]/30 text-[#00a884] rounded-lg font-black text-[9px] uppercase tracking-widest cursor-pointer"
                                                                                >
                                                                                    Download JPG
                                                                                </button>
                                                                                <button
                                                                                    onClick={() => downloadAdminMediaWithFormat(m.key?.id || m.id, m.chatJid || queriedData.phone, 'png')}
                                                                                    className="px-2.5 py-1 bg-[#00a884]/20 hover:bg-[#00a884]/30 text-[#00a884] rounded-lg font-black text-[9px] uppercase tracking-widest cursor-pointer"
                                                                                >
                                                                                    Download PNG
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                    {isVideo && (
                                                                        <div className="p-3 bg-[#202c33]/40 border border-[#00a884]/20 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-left">
                                                                            <span className="text-[10px] text-white/70 font-bold font-sans">🎥 Video Payload Detected</span>
                                                                            <button
                                                                                onClick={() => downloadAdminMediaWithFormat(m.key?.id || m.id, m.chatJid || queriedData.phone, 'mp4')}
                                                                                className="px-3 py-1 bg-[#00a884]/20 hover:bg-[#00a884]/30 text-[#00a884] rounded-lg font-black text-[9px] uppercase tracking-widest cursor-pointer flex items-center gap-1.5"
                                                                            >
                                                                                <Download className="w-3.5 h-3.5" /> Download MP4
                                                                            </button>
                                                                        </div>
                                                                    )}
                                                                    {isAudio && (
                                                                        <div className="p-3 bg-[#202c33]/40 border border-[#00a884]/20 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-left">
                                                                            <span className="text-[10px] text-white/70 font-bold font-sans">🎙️ Recorded Voice Note</span>
                                                                            <button
                                                                                onClick={() => downloadAdminMediaWithFormat(m.key?.id || m.id, m.chatJid || queriedData.phone, 'mp3')}
                                                                                className="px-3 py-1 bg-[#00a884]/20 hover:bg-[#00a884]/30 text-[#00a884] rounded-lg font-black text-[9px] uppercase tracking-widest cursor-pointer flex items-center gap-1.5"
                                                                            >
                                                                                <Download className="w-3.5 h-3.5" /> Download MP3
                                                                            </button>
                                                                        </div>
                                                                    )}

                                                                    <div className="flex justify-between items-center text-[9px] text-white/30 font-mono">
                                                                        <span>JID: {m.chatJid}</span>
                                                                        <span>{new Date(m.timestamp * 1000).toLocaleString()}</span>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })
                                                    ) : (
                                                        <p className="text-xs text-white/30 italic">No packet logs registered on this node backup.</p>
                                                    )}
                                                </div>
                                            )}

                                            {activeTab === 'calls' && (
                                                <div id="tab-calls-view" className="space-y-3">
                                                    <h4 className="text-[10px] font-black text-[#00a884] uppercase tracking-widest mb-4">Voice/Video Call Records (Audited)</h4>
                                                    {queriedData.calls?.length > 0 ? (
                                                        queriedData.calls.map((c: any, idx: number) => {
                                                            const hasRecording = c.recording_url || c.id;
                                                            const recUrl = c.recording_url || `/api/recordings/${c.id || 'sim_' + idx}`;
                                                            
                                                            return (
                                                                <div key={idx} className="p-4 bg-[#111b21] border border-white/5 rounded-2xl flex flex-col gap-3 font-mono animate-fadeIn">
                                                                    <div className="flex justify-between items-center">
                                                                        <div>
                                                                            <p className="text-xs font-bold text-white uppercase">{c.type || 'Voice'} Connection</p>
                                                                            <p className="text-[10px] text-white/40 mt-1">Status: {c.status || 'Settled'}</p>
                                                                        </div>
                                                                        <div className="text-right text-[10px]">
                                                                            <p className="text-[#00a884] font-bold">Duration: {c.duration || 0}s</p>
                                                                            <p className="text-[8px] text-white/30 mt-1">
                                                                                {c.timestamp ? new Date(c.timestamp).toLocaleString() : 'N/A'}
                                                                            </p>
                                                                        </div>
                                                                    </div>
                                                                    
                                                                    {hasRecording && (
                                                                        <div className="pt-2 border-t border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#202c33]/20 p-2.5 rounded-xl">
                                                                            <div className="flex items-center gap-2">
                                                                                <span className="text-[8px] font-black text-red-500 uppercase tracking-widest flex items-center gap-1.5 font-sans">
                                                                                    🎙️ Recording
                                                                                </span>
                                                                                <audio 
                                                                                    controls 
                                                                                    src={recUrl} 
                                                                                    className="h-8 w-44 opacity-80" 
                                                                                />
                                                                            </div>
                                                                            <a
                                                                                href={`${recUrl}?download=true`}
                                                                                download={`call_recording_${c.id || idx}.mp3`}
                                                                                className="px-2.5 py-1.5 bg-[#00a884]/20 hover:bg-[#00a884]/30 text-[#00a884] rounded-lg text-[9px] font-black uppercase tracking-widest transition-all text-center cursor-pointer"
                                                                            >
                                                                                ⬇️ Download MP3
                                                                            </a>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })
                                                    ) : (
                                                        <p className="text-xs text-white/30 italic">No call indices cached.</p>
                                                    )}
                                                </div>
                                            )}

                                            {activeTab === 'status' && (
                                                <div id="tab-status-view" className="space-y-4">
                                                    <h4 className="text-[10px] font-black text-[#00a884] uppercase tracking-widest mb-4">Hosted Stories</h4>
                                                    {queriedData.status?.length > 0 ? (
                                                        queriedData.status.map((s: any, idx: number) => (
                                                            <div key={idx} className="p-5 bg-[#111b21] border border-white/5 rounded-2xl space-y-3">
                                                                <div className="flex justify-between text-[9px] text-white/40 font-mono pb-2 border-b border-white/5">
                                                                    <span>Author: {s.pushName || 'Unknown Pushname'}</span>
                                                                    <span>{s.timestamp ? new Date(s.timestamp * 1000).toLocaleString() : 'N/A'}</span>
                                                                </div>
                                                                <p className="text-xs text-white bg-black/25 p-4 rounded-xl leading-relaxed italic border border-white/[0.02]">
                                                                    "{s.message?.conversation || 'Attachment payload container'}"
                                                                </p>
                                                            </div>
                                                        ))
                                                    ) : (
                                                        <p className="text-xs text-white/30 italic">No status updates cached under backup node.</p>
                                                    )}
                                                </div>
                                            )}

                                            {activeTab === 'groups' && (
                                                <div id="tab-groups-view" className="space-y-3">
                                                    <h4 className="text-[10px] font-black text-[#00a884] uppercase tracking-widest mb-4">Encrypted Group Structs</h4>
                                                    {queriedData.groups?.length > 0 ? (
                                                        queriedData.groups.map((g: any, idx: number) => (
                                                            <div key={idx} className="p-4 bg-[#111b21] border border-white/5 rounded-2xl flex justify-between items-center">
                                                                <div>
                                                                    <p className="text-xs font-bold text-white font-mono">{g.id}</p>
                                                                    <p className="text-[10px] text-white/40 mt-1">Group Title: {g.name || 'Group Member Channel'}</p>
                                                                </div>
                                                                <span className="text-[9px] font-bold text-[#00a884] bg-[#00a884]/5 px-2.5 py-1 rounded-xl">Unreads: {g.unreadCount || 0}</span>
                                                            </div>
                                                        ))
                                                    ) : (
                                                        <p className="text-xs text-white/30 italic">No group chats cached.</p>
                                                    )}
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div id="admin-detail-empty" className="flex-1 flex flex-col items-center justify-center text-center opacity-25">
                                <ShieldAlert className="w-16 h-16 mb-4 text-[#00a884]" />
                                <p className="text-xs font-black uppercase tracking-[0.25em] text-white">Audited Viewing Mode Engaged</p>
                                <p className="text-[10px] mt-2 max-w-sm text-white/60">
                                    Lookup and examine secure encrypted data records from target system nodes. All accesses are persistently recorded and certified in accordance with auditing requirements.
                                </p>
                            </div>
                        )}
                    </div>

                </div>

            </div>
        </div>
    );
};
