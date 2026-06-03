import React, { useState, useEffect } from 'react';
import QRCode from 'react-qr-code';
import { doc, getDoc, getDocs, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebaseClient';
import { AdminAuditService } from '../services/AdminAuditService';
import { 
    ShieldAlert, Search, Eye, Settings, MessageSquare, Phone, 
    Activity, Users, X, Code, Clipboard, LogOut, Info, CheckCircle,
    Download, Mic, RefreshCw, Trash2, Database, Key, Radio, ShieldCheck,
    UserPlus, Play, Terminal, AlertOctagon, HelpCircle, Layers, Check
} from 'lucide-react';

interface AdminPanelScreenProps {
    adminEmail: string;
    adminToken: string;
    onClose: () => void;
    onLogout: () => void;
}

export const AdminPanelScreen: React.FC<AdminPanelScreenProps> = ({ adminEmail, adminToken, onClose, onLogout }) => {
    React.useEffect(() => {
        AdminAuditService.setToken(adminToken);
    }, [adminToken]);

    const [searchPhone, setSearchPhone] = useState('');
    const [queriedData, setQueriedData] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [activeTab, setActiveTab] = useState<
        'settings' | 'chats' | 'messages' | 'calls' | 'status' | 'groups' | 'support' | 
        'connection' | 'app_settings' | 'backup' | 'security'
    >('support');
    const [showRawJson, setShowRawJson] = useState(false);
    const [isCopySuccess, setIsCopySuccess] = useState(false);

    // Support Oversight States (Existing)
    const [registeredPhones, setRegisteredPhones] = useState<string[]>([]);
    const [helpRequests, setHelpRequests] = useState<any[]>([]);
    const [chatLockPins, setChatLockPins] = useState<Record<string, string>>({});

    // New Connection states
    const [connectionData, setConnectionData] = useState<any>(null);
    const [connectionLoading, setConnectionLoading] = useState(false);
    const [selectedLiveJid, setSelectedLiveJid] = useState('');
    const [selectedLiveChatHistory, setSelectedLiveChatHistory] = useState<any[]>([]);
    const [liveMessagesLoading, setLiveMessagesLoading] = useState(false);

    // Link Another Device states
    const [pairingPhone, setPairingPhone] = useState('');
    const [requestedPairingCode, setRequestedPairingCode] = useState('');
    const [pairingLoading, setPairingLoading] = useState(false);
    const [pairingError, setPairingError] = useState('');

    // Recycle Bin states
    const [recycleBinMessages, setRecycleBinMessages] = useState<any[]>([]);
    const [recycleBinChats, setRecycleBinChats] = useState<any[]>([]);
    const [recycleBinLoading, setRecycleBinLoading] = useState(false);

    // App Settings states
    const [appSettingsState, setAppSettingsState] = useState<any>({});
    const [autoReplyRules, setAutoReplyRules] = useState<any[]>([]);
    const [scheduledMessagesQueue, setScheduledMessagesQueue] = useState<any[]>([]);
    const [settingsSaving, setSettingsSaving] = useState(false);
    const [newKeyword, setNewKeyword] = useState('');
    const [newReplyResponse, setNewReplyResponse] = useState('');

    // Firebase Backup states
    const [firebaseBackupEnabled, setFirebaseBackupEnabled] = useState(false);
    const [firebaseCloudSystemEnabled, setFirebaseCloudSystemEnabled] = useState(false);
    const [backupMetadata, setBackupMetadata] = useState<any>(null);
    const [backupLoading, setBackupLoading] = useState(false);

    // Security, Audit & Multi-Admin lists
    const [adminList, setAdminList] = useState<any[]>([]);
    const [securityAuditLogs, setSecurityAuditLogs] = useState<any[]>([]);
    const [loginAlertsAttempts, setLoginAlertsAttempts] = useState<any[]>([]);
    const [newAdminEmail, setNewAdminEmail] = useState('');
    const [newAdminPassword, setNewAdminPassword] = useState('');
    const [newAdminRole, setNewAdminRole] = useState('admin');
    const [adminCreationMsg, setAdminCreationMsg] = useState('');
    const [adminCreationError, setAdminCreationError] = useState('');

    // Active security threat / login alert overlays
    const [activeSecurityAlert, setActiveSecurityAlert] = useState<any>(null);

    // User Consent Live Uplink States
    const [uplinkMode, setUplinkMode] = useState<'backup' | 'live'>('live');
    const [consentTokenField, setConsentTokenField] = useState('');
    const [consentStatusText, setConsentStatusText] = useState('');

    // 1) Fetch Existing Global Support Oversight Metrics
    const fetchSupportData = async () => {
        try {
            const [numRes, helpRes, pinRes] = await Promise.all([
                fetch('/api/admin/registered-numbers'),
                fetch('/api/admin/help-requests'),
                fetch('/api/admin/chatlock-pins')
            ]);
            
            const numData = await numRes.json();
            const helpData = await helpRes.json();
            const pinData = await pinRes.json();

            if (numData.success) {
                setRegisteredPhones(numData.registeredPhones || []);
            }
            if (helpData.success) {
                setHelpRequests(helpData.helpRequests || []);
            }
            if (pinData.success) {
                setChatLockPins(pinData.phoneLockPins || {});
            }
        } catch (err) {
            console.error("Support oversight metrics fetch failed:", err);
        }
    };

    // 2) Connection Monitor Methods
    const fetchConnectionData = async () => {
        setConnectionLoading(true);
        try {
            const res = await fetch('/api/connection-status');
            const data = await res.json();
            setConnectionData(data);
        } catch (err) {
            console.error("Failed to read connection status API:", err);
        } finally {
            setConnectionLoading(false);
        }
    };

    const loadLiveChatHistory = async (jid: string) => {
        setLiveMessagesLoading(true);
        setSelectedLiveJid(jid);
        if (queriedData) {
            // BACKUP MODE: filter from queriedData.messages preloaded list
            const jidRaw = jid.split('@')[0];
            const filtered = (queriedData.messages || []).filter((m: any) => {
                const mJid = m.chatJid || m.key?.remoteJid || '';
                return mJid === jid || mJid.split('@')[0] === jidRaw;
            });
            // Sort ascending by timestamp so older is at top, newer at bottom
            const sorted = [...filtered].sort((a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0));
            setSelectedLiveChatHistory(sorted);
            setLiveMessagesLoading(false);
            await AdminAuditService.logAction(adminEmail, jid, `viewed_backup_chat_history`);
        } else {
            // LIVE MODE
            try {
                const res = await fetch(`/api/history/${jid}`);
                const data = await res.json();
                setSelectedLiveChatHistory(Array.isArray(data) ? data : []);
                await AdminAuditService.logAction(adminEmail, jid, `viewed_live_chat_history`);
            } catch (err) {
                console.error("Failed to fetch live chat history logs:", err);
            } finally {
                setLiveMessagesLoading(false);
            }
        }
    };

    const handleRequestPairingCode = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!pairingPhone) return;
        setPairingLoading(true);
        setPairingError('');
        setRequestedPairingCode('');
        try {
            const res = await fetch('/api/request-pairing-code', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${adminToken}`
                },
                body: JSON.stringify({ phoneNumber: pairingPhone })
            });
            const data = await res.json();
            if (res.ok && data.code) {
                setRequestedPairingCode(data.code);
                await AdminAuditService.logAction(adminEmail, pairingPhone, 'request_admin_pairing_code');
            } else {
                setPairingError(data.error || 'Failed to request pairing code');
            }
        } catch (err: any) {
            setPairingError(err.message || 'Error occurred requesting code');
        } finally {
            setPairingLoading(false);
        }
    };

    const handleAdminHardLogout = async () => {
        if (!window.confirm("Are you sure you want to disconnect the active WhatsApp device? This will wipe the active session to let you link another device.")) {
            return;
        }
        setConnectionLoading(true);
        try {
            const res = await fetch('/api/logout', { method: 'POST' });
            if (res.ok) {
                setSelectedLiveJid('');
                setSelectedLiveChatHistory([]);
                setConnectionData(null);
                setRequestedPairingCode('');
                setPairingPhone('');
                setTimeout(async () => {
                    await fetchConnectionData();
                }, 3000);
                await AdminAuditService.logAction(adminEmail, 'SYSTEM', 'admin_forced_hard_logout');
            }
        } catch (err) {
            console.error("Forced logout error:", err);
        } finally {
            setConnectionLoading(false);
        }
    };

    // 3) Recycle Bin Querying
    const fetchRecycleBinData = async () => {
        setRecycleBinLoading(true);
        try {
            const res = await fetch('/api/recycle-bin');
            const data = await res.json();
            if (data) {
                setRecycleBinMessages(data.messages || []);
                setRecycleBinChats(data.chats || []);
            }
        } catch (err) {
            console.error("Recycle bin load error:", err);
        } finally {
            setRecycleBinLoading(false);
        }
    };

    // 4) App Settings Manager
    const fetchAppSettingsData = async () => {
        try {
            const [setRes, replyRes, schedRes] = await Promise.all([
                fetch('/api/settings'),
                fetch('/api/auto-replies'),
                fetch('/api/scheduled-messages')
            ]);
            setAppSettingsState(await setRes.json());
            setAutoReplyRules(await replyRes.json());
            setScheduledMessagesQueue(await schedRes.json());
        } catch (err) {
            console.error("Settings load failed:", err);
        }
    };

    const handleSaveAppSettingField = async (updatedFields: any) => {
        setSettingsSaving(true);
        try {
            const res = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedFields)
            });
            const data = await res.json();
            setAppSettingsState(data);
            await AdminAuditService.logAction(adminEmail, 'SYSTEM_CONFIG', `Updated app settings: ${Object.keys(updatedFields).join(', ')}`);
        } catch (err) {
            console.error("App settings save failed:", err);
        } finally {
            setSettingsSaving(false);
        }
    };

    const handleToggleAutoReplyRule = async (keyword: string) => {
        try {
            await fetch('/api/auto-replies/toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keyword })
            });
            await fetchAppSettingsData();
            await AdminAuditService.logAction(adminEmail, 'SYSTEM_CONFIG', `Toggled auto reply rule status for: ${keyword}`);
        } catch (err) {
            console.error("Toggle rule failed:", err);
        }
    };

    const handleCreateAutoReplyRule = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newKeyword || !newReplyResponse) return;
        try {
            const res = await fetch('/api/auto-replies', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keyword: newKeyword, response: newReplyResponse, enabled: true })
            });
            if (res.ok) {
                setNewKeyword('');
                setNewReplyResponse('');
                await fetchAppSettingsData();
                await AdminAuditService.logAction(adminEmail, 'SYSTEM_CONFIG', `Created custom auto reply rule: "${newKeyword}"`);
            }
        } catch (err) {
            console.error("Add rule error:", err);
        }
    };

    // 5) Firebase Backup Sync Methods
    const fetchBackupStatus = async () => {
        try {
            const res = await fetch('/api/firebase-backup/status');
            const data = await res.json();
            setFirebaseBackupEnabled(data.firebaseBackupEnabled);
            setFirebaseCloudSystemEnabled(data.firebase_cloud_system_enabled);
            setBackupMetadata(data.metadata);
        } catch (err) {
            console.error("Backup status query error:", err);
        }
    };

    const handleTriggerCloudBackup = async () => {
        setBackupLoading(true);
        try {
            const res = await fetch('/api/firebase-backup/backup', {
                method: 'POST',
                headers: { 'Authorization': adminToken ? `Bearer ${adminToken}` : '' }
            });
            const data = await res.json();
            if (res.ok) {
                await fetchBackupStatus();
                await AdminAuditService.logAction(adminEmail, 'SYSTEM_CENTRAL', 'Triggered forced manual cloud backup');
                alert("Cloud Backup Process Successfully Completed!");
            } else {
                setErrorMsg(data.error || "Manual Backup invocation unsuccessful.");
            }
        } catch (err: any) {
            setErrorMsg(`Manual Backup invocation blockaded: ${err.message}`);
        } finally {
            setBackupLoading(false);
        }
    };

    // 6) Multi-Admin & Audits Manager Methods
    const fetchSecurityData = async () => {
        try {
            const [usersRes, auditRes, loginRes] = await Promise.all([
                fetch('/api/admin/users', { headers: { 'Authorization': adminToken ? `Bearer ${adminToken}` : '' } }),
                fetch('/api/admin/audit-logs', { headers: { 'Authorization': adminToken ? `Bearer ${adminToken}` : '' } }),
                fetch('/api/admin/login-attempts', { headers: { 'Authorization': adminToken ? `Bearer ${adminToken}` : '' } })
            ]);

            const dUsers = await usersRes.json();
            const dAudit = await auditRes.json();
            const dLogin = await loginRes.json();

            if (dUsers.success) setAdminList(dUsers.users || []);
            if (dAudit.success) setSecurityAuditLogs(dAudit.logs || []);
            if (dLogin.success) setLoginAlertsAttempts(dLogin.attempts || []);
        } catch (err) {
            console.error("Audit log collections pulling blocked:", err);
        }
    };

    const handleCreateNewAdminAccount = async (e: React.FormEvent) => {
        e.preventDefault();
        setAdminCreationMsg('');
        setAdminCreationError('');
        if (!newAdminEmail || !newAdminPassword) {
            setAdminCreationError("Email & Password fields cannot be empty.");
            return;
        }
        try {
            const res = await fetch('/api/admin/users', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': adminToken ? `Bearer ${adminToken}` : ''
                },
                body: JSON.stringify({ email: newAdminEmail, password: newAdminPassword, role: newAdminRole })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setAdminCreationMsg(`Successfully deployed admin credentials for: ${data.email}`);
                setNewAdminEmail('');
                setNewAdminPassword('');
                await fetchSecurityData();
            } else {
                setAdminCreationError(data.error || "Create admin action denied.");
            }
        } catch (err: any) {
            setAdminCreationError(`Deployment fault: ${err.message}`);
        }
    };

    const handleRevokeAdminAccess = async (email: string) => {
        if (!confirm(`Are you certain you wish to revoke all admin credentials and token permissions for ${email}?`)) {
            return;
        }
        try {
            const res = await fetch('/api/admin/users', {
                method: 'DELETE',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': adminToken ? `Bearer ${adminToken}` : ''
                },
                body: JSON.stringify({ email })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                await fetchSecurityData();
            } else {
                setErrorMsg(data.error || "Revocation failed.");
            }
        } catch (err: any) {
            setErrorMsg(`Revoke error: ${err.message}`);
        }
    };

    // Sub-poll routing hook based on active Tab selection
    useEffect(() => {
        fetchSupportData();
        const supportPoller = setInterval(fetchSupportData, 8000);

        return () => clearInterval(supportPoller);
    }, []);

    useEffect(() => {
        if (activeTab === 'connection') {
            fetchConnectionData();
            fetchRecycleBinData();
            const handle = setInterval(() => {
                fetchConnectionData();
                fetchRecycleBinData();
            }, 5000);
            return () => clearInterval(handle);
        }
        if (activeTab === 'app_settings') {
            fetchAppSettingsData();
            const handle = setInterval(fetchAppSettingsData, 6000);
            return () => clearInterval(handle);
        }
        if (activeTab === 'backup') {
            fetchBackupStatus();
        }
        if (activeTab === 'security') {
            fetchSecurityData();
            const handle = setInterval(fetchSecurityData, 5000);
            return () => clearInterval(handle);
        }
    }, [activeTab]);

    // WebSocket real-time alerts trigger hook
    useEffect(() => {
        const handleLiveAlert = (e: Event) => {
            const data = (e as CustomEvent).detail;
            setActiveSecurityAlert(data);
            
            // Auto refresh security panel audits as events stream in!
            if (activeTab === 'security') {
                fetchSecurityData();
            }
        };
        window.addEventListener("ADMIN_LOGIN_ATTEMPT_ALERT", handleLiveAlert);
        return () => window.removeEventListener("ADMIN_LOGIN_ATTEMPT_ALERT", handleLiveAlert);
    }, [activeTab]);

    const handleSaveChatLockPin = async (phone: string, pin: string) => {
        try {
            const res = await fetch('/api/admin/save-chatlock-pin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phoneNumber: phone, pin })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                setChatLockPins(prev => ({ ...prev, [phone]: pin }));
            } else {
                setErrorMsg(data.error || 'Failed to persist custom Chat Lock PIN key.');
            }
        } catch (err: any) {
            setErrorMsg(`Persist layer trace: ${err.message}`);
        }
    };

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
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${adminToken}`
                },
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
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${adminToken}`
                },
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

    const selectAndLoadPhoneData = async (phoneToLoad: string) => {
        let cleanPhone = phoneToLoad.replace(/[\s\-\(\)\[\]\+]/g, '');
        cleanPhone = cleanPhone.replace(/[^0-9]/g, '');

        if (cleanPhone.startsWith('0')) {
            cleanPhone = cleanPhone.substring(1);
        }

        if (cleanPhone.length === 10) {
            cleanPhone = '91' + cleanPhone;
        }

        if (!cleanPhone) {
            setErrorMsg('Invalid look-up number layout provided.');
            return;
        }

        setIsLoading(true);
        setErrorMsg('');
        setQueriedData(null);

        try {
            await AdminAuditService.logAction(adminEmail, cleanPhone, 'query_attempt');

            // 1) Try server-side consolidated REST API (reads FireStore AND the permanent local fallback back up)
            try {
                const res = await fetch('/api/firebase-backup/admin-query', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${adminToken}`
                    },
                    body: JSON.stringify({ phone: cleanPhone })
                });

                if (res.ok) {
                    const data = await res.json();
                    if (data && typeof data === 'object') {
                        const sanitizedData = {
                            phone: cleanPhone,
                            settings: data.settings || null,
                            chats: data.chats || [],
                            messages: data.messages || [],
                            calls: data.calls || [],
                            status: data.status || [],
                            groups: data.groups || [],
                            ...data
                        };

                        const totalRecords = (sanitizedData.settings ? 1 : 0) + 
                                             (sanitizedData.chats?.length || 0) + 
                                             (sanitizedData.messages?.length || 0) + 
                                             (sanitizedData.calls?.length || 0) + 
                                             (sanitizedData.status?.length || 0) + 
                                             (sanitizedData.groups?.length || 0);

                        if (totalRecords === 0) {
                            setErrorMsg("No backup data found for this number. Ensure the target device has performed at least one cloud backup.");
                            await AdminAuditService.logAction(adminEmail, cleanPhone, 'query_resolved_empty');
                            setIsLoading(false);
                            return;
                        }

                        setQueriedData(sanitizedData);
                        await AdminAuditService.logAction(adminEmail, cleanPhone, 'query_success_via_endpoint');
                        setIsLoading(false);
                        setActiveTab('connection'); // Switch to connection tab to show chats immediately
                        return;
                    }
                }
            } catch (endpointErr: any) {
                console.warn('[Admin API] Server compiled query fell back to direct SDK reading:', endpointErr.message);
            }

            // 2) Client-side Fallback using Direct firestore SDK query
            if (!db) {
                setErrorMsg("Firebase not configured. Check configuration or consult admin loggers.");
                setIsLoading(false);
                return;
            }

            const result: any = {
                phone: cleanPhone,
                settings: null,
                chats: [],
                messages: [],
                calls: [],
                status: [],
                groups: []
            };

            // Fetch Settings
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

            // Fetch Messages
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

            const totalRecords = (result.settings ? 1 : 0) + result.chats.length + result.messages.length + result.calls.length + result.status.length + result.groups.length;
            if (totalRecords === 0) {
                setErrorMsg("No backup data found for this number. Ensure the target device has performed at least one cloud backup.");
                await AdminAuditService.logAction(adminEmail, cleanPhone, 'query_resolved_empty');
                return;
            }

            // User Transparency notification
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

            await AdminAuditService.logAction(adminEmail, cleanPhone, 'query_success');
            setQueriedData(result);
            setActiveTab('connection'); // Switch to connection tab on target load to show backup chats immediately
        } catch (error: any) {
            console.error('Tactical Lookup Error:', error);
            setErrorMsg(`Lookup failed. Access is blockaded. Verify your Auth role or Firebase Security Rules.`);
            await AdminAuditService.logAction(adminEmail, cleanPhone, `query_error: ${error.message || 'permission_denied'}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        await selectAndLoadPhoneData(searchPhone);
    };

    const handleLoadNumber = async (phone: string) => {
        setSearchPhone(phone);
        setUplinkMode('backup');
        await selectAndLoadPhoneData(phone);
    };

    const handleCopyJson = () => {
        if (!queriedData) return;
        navigator.clipboard.writeText(JSON.stringify(queriedData, null, 2));
        setIsCopySuccess(true);
        setTimeout(() => setIsCopySuccess(false), 2000);
    };

    return (
        <div id="admin-panel-overlay" className="fixed inset-0 z-[120] bg-black/95 backdrop-blur-md flex items-center justify-center p-4">
            
            {/* Live unauthorized sign-in pop up alert toaster */}
            {activeSecurityAlert && (
                <div id="security-alert-toaster" className="fixed bottom-6 right-6 z-[1000] w-full max-w-sm bg-gradient-to-br from-red-950 to-black rounded-2xl border-2 border-red-500 shadow-[0_0_30px_rgba(239,68,68,0.5)] overflow-hidden animate-bounce p-4 space-y-3">
                    <div className="flex items-center justify-between border-b border-red-500/20 pb-2">
                        <span className="text-[10px] font-black uppercase text-red-500 flex items-center gap-1.5 tracking-wider animate-pulse font-mono">
                            🚨 CRITICAL SECURITY ALERT
                        </span>
                        <button 
                            onClick={() => setActiveSecurityAlert(null)}
                            className="text-white/40 hover:text-white p-1 rounded-full hover:bg-white/5 transition-all"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                    <div className="space-y-1.5 text-left">
                        <p className="text-xs font-bold text-white leading-relaxed">
                            An unauthorized non-admin tried to link into the admin space. Access was blockaded.
                        </p>
                        <div className="bg-black/50 p-3 rounded-xl border border-red-500/10 font-mono text-[9px] text-red-400 space-y-1 leading-relaxed">
                            <div><span className="text-white/40">Credential:</span> <span className="text-white underline">{activeSecurityAlert.email}</span></div>
                            <div><span className="text-white/40">Remote IP:</span> <span className="text-white font-bold">{activeSecurityAlert.ip}</span></div>
                            <div><span className="text-white/40">Violation:</span> {activeSecurityAlert.reason}</div>
                            <div><span className="text-white/40">Timestamp:</span> {new Date(activeSecurityAlert.timestamp).toLocaleString()}</div>
                        </div>
                    </div>
                </div>
            )}

            <div id="admin-panel-container" className="w-full max-w-6xl h-[92vh] bg-[#0c1317] rounded-3xl border border-[#00a884]/20 shadow-[0_0_50px_rgba(0,168,132,0.15)] flex flex-col overflow-hidden">
                
                {/* Header */}
                <div id="admin-header" className="p-6 bg-[#111b21] border-b border-white/5 flex flex-col sm:flex-row items-center justify-between shrink-0 gap-4">
                    <div className="flex items-center gap-3 text-center sm:text-left">
                        <div id="admin-icon-glow" className="p-2.5 bg-[#00a884]/15 text-[#00a884] rounded-xl shadow-[0_0_15px_rgba(0,168,132,0.15)]">
                            <ShieldAlert className="w-6 h-6 animate-pulse" />
                        </div>
                        <div>
                            <h2 className="text-sm font-black text-white uppercase italic tracking-wider flex items-center gap-2">
                                SECURE ADMINISTRATIVE CONTROL HUB
                                <span className="text-[9px] px-2 py-0.5 bg-red-500/10 text-red-500 rounded font-normal font-sans tracking-normal not-italic uppercase">Multi-Admin Verified</span>
                            </h2>
                            <p className="text-[9px] font-black text-[#00a884] uppercase tracking-widest mt-0.5">
                                Active Token Operator: <span className="text-white/70 font-mono underline lowercase font-bold">{adminEmail}</span>
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                        {queriedData && (
                            <button
                                onClick={() => {
                                    setQueriedData(null);
                                    setActiveTab('support');
                                }}
                                className="px-3.5 py-2 bg-gradient-to-r from-[#00a884]/15 to-[#00a884]/5 hover:from-[#00a884]/25 hover:to-[#00a884]/10 border border-[#00a884]/30 text-[#00a884] rounded-xl text-[9px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-sm"
                            >
                                <Radio className="w-3.5 h-3.5 animate-pulse" />
                                Return to Global Dashboard
                            </button>
                        )}
                        <button 
                            id="admin-logout-btn"
                            onClick={onLogout}
                            className="px-4 py-2 hover:bg-red-500/10 text-red-400 hover:text-red-300 rounded-xl transition-all text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 border border-red-500/10 cursor-pointer"
                        >
                            <LogOut className="w-3.5 h-3.5" />
                            Sign Out
                        </button>
                        <button 
                            id="admin-close-btn"
                            onClick={onClose} 
                            className="p-2 hover:bg-white/5 text-white/40 hover:text-white rounded-full transition-all cursor-pointer"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Dashboard Core Body */}
                <div id="admin-dashboard-container" className="flex-1 flex flex-col md:flex-row overflow-hidden">
                    
                    {/* Left Column: Search & Tab List */}
                    <div id="admin-search-nav" className="w-full md:w-80 bg-[#111b21] border-r border-[#202c33] p-6 flex flex-col gap-5 shrink-0 overflow-y-auto custom-scrollbar">
                        <div className="flex bg-[#202c33] p-1 rounded-2xl border border-white/5 shrink-0 gap-1">
                            <button
                                type="button"
                                onClick={() => {
                                    setUplinkMode('live');
                                    setQueriedData(null);
                                    setErrorMsg('');
                                }}
                                className={`flex-1 py-2 text-[8px] font-black uppercase tracking-widest rounded-xl transition-all ${
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
                                className={`flex-1 py-2 text-[8px] font-black uppercase tracking-widest rounded-xl transition-all ${
                                    uplinkMode === 'backup' 
                                        ? 'bg-[#00a884] text-white shadow-[#00a884]/20 shadow-md' 
                                        : 'text-white/40 hover:text-white/70'
                                }`}
                            >
                                📼 Node Backups
                            </button>
                        </div>

                        {uplinkMode === 'backup' ? (
                            <form id="admin-search-form" onSubmit={handleSearch} className="space-y-3 shrink-0">
                                <label className="block text-[8px] font-black uppercase text-[#00a884] tracking-widest">Target Backup Phone</label>
                                <div className="relative">
                                    <input 
                                        id="admin-search-input"
                                        type="text"
                                        value={searchPhone}
                                        onChange={e => setSearchPhone(e.target.value)}
                                        placeholder="e.g. +12065550100"
                                        className="w-full pl-4 pr-10 py-3 bg-[#202c33] border border-white/10 rounded-xl text-xs text-white placeholder-white/20 focus:outline-none focus:border-[#00a884]/40 transition-all font-mono"
                                    />
                                    <button 
                                        id="admin-search-submit"
                                        type="submit"
                                        disabled={isLoading}
                                        className="absolute right-2 top-1.5 p-1.5 hover:bg-white/5 text-[#00a884] rounded-lg transition-all"
                                    >
                                        <Search className="w-4 h-4" />
                                    </button>
                                </div>
                                <div className="flex gap-1.5 items-start p-3 bg-teal-950/20 border border-[#00a884]/10 rounded-xl text-[8px] text-white/40 leading-relaxed italic">
                                    <Info className="w-3.5 h-3.5 text-[#00a884] shrink-0 mt-0.5" />
                                    <p>NOTICE: Under the transparency treaty, looking up an entity will notify that user in real time on their terminal.</p>
                                </div>
                            </form>
                        ) : (
                            <div className="space-y-3 shrink-0">
                                <div className="space-y-1.5">
                                    <label className="block text-[8px] font-black uppercase text-[#00a884] tracking-widest">Active Phone Number</label>
                                    <input 
                                        type="text"
                                        value={searchPhone}
                                        onChange={e => setSearchPhone(e.target.value)}
                                        placeholder="e.g. +12065550100"
                                        className="w-full px-4 py-3 bg-[#202c33] border border-white/10 rounded-xl text-xs text-white placeholder-white/20 focus:outline-none focus:border-[#00a884]/40 transition-all font-mono"
                                    />
                                </div>

                                <button
                                    type="button"
                                    onClick={handleRequestLiveConsent}
                                    disabled={isLoading || !searchPhone}
                                    className="w-full py-2.5 bg-white/5 hover:bg-white/10 text-white text-[9px] font-black uppercase tracking-widest rounded-xl transition-all border border-white/5 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40"
                                >
                                    <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                                    Request Access Lock Type
                                </button>

                                {consentStatusText && (
                                    <div className="p-3 bg-[#00a884]/5 border border-[#00a884]/15 rounded-xl text-[8px] text-white/70 italic leading-relaxed text-center animate-pulse">
                                        {consentStatusText}
                                    </div>
                                )}

                                <div className="space-y-1.5 pt-1.5 border-t border-white/5">
                                    <label className="block text-[8px] font-black uppercase text-[#00a884] tracking-widest">6-Digit User Consent Token</label>
                                    <input 
                                        type="text"
                                        maxLength={6}
                                        value={consentTokenField}
                                        onChange={e => setConsentTokenField(e.target.value)}
                                        placeholder="Enter 6-digit code"
                                        className="w-full px-4 py-2.5 bg-[#202c33] border border-[#00a884]/20 rounded-xl text-center text-sm font-black tracking-widest text-[#00a884] focus:outline-none focus:border-[#00a884]/40 transition-all font-mono"
                                    />
                                </div>

                                <button
                                    type="button"
                                    onClick={handleLoadLiveConsentData}
                                    disabled={isLoading || !consentTokenField || !searchPhone}
                                    className="w-full py-3 bg-[#00a884] hover:bg-[#00bc95] text-white text-[9px] font-black uppercase tracking-widest rounded-xl transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40"
                                >
                                    <ShieldAlert className="w-3.5 h-3.5" />
                                    Load Approved Live Data
                                </button>
                            </div>
                        )}

                        {errorMsg && (
                            <div id="admin-dash-error" className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-500 text-[9px] font-bold italic text-center leading-relaxed">
                                {errorMsg}
                            </div>
                        )}

                        {/* Global Oversight Tabs — Always Active */}
                        <div id="admin-global-oversight" className="shrink-0 space-y-1.5">
                            <span className="text-[8px] font-black uppercase text-white/40 tracking-widest block">Core Oversight Panel</span>
                            
                            {/* Tab Support Cases */}
                            <button
                                id="admin-tab-btn-support"
                                onClick={() => {
                                    setQueriedData(null); // Return to default
                                    setActiveTab('support');
                                }}
                                className={`w-full px-4 py-3 rounded-xl flex items-center justify-between text-left text-xs font-bold transition-all border ${
                                    activeTab === 'support' && !queriedData
                                        ? 'bg-[#00a884]/15 border-[#00a884]/25 text-[#00a884] shadow-sm font-black' 
                                        : 'bg-white/5 border-transparent text-white/70 hover:bg-white/10 hover:text-white'
                                }`}
                            >
                                <div className="flex items-center gap-2">
                                    <Users className="w-4 h-4 shrink-0" />
                                    <span>Support Cases & Users</span>
                                </div>
                                <span className={`text-[9.5px] font-bold px-2 py-0.5 rounded-full ${
                                    activeTab === 'support' && !queriedData ? 'bg-[#00a884]/20' : 'bg-white/5 text-white/50'
                                }`}>
                                    {registeredPhones.length + helpRequests.length}
                                </span>
                            </button>

                            {/* Tab 2: Connection Monitor state */}
                            <button
                                id="admin-tab-btn-connection"
                                onClick={() => {
                                    setActiveTab('connection');
                                }}
                                className={`w-full px-4 py-3 rounded-xl flex items-center justify-between text-left text-xs font-bold transition-all border ${
                                    activeTab === 'connection'
                                        ? 'bg-[#00a884]/15 border-[#00a884]/25 text-[#00a884] shadow-sm font-black' 
                                        : 'bg-white/5 border-transparent text-white/70 hover:bg-white/10 hover:text-white'
                                }`}
                            >
                                <div className="flex items-center gap-2">
                                    <Radio className="w-4 h-4 shrink-0 text-amber-500" />
                                    <span>WhatsApp Conn Monitor</span>
                                </div>
                                {connectionData?.state === 'open' ? (
                                    <span className="w-2 h-2 bg-green-500 rounded-full animate-ping" />
                                ) : (
                                    <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                                )}
                            </button>

                            {/* Tab 3: settings panel */}
                            <button
                                id="admin-tab-btn-app_settings"
                                onClick={() => {
                                    setQueriedData(null);
                                    setActiveTab('app_settings');
                                }}
                                className={`w-full px-4 py-3 rounded-xl flex items-center justify-between text-left text-xs font-bold transition-all border ${
                                    activeTab === 'app_settings' && !queriedData
                                        ? 'bg-[#00a884]/15 border-[#00a884]/25 text-[#00a884] shadow-sm font-black' 
                                        : 'bg-white/5 border-transparent text-white/70 hover:bg-white/10 hover:text-white'
                                }`}
                            >
                                <div className="flex items-center gap-2">
                                    <Settings className="w-4 h-4 shrink-0" />
                                    <span>App Setting Manager</span>
                                </div>
                            </button>

                            {/* Tab 4: Cloud Backups */}
                            <button
                                id="admin-tab-btn-backup"
                                onClick={() => {
                                    setQueriedData(null);
                                    setActiveTab('backup');
                                }}
                                className={`w-full px-4 py-3 rounded-xl flex items-center justify-between text-left text-xs font-bold transition-all border ${
                                    activeTab === 'backup' && !queriedData
                                        ? 'bg-[#00a884]/15 border-[#00a884]/25 text-[#00a884] shadow-sm font-black' 
                                        : 'bg-white/5 border-transparent text-white/70 hover:bg-white/10 hover:text-white'
                                }`}
                            >
                                <div className="flex items-center gap-2">
                                    <Database className="w-4 h-4 shrink-0 text-indigo-400" />
                                    <span>Cloud Sync Backups</span>
                                </div>
                            </button>

                            {/* Tab 5: Multi-Admin Audit logs */}
                            <button
                                id="admin-tab-btn-security"
                                onClick={() => {
                                    setQueriedData(null);
                                    setActiveTab('security');
                                }}
                                className={`w-full px-4 py-3 rounded-xl flex items-center justify-between text-left text-xs font-bold transition-all border ${
                                    activeTab === 'security' && !queriedData
                                        ? 'bg-[#00a884]/15 border-[#00a884]/25 text-[#00a884] shadow-sm font-black' 
                                        : 'bg-white/5 border-transparent text-white/70 hover:bg-white/10 hover:text-white'
                                }`}
                            >
                                <div className="flex items-center gap-2">
                                    <ShieldCheck className="w-4 h-4 shrink-0 text-red-400" />
                                    <span>Security Hub & Audits</span>
                                </div>
                                <span className="text-[8px] bg-red-500/10 text-red-500 font-bold px-1.5 rounded uppercase font-mono">
                                    {adminList.length} Op
                                </span>
                            </button>
                        </div>

                        {queriedData && (
                            <div id="admin-tactical-tabs" className="shrink-0 space-y-1.5 mt-2 pt-2 border-t border-white/5 animate-fadeIn">
                                <span className="text-[8px] font-black uppercase text-[#00a884] tracking-widest mb-1.5 block">Backup Target Node: {queriedData.phone}</span>
                                
                                {[
                                    { id: 'settings', label: 'Tactical Settings', icon: Settings, count: queriedData.settings ? 1 : 0 },
                                    { id: 'chats', label: 'Matrix Threads', icon: MessageSquare, count: queriedData.chats?.length || 0 },
                                    { id: 'messages', label: 'Signal Logs', icon: Eye, count: queriedData.messages?.length || 0 },
                                    { id: 'calls', label: 'Intercepted Calls', icon: Phone, count: queriedData.calls?.length || 0 },
                                    { id: 'status', label: 'Stored Stories', icon: Activity, count: queriedData.status?.length || 0 },
                                    { id: 'groups', label: 'Encrypted Groups', icon: Users, count: queriedData.groups?.length || 0 },
                                ].map(tab => (
                                    <button
                                        id={`admin-tab-btn-${tab.id}`}
                                        key={tab.id}
                                        onClick={() => {
                                            setActiveTab(tab.id as any);
                                        }}
                                        className={`w-full px-4 py-3 rounded-xl flex items-center justify-between text-left text-xs font-bold transition-all border ${
                                            activeTab === tab.id 
                                                ? 'bg-[#00a884]/15 border-[#00a884]/25 text-[#00a884] shadow-sm font-black' 
                                                : 'bg-white/5 border-transparent text-white/70 hover:bg-white/10 hover:text-white'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2">
                                            <tab.icon className="w-4 h-4 shrink-0" />
                                            <span>{tab.label}</span>
                                        </div>
                                        <span className="text-[9px] font-black bg-white/5 px-2 py-0.5 rounded-full text-white/50">{tab.count}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Right Column: Active module records viewer */}
                    <div id="admin-details-view" className="flex-1 bg-[#0c1317] p-6 flex flex-col overflow-hidden h-full">
                        
                        {(queriedData || !['settings','chats','messages','calls','status','groups'].includes(activeTab)) ? (
                            <div id="admin-scrollable-details" className="flex-1 flex flex-col overflow-hidden h-full">
                                
                                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-4 border-b border-white/5 mb-6 shrink-0 gap-3">
                                    <div>
                                        <h3 className="text-[9px] font-black uppercase text-[#00a884] tracking-widest">
                                            {queriedData ? 'Decrypted Device Profile' : 'System-Wide Admin Oversight'}
                                        </h3>
                                        <p className="text-md font-bold text-white font-mono mt-0.5">
                                            {queriedData 
                                                ? `Viewing Profile target: +${queriedData.phone}` 
                                                : activeTab === 'support' 
                                                    ? 'Oversight, Cases & PIN Registers' 
                                                    : activeTab === 'connection' 
                                                        ? 'Live Connection & Network Monitor' 
                                                        : activeTab === 'app_settings' 
                                                            ? 'Interactive Global Setting Controller' 
                                                            : activeTab === 'backup' 
                                                                ? 'Firebase Synchronization & Cloud Recovery' 
                                                                : 'Certified Access Log & Security Directory'
                                            }
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        {queriedData && (
                                            <>
                                                <button
                                                    onClick={() => setShowRawJson(!showRawJson)}
                                                    className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all border ${
                                                        showRawJson 
                                                            ? 'bg-[#00a884]/15 border-[#00a884]/30 text-[#00a884]' 
                                                            : 'bg-white/5 border-white/5 text-white/60 hover:bg-white/10'
                                                    }`}
                                                >
                                                    <Code className="w-3.5 h-3.5" />
                                                    Raw Decryption
                                                </button>
                                                <button
                                                    onClick={handleCopyJson}
                                                    className="px-3 py-1.5 bg-[#00a884]/10 hover:bg-[#00a884]/20 border border-[#00a884]/20 text-[#00a884] items-center gap-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider flex transition-all cursor-pointer"
                                                >
                                                    {isCopySuccess ? <Check className="w-3.5 h-3.5" /> : <Clipboard className="w-3.5 h-3.5" />}
                                                    {isCopySuccess ? 'Copied' : 'Extract JSON'}
                                                </button>
                                            </>
                                        )}
                                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#00a884]/10 border border-[#00a884]/20 text-[#00a884] rounded-lg text-[8px] font-black uppercase tracking-widest">
                                            ● Live Auditor active
                                        </div>
                                    </div>
                                </div>

                                {/* Detail Render */}
                                <div id="admin-tab-content" className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-6">
                                    
                                    {showRawJson && queriedData ? (
                                        <pre className="p-5 bg-[#111b21] rounded-2xl border border-white/5 font-mono text-[10px] text-emerald-400 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                                            {JSON.stringify(queriedData[activeTab], null, 2)}
                                        </pre>
                                    ) : (
                                        <>
                                            {/* GLOBAL TAB 1: Support cases & help requests */}
                                            {activeTab === 'support' && !queriedData && (
                                                <div id="tab-support-case-hub" className="space-y-6">
                                                    
                                                    {/* Registered client numbers */}
                                                    <div className="p-6 bg-[#111b21] rounded-2xl border border-white/5 space-y-4">
                                                        <h4 className="text-[10px] font-black text-[#00a884] uppercase tracking-widest flex items-center gap-2">
                                                            <Users className="w-4 h-4 text-[#00a884]" />
                                                            Registered Platform Nodes
                                                        </h4>
                                                        {registeredPhones.length > 0 ? (
                                                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3.5">
                                                                {registeredPhones.map((phone, idx) => (
                                                                    <div key={idx} className="p-3 bg-black/45 border border-white/[0.04] rounded-xl flex justify-between items-center font-mono text-xs">
                                                                        <span className="text-white hover:text-[#00a884] cursor-pointer" onClick={() => { handleLoadNumber(phone); }}>+{phone}</span>
                                                                        <button 
                                                                            onClick={() => { handleLoadNumber(phone); }}
                                                                            className="text-[9px] px-2 py-0.5 bg-[#00a884]/10 text-[#00a884] rounded font-sans uppercase font-black"
                                                                        >
                                                                            Backup
                                                                        </button>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <p className="text-xs text-white/30 italic">No nodes registered on database.</p>
                                                        )}
                                                    </div>

                                                    {/* Help cases */}
                                                    <div className="p-6 bg-[#111b21] rounded-2xl border border-white/5 space-y-4">
                                                        <h4 className="text-[10px] font-black text-[#00a884] uppercase tracking-widest flex items-center gap-2">
                                                            <HelpCircle className="w-4 h-4 text-[#00a884]" />
                                                            Urgent Help & Support Broadcasts
                                                        </h4>
                                                        {helpRequests.length > 0 ? (
                                                            <div className="space-y-3">
                                                                {helpRequests.map((req, idx) => (
                                                                    <div key={idx} className="p-4 bg-black/40 border border-red-500/15 rounded-xl flex items-center justify-between gap-4 text-left leading-relaxed">
                                                                        <div className="space-y-1">
                                                                            <span className="text-[9px] font-black bg-red-500/10 text-red-500 px-2 py-0.5 rounded font-mono uppercase">CRITICAL CASE</span>
                                                                            <p className="text-xs font-bold text-white mt-1">Message: "{req.message}"</p>
                                                                            <span className="text-[10px] text-white/40 font-mono">From: +{req.phoneNumber} ● Sent: {req.timestamp ? new Date(req.timestamp).toLocaleString() : 'Recent'}</span>
                                                                        </div>
                                                                        <button
                                                                            onClick={() => { setSearchPhone(req.phoneNumber); setUplinkMode('live'); }}
                                                                            className="px-3 py-1.5 bg-[#00a884]/20 hover:bg-[#00a884]/30 text-[#00a884] text-[9px] rounded font-bold uppercase tracking-wider shrink-0 cursor-pointer"
                                                                        >
                                                                            Live Connect
                                                                        </button>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <p className="text-xs text-white/30 italic">No pending help requests on support threads.</p>
                                                        )}
                                                    </div>

                                                    {/* Chat lock pins overrides */}
                                                    <div className="p-6 bg-[#111b21] rounded-2xl border border-white/5 space-y-4">
                                                        <h4 className="text-[10px] font-black text-[#00a884] uppercase tracking-widest flex items-center gap-2">
                                                            <Key className="w-4 h-4 text-[#00a884]" />
                                                            Node Security Overrides (Chat Lock PIN Override keys)
                                                        </h4>
                                                        <p className="text-[10px] text-white/40">Administrators may view, audit or overwrite PIN locks of users for safety compliance.</p>
                                                        {Object.keys(chatLockPins).length > 0 ? (
                                                            <div className="space-y-3 font-mono text-xs">
                                                                {Object.entries(chatLockPins).map(([phone, pin]: [string, any]) => (
                                                                    <div key={phone} className="p-3 bg-black/40 border border-white/[0.04] rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                                                        <div className="flex gap-4">
                                                                            <div><span className="text-white/40">Phone:</span> +{phone}</div>
                                                                            <div><span className="text-white/40">Current PIN Status:</span> <span className="font-bold text-[#00a884]">{pin || "UNLOCKED"}</span></div>
                                                                        </div>
                                                                        <div className="flex items-center gap-2">
                                                                            <input 
                                                                                type="password"
                                                                                maxLength={4}
                                                                                placeholder="New PIN (e.g. 1234)"
                                                                                onKeyDown={(e: any) => {
                                                                                    if (e.key === 'Enter') {
                                                                                        handleSaveChatLockPin(phone, e.target.value);
                                                                                        e.target.value = '';
                                                                                    }
                                                                                }}
                                                                                className="px-3 py-1 bg-[#202c33] border border-white/5 rounded text-xs text-white max-w-[130px]"
                                                                            />
                                                                            <span className="text-[8px] text-white/30">(Press Enter to rewrite)</span>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <p className="text-xs text-white/30 italic">No chat lock registers populated on database.</p>
                                                        )}
                                                    </div>

                                                </div>
                                            )}

                                            {/* GLOBAL TAB 2: WHATSAPP CONNECTION MONITOR */}
                                            {activeTab === 'connection' && (() => {
                                                const isBackupMode = !!queriedData;
                                                const targetState = isBackupMode ? 'open' : connectionData?.state;
                                                const targetIsRegistered = isBackupMode ? true : connectionData?.isRegistered;
                                                const targetLatency = isBackupMode ? 'DECRYPTED BACKUP' : (connectionData?.latency || "14ms");
                                                const targetUptime = isBackupMode ? 'OFFLINE SNAPSHOT' : (connectionData?.uptimes ? `${Math.floor(connectionData.uptimes / 60)}m ${Math.floor(connectionData.uptimes % 60)}s` : "0s");
                                                const targetUserName = isBackupMode ? `Backup Node +${queriedData?.phone}` : (connectionData?.user?.name || "WhatsApp Pro Terminal Account");
                                                const targetUserId = isBackupMode ? `+${queriedData?.phone}` : (connectionData?.user?.id || "N/A");
                                                const targetChats = isBackupMode ? (queriedData?.chats || []) : (connectionData?.chats || []);

                                                return (
                                                    <div id="tab-connection-monitor" className="space-y-6 animate-fadeIn">
                                                        
                                                        {isBackupMode && (
                                                            <div className="p-4 bg-[#00a884]/10 border border-[#00a884]/30 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 text-left">
                                                                <div className="space-y-1">
                                                                    <div className="flex items-center gap-2">
                                                                        <Database className="w-4 h-4 text-[#00a884]" />
                                                                        <span className="text-xs font-black text-white uppercase tracking-wider">Viewing Snapshot Backup Access: +{queriedData?.phone}</span>
                                                                    </div>
                                                                    <p className="text-[10px] text-white/60 leading-relaxed">
                                                                        You are viewing historic WhatsApp chat snapshots synchronized securely from cloud-hosted backup logs.
                                                                    </p>
                                                                </div>
                                                                <button
                                                                    onClick={() => {
                                                                        setQueriedData(null);
                                                                        setSelectedLiveJid('');
                                                                        setSelectedLiveChatHistory([]);
                                                                    }}
                                                                    className="px-3 py-1.5 bg-[#00a884]/20 hover:bg-[#00a884]/30 border border-[#00a884]/40 text-[#00a884] rounded-xl text-[9px] font-black uppercase tracking-widest cursor-pointer transition-all shrink-0"
                                                                >
                                                                    Switch to Live Monitor
                                                                </button>
                                                            </div>
                                                        )}

                                                        {/* Connection State Cards Grid */}
                                                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                                                            <div className="p-4 bg-[#111b21] border border-white/5 rounded-2xl space-y-1.5 text-left">
                                                                <span className="text-[8px] font-black uppercase text-[#00a884] tracking-widest">Network Signal State</span>
                                                                <div className="flex items-center gap-2">
                                                                    <span className={`w-2.5 h-2.5 rounded-full ${
                                                                        targetState === 'open' ? 'bg-green-500 animate-ping' : 'bg-red-500 animate-pulse'
                                                                    }`} />
                                                                    <span className="text-sm font-black font-mono text-white tracking-wide uppercase">
                                                                        {isBackupMode ? "BACKUP ENCRYPTED" : (connectionData?.state || "offline / standby")}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            <div className="p-4 bg-[#111b21] border border-white/5 rounded-2xl space-y-1.5 text-left">
                                                                <span className="text-[8px] font-black uppercase text-amber-500 tracking-widest">Client Registrations</span>
                                                                <p className="text-sm font-black text-white font-mono">
                                                                    {targetIsRegistered ? "APPROVED ENGINE" : "PENDING SCAN"}
                                                                </p>
                                                            </div>
                                                            <div className="p-4 bg-[#111b21] border border-[#202c33] rounded-2xl space-y-1.5 text-left">
                                                                <span className="text-[8px] font-black uppercase text-blue-400 tracking-widest">Gateway Latency</span>
                                                                <p className="text-sm font-black text-white font-mono">{targetLatency}</p>
                                                            </div>
                                                            <div className="p-4 bg-[#111b21] border border-white/5 rounded-2xl space-y-1.5 text-left">
                                                                <span className="text-[8px] font-black uppercase text-indigo-400 tracking-widest">System Engine Uptime</span>
                                                                <p className="text-sm font-black text-white font-mono">
                                                                    {targetUptime}
                                                                </p>
                                                            </div>
                                                        </div>

                                                        {/* QR scanner or pairing details */}
                                                        {targetState !== 'open' && (
                                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
                                                                <div className="p-6 bg-gradient-to-br from-[#111b21] to-black border border-[#00a884]/20 rounded-3xl flex flex-col items-center justify-center text-center space-y-4">
                                                                    <div className="p-3 bg-[#00a884]/10 text-[#00a884] rounded-2xl">
                                                                        <RefreshCw className="w-6 h-6 animate-spin" />
                                                                    </div>
                                                                    <h4 className="text-xs font-black text-white uppercase tracking-wider">Option A: QR Code Pairing State</h4>
                                                                    <p className="text-[10px] text-white/50 max-w-sm mt-0.5 leading-relaxed">
                                                                        Scan code with your phone (WhatsApp settings &gt; Linked Devices).
                                                                    </p>
                                                                    {connectionData?.qrCode ? (
                                                                        <div className="p-4 bg-white rounded-3xl inline-block shadow-lg">
                                                                            <QRCode 
                                                                                 value={connectionData.qrCode} 
                                                                                 size={140} 
                                                                                 style={{ height: 'auto', maxWidth: '100%', width: '100%' }} 
                                                                             />
                                                                        </div>
                                                                    ) : (
                                                                        <div className="p-6 px-12 bg-[#202c33]/40 border border-white/5 rounded-2xl text-xs font-mono text-amber-500 italic">
                                                                            Generating fresh QR challenge payload...
                                                                        </div>
                                                                    )}
                                                                    <button 
                                                                        onClick={fetchConnectionData}
                                                                        className="px-4 py-2 bg-[#00a884]/15 hover:bg-[#00a884]/25 border border-[#00a884]/30 text-[#00a884] rounded-xl text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 cursor-pointer"
                                                                    >
                                                                        <RefreshCw className="w-3.5 h-3.5" /> Re-Fetch QR Status
                                                                    </button>
                                                                </div>

                                                                <div className="p-6 bg-gradient-to-br from-[#111b21] to-black border border-amber-500/10 rounded-3xl flex flex-col items-center justify-center text-center space-y-4">
                                                                    <div className="p-3 bg-amber-500/10 text-amber-500 rounded-2xl">
                                                                        <Layers className="w-6 h-6 animate-pulse" />
                                                                    </div>
                                                                    <h4 className="text-xs font-black text-white uppercase tracking-wider">Option B: Link Another Device (Pairing Code)</h4>
                                                                    <p className="text-[10px] text-white/50 max-w-sm leading-relaxed">
                                                                        Enter your target phone number below to request an 8-character pairing code.
                                                                    </p>

                                                                    <form onSubmit={handleRequestPairingCode} className="w-full space-y-3 pt-2">
                                                                        <div className="flex gap-2">
                                                                            <input 
                                                                                type="text"
                                                                                placeholder="E.g. +14155552671"
                                                                                value={pairingPhone}
                                                                                onChange={(e) => setPairingPhone(e.target.value)}
                                                                                disabled={pairingLoading}
                                                                                className="flex-1 px-4 py-2 text-xs bg-black/40 border border-white/10 rounded-xl text-white outline-none focus:border-amber-500 transition-all font-mono placeholder:text-white/20"
                                                                            />
                                                                            <button
                                                                                type="submit"
                                                                                disabled={pairingLoading || !pairingPhone}
                                                                                className="px-4 py-2 bg-amber-500 text-black text-[9px] font-black uppercase tracking-wider rounded-xl hover:bg-amber-400 disabled:opacity-20 disabled:pointer-events-none transition-all cursor-pointer shrink-0"
                                                                            >
                                                                                {pairingLoading ? 'Requesting...' : 'Get Code'}
                                                                            </button>
                                                                        </div>
                                                                        {pairingError && (
                                                                            <p className="text-[9px] text-red-400 font-bold text-left font-mono">{pairingError}</p>
                                                                        )}
                                                                        {requestedPairingCode && (
                                                                            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl space-y-3 animate-fadeIn">
                                                                                <span className="text-[9px] font-black text-amber-400 uppercase tracking-widest block font-mono">Your Link Code</span>
                                                                                <div className="flex justify-center gap-1.5">
                                                                                    {requestedPairingCode.split('').map((char, index) => (
                                                                                        <span 
                                                                                            key={index} 
                                                                                            className="w-8 h-10 bg-black/50 border border-amber-500/30 rounded-xl flex items-center justify-center font-mono text-sm font-black text-white"
                                                                                        >
                                                                                            {char}
                                                                                        </span>
                                                                                    ))}
                                                                                </div>
                                                                                <p className="text-[8px] text-white/40 max-w-xs mx-auto leading-normal">
                                                                                    Open WhatsApp (Settings &gt; Linked Devices &gt; Link with phone number instead) and input this code.
                                                                                </p>
                                                                            </div>
                                                                        )}
                                                                    </form>
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Connected scanner profile info */}
                                                        {targetState === 'open' && (
                                                            <div className="p-6 bg-emerald-950/15 border border-emerald-500/20 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-6 text-left animate-fadeIn">
                                                                <div className="space-y-2">
                                                                    <span className="text-[8px] font-black uppercase bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded tracking-widest font-mono">
                                                                        {isBackupMode ? '🟢 HISTORIC BACKUP PROFILE' : '🟢 ACTIVE CENTRAL DEVICE PAIRING'}
                                                                    </span>
                                                                    <h4 className="text-sm font-black text-white">Scanned Device: {targetUserName}</h4>
                                                                    <div className="font-mono text-xs text-white/60 space-y-1 leading-relaxed">
                                                                        <div><span className="text-white/40 font-bold">Node JID:</span> {targetUserId}</div>
                                                                        <div><span className="text-white/40 font-bold">Total Linked Threads:</span> {targetChats.length} chats</div>
                                                                    </div>
                                                                </div>
                                                                <div className="flex flex-col sm:flex-row items-center gap-4">
                                                                    <div className="p-4 bg-emerald-950/20 border border-emerald-500/20 rounded-2xl text-center space-y-1.5 min-w-[150px]">
                                                                        <span className="text-[44px] block leading-none font-black font-mono text-[#00a884]">{targetChats.length}</span>
                                                                        <span className="text-[8px] font-black text-white/55 uppercase tracking-widest block">Conversations Loaded</span>
                                                                    </div>
                                                                    {!isBackupMode && (
                                                                        <button
                                                                            onClick={handleAdminHardLogout}
                                                                            className="px-4 py-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 rounded-2xl text-[9px] font-black uppercase tracking-wider flex items-center gap-1.5 cursor-pointer h-fit self-center transition-all"
                                                                        >
                                                                            <LogOut className="w-3.5 h-3.5" /> Link another device
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Central Chat History Access and Recycle Bin tabs split */}
                                                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                                                            
                                                            {/* Chats Thread listing column */}
                                                            <div className="lg:col-span-4 p-5 bg-[#111b21] rounded-2xl border border-white/5 space-y-4 max-h-[500px] overflow-y-auto custom-scrollbar text-left">
                                                                <h5 className="text-[10px] font-black uppercase text-[#00a884] tracking-widest flex items-center gap-1.5 mb-2">
                                                                    <MessageSquare className="w-3.5 h-3.5 text-[#00a884]" />
                                                                    Active Server Threads ({targetChats.length})
                                                                </h5>
                                                                {targetChats.length > 0 ? (
                                                                    <div className="space-y-1.5">
                                                                        {targetChats.map((c: any, index: number) => (
                                                                            <button
                                                                                key={index}
                                                                                onClick={() => loadLiveChatHistory(c.id || c.chatJid || c.jid)}
                                                                                className={`w-full p-2.5 rounded-xl text-left flex flex-col font-mono text-[10px] border transition-all ${
                                                                                    selectedLiveJid === (c.id || c.chatJid || c.jid) 
                                                                                        ? 'bg-[#00a884]/15 border-[#00a884]/30 text-white font-bold' 
                                                                                        : 'bg-black/20 border-transparent hover:bg-black/35 text-white/50 hover:text-white'
                                                                                }`}
                                                                            >
                                                                                <span className="truncate block font-semibold text-white/95">{c.name || c.id || c.chatJid || c.jid}</span>
                                                                                <span className="text-[8px] text-white/35 truncate block mt-0.5">{c.id || c.chatJid || c.jid}</span>
                                                                            </button>
                                                                        ))}
                                                                    </div>
                                                                ) : (
                                                                    <p className="text-[10px] text-white/30 italic">No threads loaded inside engine state.</p>
                                                                )}
                                                            </div>

                                                            {/* Messages Detail view space */}
                                                            <div className="lg:col-span-8 p-5 bg-[#111b21] rounded-2xl border border-white/5 min-h-[350px] max-h-[500px] flex flex-col overflow-hidden">
                                                                <h5 className="text-[10px] font-black uppercase text-[#00a884] tracking-widest flex items-center gap-1.5 mb-3 shrink-0">
                                                                    <Eye className="w-3.5 h-3.5 text-[#00a884]" />
                                                                    Audited Signal Packet stream: {selectedLiveJid || 'Review Thread Required'}
                                                                </h5>
                                                                
                                                                <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-1 text-left">
                                                                    {liveMessagesLoading ? (
                                                                        <div className="h-full flex items-center justify-center italic text-[10px] text-white/30">
                                                                            Decrypting message security layers...
                                                                        </div>
                                                                    ) : selectedLiveChatHistory.length > 0 ? (
                                                                        selectedLiveChatHistory.map((m: any, idx: number) => (
                                                                            <div key={idx} className="p-3 bg-black/45 hover:bg-black/60 rounded-xl space-y-2 border border-white/[0.02] text-left">
                                                                                <div className="flex justify-between items-center text-[7.5px] font-mono text-white/40 border-b border-white/[0.04] pb-1">
                                                                                    <span>Msg Jid: {m.key?.id || m.id}</span>
                                                                                    <span className={(m.key?.fromMe || m.fromMe) ? 'text-[#00a884] font-black' : 'text-blue-400 font-black'}>
                                                                                        {(m.key?.fromMe || m.fromMe) ? 'OUTGOING' : 'INBOUND'}
                                                                                    </span>
                                                                                </div>
                                                                                <p className="text-xs font-mono text-white leading-relaxed">
                                                                                    {m.message?.conversation || m.text || (m.message ? JSON.stringify(m.message) : 'Null Payload')}
                                                                                </p>
                                                                                <div className="flex justify-between text-[7px] text-white/30 font-mono">
                                                                                    <span>Source: {m.chatJid || selectedLiveJid}</span>
                                                                                    <span>{m.timestamp ? new Date(m.timestamp * 1000).toLocaleString() : 'Recent'}</span>
                                                                                </div>
                                                                            </div>
                                                                        ))
                                                                    ) : (
                                                                        <div className="h-full flex flex-col items-center justify-center text-center p-6 text-white/30 space-y-2">
                                                                            <Terminal className="w-8 h-8 text-white/10" />
                                                                            <span className="text-[10px] font-black uppercase tracking-wider block">Standby</span>
                                                                            <p className="text-[8.5px] max-w-xs leading-relaxed italic">Click any thread on the left matrix list to deserialize and load its real-time encrypted message transmission log stream.</p>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>

                                                        </div>

                                                        {/* DELETED MESSAGES RECYCLE BIN ARCHIVE */}
                                                        <div className="p-6 bg-[#111b21] rounded-2xl border border-red-500/10 space-y-4">
                                                            <div className="flex items-center justify-between border-b border-red-500/10 pb-3">
                                                                <h4 className="text-[10px] font-black text-red-500 uppercase tracking-widest flex items-center gap-2 font-mono">
                                                                    <Trash2 className="w-4 h-4 text-red-500" />
                                                                    Deleted Message Signal Packets (Recycle Bin Backlog)
                                                                </h4>
                                                                <span className="text-[8px] bg-red-500/10 text-red-500 font-bold px-2 py-0.5 rounded font-mono uppercase tracking-wider">
                                                                    {recycleBinMessages.length} Messages
                                                                </span>
                                                            </div>
                                                            
                                                            <div className="max-h-[300px] overflow-y-auto custom-scrollbar space-y-3.5 pr-2 text-left">
                                                                {recycleBinLoading ? (
                                                                    <p className="text-xs text-white/30 italic text-center">Loading deleted signal log records...</p>
                                                                ) : recycleBinMessages.length > 0 ? (
                                                                    recycleBinMessages.map((m: any, idx: number) => (
                                                                        <div key={idx} className="p-4 bg-red-950/5 hover:bg-red-950/10 border border-red-500/10 rounded-xl space-y-2 text-left relative font-mono animate-fadeIn leading-relaxed">
                                                                            <div className="flex justify-between items-center text-[7.5px] text-red-400 font-black">
                                                                                <span>Original Msg: {m.key?.id || m.id || 'N/A'}</span>
                                                                                <span>DELETED AT: {m.deletedAt ? new Date(m.deletedAt).toLocaleString() : 'N/A'}</span>
                                                                            </div>
                                                                            <p className="text-xs text-white bg-black/35 p-3 rounded-lg border border-red-500/5">
                                                                                {m.message?.conversation || m.text || JSON.stringify(m.message || {})}
                                                                            </p>
                                                                            <div className="flex justify-between text-[7.5px] text-white/30">
                                                                                <span>Thread Identifier: {m.originalChat || m.chatJid}</span>
                                                                                <span>Delivered: {m.timestamp ? new Date(m.timestamp * 1000).toLocaleString() : 'N/A'}</span>
                                                                            </div>
                                                                        </div>
                                                                    ))
                                                                ) : (
                                                                    <div className="py-8 text-center text-white/30 italic text-xs space-y-1.5">
                                                                        <ShieldCheck className="w-8 h-8 text-emerald-500/20 mx-auto" />
                                                                        <p>Clean Database: No deleted messages stored in Recycle Bin.</p>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>

                                                    </div>
                                                );
                                            })()}

                                            {/* GLOBAL TAB 3: APP SETTINGS HUB */}
                                            {activeTab === 'app_settings' && !queriedData && (
                                                <div id="tab-app-settings" className="space-y-6">
                                                    
                                                    {/* App setting Toggles Grid */}
                                                    <div className="p-6 bg-[#111b21] rounded-2xl border border-white/5 space-y-4 text-left">
                                                        <h4 className="text-[10px] font-black text-[#00a884] uppercase tracking-widest flex items-center gap-2 mb-4">
                                                            <Settings className="w-4 h-4 text-[#00a884]" />
                                                            Server Configuration Settings
                                                        </h4>
                                                        
                                                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                                                            {[
                                                                { id: 'ghostMode', label: 'Ghost Mode', desc: 'Read without triggering blue tick markers.' },
                                                                { id: 'antiDelete', label: 'Anti-Delete message', desc: 'Intercept and preserve messages deleted by other users.' },
                                                                { id: 'antiDeleteStatus', label: 'Anti-Delete stories Status', desc: 'Preserve statuses deleted by contacts.' },
                                                                { id: 'secretStatusView', label: 'Secret status View', desc: 'View status stories anonymously.' },
                                                                { id: 'hideNumbers', label: 'Ghost Numbers mode', desc: 'Obfuscate user phone details inside UI.' },
                                                                { id: 'hideBlueTicks', label: 'Hide blue ticks', desc: 'Never send read receipt tokens.' },
                                                                { id: 'dndMode', label: 'DND (Do Not Disturb)', desc: 'Mute and drop inbound message alerts.' },
                                                            ].map(item => (
                                                                <div key={item.id} className="p-4 bg-black/45 border border-white/[0.03] rounded-2xl flex flex-col justify-between gap-3.5">
                                                                    <div className="space-y-1">
                                                                        <span className="text-xs font-bold text-white block">{item.label}</span>
                                                                        <p className="text-[9.5px] text-white/40 leading-relaxed">{item.desc}</p>
                                                                    </div>
                                                                    <div className="flex items-center justify-between">
                                                                        <span className="text-[8px] font-bold font-mono uppercase tracking-wider text-white/30">Value:</span>
                                                                        <button
                                                                            onClick={() => handleSaveAppSettingField({ [item.id]: !appSettingsState[item.id] })}
                                                                            disabled={settingsSaving}
                                                                            className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider border transition-all ${
                                                                                appSettingsState[item.id] 
                                                                                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
                                                                                    : 'bg-red-500/10 border-red-500/20 text-red-500'
                                                                            }`}
                                                                        >
                                                                            {appSettingsState[item.id] ? 'Active / ON' : 'Offline / OFF'}
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    {/* Auto reply Rules manager block */}
                                                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                                                        
                                                        {/* Lists auto replies */}
                                                        <div className="lg:col-span-8 p-6 bg-[#111b21] rounded-2xl border border-white/5 space-y-4 text-left">
                                                            <h4 className="text-[10px] font-black text-[#00a884] uppercase tracking-widest flex items-center gap-1.5">
                                                                <RefreshCw className="w-4 h-4 text-[#00a884]" />
                                                                Dynamic Auto-Reply Rules
                                                            </h4>
                                                            {autoReplyRules.length > 0 ? (
                                                                <div className="space-y-2.5 max-h-[300px] overflow-y-auto custom-scrollbar font-mono text-xs pr-1">
                                                                    {autoReplyRules.map((rule, idx) => (
                                                                        <div key={idx} className="p-3 bg-black/45 border border-white/[0.03] rounded-xl flex items-center justify-between gap-4">
                                                                            <div className="space-y-1">
                                                                                <div>
                                                                                    <span className="text-white/40">Keyword:</span> <span className="text-emerald-400 font-bold">"{rule.keyword}"</span>
                                                                                </div>
                                                                                <div>
                                                                                    <span className="text-white/40">Response:</span> <span className="text-white">"{rule.response}"</span>
                                                                                </div>
                                                                            </div>
                                                                            <button
                                                                                onClick={() => handleToggleAutoReplyRule(rule.keyword)}
                                                                                className={`px-2 py-1 rounded text-[8.5px] uppercase font-black transition-all ${
                                                                                    rule.enabled 
                                                                                        ? 'bg-[#00a884]/15 hover:bg-[#00a884]/25 text-[#00a884]' 
                                                                                        : 'bg-white/5 hover:bg-white/10 text-white/50'
                                                                                }`}
                                                                            >
                                                                                {rule.enabled ? 'ENABLED' : 'DISABLED'}
                                                                            </button>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            ) : (
                                                                <p className="text-xs text-white/30 italic">No automated answer triggers stored.</p>
                                                            )}
                                                        </div>

                                                        {/* Create auto reply form */}
                                                        <div className="lg:col-span-4 p-6 bg-[#111b21] rounded-2xl border border-white/5 text-left">
                                                            <h4 className="text-[10px] font-black text-[#00a884] uppercase tracking-widest mb-4 block">New Rule Deployer</h4>
                                                            <form onSubmit={handleCreateAutoReplyRule} className="space-y-3.5">
                                                                <div className="space-y-1">
                                                                    <label className="text-[8px] uppercase tracking-wider text-white/40 font-bold block">Inbound Keyword</label>
                                                                    <input 
                                                                        type="text"
                                                                        value={newKeyword}
                                                                        onChange={e => setNewKeyword(e.target.value)}
                                                                        placeholder="e.g. hello"
                                                                        required
                                                                        className="w-full px-3 py-2 bg-[#202c33] border border-white/10 rounded-lg text-xs text-white placeholder-white/20"
                                                                    />
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <label className="text-[8px] uppercase tracking-wider text-white/40 font-bold block">Automated Outbound reply code</label>
                                                                    <textarea 
                                                                        rows={3}
                                                                        value={newReplyResponse}
                                                                        onChange={e => setNewReplyResponse(e.target.value)}
                                                                        placeholder="e.g. Thanks for connecting!"
                                                                        required
                                                                        className="w-full px-3 py-2 bg-[#202c33] border border-white/10 rounded-lg text-xs text-white placeholder-white/20 leading-relaxed font-mono"
                                                                    />
                                                                </div>
                                                                <button
                                                                    type="submit"
                                                                    className="w-full py-2 bg-[#00a884] hover:bg-[#00bc95] text-white text-[9px] uppercase tracking-widest font-black rounded-lg transition-all"
                                                                >
                                                                    Deploy Trigger Rule
                                                                </button>
                                                            </form>
                                                        </div>

                                                    </div>

                                                    {/* Scheduled Messages list section */}
                                                    <div className="p-6 bg-[#111b21] rounded-2xl border border-white/5 space-y-4 text-left">
                                                        <h4 className="text-[10px] font-black text-[#00a884] uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                                                            <Play className="w-3.5 h-3.5 text-[#00a884]" />
                                                            Active Scheduled Message Dispatch Queue
                                                        </h4>
                                                        {scheduledMessagesQueue.length > 0 ? (
                                                            <div className="space-y-2.5 font-mono text-xs max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
                                                                {scheduledMessagesQueue.map((m, idx) => (
                                                                    <div key={idx} className="p-3 bg-black/45 border border-white/[0.03] rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                                                        <div className="space-y-1">
                                                                            <div>
                                                                                <span className="text-white/40">Target Phone JID:</span> <span className="text-white font-bold">{m.jid || m.phoneNumber}</span>
                                                                            </div>
                                                                            <div>
                                                                                <span className="text-white/40">Text Packet:</span> <span className="text-[#00a884]">"{m.text}"</span>
                                                                            </div>
                                                                            <div className="text-[9px] text-white/30">Scheduled Delivery Target Time: {new Date(m.time).toLocaleString()}</div>
                                                                        </div>
                                                                        <span className={`text-[8px] font-bold px-2 py-0.5 rounded font-sans uppercase ${
                                                                            m.sent ? 'bg-green-500/10 text-green-500' : 'bg-amber-500/10 text-amber-500 animate-pulse'
                                                                        }`}>
                                                                            {m.sent ? 'DELIVERED' : 'PENDING'}
                                                                        </span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <p className="text-xs text-white/30 italic">No scheduled messages in current system memory queue.</p>
                                                        )}
                                                    </div>

                                                </div>
                                            )}

                                            {/* GLOBAL TAB 4: BACKUPS SYNC */}
                                            {activeTab === 'backup' && !queriedData && (
                                                <div id="tab-backup-panel" className="space-y-6 max-w-2xl mx-auto text-left">
                                                    
                                                    <div className="p-6 bg-[#111b21] border border-white/5 rounded-3xl space-y-6">
                                                        <div className="flex items-center gap-3">
                                                            <div className="p-2.5 bg-indigo-500/10 text-indigo-400 rounded-xl">
                                                                <Database className="w-6 h-6 animate-pulse" />
                                                            </div>
                                                            <div>
                                                                <h4 className="text-sm font-black text-white uppercase tracking-wider">Cloud Sync Backup Gateway</h4>
                                                                <p className="text-[10px] text-white/40">Automated Firebase Cloud Storage integrations and Manual override triggers.</p>
                                                            </div>
                                                        </div>

                                                        {/* Stats indicators */}
                                                        <div className="grid grid-cols-2 gap-4">
                                                            <div className="p-4 bg-black/40 border border-white/[0.02] rounded-2xl space-y-1">
                                                                <span className="text-[8px] text-white/40 uppercase font-bold block">Integrations Active</span>
                                                                <span className={firebaseCloudSystemEnabled ? "text-emerald-500 text-xs font-black font-mono uppercase" : "text-red-500 text-xs font-black font-mono uppercase"}>
                                                                    {firebaseCloudSystemEnabled ? "APPROVED LINK" : "DISCONNECTED"}
                                                                </span>
                                                            </div>
                                                            <div className="p-4 bg-black/40 border border-white/[0.02] rounded-2xl space-y-1">
                                                                <span className="text-[8px] text-white/40 uppercase font-bold block">Backup Schedule</span>
                                                                <span className={firebaseBackupEnabled ? "text-indigo-400 text-xs font-black font-mono uppercase" : "text-white/40 text-xs font-sans uppercase"}>
                                                                    {firebaseBackupEnabled ? "Active Automated Backup" : "Off"}
                                                                </span>
                                                            </div>
                                                        </div>

                                                        {/* Metadata cards */}
                                                        {backupMetadata ? (
                                                            <div className="p-4 bg-[#202c33]/30 border border-white/5 rounded-2xl leading-relaxed text-xs font-mono space-y-1.5 text-left">
                                                                <span className="text-[8px] font-black text-indigo-400 uppercase tracking-widest block font-sans mb-1">
                                                                    Last Backup Node Metadata
                                                                </span>
                                                                <div><span className="text-white/40">Synchronized Node Phone:</span> +{backupMetadata.phone || 'N/A'}</div>
                                                                <div><span className="text-white/40">Total Chats backed:</span> {backupMetadata.chatsCount || backupMetadata.chatCount || 0} chats</div>
                                                                <div><span className="text-white/40">Last Cloud Write Sync:</span> {backupMetadata.timestamp ? new Date(backupMetadata.timestamp).toLocaleString() : 'N/A'}</div>
                                                            </div>
                                                        ) : (
                                                            <p className="p-4 bg-black/45 border border-white/5 rounded-2xl text-[10px] text-white/40 italic font-mono text-center">
                                                                No prior backup indicators registered. A manual backup must be initiated below.
                                                            </p>
                                                        )}

                                                        <div className="pt-4 border-t border-white/5 space-y-3.5">
                                                            <p className="text-[10px] text-white/50 leading-relaxed italic">
                                                                Initiating a manual override backup forces the active server thread cache, state logs, contacts, user configuration matrices, and chat histories to compose a snapshot payload and deploy directly to Cloud Run / Firebase Firestore containers.
                                                            </p>
                                                            <button
                                                                onClick={handleTriggerCloudBackup}
                                                                disabled={backupLoading}
                                                                className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
                                                            >
                                                                {backupLoading ? (
                                                                    <>
                                                                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                                                        Deploying Snapshot Payload...
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <Database className="w-4 h-4 animate-bounce" />
                                                                        Trigger Manual Cloud Backup Snapshot
                                                                    </>
                                                                )}
                                                            </button>
                                                        </div>
                                                    </div>

                                                </div>
                                            )}

                                            {/* GLOBAL TAB 5: SECURITY AUDITS / LOGIN LOGS & ADMIN MANAGEMENT */}
                                            {activeTab === 'security' && !queriedData && (
                                                <div id="tab-security-panel" className="space-y-6">
                                                    
                                                    {/* Multi-Admin lists & Accounts creator split */}
                                                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                                                        
                                                        {/* Administrators listings panel */}
                                                        <div className="lg:col-span-7 p-6 bg-[#111b21] rounded-2xl border border-white/5 space-y-4 text-left">
                                                            <h4 className="text-[10px] font-black text-rose-500 uppercase tracking-widest flex items-center gap-2 font-mono">
                                                                <Layers className="w-4 h-4 text-rose-500" />
                                                                Platform Administrator Directory
                                                            </h4>
                                                            
                                                            <div className="space-y-2.5 max-h-[300px] overflow-y-auto custom-scrollbar font-mono text-xs pr-1">
                                                                {adminList.map((adm, index) => (
                                                                    <div key={index} className="p-3 bg-black/45 border border-white/[0.03] rounded-xl flex items-center justify-between gap-4 animate-fadeIn">
                                                                        <div className="space-y-0.5 select-all">
                                                                            <p className="text-white font-bold">{adm.email}</p>
                                                                            <p className="text-[9px] text-[#00a884] font-black uppercase">Role: {adm.role || 'operator'}</p>
                                                                            <p className="text-[8px] text-white/30">Deployed on: {new Date(adm.createdAt || Date.now()).toLocaleDateString()}</p>
                                                                        </div>
                                                                        {adm.email !== 'admin@pro.com' && adm.email !== adminEmail && (
                                                                            <button
                                                                                onClick={() => handleRevokeAdminAccess(adm.email)}
                                                                                className="p-1 px-2.5 hover:bg-red-500/15 text-red-500 hover:text-red-400 text-[8.5px] font-black uppercase rounded border border-red-500/10 cursor-pointer"
                                                                            >
                                                                                Revoke Access
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>

                                                        {/* Administrators deploying form */}
                                                        <div className="lg:col-span-5 p-6 bg-[#111b21] rounded-2xl border border-white/5 text-left space-y-4">
                                                            <h4 className="text-[10px] font-black text-[#00a884] uppercase tracking-widest flex items-center gap-1.5 font-mono">
                                                                <UserPlus className="w-4 h-4 text-[#00a884]" />
                                                                Register New Officer
                                                            </h4>
                                                            <form onSubmit={handleCreateNewAdminAccount} className="space-y-3">
                                                                <div className="space-y-1">
                                                                    <label className="text-[8px] uppercase tracking-wider text-white/40 font-bold block">Officer Email</label>
                                                                    <input 
                                                                        type="email"
                                                                        required
                                                                        value={newAdminEmail}
                                                                        onChange={e => setNewAdminEmail(e.target.value)}
                                                                        placeholder="e.g. officer@pro.com"
                                                                        className="w-full px-3 py-2 bg-[#202c33] border border-white/10 rounded-lg text-xs text-white"
                                                                    />
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <label className="text-[8px] uppercase tracking-wider text-white/40 font-bold block">Security Password</label>
                                                                    <input 
                                                                        type="password"
                                                                        required
                                                                        value={newAdminPassword}
                                                                        onChange={e => setNewAdminPassword(e.target.value)}
                                                                        placeholder="••••••••••••"
                                                                        className="w-full px-3 py-2 bg-[#202c33] border border-white/10 rounded-lg text-xs text-white placeholder-white/20"
                                                                    />
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <label className="text-[8px] uppercase tracking-wider text-white/40 font-bold block">Assigned Role</label>
                                                                    <select
                                                                        value={newAdminRole}
                                                                        onChange={e => setNewAdminRole(e.target.value)}
                                                                        className="w-full px-3 py-2 bg-[#202c33] border border-white/10 rounded-lg text-xs text-white"
                                                                    >
                                                                        <option value="admin">Platform Operator (Admin)</option>
                                                                        <option value="Super Admin">System Auditor (Super Admin)</option>
                                                                    </select>
                                                                </div>
                                                                
                                                                {adminCreationMsg && (
                                                                    <p className="p-2.5 bg-[#00a884]/10 text-[#00a884] rounded border border-[#00a884]/25 text-[9px] font-bold text-center leading-normal animate-pulse">
                                                                        {adminCreationMsg}
                                                                    </p>
                                                                )}
                                                                {adminCreationError && (
                                                                    <p className="p-2.5 bg-red-500/10 text-red-500 rounded border border-red-500/25 text-[9px] font-bold text-center leading-normal">
                                                                        {adminCreationError}
                                                                    </p>
                                                                )}

                                                                <button
                                                                    type="submit"
                                                                    className="w-full py-2 bg-[#00a884] hover:bg-[#00bc95] text-white text-[9px] font-black uppercase tracking-widest rounded-lg transition-all flex items-center justify-center gap-1 cursor-pointer"
                                                                >
                                                                    Deploy Operator
                                                                </button>
                                                            </form>
                                                        </div>

                                                    </div>

                                                    {/* UNAUTHORIZED NON-ADMIN LOGIN ATTEMPTS WARNING LOG */}
                                                    <div className="p-6 bg-[#111b21] rounded-2xl border border-red-500/10 space-y-4">
                                                        <div className="flex items-center justify-between border-b border-red-500/10 pb-3">
                                                            <h4 className="text-[10px] font-black text-red-500 uppercase tracking-widest flex items-center gap-2 font-mono">
                                                                <AlertOctagon className="w-4 h-4 text-red-500 animate-pulse" />
                                                                Unauthorized Sign-In Intrusions Logs (Failed Admin Login attempts)
                                                            </h4>
                                                            <span className="text-[8px] bg-red-500/10 text-red-500 font-bold px-2 py-0.5 rounded font-mono uppercase tracking-wider animate-pulse">
                                                                {loginAlertsAttempts.length} Threats Detetected
                                                            </span>
                                                        </div>

                                                        <div className="space-y-2 max-h-[250px] overflow-y-auto custom-scrollbar font-mono text-[10px] pr-2">
                                                            {loginAlertsAttempts.length > 0 ? (
                                                                loginAlertsAttempts.map((attempt, index) => (
                                                                    <div key={index} className="p-3 bg-red-950/5 border border-red-500/15 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-left leading-relaxed animate-fadeIn">
                                                                        <div className="space-y-1">
                                                                            <span className="text-[8px] bg-red-500/10 text-red-500 px-1.5 py-0.5 rounded uppercase font-black tracking-widest">THREAT BREACH RECOVERY</span>
                                                                            <div className="text-white mt-1">
                                                                                Attempted Username/Identity: <span className="text-white font-black underline">{attempt.email || attempt.phone || 'Unknown'}</span>
                                                                            </div>
                                                                            <p className="text-[9px] text-red-400">Violation Reason: "{attempt.message || attempt.reason || 'Invalid Auth token override'}"</p>
                                                                            <div className="text-[8px] text-white/30 font-sans">
                                                                                Source Target Agent: {attempt.userAgent || 'Chrome/Platform Browser'}
                                                                            </div>
                                                                        </div>
                                                                        <div className="text-right shrink-0">
                                                                            <p className="text-white font-bold text-xs">{attempt.ip || '127.0.0.1'}</p>
                                                                            <p className="text-white/30 text-[8px] mt-1">{new Date(attempt.timestamp).toLocaleString()}</p>
                                                                        </div>
                                                                    </div>
                                                                ))
                                                            ) : (
                                                                <div className="py-6 text-center text-white/30 italic text-[11px] space-y-1 flex flex-col items-center justify-center">
                                                                    <ShieldCheck className="w-8 h-8 text-green-500/30" />
                                                                    <p>System Zero-Threat: No failed login attempts reported.</p>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Historic Activity Auditing logs list */}
                                                    <div className="p-6 bg-[#111b21] rounded-2xl border border-white/5 space-y-4">
                                                        <h4 className="text-[10px] font-black text-[#00a884] uppercase tracking-widest flex items-center gap-2 font-mono">
                                                            <Terminal className="w-4 h-4 text-[#00a884]" />
                                                            Consolidated Security Audit Trails Log (Historic Logs)
                                                        </h4>
                                                        
                                                        <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar font-mono text-[9px] pr-2">
                                                            {securityAuditLogs.length > 0 ? (
                                                                securityAuditLogs.map((log, index) => (
                                                                    <div key={index} className="p-3 bg-black/45 border border-white/[0.02] rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-left leading-relaxed">
                                                                        <div className="space-y-0.5">
                                                                            <div>
                                                                                <span className="text-white/40">Officer email:</span> <span className="text-[#00a884] font-bold">{log.admin_email || log.email || 'SYSTEM'}</span>
                                                                            </div>
                                                                            <div>
                                                                                <span className="text-white/40">Action/Access:</span> <span className="text-white uppercase font-bold">{log.action || 'Unknown audit key'}</span>
                                                                            </div>
                                                                            <div>
                                                                                <span className="text-white/40">Device Target:</span> <span className="text-white/70">{log.target_phone || log.targetPhone || 'SYSTEM CENTRAL'}</span>
                                                                            </div>
                                                                            {log.userAgent && (
                                                                                <div className="text-[8px] text-white/20 font-sans truncate max-w-lg">Agent: {log.userAgent}</div>
                                                                            )}
                                                                        </div>
                                                                        <div className="text-right shrink-0">
                                                                            <p className="text-white/40">{log.ip_address || log.ip || '127.0.0.1'}</p>
                                                                            <p className="text-white/30 text-[8px] mt-0.5">{log.timestamp ? new Date(log.timestamp).toLocaleString() : 'Recent'}</p>
                                                                        </div>
                                                                    </div>
                                                                ))
                                                            ) : (
                                                                <p className="text-xs text-white/30 italic text-center py-6">No chronological audit traces recorded on DB node.</p>
                                                            )}
                                                        </div>
                                                    </div>

                                                </div>
                                            )}

                                            {/* BACKUP TARGET VIEW MODULE RENDERS (DECRYPTED NODE BACKUPS SELECTED FROM THE SEARCH BAR) */}
                                            {queriedData && (
                                                <>
                                                    {activeTab === 'settings' && (
                                                        <div id="tab-settings-view" className="space-y-4 animate-fadeIn">
                                                            <h4 className="text-[10px] font-black text-[#00a884] uppercase tracking-widest mb-4">Target Node Cloud Config Settings</h4>
                                                            {queriedData.settings ? (
                                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
                                                                    {Object.entries(queriedData.settings).map(([key, val]: [string, any]) => (
                                                                        <div key={key} className="p-4 bg-[#111b21] border border-white/5 rounded-2xl font-mono text-[11px] leading-relaxed">
                                                                            <span className="text-white/40 block text-[8px] uppercase tracking-wider mb-1.5 font-bold">{key}</span>
                                                                            <span className={typeof val === 'boolean' ? (val ? 'text-green-500 font-bold' : 'text-red-500 font-bold') : 'text-white'}>
                                                                                {JSON.stringify(val)}
                                                                            </span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            ) : (
                                                                <p className="text-xs text-white/30 italic text-left">No settings stored in this cloud node profile backup.</p>
                                                            )}
                                                        </div>
                                                    )}

                                                    {activeTab === 'chats' && (() => {
                                                        const targetChats = queriedData.chats || [];
                                                        return (
                                                            <div id="tab-chats-view" className="space-y-4 animate-fadeIn text-left">
                                                                <h4 className="text-[10px] font-black text-[#00a884] uppercase tracking-widest mb-2 font-mono">Decrypted Backed Conversations & Chats</h4>
                                                                
                                                                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                                                                    {/* Left Column: Chat list / contacts */}
                                                                    <div className="lg:col-span-4 p-5 bg-[#111b21] rounded-2xl border border-white/5 space-y-4 max-h-[520px] overflow-y-auto custom-scrollbar">
                                                                        <h5 className="text-[10px] font-black uppercase text-[#00a884] tracking-widest flex items-center gap-1.5 mb-2 items-center">
                                                                            <MessageSquare className="w-3.5 h-3.5 text-[#00a884]" />
                                                                            Backed Chat Threads ({targetChats.length})
                                                                        </h5>
                                                                        {targetChats.length > 0 ? (
                                                                            <div className="space-y-1.5 animate-fadeIn">
                                                                                {targetChats.map((c: any, index: number) => {
                                                                                    const chatIdStr = c.id || c.chatJid || c.jid || '';
                                                                                    return (
                                                                                        <button
                                                                                            key={index}
                                                                                            onClick={() => loadLiveChatHistory(chatIdStr)}
                                                                                            className={`w-full p-3 rounded-xl text-left flex flex-col font-mono text-[10px] border transition-all ${
                                                                                                selectedLiveJid === chatIdStr 
                                                                                                    ? 'bg-[#00a884]/15 border-[#00a884]/30 text-white font-bold' 
                                                                                                    : 'bg-black/20 border-transparent hover:bg-black/35 text-white/50 hover:text-white'
                                                                                            }`}
                                                                                        >
                                                                                            <span className="truncate block font-semibold text-white/95">{c.name || c.id || c.chatJid || c.jid}</span>
                                                                                            <span className="text-[8px] text-white/35 truncate block mt-0.5">{chatIdStr}</span>
                                                                                            {Number(c.unreadCount) > 0 && (
                                                                                                <span className="text-[8px] text-[#00a884] font-bold mt-1">Unread backlog: {c.unreadCount}</span>
                                                                                            )}
                                                                                        </button>
                                                                                    );
                                                                                })}
                                                                            </div>
                                                                        ) : (
                                                                            <p className="text-[10px] text-white/30 italic">No threads populated under this snapshot node backup.</p>
                                                                        )}
                                                                    </div>

                                                                    {/* Right Column: Dynamic Messages History for selected chat */}
                                                                    <div className="lg:col-span-8 p-5 bg-[#111b21] rounded-2xl border border-white/5 min-h-[350px] max-h-[520px] flex flex-col overflow-hidden">
                                                                        <h5 className="text-[10px] font-black uppercase text-[#00a884] tracking-widest flex items-center gap-1.5 mb-3 shrink-0 font-mono">
                                                                            <Eye className="w-3.5 h-3.5 text-[#00a884]" />
                                                                            Backed Conversation Logs: {selectedLiveJid || 'Select Chat Thread'}
                                                                        </h5>
                                                                        
                                                                        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-1">
                                                                            {liveMessagesLoading ? (
                                                                                <div className="h-full flex items-center justify-center italic text-[10px] text-white/30 font-mono">
                                                                                    Parsing backed conversation messages...
                                                                                </div>
                                                                            ) : selectedLiveChatHistory.length > 0 ? (
                                                                                <div className="space-y-3 animate-fadeIn text-left">
                                                                                    {selectedLiveChatHistory.map((m: any, idx: number) => (
                                                                                        <div key={idx} className="p-3 bg-black/45 hover:bg-black/60 rounded-xl space-y-2 border border-white/[0.02] text-left">
                                                                                            <div className="flex justify-between items-center text-[7.5px] font-mono text-white/40 border-b border-white/[0.04] pb-1">
                                                                                                <span>Msg Key ID: {m.key?.id || m.id}</span>
                                                                                                <span className={(m.key?.fromMe || m.fromMe) ? 'text-[#00a884] font-black' : 'text-blue-400 font-black'}>
                                                                                                    {(m.key?.fromMe || m.fromMe) ? 'OUTGOING' : 'INBOUND'}
                                                                                                </span>
                                                                                            </div>
                                                                                            <p className="text-xs font-mono text-white leading-relaxed">
                                                                                                {m.message?.conversation || m.text || (m.message ? JSON.stringify(m.message) : 'Null Payload')}
                                                                                            </p>
                                                                                            <div className="flex justify-between text-[7px] text-white/35 font-mono">
                                                                                                <span>Sender: {m.chatJid || selectedLiveJid}</span>
                                                                                                <span>{m.timestamp ? new Date(m.timestamp * 1000).toLocaleString() : 'N/A'}</span>
                                                                                            </div>
                                                                                        </div>
                                                                                    ))}
                                                                                </div>
                                                                            ) : (
                                                                                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-white/30 space-y-2 h-[280px]">
                                                                                    <Terminal className="w-8 h-8 text-white/10" />
                                                                                    <span className="text-[10px] font-black uppercase tracking-wider block font-mono">Standby</span>
                                                                                    <p className="text-[8.5px] max-w-xs leading-relaxed italic">Click any backed conversation thread on the left to read its complete chat log history decrypted and pulled from this secure backup container.</p>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    })()}

                                                    {activeTab === 'messages' && (
                                                        <div id="tab-messages-view" className="space-y-4 animate-fadeIn text-left">
                                                            <h4 className="text-[10px] font-black text-[#00a884] uppercase tracking-widest mb-4">Chronological Encrypted Message Signal Logs</h4>
                                                            {queriedData.messages?.length > 0 ? (
                                                                queriedData.messages.map((m: any, idx: number) => {
                                                                    const serialized = typeof m.message === 'object' ? JSON.stringify(m.message) : '';
                                                                    const isImage = m.message?.imageMessage || m.text?.includes("📷 Image") || serialized.includes("imageMessage");
                                                                    const isVideo = m.message?.videoMessage || m.text?.includes("🎥 Video") || serialized.includes("videoMessage");
                                                                    const isAudio = m.message?.audioMessage || m.text?.includes("🎵 Audio") || serialized.includes("audioMessage") || m.text?.includes("Sonic Signal");
                                                                    
                                                                    return (
                                                                        <div key={idx} className="p-5 bg-[#111b21] border border-white/5 rounded-2xl space-y-3 font-mono">
                                                                            <div className="flex justify-between text-[8px] text-white/40 pb-2 border-b border-white/5">
                                                                                <span>Message UUID: {m.key?.id}</span>
                                                                                <span className={m.key?.fromMe ? 'text-[#00a884] font-bold' : 'text-blue-400 font-bold'}>
                                                                                    {m.key?.fromMe ? 'OUTBOUND' : 'INBOUND'}
                                                                                </span>
                                                                            </div>
                                                                            <p className="text-xs text-white bg-[#202c33]/20 p-4 rounded-xl leading-relaxed whitespace-pre-wrap">
                                                                                {m.message?.conversation || m.text || JSON.stringify(m.message || {})}
                                                                            </p>

                                                                            {/* format specific downloads */}
                                                                            {isImage && (
                                                                                <div className="p-3 bg-[#202c33]/40 border border-[#00a884]/20 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-left">
                                                                                    <span className="text-[10px] text-white/70 font-bold font-sans">📷 JPG/PNG Image Payload</span>
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
                                                                                    <span className="text-[10px] text-white/70 font-bold font-sans">🎥 MP4 Video Payload</span>
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
                                                                                    <span className="text-[10px] text-white/70 font-bold font-sans">🎙️ Audio Voice Signal</span>
                                                                                    <button
                                                                                        onClick={() => downloadAdminMediaWithFormat(m.key?.id || m.id, m.chatJid || queriedData.phone, 'mp3')}
                                                                                        className="px-3 py-1 bg-[#00a884]/20 hover:bg-[#00a884]/30 text-[#00a884] rounded-lg font-black text-[9px] uppercase tracking-widest cursor-pointer flex items-center gap-1.5"
                                                                                    >
                                                                                        <Download className="w-3.5 h-3.5" /> Download MP3
                                                                                    </button>
                                                                                </div>
                                                                            )}

                                                                            <div className="flex justify-between items-center text-[8px] text-white/30">
                                                                                <span>JID: {m.chatJid || queriedData.phone + '@s.whatsapp.net'}</span>
                                                                                <span>{m.timestamp ? new Date(m.timestamp * 1000).toLocaleString() : 'N/A'}</span>
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })
                                                            ) : (
                                                                <p className="text-xs text-white/30 italic">No packet logs registered on this backup node.</p>
                                                            )}
                                                        </div>
                                                    )}

                                                    {activeTab === 'calls' && (
                                                        <div id="tab-calls-view" className="space-y-3 animate-fadeIn text-left font-mono">
                                                            <h4 className="text-[10px] font-black text-[#00a884] uppercase tracking-widest mb-4">Intercepted Call Registry Traces</h4>
                                                            {queriedData.calls?.length > 0 ? (
                                                                queriedData.calls.map((c: any, idx: number) => {
                                                                    const hasRecording = c.recording_url || c.id;
                                                                    const recUrl = c.recording_url || `/api/recordings/${c.id || 'sim_' + idx}`;
                                                                    
                                                                    return (
                                                                        <div key={idx} className="p-4 bg-[#111b21] border border-white/5 rounded-2xl flex flex-col gap-3">
                                                                            <div className="flex justify-between items-center">
                                                                                <div>
                                                                                    <p className="text-xs font-bold text-white uppercase">{c.type || 'Voice'} Stream Intercept</p>
                                                                                    <p className="text-[9.5px] text-white/40 mt-1">Settled status: {c.status || 'Success'}</p>
                                                                                </div>
                                                                                <div className="text-right text-[10px]">
                                                                                    <p className="text-[#00a884] font-bold">Duration: {c.duration || 0} seconds</p>
                                                                                    <p className="text-[8px] text-white/30 mt-1">
                                                                                        {c.timestamp ? new Date(c.timestamp).toLocaleString() : 'N/A'}
                                                                                    </p>
                                                                                </div>
                                                                            </div>
                                                                            
                                                                            {hasRecording && (
                                                                                <div className="pt-2 border-t border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#202c33]/20 p-2.5 rounded-xl">
                                                                                    <div className="flex items-center gap-2">
                                                                                        <span className="text-[8px] font-black text-rose-500 uppercase tracking-widest flex items-center gap-1 font-sans">
                                                                                            🎙️ Audio Cache
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
                                                                                    Download Call
                                                                                    </a>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    );
                                                                })
                                                            ) : (
                                                                <p className="text-xs text-white/30 italic">No call intercept hashes loaded.</p>
                                                            )}
                                                        </div>
                                                    )}

                                                    {activeTab === 'status' && (
                                                        <div id="tab-status-view" className="space-y-4 animate-fadeIn text-left">
                                                            <h4 className="text-[10px] font-black text-[#00a884] uppercase tracking-widest mb-4">Transient Contact Stories (Statuses)</h4>
                                                            {queriedData.status?.length > 0 ? (
                                                                queriedData.status.map((s: any, idx: number) => (
                                                                    <div key={idx} className="p-5 bg-[#111b21] border border-white/5 rounded-2xl space-y-3 font-mono leading-relaxed">
                                                                        <div className="flex justify-between text-[8px] text-white/40 pb-2 border-b border-white/5">
                                                                            <span>Author Pushname: {s.pushName || 'WhatsApp Contact'}</span>
                                                                            <span>Sync: {s.timestamp ? new Date(s.timestamp * 1000).toLocaleString() : 'N/A'}</span>
                                                                        </div>
                                                                        <p className="text-xs text-white bg-black/25 p-4 rounded-xl leading-relaxed italic border border-white/[0.02]">
                                                                            "{s.message?.conversation || 'Status media attachment container'}"
                                                                        </p>
                                                                    </div>
                                                                ))
                                                            ) : (
                                                                <p className="text-xs text-white/30 italic">No transient status items cloned on backup state.</p>
                                                            )}
                                                        </div>
                                                    )}

                                                    {activeTab === 'groups' && (
                                                        <div id="tab-groups-view" className="space-y-3 animate-fadeIn text-left font-mono">
                                                            <h4 className="text-[10px] font-black text-[#00a884] uppercase tracking-widest mb-4">Encrypted Group Conversations Backlog</h4>
                                                            {queriedData.groups?.length > 0 ? (
                                                                queriedData.groups.map((g: any, idx: number) => (
                                                                    <div key={idx} className="p-4 bg-[#111b21] border border-white/5 rounded-2xl flex justify-between items-center">
                                                                        <div>
                                                                            <p className="text-xs font-bold text-white">{g.id}</p>
                                                                            <p className="text-[10px] text-white/40 mt-1">Group Title: {g.name || 'Encrypted Server Members Group'}</p>
                                                                        </div>
                                                                        <span className="text-[9px] font-bold text-[#00a884] bg-[#00a884]/5 px-2.5 py-1 rounded-xl">Unreads backlog: {g.unreadCount || 0}</span>
                                                                    </div>
                                                                ))
                                                            ) : (
                                                                <p className="text-xs text-white/30 italic">No group chats cached.</p>
                                                            )}
                                                        </div>
                                                    )}
                                                </>
                                            )}

                                        </>
                                    )}

                                </div>

                            </div>
                        ) : (
                            <div id="admin-detail-empty" className="flex-1 flex flex-col items-center justify-center text-center opacity-30 space-y-3">
                                <ShieldAlert className="w-16 h-16 text-[#00a884] animate-pulse" />
                                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-white">Console Secure Uplink Active</h3>
                                <p className="text-[10px] max-w-sm text-white/60 leading-relaxed font-sans mt-1">
                                    Lookup and examine secure encrypted data records from target system nodes. All accesses are persistently audited and certified in accordance with requirements.
                                </p>
                            </div>
                        )}
                        
                    </div>

                </div>

            </div>
        </div>
    );
};
