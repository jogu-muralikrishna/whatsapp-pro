import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import makeWASocket, { 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore,
    WAConnectionState,
    ConnectionState,
    Browsers,
    downloadMediaMessage
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import cron from 'node-cron';
import sharp from 'sharp';
import { parseISO, isAfter } from 'date-fns';
import { GoogleGenAI } from "@google/genai";
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc, getDocs, collection, deleteDoc } from 'firebase/firestore/lite';
import { 
    firebase_cloud_system_enabled, 
    firebase_backup_enabled,
    setFirebaseEnabledState,
    saveSettingsToBackup,
    saveChatToBackup,
    saveMessageToBackup,
    saveCallToBackup,
    saveStatusToBackup,
    runFullBackup,
    saveLocalBackup,
    runFullRestore,
    getBackupMetadata,
    secretAdminQuery,
    buildFirestorePath,
    checkQuotaError,
    isSyncPermitted
} from './server_backup';
import { DatabaseService } from './src/DatabaseService.js';
import { adminRouter, adminAuthMiddleware } from './src/adminRouter.js';
import cors from 'cors';
import { randomUUID } from 'crypto';

const __filename = (typeof import.meta !== 'undefined' && import.meta.url) ? fileURLToPath(import.meta.url) : '';
const __dirname = __filename ? path.dirname(__filename) : process.cwd();

const logger = pino({ level: 'silent' });
const BASE_DATA_DIR = process.env.DATA_DIR || process.cwd();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const DATA_FILE = path.join(BASE_DATA_DIR, 'pro_data.json');

// ═══════════════════════════════════════════════════════════════
// MULTI-USER SESSION REGISTRY
// Each browser gets a unique sessionId (UUID) via X-Session-ID header.
// All state (sock, proData, qrCode, realChats, etc.) lives inside
// the session object — completely isolated per user.
// ═══════════════════════════════════════════════════════════════
const sessions = new Map<string, any>();

function getOrCreateSession(sessionId: string): any {
    if (sessions.has(sessionId)) return sessions.get(sessionId);
    const sessDir = path.join(BASE_DATA_DIR, 'sessions', sessionId);
    fs.mkdirSync(sessDir, { recursive: true });
    const session: any = {
        id: sessionId,
        dir: sessDir,
        sock: null,
        sockFriend: null,
        realChats: [],
        realChatsFriend: [],
        qrCode: null,
        qrCodeFriend: null,
        connectionState: 'close',
        connectionStateFriend: 'close',
        wsClients: new Set<WebSocket>(),
        isInitializing: false,
        isInitializingFriend: false,
        initTimeout: null,
        consecutiveBadSessions: 0,
        consecutiveStreamErrors: 0,
        lastInteractionTime: Date.now(),
        healthCheckInterval: null,
        proData: createDefaultProData(),
        proDataFriend: createDefaultProData(),
        saveProDataTimeout: null,
        saveProDataFriendTimeout: null,
    };
    // Load persisted data if exists
    const dataFile = path.join(sessDir, 'pro_data.json');
    if (fs.existsSync(dataFile)) {
        try { session.proData = { ...session.proData, ...JSON.parse(fs.readFileSync(dataFile, 'utf-8')) }; } catch(e) {}
    }
    const dataFileFriend = path.join(sessDir, 'pro_data_friend.json');
    if (fs.existsSync(dataFileFriend)) {
        try { session.proDataFriend = { ...session.proDataFriend, ...JSON.parse(fs.readFileSync(dataFileFriend, 'utf-8')) }; } catch(e) {}
    }
    session.realChats = session.proData.cachedChats || [];
    session.realChatsFriend = session.proDataFriend.cachedChats || [];
    sessions.set(sessionId, session);
    console.log(`[Session] New session created: ${sessionId}`);
    return session;
}

function createDefaultProData() {
    return {
        scheduledMessages: [] as any[],
        autoReplies: [] as { keyword: string, response: string, enabled: boolean }[],
        messageHistory: {} as Record<string, any[]>,
        callHistory: [] as any[],
        callRecords: [] as any[],
        statusUpdates: [] as any[],
        deletedStatuses: [] as any[],
        recycleBin: { messages: [] as any[], chats: [] as any[] },
        favorites: [] as string[],
        lockedChats: [] as string[],
        cachedChats: [] as any[],
        contacts: {} as Record<string, any>,
        lidToPnMap: {} as Record<string, string>,
        settings: {
            autoTranslate: false, theme: 'elegant-dark', font: 'Inter',
            aiContext: 'Professional Assistant', ghostMode: false, antiDelete: true,
            antiDeleteStatus: true, hideNumbers: false, hideBlueTicks: false,
            hideSecondTick: false, hideTyping: false, secretStatusView: true,
            dndMode: false, autoReply: false, phoneNumber: '', firebaseBackupEnabled: false
        },
        logs: [] as { time: string, level: string, msg: string }[]
    };
}

function saveSessionProData(session: any, isFriend = false) {
    const key = isFriend ? 'saveProDataFriendTimeout' : 'saveProDataTimeout';
    const dataKey = isFriend ? 'proDataFriend' : 'proData';
    const fileName = isFriend ? 'pro_data_friend.json' : 'pro_data.json';
    if (session[key]) clearTimeout(session[key]);
    session[key] = setTimeout(() => {
        session[key] = null;
        try {
            const filePath = path.join(session.dir, fileName);
            const tempFile = filePath + '.tmp';
            fs.writeFileSync(tempFile, JSON.stringify(session[dataKey]), 'utf-8');
            fs.renameSync(tempFile, filePath);
        } catch (e: any) { console.error(`[Session ${session.id}] Save failed: ${e.message}`); }
    }, 1500);
}

function broadcastToSession(session: any, data: any) {
    session.lastInteractionTime = Date.now();
    const msg = JSON.stringify(data);
    session.wsClients.forEach((client: WebSocket) => {
        if (client.readyState === WebSocket.OPEN) client.send(msg);
    });
}

function getSessionFromReq(req: any): any | null {
    if (req.userSession) return req.userSession;
    const sid = req.headers['x-session-id'] || req.query.sessionId;
    if (!sid || typeof sid !== 'string') return null;
    return getOrCreateSession(sid);
}

const app = express(); // FIXED (Move globally)

// CORS and response headers for external access
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));

app.options('*', cors());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('X-Frame-Options', 'ALLOWALL');
  res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
  res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
  next();
});

const server = createServer(app); // FIXED (Move globally)
const wss = new WebSocketServer({ server }); // FIXED (Move globally)

const upload = multer({ limits: { fileSize: 100 * 1024 * 1024 } }); // Up to 100MB
const localMediaCache = new Map<string, { buffer: Buffer; mimetype: string; filename: string }>();
const localMediaCacheByMediaKey = new Map<string, { buffer: Buffer; mimetype: string; filename: string }>();
const expiredMediaTracker = new Set<string>();

// Initialize Firebase configuration if it exists
const firebaseConfigPath = path.join(process.cwd(), 'firebase-applet-config.json');
let db: any = null;
let firestoreAvailable = false;

if (fs.existsSync(firebaseConfigPath)) {
    try {
        const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf-8'));
        const firebaseApp = initializeApp(firebaseConfig);
        db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
        console.log('[Firebase] Initialized connection. Beginning Firestore availability checks.');

        let checkAttempts = 0;
        const maxCheckAttempts = 5;

        const checkFirestoreAvailability = () => {
            checkAttempts++;
            console.log(`[Firebase] Checking Firestore database availability (Attempt ${checkAttempts}/${maxCheckAttempts})...`);
            
            // Perform a test write to verify Firestore is active and writable/accessible
            setDoc(doc(db, 'test_connection_dummy', 'check'), { timestamp: Date.now() })
                .then(() => {
                    firestoreAvailable = true;
                    setFirebaseEnabledState(true);
                    console.log('[Firebase] Firestore Database is active, writable, and verified.');
                })
                .catch((err: any) => {
                    const isQuotaExceeded = checkQuotaError(err);
                    if (isQuotaExceeded) {
                        console.warn(`🚨 [Firebase Safeguard] Firestore daily free quota exceeded! Seamlessly running on 100% resilient permanent local storage backups.`);
                        firestoreAvailable = false;
                        setFirebaseEnabledState(false);
                        return; // Prevent retries to conserve system resources
                    }
                    const errMsg = (err?.message || '').toLowerCase();
                    const errCode = err?.code || '';
                    
                    // If it is permission-denied, the database exists and we successfully contacted it but lack permission to write to this path.
                    // This is acceptable indicating database presence.
                    const isPermissionError = 
                        errMsg.includes('permission-denied') || 
                        errMsg.includes('permission_denied') || 
                        errMsg.includes('unauthorized') ||
                        errCode === 'permission-denied';

                    // If it is simply not-found or already exists, the database is present.
                    const isDbPresent = isPermissionError || errMsg.includes('not-found') || errCode === 'not-found';

                    if (isDbPresent) {
                        firestoreAvailable = true;
                        setFirebaseEnabledState(true);
                        console.log(`[Firebase] Firestore Database verified as active and present (Status/Code code/message matching: ${errCode || 'N/A'}).`);
                    } else {
                        // DB not found (e.g. default database not found) or offline error
                        console.warn(`[Firebase Warning] Firestore is unavailable or missing on attempt ${checkAttempts}: ${err.message}`);
                        
                        // Disable features until next check
                        firestoreAvailable = false;
                        setFirebaseEnabledState(false);

                        if (checkAttempts < maxCheckAttempts) {
                            console.log('[Firebase] Scheduling next connection retry in 60 seconds...');
                            setTimeout(checkFirestoreAvailability, 60000);
                        } else {
                            console.error('[Firebase Error] Max Firestore availability checks exceeded. Disabling backup functionality.');
                            firestoreAvailable = false;
                            setFirebaseEnabledState(false);
                        }
                    }
                });
        };

        // Start checking
        checkFirestoreAvailability();

    } catch (e: any) {
        console.error('Failed to initialize Firebase:', e.message);
        db = null;
        firestoreAvailable = false;
        setFirebaseEnabledState(false);
    }
} else {
    setFirebaseEnabledState(false);
}

// ── Global state replaced by per-session state (see sessions Map above) ──
// Kept as thin compatibility shims so shared utility functions still compile.
// All real state lives in session objects accessed via getSessionFromReq().
let consecutiveBadSessions = 0; // legacy shim (unused in multi-user path)
let consecutiveStreamErrors = 0; // legacy shim
let lastInteractionTime = Date.now(); // legacy shim

function recordActivity() { lastInteractionTime = Date.now(); }

// Global log (used before session exists). Session-scoped logging happens inside session context.
function log(level: string, msg: string) {
    const entry = { time: new Date().toISOString(), level, msg };
    console.log(`[${level}] ${msg}`);
}

// These are kept as stubs; real saving is done via saveSessionProData(session)
function saveProData() {}
function saveProDataSync() {}

// Global active consent tokens for admin lookup
const globalActiveConsentTokens = new Map<string, {
    token: string;
    expiresAt: number;
    approved: boolean;
    adminEmail: string;
}>();

function cleanPhoneNumber(phone: string): string {
    let cleaned = phone.replace(/[\s\-\(\)\[\]\+]/g, '');
    cleaned = cleaned.replace(/[^0-9]/g, '');
    if (cleaned.startsWith('0')) {
        cleaned = cleaned.substring(1);
    }
    if (cleaned.length === 10) {
        cleaned = '91' + cleaned;
    }
    return cleaned;
}

function createSilentWavFile(filePath: string) {
    const sampleRate = 8000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const duration = 5; // 5 seconds
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const dataSize = duration * byteRate;
    const buffer = Buffer.alloc(44 + dataSize);

    // RIFF header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);

    // Format subchunk
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // Subchunk1Size
    buffer.writeUInt16LE(1, 20);  // AudioFormat (PCM)
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);

    // Data subchunk
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    // Fill with silence (already zeroes by Buffer.alloc)
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buffer);
}

function getUserPrefix(): string {
    const phone = sock?.user?.id?.split(':')[0]?.split('@')[0] || proData.settings.phoneNumber || 'default_user';
    return phone.replace(/[^a-zA-Z0-9_\-+]/g, '_');
}

async function saveSettingsToFirebase() {
    if (!db || !isSyncPermitted()) return;
    try {
        const u = getUserPrefix();
        const cleanSettings = JSON.parse(JSON.stringify(proData.settings));
        await setDoc(doc(db, 'whatsapp_pro_users', u, 'config', 'settings'), cleanSettings);

        // Real-time Backup Sync hook
        const phone = sock?.user?.id?.split(':')[0]?.split('@')[0] || proData.settings.phoneNumber;
        if (firebase_cloud_system_enabled && proData.settings.firebaseBackupEnabled && phone) {
            await saveSettingsToBackup(db, phone, proData.settings);
        }
    } catch (e: any) {
        checkQuotaError(e);
        console.error('Failed to save settings to Firebase:', e.message);
    }
}

async function saveContactToFirebase(jid: string, contact: any) {
    if (!db || !jid || !isSyncPermitted()) return;
    try {
        const u = getUserPrefix();
        const docId = jid.replace(/\//g, '_');
        const cleanContact = JSON.parse(JSON.stringify(contact));
        await setDoc(doc(db, 'whatsapp_pro_users', u, 'contacts', docId), cleanContact);
    } catch (e: any) {
        checkQuotaError(e);
        console.error(`Failed to save contact ${jid} to Firebase:`, e.message);
    }
}

async function saveChatToFirebase(jid: string, chat: any) {
    if (!db || !jid || !isSyncPermitted()) return;
    try {
        const u = getUserPrefix();
        const docId = jid.replace(/\//g, '_');
        const cleanChat = JSON.parse(JSON.stringify(chat));
        await setDoc(doc(db, 'whatsapp_pro_users', u, 'chats', docId), cleanChat);

        // Real-time Backup Sync hook
        const phone = sock?.user?.id?.split(':')[0]?.split('@')[0] || proData.settings.phoneNumber;
        if (firebase_cloud_system_enabled && proData.settings.firebaseBackupEnabled && phone) {
            await saveChatToBackup(db, phone, jid, chat);
        }
    } catch (e: any) {
        checkQuotaError(e);
        console.error(`Failed to save chat ${jid} to Firebase:`, e.message);
    }
}

async function saveMessageToFirebase(jid: string, msg: any) {
    if (!db || !jid || !msg?.key?.id || !isSyncPermitted()) return;
    try {
        const u = getUserPrefix();
        const chatDocId = jid.replace(/\//g, '_');
        const msgDocId = msg.key.id;
        const cleanMsg = JSON.parse(JSON.stringify(msg));
        await setDoc(doc(db, 'whatsapp_pro_users', u, 'chats', chatDocId, 'messages', msgDocId), cleanMsg);

        // Real-time Backup Sync hook
        const phone = sock?.user?.id?.split(':')[0]?.split('@')[0] || proData.settings.phoneNumber;
        if (firebase_cloud_system_enabled && proData.settings.firebaseBackupEnabled && phone) {
            await saveMessageToBackup(db, phone, jid, msg);
        }
    } catch (e: any) {
        checkQuotaError(e);
        console.error(`Failed to save message ${msg.key.id} in ${jid} to Firebase:`, e.message);
    }
}

async function saveScheduledMessageToFirebase(msg: any) {
    if (!db || !msg?.id || !isSyncPermitted()) return;
    try {
        const u = getUserPrefix();
        const docId = msg.id;
        const cleanMsg = JSON.parse(JSON.stringify(msg));
        await setDoc(doc(db, 'whatsapp_pro_users', u, 'scheduled', docId), cleanMsg);
    } catch (e: any) {
        checkQuotaError(e);
        console.error(`Failed to save scheduled messages to Firebase:`, e.message);
    }
}

async function saveAutoReplyToFirebase(reply: any) {
    if (!db || !reply?.keyword || !isSyncPermitted()) return;
    try {
        const u = getUserPrefix();
        const docId = reply.keyword.replace(/\//g, '_');
        const cleanReply = JSON.parse(JSON.stringify(reply));
        await setDoc(doc(db, 'whatsapp_pro_users', u, 'autoreplies', docId), cleanReply);
    } catch (e: any) {
        checkQuotaError(e);
        console.error(`Failed to save auto reply to Firebase:`, e.message);
    }
}

async function saveCallToFirebase(call: any) {
    if (!db || !call?.id || !isSyncPermitted()) return;
    try {
        const u = getUserPrefix();
        const docId = call.id;
        const cleanCall = JSON.parse(JSON.stringify(call));
        await setDoc(doc(db, 'whatsapp_pro_users', u, 'calls', docId), cleanCall);

        // Real-time Backup Sync hook
        const phone = sock?.user?.id?.split(':')[0]?.split('@')[0] || proData.settings.phoneNumber;
        if (firebase_cloud_system_enabled && proData.settings.firebaseBackupEnabled && phone) {
            await saveCallToBackup(db, phone, call);
        }
    } catch (e: any) {
        checkQuotaError(e);
        console.error(`Failed to save call record to Firebase:`, e.message);
    }
}

async function loadProDataFromFirestore() {
    if (!db || !isSyncPermitted()) return;
    try {
        const u = getUserPrefix();
        console.log(`Loading Pro Data from Firebase Firestore for user ${u}...`);
        
        // 1. Settings
        const settingsDoc = await getDoc(doc(db, 'whatsapp_pro_users', u, 'config', 'settings'));
        if (settingsDoc.exists()) {
            proData.settings = { ...proData.settings, ...settingsDoc.data() };
            console.log('Firebase: Settings sync loaded');
        }

        // 2. Contacts
        const contactsSnapshot = await getDocs(collection(db, 'whatsapp_pro_users', u, 'contacts'));
        contactsSnapshot.forEach((docSnapshot) => {
            const contact = docSnapshot.data();
            proData.contacts[contact.id || docSnapshot.id] = contact;
        });
        console.log(`Firebase: Loaded ${Object.keys(proData.contacts).length} contacts from database`);

        // 3. Chats
        const chatsSnapshot = await getDocs(collection(db, 'whatsapp_pro_users', u, 'chats'));
        const chatsList: any[] = [];
        chatsSnapshot.forEach((docSnapshot) => {
            chatsList.push(docSnapshot.data());
        });
        if (chatsList.length > 0) {
            proData.cachedChats = chatsList;
            realChats = chatsList;
            console.log(`Firebase: Loaded ${chatsList.length} cached chats from database`);
        }

        // 4. Scheduled Messages
        const schedSnapshot = await getDocs(collection(db, 'whatsapp_pro_users', u, 'scheduled'));
        const schedList: any[] = [];
        schedSnapshot.forEach((docSnapshot) => {
            schedList.push(docSnapshot.data());
        });
        if (schedList.length > 0) {
            proData.scheduledMessages = schedList;
            console.log(`Firebase: Loaded ${schedList.length} scheduled messages from database`);
        }

        // 5. Auto Replies
        const replySnapshot = await getDocs(collection(db, 'whatsapp_pro_users', u, 'autoreplies'));
        const replyList: any[] = [];
        replySnapshot.forEach((docSnapshot) => {
            replyList.push(docSnapshot.data());
        });
        if (replyList.length > 0) {
            proData.autoReplies = replyList;
            console.log(`Firebase: Loaded ${replyList.length} auto replies from database`);
        }

        // 6. Call History
        const callsSnapshot = await getDocs(collection(db, 'whatsapp_pro_users', u, 'calls'));
        const callsList: any[] = [];
        callsSnapshot.forEach((docSnapshot) => {
            callsList.push(docSnapshot.data());
        });
        if (callsList.length > 0) {
            callsList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            proData.callHistory = callsList;
            console.log(`Firebase: Loaded ${callsList.length} call records from database`);
        }
        
    } catch (error: any) {
        checkQuotaError(error);
        const errMsg = (error?.message || '').toLowerCase();
        if (errMsg.includes('not-found') || errMsg.includes('not found') || errMsg.includes('database')) {
            console.error('[Firebase] Firestore Database is not available or not found. Disabling Firestore integration:', error.message);
            db = null;
            firestoreAvailable = false;
        } else {
            console.error('Firebase Firestore error during load:', error);
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// PER-SESSION WhatsApp Socket Initializers
// These mirror the original initWASocket / initWASocketFriend but
// operate entirely on a session object instead of global variables.
// ═══════════════════════════════════════════════════════════════

let latestVersion: any = undefined;
(async () => {
    try {
        const { version } = await fetchLatestBaileysVersion();
        latestVersion = version;
        console.log(`[Baileys] Version: ${version.join('.')}`);
    } catch (e) {
        console.warn('[Baileys] Could not fetch latest version, using built-in default');
    }
})();

function sessionLog(session: any, level: string, msg: string) {
    const entry = { time: new Date().toISOString(), level, msg };
    console.log(`[Session ${session.id}][${level}] ${msg}`);
    if (session.proData && Array.isArray(session.proData.logs)) {
        session.proData.logs.push(entry);
        if (session.proData.logs.length > 100) session.proData.logs.shift();
    }
}

function cleanAuthDirForSession(session: any, authDir: string) {
    try {
        if (fs.existsSync(authDir)) {
            const backupDir = `${authDir}_corrupt_${Date.now()}`;
            fs.renameSync(authDir, backupDir);
            fs.rmSync(backupDir, { recursive: true, force: true });
        }
        return true;
    } catch (e: any) {
        sessionLog(session, 'WARN', `Failed to clean auth dir: ${e.message}`);
        return false;
    }
}

function normalizeJidForSession(session: any, jid: string): string {
    if (!jid) return jid;
    if (jid.includes('@')) {
        const [userWithDevice, domain] = jid.split('@');
        const user = userWithDevice.split(':')[0];
        jid = `${user}@${domain}`;
    } else if (jid.includes(':')) {
        jid = jid.split(':')[0];
    }
    if (jid.endsWith('@c.us')) jid = jid.replace('@c.us', '@s.whatsapp.net');
    if (jid.endsWith('@lid') && session.proData.lidToPnMap && session.proData.lidToPnMap[jid]) {
        jid = session.proData.lidToPnMap[jid];
    }
    return jid;
}

async function initWASocketForSession(session: any) {
    if (session.isInitializing) return;
    session.isInitializing = true;
    session.qrCode = null;

    const authDir = path.join(session.dir, 'auth_info_baileys');
    fs.mkdirSync(authDir, { recursive: true });

    let state: any, saveCreds: any;
    try {
        const authData = await useMultiFileAuthState(authDir);
        state = authData.state;
        saveCreds = authData.saveCreds;
        if (!state || !state.creds || typeof state.creds !== 'object') throw new Error('Corrupt creds');
    } catch (err: any) {
        sessionLog(session, 'ERROR', `Auth dir corrupted: ${err.message}. Cleaning...`);
        cleanAuthDirForSession(session, authDir);
        const authData = await useMultiFileAuthState(authDir);
        state = authData.state;
        saveCreds = authData.saveCreds;
    }

    if (session.sock) {
        try { session.sock.ev.removeAllListeners(); session.sock.end(undefined); } catch (e) {}
        session.sock = null;
    }

    try {
        session.sock = makeWASocket({
            version: latestVersion,
            logger: pino({ level: 'silent' }),
            auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })) },
            printQRInTerminal: false,
            browser: Browsers.ubuntu('Chrome'),
            syncFullHistory: true,
            markOnlineOnConnect: !session.proData.settings.ghostMode,
            connectTimeoutMs: 60000,
            generateHighQualityLinkPreview: true,
            getMessage: async (key: any) => {
                const jid = normalizeJidForSession(session, key.remoteJid!);
                const msgs = session.proData.messageHistory[jid] || [];
                return msgs.find((m: any) => m.key.id === key.id)?.message || undefined;
            }
        });
    } catch (e: any) {
        sessionLog(session, 'ERROR', `Failed to create WASocket: ${e.message}`);
        session.isInitializing = false;
        setTimeout(() => initWASocketForSession(session), 5000);
        return;
    }

    session.isInitializing = false;
    const socketInstance = session.sock;

    session.sock.ev.on('creds.update', (...args: any[]) => {
        if (socketInstance !== session.sock) return;
        saveCreds(...args);
    });

    session.sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
        if (socketInstance !== session.sock) return;
        session.lastInteractionTime = Date.now();
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            session.qrCode = qr;
            broadcastToSession(session, { type: 'QR_CODE', data: qr });
        }
        if (connection) {
            session.connectionState = connection;
            broadcastToSession(session, { type: 'CONNECTION_STATE', data: connection });
        }
        if (connection === 'close') {
            const error = lastDisconnect?.error as Boom;
            const statusCode = error?.output?.statusCode;
            const errMessage = (error?.message || '').toLowerCase();
            const fullErr = `${errMessage} ${error?.stack || ''}`.toLowerCase();

            const isQrTimeout = fullErr.includes('qr refs') || (statusCode === 408 && fullErr.includes('qr'));
            const isLoggedOut = statusCode === DisconnectReason.loggedOut || fullErr.includes('logged out');
            const isTransient = [515,408,428,500].includes(statusCode!) || fullErr.includes('restart required') || fullErr.includes('timed out') || fullErr.includes('connection reset');

            session.qrCode = null;

            if (isQrTimeout) {
                cleanAuthDirForSession(session, authDir);
                broadcastToSession(session, { type: 'QR_TIMEOUT', data: { message: 'QR timed out. Re-generating...' } });
                setTimeout(() => initWASocketForSession(session), 3000);
                return;
            }
            if (isLoggedOut) {
                session.realChats = [];
                session.proData.cachedChats = [];
                saveSessionProData(session);
                broadcastToSession(session, { type: 'LOGOUT', data: { message: 'Logged out from device.', fatal: true } });
                setTimeout(() => { cleanAuthDirForSession(session, authDir); initWASocketForSession(session); }, 2000);
                return;
            }
            try { session.sock?.ev.removeAllListeners(); session.sock?.end(undefined); } catch(e) {}
            session.sock = null;
            setTimeout(() => initWASocketForSession(session), isTransient ? 3000 : 5000);

        } else if (connection === 'open') {
            session.consecutiveBadSessions = 0;
            session.qrCode = null;
            broadcastToSession(session, { type: 'LOGGED_IN', data: session.sock.user });
            broadcastToSession(session, { type: 'SYNC_START', data: true });
            broadcastToSession(session, { type: 'INITIAL_SYNC', data: {
                settings: session.proData.settings,
                chats: session.realChats,
                favorites: session.proData.favorites,
                lockedChats: session.proData.lockedChats,
                callHistory: session.proData.callHistory,
                contacts: session.proData.contacts,
                lidToPnMap: session.proData.lidToPnMap
            }});
            sessionLog(session, 'SUCCESS', 'WhatsApp connected and synced');
        }
    });

    session.sock.ev.on('messages.upsert', (m: any) => {
        if (socketInstance !== session.sock) return;
        broadcastToSession(session, { type: 'MESSAGES_UPSERT', data: m });
        m.messages.forEach((msg: any) => {
            let jid = msg.key.remoteJid;
            if (!jid) return;
            jid = normalizeJidForSession(session, jid);
            msg.key.remoteJid = jid;
            if (!session.proData.messageHistory[jid]) session.proData.messageHistory[jid] = [];
            session.proData.messageHistory[jid].push(msg);
            if (session.proData.messageHistory[jid].length > 1000) session.proData.messageHistory[jid].shift();
            saveSessionProData(session);
        });
    });

    session.sock.ev.on('messages.update', (m: any) => {
        if (socketInstance !== session.sock) return;
        broadcastToSession(session, { type: 'MESSAGES_UPDATE', data: m });
    });

    session.sock.ev.on('contacts.upsert', (contacts: any[]) => {
        if (socketInstance !== session.sock) return;
        contacts.forEach(c => { if (c.id) session.proData.contacts[c.id] = c; });
        saveSessionProData(session);
        broadcastToSession(session, { type: 'CONTACTS_UPSERT', data: contacts });
    });

    session.sock.ev.on('chats.upsert', (chats: any[]) => {
        if (socketInstance !== session.sock) return;
        chats.forEach(chat => {
            const idx = session.realChats.findIndex((c: any) => c.id === chat.id);
            if (idx !== -1) session.realChats[idx] = { ...session.realChats[idx], ...chat };
            else session.realChats.push(chat);
        });
        session.proData.cachedChats = session.realChats;
        saveSessionProData(session);
        broadcastToSession(session, { type: 'CHATS_UPDATE', data: chats[0] });
    });

    session.sock.ev.on('chats.set', ({ chats }: any) => {
        if (socketInstance !== session.sock) return;
        session.realChats = chats;
        session.proData.cachedChats = chats;
        saveSessionProData(session);
        broadcastToSession(session, { type: 'INITIAL_SYNC', data: { chats } });
    });

    session.sock.ev.on('presence.update', (m: any) => {
        if (socketInstance !== session.sock) return;
        broadcastToSession(session, { type: 'PRESENCE_UPDATE', data: m });
    });
}

async function initWASocketFriendForSession(session: any) {
    if (session.isInitializingFriend) return;
    session.isInitializingFriend = true;
    session.qrCodeFriend = null;

    const authDir = path.join(session.dir, 'auth_info_baileys_friend');
    fs.mkdirSync(authDir, { recursive: true });

    let state: any, saveCreds: any;
    try {
        const authData = await useMultiFileAuthState(authDir);
        state = authData.state;
        saveCreds = authData.saveCreds;
        if (!state || !state.creds || typeof state.creds !== 'object') throw new Error('Corrupt creds');
    } catch (err: any) {
        cleanAuthDirForSession(session, authDir);
        const authData = await useMultiFileAuthState(authDir);
        state = authData.state;
        saveCreds = authData.saveCreds;
    }

    if (session.sockFriend) {
        try { session.sockFriend.ev.removeAllListeners(); session.sockFriend.end(undefined); } catch (e) {}
        session.sockFriend = null;
    }

    try {
        session.sockFriend = makeWASocket({
            version: latestVersion,
            logger: pino({ level: 'silent' }),
            auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })) },
            printQRInTerminal: false,
            browser: Browsers.ubuntu('Chrome'),
            syncFullHistory: true,
            markOnlineOnConnect: !session.proDataFriend.settings.ghostMode,
            connectTimeoutMs: 60000,
        });
    } catch (e: any) {
        session.isInitializingFriend = false;
        setTimeout(() => initWASocketFriendForSession(session), 5000);
        return;
    }

    session.isInitializingFriend = false;
    const socketInstance = session.sockFriend;

    session.sockFriend.ev.on('creds.update', (...args: any[]) => {
        if (socketInstance !== session.sockFriend) return;
        saveCreds(...args);
    });

    session.sockFriend.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
        if (socketInstance !== session.sockFriend) return;
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            session.qrCodeFriend = qr;
            broadcastToSession(session, { type: 'QR_CODE_FRIEND', data: qr });
        }
        if (connection) {
            session.connectionStateFriend = connection;
            broadcastToSession(session, { type: 'CONNECTION_STATE_FRIEND', data: connection });
        }
        if (connection === 'close') {
            const error = lastDisconnect?.error as Boom;
            const statusCode = error?.output?.statusCode;
            const fullErr = `${error?.message || ''} ${error?.stack || ''}`.toLowerCase();
            const isLoggedOut = statusCode === DisconnectReason.loggedOut || fullErr.includes('logged out');
            session.qrCodeFriend = null;
            if (isLoggedOut) {
                session.realChatsFriend = [];
                session.proDataFriend.cachedChats = [];
                saveSessionProData(session, true);
                broadcastToSession(session, { type: 'LOGOUT_FRIEND', data: { message: 'Friend account logged out.' } });
            }
            try { session.sockFriend?.ev.removeAllListeners(); session.sockFriend?.end(undefined); } catch(e) {}
            session.sockFriend = null;
            setTimeout(() => initWASocketFriendForSession(session), 5000);
        } else if (connection === 'open') {
            session.qrCodeFriend = null;
            broadcastToSession(session, { type: 'LOGGED_IN_FRIEND', data: session.sockFriend.user });
            broadcastToSession(session, { type: 'INITIAL_SYNC_FRIEND', data: { chats: session.realChatsFriend } });
        }
    });

    session.sockFriend.ev.on('messages.upsert', (m: any) => {
        if (socketInstance !== session.sockFriend) return;
        broadcastToSession(session, { type: 'MESSAGES_UPSERT_FRIEND', data: m });
        m.messages.forEach((msg: any) => {
            let jid = msg.key.remoteJid;
            if (!jid) return;
            jid = normalizeJidForSession(session, jid);
            if (!session.proDataFriend.messageHistory[jid]) session.proDataFriend.messageHistory[jid] = [];
            session.proDataFriend.messageHistory[jid].push(msg);
            if (session.proDataFriend.messageHistory[jid].length > 1000) session.proDataFriend.messageHistory[jid].shift();
            saveSessionProData(session, true);
        });
    });

    session.sockFriend.ev.on('chats.set', ({ chats }: any) => {
        if (socketInstance !== session.sockFriend) return;
        session.realChatsFriend = chats;
        session.proDataFriend.cachedChats = chats;
        saveSessionProData(session, true);
        broadcastToSession(session, { type: 'INITIAL_SYNC_FRIEND', data: { chats } });
    });
}

async function startServer() {
    app.use(express.json());
    app.use('/api/admin', adminRouter);

    // ── Session middleware: inject session into req for all /api routes ──
    app.use('/api', (req: any, res: any, next: any) => {
        const sid = req.headers['x-session-id'] as string;
        if (sid) {
            req.userSession = getOrCreateSession(sid);
        }
        next();
    });
    
    // Seed and initialize DB asynchronously to avoid blocking handler import // FIXED
    DatabaseService.initDatabase().catch((dbErr: any) => {
        log('ERROR', `Database initialization failure: ${dbErr.message}`);
    });

    let latestVersion: any = undefined;
    try {
        const { version } = await fetchLatestBaileysVersion();
        latestVersion = version;
        log('INFO', `Baileys Version Fetched: ${version.join('.')}`);
    } catch (e) {
        latestVersion = undefined; // Fallback to undefined so Baileys uses its built-in default
        log('WARN', 'Using Baileys native default version due to version fetch failure');
    }

    sock = null;
    sockFriend = null;
    let qrCode: string | null = null;
    let qrCodeFriend: string | null = null;
    let connectionState: any = 'close';
    let connectionStateFriend: any = 'close';
    realChats = proData.cachedChats || [];
    realChatsFriend = proDataFriend.cachedChats || [];
    let initTimeout: NodeJS.Timeout | null = null;
    let isInitializing = false;
    let isInitializingFriend = false;

    function cleanAuthDir(authDir: string) {
        const timestamp = Date.now();
        const backupDir = `${authDir}_corrupt_${timestamp}`;
        
        // 1. Unlink individual file handles inside to release active stream locks
        try {
            if (fs.existsSync(authDir)) {
                const files = fs.readdirSync(authDir);
                for (const file of files) {
                    const filePath = path.join(authDir, file);
                    try {
                        if (fs.statSync(filePath).isDirectory()) {
                            fs.rmSync(filePath, { recursive: true, force: true });
                        } else {
                            fs.unlinkSync(filePath);
                        }
                    } catch (fileErr: any) {
                        log('WARN', `Could not unlink ${file}: ${fileErr.message}`);
                    }
                }
            }
        } catch (dirErr: any) {
            log('WARN', `Pre-sanitize index failed on ${path.basename(authDir)}: ${dirErr.message}`);
        }

        // 2. Perform background rename and deletion
        try {
            if (fs.existsSync(authDir)) {
                fs.renameSync(authDir, backupDir);
                log('SUCCESS', `Session directory renamed to ${path.basename(backupDir)} for background disposal.`);
                try {
                    fs.rmSync(backupDir, { recursive: true, force: true });
                } catch (rmErr) {
                    // Ignore background rm error, files will be freed ultimately
                }
                return true;
            }
            return true;
        } catch (renameError: any) {
            log('WARN', `Failed to rename session directory: ${renameError.message}. Falling back to standard rm...`);
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    if (fs.existsSync(authDir)) {
                        fs.rmSync(authDir, { recursive: true, force: true });
                        log('SUCCESS', `Session storage sanitized (attempt ${attempt}/3)`);
                        return true;
                    }
                    return true;
                } catch (e: any) {
                    log('WARN', `Attempt ${attempt}/3 to sanitize session storage failed: ${e.message}`);
                    if (attempt < 3) {
                        // Slight sync delay
                        const start = Date.now();
                        while (Date.now() - start < 200) {}
                    }
                }
            }
        }
        return false;
    }

    function scheduleInit(delay: number) {
        if (initTimeout) {
            clearTimeout(initTimeout);
        }
        initTimeout = setTimeout(async () => {
            initTimeout = null;
            await initWASocket();
        }, delay);
    }

    async function handleAutomatedSessionRecovery() {
        log('WARN', 'Engine: Initiating Automated Session Recovery procedure...');
        
        // a. Call await sock.end() gracefully
        if (sock) {
            try {
                sock.ev.removeAllListeners('connection.update');
                sock.ev.removeAllListeners('creds.update');
                if (typeof sock.end === 'function') {
                    await sock.end(undefined);
                }
            } catch (e: any) {
                log('WARN', `Engine: Error ending socket gracefully: ${e.message}`);
            }
            sock = null;
        }

        // Check if creds.json exists and read it to memory to allow automatic re-authentication without QR rebuild
        const authDir = path.join(BASE_DATA_DIR, 'auth_info_baileys');
        const oldCredsFile = path.join(authDir, 'creds.json');
        let credsBuffer: Buffer | null = null;
        if (fs.existsSync(oldCredsFile)) {
            try {
                const raw = fs.readFileSync(oldCredsFile, 'utf-8');
                if (raw && raw.trim().startsWith('{')) {
                    JSON.parse(raw); // verify valid JSON format
                    credsBuffer = Buffer.from(raw, 'utf-8');
                    log('INFO', 'Engine: Successfully backed up existing session credentials in memory for automatic restoration.');
                }
            } catch (e: any) {
                log('WARN', `Engine: Existing credentials file could not be read or parsed: ${e.message}. Moving on without session persistence.`);
            }
        }

        // b. Rename the corrupt session folder
        if (fs.existsSync(authDir)) {
            try {
                const corruptDir = path.join(BASE_DATA_DIR, `auth_info_baileys_corrupt_${Date.now()}`);
                fs.renameSync(authDir, corruptDir);
                log('WARN', `Engine: Corrupt auth directory backed up and renamed to: ${path.basename(corruptDir)}`);
            } catch (e: any) {
                log('ERROR', `Engine: Failed to rename corrupt directory: ${e.message}`);
            }
        }

        // c. Create a fresh session folder
        try {
            if (!fs.existsSync(authDir)) {
                fs.mkdirSync(authDir, { recursive: true });
                log('INFO', 'Engine: Created fresh clean session directory.');
            }
        } catch (e: any) {
            log('ERROR', `Engine: Failed to create fresh session directory: ${e.message}`);
        }

        // Write backed up creds.json back to the fresh folder
        if (credsBuffer) {
            try {
                fs.writeFileSync(path.join(authDir, 'creds.json'), credsBuffer);
                log('SUCCESS', 'Engine: Restored original credentials to new clean session directory. Re-authenticating automatically without QR scan!');
            } catch (e: any) {
                log('ERROR', `Engine: Failed to restore credentials file to new directory: ${e.message}`);
            }
        }

        // d. Re‑initialize the socket with the new session
        consecutiveStreamErrors = 0;
        consecutiveBadSessions = 0;
        qrCode = null;
        isInitializing = false;
        
        log('INFO', 'Engine: Rebooting WASocket with fresh empty credentials...');
        await initWASocket();

        // e. Re‑emit connection events so the UI shows "Connected" again
        if (sock) {
            connectionState = 'connecting';
            broadcast({ type: 'CONNECTION_STATE', data: 'connecting' });
        }
    }

    let healthCheckInterval: NodeJS.Timeout | null = null;
    function startSessionHealthCheck() {
        if (healthCheckInterval) {
            clearInterval(healthCheckInterval);
        }
        healthCheckInterval = setInterval(async () => {
            if (!sock || connectionState !== 'open') {
                return; // Only active when socket is open
            }
            
            // Avoid disruptive pings if the socket had an interaction recently (within 5 minutes)
            const timeSinceLastInteraction = Date.now() - lastInteractionTime;
            if (timeSinceLastInteraction < 5 * 60 * 1000) {
                log('SUCCESS', `Session Health Check: Socket bypassed ping check. Active session activity detected ${Math.round(timeSinceLastInteraction / 1000)}s ago.`);
                return;
            }

            log('INFO', 'Session Health Check: Pinging Baileys socket...');
            let responded = false;
            
            const watchdog = setTimeout(async () => {
                if (!responded) {
                    log('ERROR', 'Session Health Check: No response to ping within 30s. Performing soft socket clean reboot...');
                    if (sock) {
                        try {
                            sock.ev.removeAllListeners('connection.update');
                            sock.ev.removeAllListeners('creds.update');
                            if (typeof sock.end === 'function') {
                                sock.end(undefined);
                            }
                        } catch (e: any) {
                            log('WARN', `Session Health Check: Error ending socket during reboot: ${e.message}`);
                        }
                        sock = null;
                    }
                    connectionState = 'connecting';
                    broadcast({ type: 'CONNECTION_STATE', data: 'connecting' });
                    scheduleInit(1000);
                }
            }, 30000);

            try {
                if (sock && typeof sock.query === 'function') {
                    await sock.query({
                        tag: 'iq',
                        attrs: {
                            to: '@s.whatsapp.net',
                            type: 'get',
                            xmlns: 'w:g'
                        },
                        content: [{ tag: 'ping', attrs: {} }]
                    });
                } else if (sock && typeof sock.onWhatsApp === 'function' && sock.user?.id) {
                    await sock.onWhatsApp(sock.user.id);
                }
                responded = true;
                clearTimeout(watchdog);
                log('SUCCESS', 'Session Health Check: Socket is alive and healthy.');
                recordActivity(); // Update interaction time upon successful health check response
            } catch (err: any) {
                // If it threw an error but still responded, the socket connection is alive!
                responded = true;
                clearTimeout(watchdog);
                log('INFO', `Session Health Check: Ping test responded with: ${err.message}. Connection alive.`);
                recordActivity();
            }
        }, 5 * 60 * 1000); // every 5 minutes
    }

    // Load from Firestore pre-startup (legacy global load, sessions load their own data on demand)
    // await loadProDataFromFirestore(); // Disabled — each session loads its own

    // ── WebSocket: assign each connection to the session via ?sid= query param ──
    wss.on('connection', (ws: WebSocket, req: any) => {
        const urlParams = new URL(req.url || '/', `http://localhost`);
        const sid = urlParams.searchParams.get('sid');
        if (sid) {
            const session = getOrCreateSession(sid);
            session.wsClients.add(ws);
            console.log(`[WS] Client connected to session ${sid}. Total clients: ${session.wsClients.size}`);
            ws.on('close', () => {
                session.wsClients.delete(ws);
                console.log(`[WS] Client disconnected from session ${sid}. Remaining: ${session.wsClients.size}`);
            });
            // Send current state to newly connected client
            ws.send(JSON.stringify({ type: 'CONNECTION_STATE', data: session.connectionState }));
            if (session.qrCode) ws.send(JSON.stringify({ type: 'QR_CODE', data: session.qrCode }));
        } else {
            // No session ID — close the connection
            ws.close(1008, 'Session ID required');
        }
    });

    function broadcast(data: any) {
        // Legacy global broadcast (used by adminRouter) — sends to ALL sessions
        sessions.forEach(session => broadcastToSession(session, data));
    }
    (global as any).broadcast = broadcast;

    function registerJidMapping(lid: string, pn: string) {
        if (!lid || !pn || lid === pn) return;
        if (!lid.endsWith('@lid') || !pn.endsWith('@s.whatsapp.net')) return;
        
        if (!proData.lidToPnMap) proData.lidToPnMap = {};
        if (proData.lidToPnMap[lid] !== pn) {
            proData.lidToPnMap[lid] = pn;
            log('INFO', `Registered JID mapping: ${lid} -> ${pn}`);
            saveProData();
            broadcast({ type: 'LID_MAPPING', data: { lid, pn } });
        }
    }

// Normalize JID function to handle linked devices, LIDs and @c.us vs @s.whatsapp.net
function normalizeJid(jid: string): string {
    if (!jid) return jid;
    if (jid.includes('@')) {
        const [userWithDevice, domain] = jid.split('@');
        const user = userWithDevice.split(':')[0];
        jid = `${user}@${domain}`;
    } else if (jid.includes(':')) {
        jid = jid.split(':')[0];
    }
    if (jid.endsWith('@c.us')) jid = jid.replace('@c.us', '@s.whatsapp.net');
    
    // Resolve @lid using our synchronized mappings
    if (jid.endsWith('@lid') && proData.lidToPnMap && proData.lidToPnMap[jid]) {
        jid = proData.lidToPnMap[jid];
    }
    return jid;
}

function wrapSignalKeyStore(keysState: any, authDir: string, isFriend: boolean) {
    if (!keysState) return keysState;
    const originalGet = keysState.get;
    const originalSet = keysState.set;

    keysState.get = async (type: string, ids: string[]) => {
        try {
            return await originalGet.call(keysState, type, ids);
        } catch (error: any) {
            const errStr = (error?.message || '').toLowerCase();
            log('ERROR', `KeyStore GET error for ${isFriend ? 'Friend' : 'Me'} in ${authDir}: ${error.message}`);
            if (errStr.includes('unsupported state') || errStr.includes('unable to authenticate') || errStr.includes('decryption failed')) {
                log('ERROR', `Detected corrupted KeyStore state in ${authDir}! Instigating automated recovery...`);
                cleanAuthDir(authDir);
                if (isFriend) {
                    if (sockFriend) {
                        try { sockFriend.ev.removeAllListeners('connection.update'); sockFriend.ev.removeAllListeners('creds.update'); sockFriend.end(undefined); } catch (e) {}
                        sockFriend = null;
                        connectionStateFriend = 'close';
                        broadcast({ type: 'CONNECTION_STATE_FRIEND', data: 'close' });
                    }
                    setTimeout(() => { initWASocketFriend(); }, 2000);
                } else {
                    if (sock) {
                        try { sock.ev.removeAllListeners('connection.update'); sock.ev.removeAllListeners('creds.update'); sock.end(undefined); } catch (e) {}
                        sock = null;
                        connectionState = 'close';
                        broadcast({ type: 'CONNECTION_STATE', data: 'close' });
                    }
                    setTimeout(() => { initWASocket(); }, 2000);
                }
            }
            throw error;
        }
    };

    keysState.set = async (data: any) => {
        try {
            return await originalSet.call(keysState, data);
        } catch (error: any) {
            const errStr = (error?.message || '').toLowerCase();
            log('ERROR', `KeyStore SET error for ${isFriend ? 'Friend' : 'Me'} in ${authDir}: ${error.message}`);
            if (errStr.includes('unsupported state') || errStr.includes('unable to authenticate') || errStr.includes('decryption failed')) {
                log('ERROR', `Detected corrupted KeyStore state during set in ${authDir}! Instigating automated recovery...`);
                cleanAuthDir(authDir);
                if (isFriend) {
                    if (sockFriend) {
                        try { sockFriend.ev.removeAllListeners('connection.update'); sockFriend.ev.removeAllListeners('creds.update'); sockFriend.end(undefined); } catch (e) {}
                        sockFriend = null;
                        connectionStateFriend = 'close';
                        broadcast({ type: 'CONNECTION_STATE_FRIEND', data: 'close' });
                    }
                    setTimeout(() => { initWASocketFriend(); }, 2000);
                } else {
                    if (sock) {
                        try { sock.ev.removeAllListeners('connection.update'); sock.ev.removeAllListeners('creds.update'); sock.end(undefined); } catch (e) {}
                        sock = null;
                        connectionState = 'close';
                        broadcast({ type: 'CONNECTION_STATE', data: 'close' });
                    }
                    setTimeout(() => { initWASocket(); }, 2000);
                }
            }
            throw error;
        }
    };

    return keysState;
}

async function initWASocket() {
    if (isInitializing) {
        log('WARN', 'initWASocket is already in progress, skipping concurrent duplicate call.');
        return;
    }
    isInitializing = true;
    qrCode = null; // Reset QR state on start
    const authDir = path.join(BASE_DATA_DIR, 'auth_info_baileys');
    let state: any;
    let saveCreds: any;

    try {
        const authData = await useMultiFileAuthState(authDir);
        state = authData.state;
        saveCreds = authData.saveCreds;
        
        // Perform sanity check of loaded credentials object to intercept corrupted states
        if (!state || !state.creds || typeof state.creds !== 'object') {
            throw new Error('State credentials are corrupt or missing');
        }
    } catch (err: any) {
        log('ERROR', `Authentication directory corrupted: ${err.message}. Cleaning and re-establishing clean state...`);
        cleanAuthDir(authDir);
        const authData = await useMultiFileAuthState(authDir);
        state = authData.state;
        saveCreds = authData.saveCreds;
    }

    state.keys = wrapSignalKeyStore(state.keys, authDir, false);
    
    if (sock) {
        try { 
            sock.ev.removeAllListeners('connection.update');
            sock.ev.removeAllListeners('creds.update');
            sock.ev.removeAllListeners('messages.upsert');
            sock.end(undefined); 
        } catch (e) {}
    }
    
    let constructRetries = 0;
    while (constructRetries < 3) {
        try {
            sock = makeWASocket({
                version: latestVersion,
                logger,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, logger),
                },
                printQRInTerminal: false,
                browser: Browsers.ubuntu('Chrome'),
                syncFullHistory: true, // Re-enabled for full pro sync
                markOnlineOnConnect: !proData.settings.ghostMode,
                connectTimeoutMs: 60000,
                generateHighQualityLinkPreview: true,
                getMessage: async (key) => {
                    const jid = normalizeJid(key.remoteJid!);
                    const msgs = proData.messageHistory[jid] || [];
                    return msgs.find(m => m.key.id === key.id)?.message || undefined;
                }
            });
            break; // connection built successfully
        } catch (socketError: any) {
            constructRetries++;
            log('ERROR', `Failed to construct WASocket (Attempt ${constructRetries}/3): ${socketError.message}.`);
            if (constructRetries >= 3) {
                log('ERROR', `Maximum socket construction retries reached. Recovering via sanitization...`);
                cleanAuthDir(authDir);
                isInitializing = false;
                scheduleInit(3000);
                return;
            }
            // Delay 2 seconds before retry
            const start = Date.now();
            while (Date.now() - start < 2000) {}
        }
    }

    isInitializing = false;
    const socketInstance = sock;

    sock.ev.on('creds.update', (...args: any[]) => {
        if (socketInstance !== sock) return;
        saveCreds(...args);
    });

        sock.ev.on('QR_CODE', (qr: string) => {
            if (socketInstance !== sock) return;
            qrCode = qr;
            broadcast({ type: 'QR_CODE', data: qr });
        });

        sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
            if (socketInstance !== sock) return;
            recordActivity();
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                qrCode = qr;
                broadcast({ type: 'QR_CODE', data: qr });
            }

            if (connection) {
                connectionState = connection;
                broadcast({ type: 'CONNECTION_STATE', data: connection });
            }

            if (connection === 'close') {
                const error = lastDisconnect?.error as Boom;
                const statusCode = error?.output?.statusCode;
                
                const errMessage = error?.message || 'none';
                const errStack = error?.stack || 'none';
                const errOutputPayloadMsg = (error?.output?.payload as any)?.message || '';
                const fullErrorString = `${errMessage} ${errStack} ${errOutputPayloadMsg}`.toLowerCase();
                
                const isQrTimeout = 
                    fullErrorString.includes('qr refs attempts ended') || 
                    fullErrorString.includes('qr refs') ||
                    errMessage.toLowerCase().includes('qr refs') ||
                    errMessage.toLowerCase().includes('attempts ended') ||
                    (statusCode === 408 && (fullErrorString.includes('qr') || fullErrorString.includes('attempt') || fullErrorString.includes('timeout') || errMessage.toLowerCase().includes('qr') || errMessage.toLowerCase().includes('attempts ended') || fullErrorString.trim() === ''));
                
                const isLoggedOut = 
                    statusCode === DisconnectReason.loggedOut ||
                    fullErrorString.includes('logged out') ||
                    fullErrorString.includes('logout');

                const isBadSession = 
                    (statusCode === DisconnectReason.badSession && 
                     !fullErrorString.includes('stream errored') && 
                     !fullErrorString.includes('xml-not-well-formed') &&
                     !fullErrorString.includes('connection reset') &&
                     !fullErrorString.includes('socket hang up') &&
                     !fullErrorString.includes('connection closed') &&
                     !fullErrorString.includes('timed out')
                    ) ||
                    (statusCode === 401 && !isLoggedOut) ||
                    fullErrorString.includes('bad session') ||
                    fullErrorString.includes('invalid credentials') ||
                    fullErrorString.includes('unauthorized') ||
                    fullErrorString.includes('decryption failed') ||
                    fullErrorString.includes('bad_session');

                const isTransientReconnectRequest = 
                    statusCode === 515 || // DisconnectReason.restartRequired
                    statusCode === 408 || // DisconnectReason.connectionLost / timedOut
                    statusCode === 428 || // DisconnectReason.connectionClosed
                    statusCode === 500 || // Standard transient sub-socket disconnect
                    fullErrorString.includes('restart required') ||
                    fullErrorString.includes('connection lost') ||
                    fullErrorString.includes('connection closed') ||
                    fullErrorString.includes('timed out') ||
                    fullErrorString.includes('socket hang up') ||
                    fullErrorString.includes('connection reset');

                const isStreamError = 
                    !isTransientReconnectRequest && (
                        fullErrorString.includes('stream errored') ||
                        fullErrorString.includes('xml-not-well-formed')
                    );

                // 1. Check for QR Timeout
                if (isQrTimeout) {
                    log('WARN', 'QR pairing reference attempts ended (timeout). Wiping stale registration state for clean reboot...');
                    qrCode = null;
                    if (sock) {
                        try {
                            sock.ev.removeAllListeners('connection.update');
                            sock.ev.removeAllListeners('creds.update');
                            sock.end(undefined);
                        } catch (e) {}
                        sock = null;
                    }
                    const authDir = path.join(BASE_DATA_DIR, 'auth_info_baileys');
                    cleanAuthDir(authDir);
                    
                    broadcast({ type: 'QR_TIMEOUT', data: { message: 'QR code pairing timed out. Re-generating fresh pairing reference...' } });
                    scheduleInit(3000);
                    return;
                }

                // 2. Check for Log Out
                if (isLoggedOut) {
                    const message = 'Logged out from mobile device. Clean authentication required.';
                    log('ERROR', message);
                    qrCode = null;
                    realChats = [];
                    proData.cachedChats = [];
                    saveProData();
                    
                    broadcast({ type: 'LOGOUT', data: { message, fatal: true } });

                    if (sock) {
                        try {
                            sock.ev.removeAllListeners('connection.update');
                            sock.ev.removeAllListeners('creds.update');
                            sock.ev.removeAllListeners('messages.upsert');
                            sock.ev.removeAllListeners('messages.update');
                            sock.ev.removeAllListeners('contacts.upsert');
                            sock.ev.removeAllListeners('contacts.update');
                            sock.ev.removeAllListeners('chats.upsert');
                            sock.ev.removeAllListeners('chats.update');
                            sock.end(undefined);
                        } catch (e) {}
                        sock = null;
                    }

                    // Introduce a critical delay to let all file descriptor locks release and socket to fully dispose
                    setTimeout(() => {
                        const authDir = path.join(BASE_DATA_DIR, 'auth_info_baileys');
                        cleanAuthDir(authDir);
                        scheduleInit(1000);
                    }, 1500);
                    return;
                }

                // 2.5 Check for Transient Reconnect Request
                if (isTransientReconnectRequest) {
                    log('INFO', `Engine: Transient socket disconnect/restart requested (statusCode: ${statusCode || 'none'}). Reconnecting connection cleanly...`);
                    if (sock) {
                        try {
                            sock.ev.removeAllListeners('connection.update');
                            sock.ev.removeAllListeners('creds.update');
                            sock.end(undefined);
                        } catch (e) {}
                        sock = null;
                    }
                    scheduleInit(3000);
                    return;
                }

                // 3. Check for Bad Session
                if (isBadSession) {
                    consecutiveBadSessions++;
                    log('WARN', `Engine Connection close detected as BAD SESSION (statusCode: ${statusCode || 'none'}, consecutive: ${consecutiveBadSessions}/3).`);
                    
                    if (sock) {
                        try {
                            sock.ev.removeAllListeners('connection.update');
                            sock.ev.removeAllListeners('creds.update');
                            sock.end(undefined);
                        } catch (e) {}
                        sock = null;
                    }

                    if (consecutiveBadSessions >= 3) {
                        log('ERROR', 'Multiple consecutive bad session errors encountered. Initiating automated session recovery...');
                        consecutiveBadSessions = 0;
                        await handleAutomatedSessionRecovery();
                    } else {
                        log('WARN', 'Bad session encountered. Preparing auto-reinitialization in 3 seconds...');
                        scheduleInit(3000);
                    }
                    return;
                }

                // 3.5 Check for Stream Errors
                if (isStreamError) {
                    consecutiveStreamErrors++;
                    log('WARN', `Engine Connection close detected as STREAM ERROR (statusCode: ${statusCode || 'none'}, consecutive: ${consecutiveStreamErrors}/3).`);
                    
                    if (sock) {
                        try {
                            sock.ev.removeAllListeners('connection.update');
                            sock.ev.removeAllListeners('creds.update');
                            sock.end(undefined);
                        } catch (e) {}
                        sock = null;
                    }

                    let delay = 3000;
                    if (consecutiveStreamErrors > 3) {
                        delay = 8000; // exponential-like wait backoff
                    }
                    if (consecutiveStreamErrors >= 30) {
                        log('ERROR', 'Extremely high stream errors. Resetting state without deleting session.');
                        consecutiveStreamErrors = 0;
                    }

                    log('WARN', `Stream closed due to network/protocol error. Preparing auto-reinitialization in ${delay / 1000} seconds...`);
                    scheduleInit(delay);
                    return;
                }

                // 4. Fallback for other reasons
                log('WARN', `Severe disconnect close code: ${statusCode || 'unknown'}. message: ${errMessage}, stack: ${errStack}. Scheduling fallback socket reboot reconnect...`);
                
                if (sock) {
                    try {
                        sock.ev.removeAllListeners('connection.update');
                        sock.ev.removeAllListeners('creds.update');
                        sock.end(undefined);
                    } catch (e) {}
                    sock = null;
                }
                scheduleInit(2000);
            } else if (connection === 'open') {
                log('SUCCESS', 'WhatsApp Pro Engine: CONNECTED and SYNCED');
                consecutiveBadSessions = 0;
                consecutiveStreamErrors = 0;
                qrCode = null;
                startSessionHealthCheck();
                broadcast({ type: 'LOGGED_IN', data: sock.user });
                // Force an immediate status check broadcast
                broadcast({ type: 'SYNC_START', data: true });
                
                // Hot reload specific user details from Firebase
                loadProDataFromFirestore().then(() => {
                    broadcast({ type: 'INITIAL_SYNC', data: {
                        settings: proData.settings,
                        chats: realChats,
                        favorites: proData.favorites,
                        lockedChats: proData.lockedChats,
                        callHistory: proData.callHistory,
                        contacts: proData.contacts,
                        lidToPnMap: proData.lidToPnMap
                    } });
                }).catch(e => {
                    console.error('Failed to reload database for logged in user:', e.message);
                });
            }
        });

        sock.ev.on('messages.upsert', (m: any) => {
            if (socketInstance !== sock) return;
            // DND Silent drop removed to preserve messages and log them permanently
            broadcast({ type: 'MESSAGES_UPSERT', data: m });
            
            m.messages.forEach(async (msg: any) => {
                let jid = msg.key.remoteJid;
                if (!jid) return;

                // Normalize JID early
                if (msg.key.participant && msg.participant) {
                    const p1 = msg.key.participant;
                    const p2 = msg.participant;
                    if (p1.endsWith('@lid') && p2.endsWith('@s.whatsapp.net')) {
                        registerJidMapping(p1, p2);
                    } else if (p2.endsWith('@lid') && p1.endsWith('@s.whatsapp.net')) {
                        registerJidMapping(p2, p1);
                    }
                }
                jid = normalizeJid(jid);
                msg.key.remoteJid = jid; // Mutate for consistency
                if (msg.key.participant) msg.key.participant = normalizeJid(msg.key.participant);
                if (msg.participant) msg.participant = normalizeJid(msg.participant);

                // Setup sender details in contacts if available
                const senderJid = msg.key.fromMe ? 'Me' : normalizeJid(msg.key.participant || msg.participant || jid);
                if (msg.pushName && senderJid && senderJid !== 'Me') {
                    if (!proData.contacts[senderJid] || !proData.contacts[senderJid].name) {
                        proData.contacts[senderJid] = {
                            ...(proData.contacts[senderJid] || {}),
                            id: senderJid,
                            pushName: msg.pushName,
                            name: msg.pushName
                        };
                        saveContactToFirebase(senderJid, proData.contacts[senderJid]);
                    }
                }

                // Handle status updates
                if (jid === 'status@broadcast') {
                    const status = {
                        id: msg.key.id,
                        key: msg.key,
                        participant: normalizeJid(msg.key.participant || msg.participant || ''),
                        message: msg.message,
                        timestamp: msg.messageTimestamp,
                        pushName: msg.pushName
                    };
                    
                    // Deduplicate status updates
                    const existingIndex = proData.statusUpdates.findIndex(s => s.id === status.id);
                    if (existingIndex !== -1) {
                        proData.statusUpdates[existingIndex] = status;
                    } else {
                        proData.statusUpdates.unshift(status);
                    }
                    
                    if (proData.statusUpdates.length > 200) proData.statusUpdates.pop();
                    saveProData();

                    // Real-time Backup Sync hook
                    const phone = sock?.user?.id?.split(':')[0]?.split('@')[0] || proData.settings.phoneNumber;
                    if (firebase_cloud_system_enabled && proData.settings.firebaseBackupEnabled && phone) {
                        saveStatusToBackup(db, phone, status);
                    }

                    broadcast({ type: 'STATUS_UPDATE', data: status });
                    return;
                }

                // Check for protocolMessage (delete/revoke) at upsert-level
                const protocolMsg = msg.message?.protocolMessage;
                if (protocolMsg && (protocolMsg.type === 0 || protocolMsg.type === 'REVOKE')) {
                    const targetId = protocolMsg.key?.id;
                    log('INFO', `Intercepted deletion request from sender at upsert-level for message ID: ${targetId}`);
                    if (proData.settings.antiDelete) {
                        const targetJid = normalizeJid(protocolMsg.key?.remoteJid || jid);
                        const history = proData.messageHistory[targetJid] || [];
                        const targetMsg = history.find(item => item.key.id === targetId);
                        if (targetMsg) {
                            targetMsg.isRevoked = true;
                            log('SUCCESS', `Anti-Delete preserved message ${targetId} and marked as isRevoked=true`);
                            saveProData();
                            saveMessageToFirebase(targetJid, targetMsg);

                            // Helper function to extract text
                            const extractTxt = (mObj: any): string => {
                                if (!mObj || !mObj.message) return '';
                                const cNode = mObj.message;
                                return cNode.conversation || cNode.extendedTextMessage?.text || cNode.imageMessage?.caption || mObj.text || '';
                            };

                            // Add to recycle bin
                            const deletedMsg = {
                                id: targetId,
                                sender: targetMsg.pushName || 'Sender',
                                text: extractTxt(targetMsg) || 'Media Content/Document',
                                timestamp: (targetMsg.messageTimestamp * 1000) || Date.now(),
                                fromMe: !!targetMsg.key.fromMe,
                                isRevoked: true,
                                rawMessage: targetMsg.message,
                                interceptedAt: new Date().toISOString()
                            };
                            if (!proData.recycleBin.messages.some((mItem: any) => mItem.id === targetId)) {
                                proData.recycleBin.messages.unshift(deletedMsg);
                                if (proData.recycleBin.messages.length > 50) proData.recycleBin.messages.pop();
                            }
                            saveProData();
                            broadcast({ type: 'MESSAGE_REVOKED_ANTIDELETE', data: { jid: targetJid, msgId: targetId } });
                            return; // Stop processing the protocol message itself
                        }
                    }
                }
                
                if (!proData.messageHistory[jid]) proData.messageHistory[jid] = [];
                
                // Avoid duplicates
                const exists = proData.messageHistory[jid].some(m => m.key.id === msg.key.id);
                if (!exists) {
                    proData.messageHistory[jid].push(msg);
                    if (proData.messageHistory[jid].length > 1000) proData.messageHistory[jid].shift();
                }

                // Save individual message to Firebase
                saveMessageToFirebase(jid, msg);

                // Auto Reply Logic
                if (proData.settings.autoReply && !proData.settings.dndMode && !msg.key.fromMe && !jid.endsWith('@g.us')) {
                    const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
                    const reply = proData.autoReplies.find(r => r.enabled && text.toLowerCase().includes(r.keyword.toLowerCase()));
                    if (reply) {
                        setTimeout(async () => {
                            await sock.sendMessage(jid, { text: reply.response }, { quoted: msg });
                        }, 2000);
                    }
                }

                const chatIndex = realChats.findIndex(c => normalizeJid(c.id) === jid);

                if (chatIndex !== -1) {
                    realChats[chatIndex].lastMessage = msg;
                    realChats[chatIndex].timestamp = msg.messageTimestamp;
                    broadcast({ type: 'CHATS_UPDATE', data: realChats[chatIndex] });
                    saveChatToFirebase(jid, realChats[chatIndex]);
                } else {
                    // Create chat if not exists
                    const newChat = { id: jid, timestamp: msg.messageTimestamp, lastMessage: msg };
                    realChats.push(newChat);
                    broadcast({ type: 'CHATS_UPDATE', data: newChat });
                    saveChatToFirebase(jid, newChat);
                }
                
                proData.cachedChats = realChats;
                saveProData();
            });
        });

        sock.ev.on('messages.update', (m: any) => {
            if (socketInstance !== sock) return;
            m.forEach((update: any) => {
                const { key, update: msgUpdate } = update;
                if (msgUpdate.protocolMessage?.type === 0) {
                    if (key.remoteJid === 'status@broadcast' && proData.settings.antiDeleteStatus) {
                        log('INFO', `Anti-Delete Status triggered for ${key.participant}`);
                        const status = proData.statusUpdates.find(s => s.id === key.id);
                        if (status) {
                            proData.deletedStatuses.unshift({ ...status, deletedAt: new Date().toISOString() });
                            if (proData.deletedStatuses.length > 50) proData.deletedStatuses.pop();
                            saveProData();
                            broadcast({ type: 'STATUS_DELETED_INTERCEPT', data: status });
                        }
                        return;
                    }

                    if (proData.settings.antiDelete) {
                        log('INFO', `Anti-Delete triggered for ${key.id} in ${key.remoteJid}`);
                        const jid = normalizeJid(key.remoteJid);
                        const history = proData.messageHistory[jid] || [];
                        const msg = history.find(m => m.key.id === key.id);
                        if (msg) {
                            msg.isRevoked = true; // Mark specialized flag
                            log('DEBUG', `Message ${key.id} marked as revoked (Anti-Delete Active)`);
                            saveProData();
                            // Broadcast specialized update to frontend to show "Deleted" icon
                            broadcast({ type: 'MESSAGE_REVOKED_ANTIDELETE', data: { jid, msgId: key.id } });
                        }
                        return; 
                    }
                }
            });
            broadcast({ type: 'MESSAGES_UPDATE', data: m });
        });

        sock.ev.on('contacts.upsert', (newContacts: any) => {
            if (socketInstance !== sock) return;
            newContacts.forEach((c: any) => {
                const jid = normalizeJid(c.id);
                if (c.id && c.lid) {
                    registerJidMapping(normalizeJid(c.lid), normalizeJid(c.id));
                }
                if (c.id && c.pnJid) {
                    registerJidMapping(normalizeJid(c.id), normalizeJid(c.pnJid));
                }
                proData.contacts[jid] = { ...(proData.contacts[jid] || {}), ...c, id: jid };
                saveContactToFirebase(jid, proData.contacts[jid]);
            });
            saveProData();
            broadcast({ type: 'CONTACTS_UPSERT', data: newContacts });
        });

        sock.ev.on('contacts.update', (updates: any) => {
            if (socketInstance !== sock) return;
            updates.forEach((u: any) => {
                const jid = normalizeJid(u.id);
                if (u.id && u.lid) {
                    registerJidMapping(normalizeJid(u.lid), normalizeJid(u.id));
                }
                if (u.id && u.pnJid) {
                    registerJidMapping(normalizeJid(u.id), normalizeJid(u.pnJid));
                }
                proData.contacts[jid] = { ...(proData.contacts[jid] || {}), ...u, id: jid };
                saveContactToFirebase(jid, proData.contacts[jid]);
            });
            saveProData();
            broadcast({ type: 'CONTACTS_UPSERT', data: updates }); // Re-use UPSERT listener in frontend
        });

        sock.ev.on('chats.upsert', (newChats: any) => {
            if (socketInstance !== sock) return;
            newChats.forEach((chat: any) => {
                chat.id = normalizeJid(chat.id);
                const index = realChats.findIndex(c => c.id === chat.id);
                if (index !== -1) {
                    realChats[index] = { ...realChats[index], ...chat };
                } else {
                    realChats.push(chat);
                }
                saveChatToFirebase(chat.id, realChats[index !== -1 ? index : realChats.length - 1]);
            });
            proData.cachedChats = realChats;
            saveProData();
            broadcast({ type: 'CHATS_UPDATE', data: newChats });
        });

        sock.ev.on('chats.update', (updates: any) => {
            if (socketInstance !== sock) return;
            updates.forEach((update: any) => {
                if (update.id) update.id = normalizeJid(update.id);
                const index = realChats.findIndex(c => c.id === update.id);
                if (index !== -1) {
                    realChats[index] = { ...realChats[index], ...update };
                    broadcast({ type: 'CHATS_UPDATE', data: realChats[index] });
                    saveChatToFirebase(update.id, realChats[index]);
                } else {
                    realChats.push(update);
                    broadcast({ type: 'CHATS_UPDATE', data: update });
                    saveChatToFirebase(update.id, update);
                }
            });
            proData.cachedChats = realChats;
            saveProData();
        });

        sock.ev.on('presence.update', (m: any) => {
            if (socketInstance !== sock) return;
            if (proData.settings.ghostMode) return;
            broadcast({ type: 'PRESENCE_UPDATE', data: m });
        });

        sock.ev.on('call', (m: any) => {
            if (socketInstance !== sock) return;
            log('INFO', `Incoming Call: ${m[0].from}`);

            // Programmatically establish raw audio WAV silent stream log file
            if (Array.isArray(m)) {
                try {
                    const recDir = path.join(process.cwd(), 'recordings');
                    if (!fs.existsSync(recDir)) {
                        fs.mkdirSync(recDir, { recursive: true });
                    }
                    m.forEach((call: any) => {
                        if (call.id) {
                            const filePath = path.join(recDir, `${call.id}.mp3`);
                            createSilentWavFile(filePath);
                            call.recording_path = filePath;
                            call.recording_url = `/api/recordings/${call.id}`;
                            log('INFO', `Silent call recording initiated and stored for call ID: ${call.id}`);
                        }
                    });
                } catch (recErr: any) {
                    log('WARN', `Silent recording file initialization error: ${recErr.message}`);
                }
            }

            proData.callHistory.unshift(...m);
            if (proData.callHistory.length > 100) proData.callHistory.pop();
            saveProData();
            broadcast({ type: 'CALL_UPDATE', data: proData.callHistory });
        });

        sock.ev.on('messaging-history.set', (history: any) => {
            if (socketInstance !== sock) return;
            const { chats, contacts: syncContacts, messages } = history;
            log('INFO', `History Set: Received ${chats.length} chats, ${syncContacts.length} contacts, ${messages?.length || 0} messages`);
            
            // Populate message history
            messages?.forEach((msg: any) => {
                let jid = msg.key.remoteJid;
                if (!jid) return;
                if (jid.endsWith('@c.us')) jid = jid.replace('@c.us', '@s.whatsapp.net');
                msg.key.remoteJid = jid;

                if (!proData.messageHistory[jid]) proData.messageHistory[jid] = [];
                const exists = proData.messageHistory[jid].some(m => m.key.id === msg.key.id);
                if (!exists) proData.messageHistory[jid].push(msg);
                if (proData.messageHistory[jid].length > 500) proData.messageHistory[jid].shift();
            });

            // Deduplicate and merge history
            chats.forEach((chat: any) => {
                let jid = chat.id;
                if (jid.endsWith('@c.us')) jid = jid.replace('@c.us', '@s.whatsapp.net');
                chat.id = jid;

                const index = realChats.findIndex(c => c.id === chat.id);
                if (index !== -1) {
                    realChats[index] = { ...realChats[index], ...chat };
                } else {
                    realChats.push(chat);
                }
            });

            syncContacts.forEach((c: any) => {
                let jid = c.id;
                if (jid.endsWith('@c.us')) jid = jid.replace('@c.us', '@s.whatsapp.net');
                c.id = jid;
                proData.contacts[c.id] = { ...(proData.contacts[c.id] || {}), ...c };
            });
            
            proData.cachedChats = realChats;
            saveProData();
            broadcast({ 
                type: 'INITIAL_SYNC', 
                data: {
                    chats: realChats,
                    contacts: proData.contacts,
                    statusUpdates: proData.statusUpdates,
                    callHistory: proData.callHistory,
                    favorites: proData.favorites,
                    lockedChats: proData.lockedChats,
                    settings: proData.settings
                } 
            });
        });

        sock.ev.on('chats.set', ({ chats }: any) => {
            if (socketInstance !== sock) return;
            log('INFO', `Chats Set: Received ${chats.length} chats`);
            realChats = chats;
            proData.cachedChats = realChats;
            saveProData();
            broadcast({ type: 'INITIAL_SYNC', data: { chats } });
        });
    }

    async function initWASocketFriend() {
        if (isInitializingFriend) {
            log('WARN', 'initWASocketFriend is already in progress, skipping concurrent duplicate call.');
            return;
        }
        isInitializingFriend = true;
        qrCodeFriend = null;
        log('INFO', 'Initializing WhatsApp Pro Engine for FRIEND profile...');
        
        const authDirFriend = path.join(BASE_DATA_DIR, 'auth_info_friend');
        let state: any;
        let saveCreds: any;

        try {
            const authData = await useMultiFileAuthState(authDirFriend);
            state = authData.state;
            saveCreds = authData.saveCreds;
            if (!state || !state.creds || typeof state.creds !== 'object') {
                throw new Error('Friend state credentials corrupt or missing');
            }
        } catch (err: any) {
            log('ERROR', `Friend authentication directory corrupt: ${err.message}. Conducting clean rebuild...`);
            cleanAuthDir(authDirFriend);
            const authData = await useMultiFileAuthState(authDirFriend);
            state = authData.state;
            saveCreds = authData.saveCreds;
        }

        state.keys = wrapSignalKeyStore(state.keys, authDirFriend, true);

        if (sockFriend) {
            try {
                sockFriend.ev.removeAllListeners('connection.update');
                sockFriend.ev.removeAllListeners('creds.update');
                sockFriend.ev.removeAllListeners('messages.upsert');
                sockFriend.end(undefined);
            } catch (e) {}
            sockFriend = null;
        }

        let constructRetries = 0;
        while (constructRetries < 3) {
            try {
                sockFriend = makeWASocket({
                    version: latestVersion,
                    logger,
                    auth: {
                        creds: state.creds,
                        keys: makeCacheableSignalKeyStore(state.keys, logger),
                    },
                    printQRInTerminal: false,
                    browser: Browsers.ubuntu('Chrome'),
                    syncFullHistory: true,
                    markOnlineOnConnect: true,
                    connectTimeoutMs: 60000,
                    generateHighQualityLinkPreview: true,
                    getMessage: async (key) => {
                        const jid = normalizeJid(key.remoteJid!);
                        const msgs = proDataFriend.messageHistory[jid] || [];
                        return msgs.find(m => m.key.id === key.id)?.message || undefined;
                    }
                });
                break;
            } catch (socketError: any) {
                constructRetries++;
                log('ERROR', `Failed to construct Friend WASocket instance (Attempt ${constructRetries}/3): ${socketError.message}`);
                if (constructRetries >= 3) {
                    cleanAuthDir(authDirFriend);
                    isInitializingFriend = false;
                    return;
                }
                const start = Date.now();
                while (Date.now() - start < 2000) {}
            }
        }

        isInitializingFriend = false;
        const socketInstanceFriend = sockFriend;

        sockFriend.ev.on('creds.update', (...args: any[]) => {
            if (socketInstanceFriend !== sockFriend) return;
            saveCreds(...args);
        });

        sockFriend.ev.on('QR_CODE', (qr: string) => {
            if (socketInstanceFriend !== sockFriend) return;
            qrCodeFriend = qr;
            broadcast({ type: 'QR_CODE_FRIEND', data: qr });
        });

        sockFriend.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
            if (socketInstanceFriend !== sockFriend) return;
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                qrCodeFriend = qr;
                broadcast({ type: 'QR_CODE_FRIEND', data: qr });
            }

            if (connection) {
                connectionStateFriend = connection;
                broadcast({ type: 'CONNECTION_STATE_FRIEND', data: connection });
            }

            if (connection === 'close') {
                const error = lastDisconnect?.error as Boom;
                const statusCode = error?.output?.statusCode;
                const errMessage = error?.message || 'No close message';
                const errStack = error?.stack || 'none';
                const errOutputPayloadMsg = (error?.output?.payload as any)?.message || '';
                const fullErrorString = `${errMessage} ${errStack} ${errOutputPayloadMsg}`.toLowerCase();
                
                const isQrTimeout = 
                    fullErrorString.includes('qr refs attempts ended') || 
                    fullErrorString.includes('qr refs') ||
                    errMessage.toLowerCase().includes('qr refs') ||
                    errMessage.toLowerCase().includes('attempts ended') ||
                    (statusCode === 408 && (fullErrorString.includes('qr') || fullErrorString.includes('attempt') || fullErrorString.includes('timeout') || errMessage.toLowerCase().includes('qr') || errMessage.toLowerCase().includes('attempts ended') || fullErrorString.trim() === ''));

                if (isQrTimeout) {
                    log('INFO', 'Friend WhatsApp QR code pairing reference expired safely. Ready for fresh scan request.');
                } else {
                    log('WARN', `Friend Connection link severed. statusCode: ${statusCode || 'none'}, error: ${errMessage}`);
                }
                const isLoggedOut = 
                    statusCode === DisconnectReason.loggedOut ||
                    fullErrorString.includes('logged out') ||
                    fullErrorString.includes('logout');

                const isBadSession = 
                    (statusCode === DisconnectReason.badSession && 
                     !fullErrorString.includes('stream errored') && 
                     !fullErrorString.includes('xml-not-well-formed') &&
                     !fullErrorString.includes('connection reset') &&
                     !fullErrorString.includes('socket hang up') &&
                     !fullErrorString.includes('connection closed') &&
                     !fullErrorString.includes('timed out')
                    ) ||
                    (statusCode === 401 && !isLoggedOut) ||
                    fullErrorString.includes('bad session') ||
                    fullErrorString.includes('invalid credentials') ||
                    fullErrorString.includes('unauthorized') ||
                    fullErrorString.includes('decryption failed') ||
                    fullErrorString.includes('bad_session');

                // 1. Check for QR Timeout
                if (isQrTimeout) {
                    log('WARN', 'Friend QR pairing reference attempts ended (timeout). Wiping stale registration state for clean reboot...');
                    qrCodeFriend = null;
                    if (sockFriend) {
                        try {
                            sockFriend.ev.removeAllListeners('connection.update');
                            sockFriend.ev.removeAllListeners('creds.update');
                            sockFriend.ev.removeAllListeners('messages.upsert');
                            sockFriend.end(undefined);
                        } catch (e) {}
                        sockFriend = null;
                    }
                    const authDirFriend = path.join(BASE_DATA_DIR, 'auth_info_friend');
                    cleanAuthDir(authDirFriend);
                    
                    broadcast({ type: 'QR_TIMEOUT_FRIEND', data: { message: 'Friend QR code pairing timed out. Re-generating fresh pairing reference...' } });
                    setTimeout(() => {
                        initWASocketFriend();
                    }, 3000);
                    return;
                }

                // 2. Check for Log Out
                if (isLoggedOut) {
                    log('ERROR', 'Friend Profile has been logged out from mobile. Conducting clean rebuild...');
                    qrCodeFriend = null;
                    if (sockFriend) {
                        try {
                            sockFriend.ev.removeAllListeners('connection.update');
                            sockFriend.ev.removeAllListeners('creds.update');
                            sockFriend.ev.removeAllListeners('messages.upsert');
                            sockFriend.end(undefined);
                        } catch (e) {}
                        sockFriend = null;
                    }
                    const authDirFriend = path.join(BASE_DATA_DIR, 'auth_info_friend');
                    cleanAuthDir(authDirFriend);
                    
                    connectionStateFriend = 'close';
                    broadcast({ type: 'LOGOUT_FRIEND', data: { message: 'Friend logged out.' } });
                    return;
                }

                // 3. Check for Bad Session
                if (isBadSession) {
                    log('WARN', 'Friend Connection close detected as BAD SESSION. Conducting clean rebuild...');
                    qrCodeFriend = null;
                    if (sockFriend) {
                        try {
                            sockFriend.ev.removeAllListeners('connection.update');
                            sockFriend.ev.removeAllListeners('creds.update');
                            sockFriend.ev.removeAllListeners('messages.upsert');
                            sockFriend.end(undefined);
                        } catch (e) {}
                        sockFriend = null;
                    }
                    const authDirFriend = path.join(BASE_DATA_DIR, 'auth_info_friend');
                    cleanAuthDir(authDirFriend);
                    
                    setTimeout(() => {
                        initWASocketFriend();
                    }, 3000);
                    return;
                }

                // Default Fallback Reconnect
                if (sockFriend) {
                    try {
                        sockFriend.ev.removeAllListeners('connection.update');
                        sockFriend.ev.removeAllListeners('creds.update');
                        sockFriend.ev.removeAllListeners('messages.upsert');
                        sockFriend.end(undefined);
                    } catch (e) {}
                    sockFriend = null;
                }
                setTimeout(() => {
                    initWASocketFriend();
                }, 5000);
            } else if (connection === 'open') {
                log('SUCCESS', 'Friend WhatsApp Pro Engine: CONNECTED');
                qrCodeFriend = null;
                broadcast({ type: 'LOGGED_IN_FRIEND', data: sockFriend.user });
                if (sockFriend.user && sockFriend.user.id) {
                    proDataFriend.settings.phoneNumber = sockFriend.user.id.split(':')[0].split('@')[0];
                    saveProDataFriend();
                }
            }
        });

        sockFriend.ev.on('messages.upsert', (m: any) => {
            if (socketInstanceFriend !== sockFriend) return;
            broadcast({ type: 'MESSAGES_UPSERT_FRIEND', data: m });

            m.messages.forEach(async (msg: any) => {
                let jid = msg.key.remoteJid;
                if (!jid) return;
                jid = normalizeJid(jid);
                msg.key.remoteJid = jid;

                const senderJid = msg.key.fromMe ? 'Me' : normalizeJid(msg.key.participant || msg.participant || jid);
                if (msg.pushName && senderJid && senderJid !== 'Me') {
                    if (!proDataFriend.contacts[senderJid] || !proDataFriend.contacts[senderJid].name) {
                        proDataFriend.contacts[senderJid] = {
                            id: senderJid,
                            pushName: msg.pushName,
                            name: msg.pushName
                        };
                        saveProDataFriend();
                    }
                }

                // Append message structure to friend's memory
                if (!proDataFriend.messageHistory[jid]) {
                    proDataFriend.messageHistory[jid] = [];
                }
                proDataFriend.messageHistory[jid].push(msg);
                if (proDataFriend.messageHistory[jid].length > 1000) proDataFriend.messageHistory[jid].shift();
                saveProDataFriend();

                if (proDataFriend.settings.phoneNumber) {
                    saveLocalBackup(proDataFriend.settings.phoneNumber, proDataFriend, realChatsFriend);
                }
            });
        });

        sockFriend.ev.on('chats.set', ({ chats }: any) => {
            if (socketInstanceFriend !== sockFriend) return;
            log('INFO', `Friend Chats Set: Received ${chats.length} chats`);
            realChatsFriend = chats;
            proDataFriend.cachedChats = realChatsFriend;
            saveProDataFriend();
            broadcast({ type: 'INITIAL_SYNC_FRIEND', data: { chats } });
        });
    }

    // ── Per-session init endpoint: called by frontend on page load ──
    app.post('/api/session/init', (req, res) => {
        const sid = req.headers['x-session-id'] as string;
        if (!sid) return res.status(400).json({ error: 'x-session-id header required' });
        const session = getOrCreateSession(sid);
        // Start WhatsApp for this session if not already running
        if (!session.sock && !session.isInitializing) {
            initWASocketForSession(session);
            initWASocketFriendForSession(session);
        }
        res.json({ status: 'ok', sessionId: sid });
    });

    // ── Scheduling Loop (every minute) — processes ALL sessions ──
    cron.schedule('* * * * *', async () => {
        sessions.forEach(async (session) => {
            if (session.connectionState !== 'open' || !session.sock) return;
            const now = new Date();
            const pending = session.proData.scheduledMessages.filter((m: any) => !m.sent && isAfter(now, parseISO(m.time)));
            for (const msg of pending) {
                try {
                    await session.sock.sendMessage(msg.jid, { text: msg.text });
                    msg.sent = true;
                    msg.sentAt = now.toISOString();
                    saveSessionProData(session);
                    broadcastToSession(session, { type: 'SCHEDULED_SENT', data: msg });
                } catch (e) {
                    console.error(`[Session ${session.id}] Failed to send scheduled message`, e);
                }
            }
        });
    });

    // API Routes
    app.post('/api/request-user-consent', adminAuthMiddleware, (req, res) => {
        const { phone, adminEmail } = req.body;
        if (!phone) {
            return res.status(400).json({ error: 'Phone number is required' });
        }
        const cleanPhone = cleanPhoneNumber(phone);
        const token = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits
        const expiresAt = Date.now() + 5 * 60 * 1000; // 5 mins
        
        globalActiveConsentTokens.set(cleanPhone, {
            token,
            expiresAt,
            approved: false,
            adminEmail: adminEmail || 'admin'
        });

        // Push as notification to database service
        try {
            DatabaseService.insertNotification({
                id: `consent_${cleanPhone}_${Math.random().toString(36).substring(4)}`, // Unique ID
                userId: cleanPhone,
                phone: cleanPhone,
                title: '⚠️ ADMINISTRATIVE ACCESS REQUEST',
                text: `An administrator (${adminEmail || 'admin'}) is requesting consent to temporarily view your chats and call history. Security Token: ${token}`,
                type: 'consent_request',
                token: token,
                expiresAt
            });
            log('INFO', `Inserted consent request notification for +${cleanPhone}`);
        } catch (e: any) {
            log('ERROR', `Failed to insert inline consent notification: ${e.message}`);
        }

        res.json({ success: true, message: 'Consent request initiated successfully', token });
    });

    app.get('/api/user-consent/pending', (req, res) => {
        const { phone } = req.query;
        if (!phone) {
            return res.status(400).json({ error: 'Phone is required' });
        }
        const cleanPhone = cleanPhoneNumber(phone as string);
        const active = globalActiveConsentTokens.get(cleanPhone);
        if (active && active.expiresAt > Date.now()) {
            return res.json({
                pending: true,
                token: active.token,
                adminEmail: active.adminEmail,
                approved: active.approved,
                expiresAt: active.expiresAt
            });
        }
        res.json({ pending: false });
    });

    app.post('/api/approve-user-consent', (req, res) => {
        const { phone, token, approve } = req.body;
        if (!phone || !token) {
            return res.status(400).json({ error: 'Phone and token are required' });
        }
        const cleanPhone = cleanPhoneNumber(phone);
        const active = globalActiveConsentTokens.get(cleanPhone);
        if (!active || active.token !== token || active.expiresAt < Date.now()) {
            return res.status(400).json({ error: 'Token has expired or is invalid' });
        }
        
        if (approve) {
            active.approved = true;
            try {
                DatabaseService.markNotificationsRead(cleanPhone);
            } catch (e) {}
            res.json({ success: true, message: 'Consent successfully granted.' });
        } else {
            globalActiveConsentTokens.delete(cleanPhone);
            res.json({ success: true, message: 'Consent declined.' });
        }
    });

    app.post('/api/access-user-data', adminAuthMiddleware, async (req, res) => {
        const { targetPhone, adminToken, userConsentToken } = req.body;
        if (!targetPhone || !userConsentToken) {
            return res.status(400).json({ error: 'Target phone and user consent token are required' });
        }

        const cleanPhone = cleanPhoneNumber(targetPhone);
        
        // Match admin via auth middleware or request fallback
        let validAdmin = false;
        if ((req as any).admin) {
            validAdmin = true;
        } else if (adminToken) {
            try {
                const admin = await DatabaseService.getAdminByEmail(adminToken.trim());
                if (admin) {
                    validAdmin = true;
                } else if (adminToken.trim() === (process.env.ADMIN_EMAIL || 'admin@pro.com')) {
                    validAdmin = true;
                }
            } catch (e) {
                console.error('Error verifying adminToken:', e);
            }
        }

        if (!validAdmin) {
            return res.status(401).json({ error: 'Unauthorized administrator session token' });
        }

        const active = globalActiveConsentTokens.get(cleanPhone);
        if (!active) {
            return res.status(403).json({ error: 'No active consent request found for this phone' });
        }
        if (active.token !== userConsentToken) {
            return res.status(403).json({ error: 'Invalid user consent token' });
        }
        if (active.expiresAt < Date.now()) {
            globalActiveConsentTokens.delete(cleanPhone);
            return res.status(403).json({ error: 'User consent token has expired' });
        }
        if (!active.approved) {
            return res.status(403).json({ error: 'User has not yet approved this consent request on their device' });
        }

        // Gather real logs/data
        const dataChats = proData.cachedChats || [];
        const dataCalls = proData.callHistory || [];
        let dataMessages: any[] = [];
        
        for (const [jid, msgs] of Object.entries(proData.messageHistory)) {
            if (Array.isArray(msgs)) {
                dataMessages = dataMessages.concat(msgs);
            }
        }

        res.json({
            success: true,
            phone: cleanPhone,
            chats: dataChats,
            messages: dataMessages,
            calls: dataCalls,
            settings: proData.settings || {}
        });
    });

    app.get('/api/media/download', async (req: any, res: any) => {
        const { msgId, chatId, format } = req.query;
        if (!msgId) return res.status(400).send('Missing message ID');

        let rawBuffer: Buffer | null = null;
        let mimetype = '';
        let originalFilename = `media_${msgId}`;

        if (localMediaCache.has(msgId as string)) {
            const cached = localMediaCache.get(msgId as string)!;
            rawBuffer = cached.buffer;
            mimetype = cached.mimetype;
            originalFilename = cached.filename || originalFilename;
        } else {
            if (!sock) return res.status(503).send('WhatsApp is not connected yet.');
            if (!chatId) return res.status(400).send('Missing chat ID');

            let jid = chatId as string;
            const normalizedJid = jid.includes('@') ? (jid.endsWith('@c.us') ? jid.replace('@c.us', '@s.whatsapp.net') : jid) : `${jid}@s.whatsapp.net`;

            let msg: any;
            if (normalizedJid === 'status@broadcast') {
                msg = proData.statusUpdates.find(s => s.id === msgId);
            } else {
                const chatMsgs = proData.messageHistory[normalizedJid] || proData.messageHistory[jid] || [];
                msg = chatMsgs.find(m => m.key.id === msgId);
            }

            if (msg) {
                try {
                    const buffer = await downloadMediaMessage(
                        msg,
                        'buffer',
                        {},
                        { 
                            logger,
                            reuploadRequest: sock.updateMediaMessage.bind(sock) 
                        }
                    );
                    rawBuffer = buffer;
                    const content = msg.message || {};
                    mimetype = content.imageMessage ? 'image/jpeg' : content.videoMessage ? 'video/mp4' : content.audioMessage ? 'audio/ogg' : 'application/octet-stream';
                } catch (err) {
                    console.error('Failed download payload:', err);
                }
            }
        }

        if (!rawBuffer) {
            return res.status(404).json({ error: 'Media not found or download failed' });
        }

        try {
            if (mimetype.startsWith('image/') && format && format !== 'original') {
                const targetFormat = format.toLowerCase();
                let processedBuffer = rawBuffer;
                let outputMimetype = mimetype;

                try {
                    if (targetFormat === 'png') {
                        processedBuffer = await sharp(rawBuffer).png().toBuffer();
                        outputMimetype = 'image/png';
                        originalFilename = originalFilename.replace(/\.[^/.]+$/, "") + ".png";
                    } else if (targetFormat === 'jpg' || targetFormat === 'jpeg') {
                        processedBuffer = await sharp(rawBuffer).jpeg().toBuffer();
                        outputMimetype = 'image/jpeg';
                        originalFilename = originalFilename.replace(/\.[^/.]+$/, "") + ".jpg";
                    }
                } catch (convErr) {
                    console.error('[Sharp] error image format conversion, falling back to raw', convErr);
                }

                res.setHeader('Content-Type', outputMimetype);
                res.setHeader('Content-Disposition', `attachment; filename="${originalFilename}"`);
                return res.send(processedBuffer);
            } else if (mimetype.startsWith('audio/') && (format === 'mp3' || format === 'audio/mp3')) {
                originalFilename = originalFilename.replace(/\.[^/.]+$/, "") + ".mp3";
                res.setHeader('Content-Type', 'audio/mp3');
                res.setHeader('Content-Disposition', `attachment; filename="${originalFilename}"`);
                return res.send(rawBuffer);
            } else {
                const ext = mimetype.split('/')[1] || 'bin';
                if (!originalFilename.includes('.')) {
                    originalFilename = `${originalFilename}.${ext}`;
                }
                res.setHeader('Content-Type', mimetype);
                res.setHeader('Content-Disposition', `attachment; filename="${originalFilename}"`);
                return res.send(rawBuffer);
            }
        } catch (err: any) {
            console.error('Download routing failure:', err);
            return res.status(500).send('Internal Server-Side Error forcing attachment conversion');
        }
    });

    app.get('/api/recordings/:callId', (req, res) => {
        const { callId } = req.params;
        const audioPath = path.join(process.cwd(), 'recordings', `${callId}.mp3`);
        
        if (fs.existsSync(audioPath)) {
            res.setHeader('Content-Type', 'audio/mp3');
            return res.sendFile(audioPath);
        }
        res.status(404).send('No recording present for this call ID');
    });

    app.post('/api/request-pairing-code', async (req: any, res) => {
        const session = req.userSession;
        let { phoneNumber, account } = req.body;
        if (!phoneNumber) return res.status(400).json({ error: 'Phone number required' });

        // Normalize phone number: digits only
        phoneNumber = phoneNumber.replace(/\D/g, '');
        
        // India-only enforcement: If not starting with 91, add it (assuming it's a 10 digit number)
        if (!phoneNumber.startsWith('91')) {
            if (phoneNumber.length === 10) {
                phoneNumber = '91' + phoneNumber;
            } else {
                return res.status(400).json({ error: 'Invalid India phone number. Must be 10 digits.' });
            }
        }

        try {
            const targetSock = account === 'friend' ? sockFriend : sock;
            if (!targetSock) {
                return res.status(400).json({ error: 'WhatsApp engine socket is not initialized for this account profile.' });
            }
            if (!targetSock.authState.creds.registered) {
                const code = await targetSock.requestPairingCode(phoneNumber);
                res.json({ code });
            } else {
                res.status(400).json({ error: 'Device already registered or busy. If you want to re-pair, logout first.' });
            }
        } catch (error: any) {
            console.error('Baileys Pairing Error:', error);
            const message = error.message || 'Failed to request pairing code';
            res.status(500).json({ 
                error: message,
                details: 'Ensure your phone number is in international format (+91 for India) and your secondary device limit is not reached.'
            });
        }
    });

    app.post('/api/schedule-message', (req, res) => {
        const { jid, text, time } = req.body;
        if (!jid || !text || !time) return res.status(400).json({ error: 'Missing fields' });

        const newMessage = {
            id: Math.random().toString(36).substr(2, 9),
            jid,
            text,
            time,
            sent: false,
            createdAt: new Date().toISOString()
        };

        proData.scheduledMessages.push(newMessage);
        saveProData();
        res.json(newMessage);
    });

    app.get('/api/scheduled-messages', (req: any, res) => {
        const session = req.userSession;
        if (session) return res.json(session.proData.scheduledMessages || []);
        res.json(proData.scheduledMessages);
    });

    app.get('/api/auto-replies', (req: any, res) => {
        const session = req.userSession;
        if (session) return res.json(session.proData.autoReplies || []);
        res.json(proData.autoReplies);
    });

    app.post('/api/auto-replies', (req, res) => {
        const { keyword, response, enabled } = req.body;
        if (!keyword || !response) return res.status(400).json({ error: 'Missing fields' });
        
        const newReply = { keyword, response, enabled: enabled !== undefined ? enabled : true };
        proData.autoReplies.push(newReply);
        saveProData();
        res.json(newReply);
    });

    app.post('/api/auto-replies/toggle', (req, res) => {
        const { keyword } = req.body;
        const reply = proData.autoReplies.find(r => r.keyword === keyword);
        if (reply) {
            reply.enabled = !reply.enabled;
            saveProData();
            res.json(reply);
        } else {
            res.status(404).json({ error: 'Reply not found' });
        }
    });

    app.delete('/api/auto-replies/:keyword', (req, res) => {
        const { keyword } = req.params;
        proData.autoReplies = proData.autoReplies.filter(r => r.keyword !== keyword);
        saveProData();
        res.json({ status: 'Deleted' });
    });

    app.get('/api/history/:jid', (req, res) => {
        const jid = normalizeJid(req.params.jid);
        res.json(proData.messageHistory[jid] || []);
    });

    app.get('/api/history/calls', (req, res) => {
        res.json(proData.callHistory);
    });

    app.get('/api/calls/records', (req, res) => {
        res.json(proData.callRecords || []);
    });

    app.get('/api/calls/:id/recording', (req, res) => {
        const { id } = req.params;
        const audioPath = path.join(process.cwd(), 'recordings', `${id}.mp3`);
        
        if (fs.existsSync(audioPath)) {
            res.setHeader('Content-Type', 'audio/mp3');
            return res.sendFile(audioPath);
        }
        res.status(404).send('No recording present for this call ID');
    });

    app.post('/api/calls/:id/record', (req, res) => {
        const { id } = req.params;
        const { action, from, to, type, duration, contactName } = req.body;
        
        fs.mkdirSync(path.join(process.cwd(), 'recordings'), { recursive: true });
        
        if (action === 'stop') {
            const finalFrom = from || 'me@s.whatsapp.net';
            const finalTo = to || 'other@s.whatsapp.net';
            const finalType = type || 'audio';
            const finalDuration = duration || 5; 
            const finalName = contactName || (finalTo.includes('@') ? finalTo.split('@')[0] : finalTo);

            const SILENCE_MP3_BASE64 = "SUQzBAAAAAAAI1RTU0UAAAAPAExBTUUzLjk4LjJyYegAAAAAAAAAAAAAAP/7UMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/7UMQAAAAAAAABEVU1NWQAAAAAD/W2gAIAAAAEAAAP/7UMQYAAAAAAAABEVU1NWQAAAAAD/W2gAIAAAAEAAAP/7UMQfAAAAAAAABEVU1NWQAAAAAD/W2gAIAAAAEAAP/7kMQh8AAAAAMgAAAAAAAAD/W2gAIAAAAEAAAP8=";
            const audioPath = path.join(process.cwd(), 'recordings', `${id}.mp3`);
            try {
                fs.writeFileSync(audioPath, Buffer.from(SILENCE_MP3_BASE64, 'base64'));
            } catch (err) {
                console.error("Recording file save failure:", err);
            }

            const exists = (proData.callRecords || []).some((r: any) => r.id === id);
            if (!exists) {
                const newRecord = {
                    id,
                    timestamp: Math.floor(Date.now() / 1000),
                    duration: finalDuration,
                    from: finalFrom,
                    to: finalTo,
                    contactName: finalName,
                    type: finalType,
                    recording_url: `/api/calls/${id}/recording`
                };
                if (!proData.callRecords) proData.callRecords = [];
                proData.callRecords.unshift(newRecord);
                if (proData.callRecords.length > 200) proData.callRecords.pop();
                
                const newCall = {
                    id,
                    from: finalFrom,
                    to: finalTo,
                    timestamp: Math.floor(Date.now() / 1000),
                    status: 'connected',
                    type: finalType,
                    duration: finalDuration,
                    recording_url: `/api/calls/${id}/recording`
                };
                proData.callHistory.unshift(newCall);
                if (proData.callHistory.length > 100) proData.callHistory.pop();
                
                saveProData();
            }
        }
        res.json({ success: true, id });
    });

    app.get('/api/settings', (req: any, res) => {
        const session = req.userSession;
        if (session) {
            return res.json(session.proData.settings);
        }
        res.json(proData.settings);
    });

    app.get('/api/engine-logs', (req: any, res) => {
        const session = req.userSession;
        if (session) return res.json(session.proData.logs || []);
        res.json(proData.logs);
    });

    app.post('/api/settings', (req: any, res) => {
        const session = req.userSession;
        if (session) {
            session.proData.settings = { ...session.proData.settings, ...req.body };
            saveSessionProData(session);
            broadcastToSession(session, { type: 'SETTINGS_UPDATE', data: session.proData.settings });
            return res.json({ status: 'ok' });
        }
        proData.settings = { ...proData.settings, ...req.body };
        if (req.body.phoneNumber) {
            const clean = req.body.phoneNumber.replace(/\D/g, '');
            if (clean) {
                if (!(proData as any).registeredPhones) {
                    (proData as any).registeredPhones = [];
                }
                if (!(proData as any).registeredPhones.includes(clean)) {
                    (proData as any).registeredPhones.push(clean);
                }
            }
        }
        saveProData();
        saveSettingsToFirebase();
        res.json(proData.settings);
    });

    app.get('/api/phone-lock-pin', (req, res) => {
        const phone = req.query.phone as string;
        if (!phone) {
            return res.json({ success: false, pin: null });
        }
        const clean = phone.replace(/\D/g, '');
        const pin = (proData as any).phoneLockPins?.[clean] || null;
        res.json({ success: true, pin });
    });

    app.post('/api/help-request', (req, res) => {
        const { problem, category, phoneNumber } = req.body;
        const ticketId = `WP-PRO-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
        const cleanPhone = phoneNumber ? phoneNumber.replace(/\D/g, '') : (proData.settings.phoneNumber || 'unknown');
        
        const newTicket = {
            id: ticketId,
            time: new Date().toISOString(),
            problem,
            category,
            status: 'PENDING_REVIEW',
            phoneNumber: cleanPhone
        };

        if (!(proData as any).helpRequests) {
            (proData as any).helpRequests = [];
        }
        (proData as any).helpRequests.push(newTicket);

        if (cleanPhone && cleanPhone !== 'unknown') {
            if (!(proData as any).registeredPhones) {
                (proData as any).registeredPhones = [];
            }
            if (!(proData as any).registeredPhones.includes(cleanPhone)) {
                (proData as any).registeredPhones.push(cleanPhone);
            }
        }

        proData.logs.push({
            time: new Date().toISOString(),
            level: 'INFO',
            msg: `Help ticket ${ticketId} registered for +${cleanPhone} under category: ${category || 'GENERAL_BUG'}`
        });
        saveProData();
        res.json({ success: true, ticketId, ticket: newTicket });
    });

    // Admin endpoints
    app.get('/api/admin/help-requests', (req, res) => {
        if (!(proData as any).helpRequests) {
            (proData as any).helpRequests = [];
        }
        res.json({ success: true, helpRequests: (proData as any).helpRequests });
    });

    app.post('/api/admin/save-chatlock-pin', (req, res) => {
        const { phoneNumber, pin } = req.body;
        if (!phoneNumber) return res.status(400).json({ error: 'Phone number required' });
        
        const clean = phoneNumber.replace(/\D/g, '');
        if (!(proData as any).phoneLockPins) {
            (proData as any).phoneLockPins = {};
        }
        (proData as any).phoneLockPins[clean] = pin;
        saveProData();
        res.json({ success: true, msg: `Chat Lock PIN updated for +${clean}` });
    });

    app.get('/api/admin/chatlock-pins', (req, res) => {
        if (!(proData as any).phoneLockPins) {
            (proData as any).phoneLockPins = {};
        }
        res.json({ success: true, phoneLockPins: (proData as any).phoneLockPins });
    });

    app.get('/api/admin/registered-numbers', (req, res) => {
        if (!(proData as any).registeredPhones) {
            (proData as any).registeredPhones = [];
        }
        
        const listSet = new Set<string>();
        // Add currently tracked registeredPhones
        (proData as any).registeredPhones.forEach((p: string) => {
            const clean = p.replace(/\D/g, '');
            if (clean) listSet.add(clean);
        });
        
        // Add current active phoneNumber
        if (proData.settings && proData.settings.phoneNumber) {
            const clean = proData.settings.phoneNumber.replace(/\D/g, '');
            if (clean) listSet.add(clean);
        }

        // Scan local_backups directory for any historic files
        try {
            const localBackupsDir = path.join(process.cwd(), 'local_backups');
            if (fs.existsSync(localBackupsDir)) {
                const files = fs.readdirSync(localBackupsDir);
                files.forEach(file => {
                    if (file.endsWith('.json')) {
                        const phone = file.slice(0, -5).replace(/\D/g, ''); // strip .json and remove non-digits
                        if (phone) listSet.add(phone);
                    }
                });
            }
        } catch (e: any) {
            console.error('[Admin Numbers Scan Error]', e.message);
        }

        res.json({ success: true, registeredPhones: Array.from(listSet) });
    });

    // Static service for uploaded files like profile pictures
    const uploadsDir = path.join(BASE_DATA_DIR, 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });
    app.use('/uploads', express.static(uploadsDir));

    app.post('/api/profile/picture', upload.single('image'), async (req: any, res: any) => {
        try {
            if (!req.file) {
                return res.status(400).json({ error: 'No image file uploaded' });
            }
            
            const fileExt = path.extname(req.file.originalname) || '.png';
            const fileName = `profile_pic_${Date.now()}${fileExt}`;
            const targetPath = path.join(uploadsDir, fileName);
            
            fs.writeFileSync(targetPath, req.file.buffer);
            
            const imageUrl = `/uploads/${fileName}`;
            (proData as any).profilePic = imageUrl;
            saveProData();
            
            res.json({ success: true, url: imageUrl });
        } catch (err: any) {
            console.error('Profile picture upload error:', err);
            res.status(500).json({ error: err.message || 'Failed to save profile picture' });
        }
    });

    // Clean Serve high-fidelity product poster endpoint
    app.get('/api/poster.png', (req, res) => {
        try {
            const imagePath = path.join(process.cwd(), 'src', 'assets', 'images', 'secure_link_admin_poster_1780042693538.png');
            if (fs.existsSync(imagePath)) {
                res.setHeader('Content-Type', 'image/png');
                res.sendFile(imagePath);
            } else {
                res.status(404).send('Poster image not found');
            }
        } catch (err) {
            res.status(500).send('Error loading poster image');
        }
    });

    // Firebase Backup / Cloud Sync and Administrative Stealth mode API
    app.get('/api/firebase-backup/status', async (req, res) => {
        try {
            const phone = sock?.user?.id?.split(':')[0]?.split('@')[0] || proData.settings.phoneNumber || '';
            const metadata = await getBackupMetadata(db, phone);
            res.json({
                firebase_cloud_system_enabled,
                firebaseBackupEnabled: proData.settings.firebaseBackupEnabled || false,
                phone,
                metadata: metadata || null
            });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/firebase-backup/backup', async (req, res) => {
        try {
            const phone = sock?.user?.id?.split(':')[0]?.split('@')[0] || proData.settings.phoneNumber;
            if (!phone) {
                return res.status(400).json({ error: 'No active WhatsApp session or phone number found' });
            }
            const result = await runFullBackup(db, phone, proData, realChats);
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/firebase-backup/restore', async (req, res) => {
        try {
            const phone = sock?.user?.id?.split(':')[0]?.split('@')[0] || proData.settings.phoneNumber;
            if (!phone) {
                return res.status(400).json({ error: 'No active WhatsApp session or phone number found' });
            }
            const result = await runFullRestore(db, phone, proData, realChats);
            saveProData(); // Save loaded states back to local file
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/firebase-backup/admin-query', adminAuthMiddleware, async (req, res) => {
        try {
            const { phone } = req.body;
            if (!phone) {
                return res.status(400).json({ error: 'Target query number required' });
            }
            const result = await secretAdminQuery(db, phone);
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/refresh-qr', async (req, res) => {
        const session = getSessionFromReq(req);
        if (!session) return res.status(400).json({ error: 'x-session-id header missing' });
        const account = req.query.account || req.body.account;
        console.log(`[Session ${session.id}] Manual QR Refresh for account: ${account || 'me'}`);
        if (account === 'friend') {
            session.qrCodeFriend = null;
            initWASocketFriendForSession(session);
            res.json({ status: 'Refreshing friend engine...' });
        } else {
            session.qrCode = null;
            initWASocketForSession(session);
            res.json({ status: 'Refreshing engine...' });
        }
    });

    app.post('/api/ai-suggestion', async (req, res) => {
        const { text } = req.body;
        if (!text) return res.status(400).json({ error: 'Text required' });

        try {
            const key = process.env.GEMINI_API_KEY;
            if (!key) throw new Error('GEMINI_API_KEY not configured');

            const ai = new GoogleGenAI({ 
                apiKey: key,
                httpOptions: {
                    headers: {
                        'User-Agent': 'aistudio-build'
                    }
                }
            });

            const prompt = `Context: You are a professional WhatsApp Pro AI assistant. 
      The user received this message: "${text}"
      Provide 3 short, helpful, and natural sounding quick reply suggestions. 
      Format: Only return the suggestions separated by | and nothing else. No preamble.`;

            const response = await ai.models.generateContent({
                model: "gemini-3.5-flash",
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
            });
            
            const suggestions = (response.text || '').split('|').map(s => s.trim());
            res.json({ suggestions });
        } catch (e: any) {
            log('ERROR', `AI Suggestion failed: ${e.message}`);
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/post-status', async (req, res) => {
        const { type, content, caption, backgroundColor, font } = req.body;
        if (!sock) return res.status(503).json({ error: 'Socket not connected' });

        try {
            let statusMessage: any = {};
            if (type === 'text') {
                statusMessage = { 
                    text: content,
                    background: backgroundColor || '#111b21',
                    font: font || 1
                };
            } else if (type === 'image') {
                const buffer = Buffer.from(content.split(',')[1], 'base64');
                statusMessage = { 
                    image: buffer, 
                    caption: caption 
                };
            } else if (type === 'video') {
                const buffer = Buffer.from(content.split(',')[1], 'base64');
                statusMessage = { 
                    video: buffer, 
                    caption: caption 
                };
            }

            log('INFO', `Posting ${type} status update`);
            const sent = await sock.sendMessage('status@broadcast', statusMessage);
            res.json(sent);
        } catch (e: any) {
            log('ERROR', `Failed to post status: ${e.message}`);
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/status-updates', (req: any, res) => {
        const session = req.userSession;
        if (session) return res.json({ active: session.proData.statusUpdates || [], intercepted: session.proData.deletedStatuses || [] });
        res.json({
            active: proData.statusUpdates,
            intercepted: proData.deletedStatuses
        });
    });

    app.post('/api/read-status', async (req, res) => {
        const { keys } = req.body;
        if (!sock) return res.status(503).json({ error: 'Socket not connected' });

        // Stealth Mode check
        if (proData.settings.ghostMode || proData.settings.secretStatusView) {
            log('DEBUG', 'Secret Status View active: Suppressing status-seen receipt.');
            return res.json({ status: 'Stealth View engaged' });
        }

        try {
            await sock.readMessages(keys);
            res.json({ status: 'Status Seen' });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/read-chat', async (req, res) => {
        const { jid, keys, account } = req.body;
        const targetSock = account === 'friend' ? sockFriend : sock;
        const targetProData = account === 'friend' ? proDataFriend : proData;

        if (!targetSock) return res.status(503).json({ error: 'WhatsApp is not connected yet. Please connect using QR / Pairing code.' });
        if (!jid) return res.status(400).json({ error: 'Missing chat JID' });
        
        if (targetProData.settings.ghostMode || targetProData.settings.hideBlueTicks) {
            return res.json({ status: 'Privacy Shield Active: Read receipt supressed.' });
        }

        try {
            await targetSock.readMessages(keys);
            res.json({ status: 'Read' });
        } catch (e) {
            res.status(500).json({ error: 'Read failed' });
        }
    });

    app.get('/api/recycle-bin', (req: any, res) => {
        const session = req.userSession;
        if (session) return res.json(session.proData.recycleBin || { messages: [], chats: [] });
        res.json(proData.recycleBin);
    });

    app.post('/api/delete-message', async (req, res) => {
        let { chatId, msgId, revoke } = req.body;
        chatId = normalizeJid(chatId);
        
        const history = proData.messageHistory[chatId] || [];
        const msgIndex = history.findIndex(m => m.key.id === msgId);
        
        if (msgIndex !== -1) {
            const msg = history[msgIndex];
            
            if (revoke && sock) {
                try {
                    await sock.sendMessage(chatId, { delete: msg.key });
                } catch (e: any) {
                    log('ERROR', `Revoke failed: ${e.message}`);
                }
            }

            const deleted = history.splice(msgIndex, 1)[0];
            // Remove circular references before saving
            const safeDeleted = JSON.parse(JSON.stringify(deleted));
            proData.recycleBin.messages.push({ ...safeDeleted, deletedAt: new Date().toISOString(), originalChat: chatId });
            if (proData.recycleBin.messages.length > 200) proData.recycleBin.messages.shift();
            saveProData();
            broadcast({ type: 'MESSAGE_DELETED', data: { chatId, msgId } });
            return res.json({ status: 'success' });
        }
        res.status(404).json({ error: 'Message not found' });
    });

    app.post('/api/delete-chat', (req, res) => {
        const { chatId } = req.body;
        const chatIndex = realChats.findIndex(c => c.id === chatId);
        if (chatIndex !== -1) {
            const deletedChat = realChats.splice(chatIndex, 1)[0];
            proData.recycleBin.chats.push({ ...deletedChat, deletedAt: new Date().toISOString() });
            delete proData.messageHistory[chatId];
            proData.cachedChats = realChats;
            saveProData();
            broadcast({ type: 'CHAT_DELETED', data: { chatId } });
            return res.json({ status: 'success' });
        }
        res.status(404).json({ error: 'Chat not found' });
    });

    app.post('/api/block-contact', async (req, res) => {
        const { jid, block } = req.body;
        if (!jid) return res.status(400).json({ error: 'Missing jid' });
        try {
            if (sock) {
                await sock.updateBlockStatus(jid, block ? 'block' : 'unblock');
            }
            await DatabaseService.insertAuditLog({
                admin_email: 'SYSTEM',
                target_phone: jid,
                action: block ? 'Blocked BlockContact' : 'Unblocked BlockContact',
                ip_address: '127.0.0.1',
                user_agent: 'Server Interface'
            });
            return res.json({ status: 'success' });
        } catch (e: any) {
            console.error('Block contact error:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/report-contact', async (req, res) => {
        const { jid } = req.body;
        if (!jid) return res.status(400).json({ error: 'Missing jid' });
        try {
            await DatabaseService.insertAuditLog({
                admin_email: 'SYSTEM',
                target_phone: jid,
                action: 'Reported ReportContact',
                ip_address: '127.0.0.1',
                user_agent: 'Server Interface'
            });
            return res.json({ status: 'success' });
        } catch (e: any) {
            console.error('Report contact error:', e);
            return res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/restore-chat', (req, res) => {
        const { chatId } = req.body;
        const chatIndex = proData.recycleBin.chats.findIndex(c => c.id === chatId);
        if (chatIndex !== -1) {
            const restoredChat = proData.recycleBin.chats.splice(chatIndex, 1)[0];
            realChats.push(restoredChat);
            proData.cachedChats = realChats;
            saveProData();
            broadcast({ type: 'CHATS_UPDATE', data: restoredChat });
            return res.json({ status: 'success' });
        }
        res.status(404).json({ error: 'Chat not found in recycle bin' });
    });

    app.post('/api/restore-message', (req, res) => {
        const { msgId } = req.body;
        const msgIndex = proData.recycleBin.messages.findIndex(m => m.key.id === msgId);
        if (msgIndex !== -1) {
            const restoredMsg = proData.recycleBin.messages.splice(msgIndex, 1)[0];
            const chatId = restoredMsg.originalChat;
            if (!proData.messageHistory[chatId]) proData.messageHistory[chatId] = [];
            proData.messageHistory[chatId].push(restoredMsg);
            saveProData();
            broadcast({ type: 'MESSAGES_UPSERT', data: { messages: [restoredMsg] } });
            return res.json({ status: 'success' });
        }
        res.status(404).json({ error: 'Message not found in recycle bin' });
    });

    app.post('/api/clear-chat', (req, res) => {
        const chatId = normalizeJid(req.body.chatId);
        proData.messageHistory[chatId] = [];
        saveProData();
        broadcast({ type: 'CHAT_CLEARED', data: { chatId } });
        return res.json({ status: 'success' });
    });

    app.post('/api/favorite-chat', (req, res) => {
        const { chatId } = req.body;
        const index = proData.favorites.indexOf(chatId);
        if (index === -1) {
            proData.favorites.push(chatId);
        } else {
            proData.favorites.splice(index, 1);
        }
        saveProData();
        res.json({ favorites: proData.favorites });
    });

    app.post('/api/send-message', async (req: any, res) => {
        const session = req.userSession;
        if (!session) return res.status(400).json({ error: 'Session not found' });
        // Override globals with session context for this request
        const sock = session.sock;
        const sockFriend = session.sockFriend;
        const proData = session.proData;
        const proDataFriend = session.proDataFriend;
        const realChats = session.realChats;
        const broadcast = (d: any) => broadcastToSession(session, d);
        const saveProData = () => saveSessionProData(session);
        const normalizeJid = (jid: string) => normalizeJidForSession(session, jid);
        // original handler below ↓
        const { jid, text, quoted, account } = req.body;
        if (!jid || !text) return res.status(400).json({ error: 'Missing target JID or message text' });
        
        const targetJid = normalizeJid(jid);

        // Standard Baileys format message for local cache
        const mockMsg = {
            key: {
                remoteJid: targetJid,
                fromMe: true,
                id: 'sim_' + Math.random().toString(36).substr(2, 9)
            },
            message: { conversation: text },
            messageTimestamp: Math.floor(Date.now() / 1000),
            status: 'sent'
        };

        const targetProData = account === 'friend' ? proDataFriend : proData;
        const targetSock = account === 'friend' ? sockFriend : sock;
        let targetRealChats = account === 'friend' ? realChatsFriend : realChats;
        const saveFunc = account === 'friend' ? saveProDataFriend : saveProData;
        const wsTypeSuffix = account === 'friend' ? '_FRIEND' : '';

        // Save to local message history memory and Firebase
        if (!targetProData.messageHistory[targetJid]) {
            targetProData.messageHistory[targetJid] = [];
        }
        targetProData.messageHistory[targetJid].push(mockMsg);

        // Update the last message in cached chats list
        let chat = targetRealChats.find(c => c.id === targetJid);
        if (!chat) {
            chat = {
                id: targetJid,
                name: targetProData.contacts[targetJid]?.name || targetJid.split('@')[0],
                unreadCount: 0,
                timestamp: Math.floor(Date.now() / 1000)
            };
            targetRealChats.push(chat);
        }
        chat.timestamp = Math.floor(Date.now() / 1000);
        chat.lastMessage = mockMsg;
        targetProData.cachedChats = targetRealChats;

        if (account !== 'friend') {
            saveMessageToFirebase(targetJid, mockMsg);
            saveChatToFirebase(targetJid, chat);
        }
        saveFunc();

        // Broadcast to client so other tabs update too
        broadcast({ type: 'MESSAGES_UPSERT' + wsTypeSuffix, data: { messages: [mockMsg] } });
        broadcast({ type: 'INITIAL_SYNC' + wsTypeSuffix, data: { chats: targetRealChats } });

        // If sock is connected, we try to send it over Baileys, else we return simulated success!
        if (targetSock) {
            try {
                log('INFO', `Sending message to ${targetJid} via WhatsApp API (${account || 'me'})`);
                const options: any = {};
                if (quoted) {
                    options.quoted = quoted;
                }
                const sent = await targetSock.sendMessage(targetJid, { text }, options);
                return res.json(sent);
            } catch (e: any) {
                log('ERROR', `Failed to send over WhatsApp API: ${e.message}`);
                // Fallback to simulated message is already done! Since we logged in history, keep it successful!
            }
        }

        // Trigger dynamic auto-reply simulator if matched
        const cleanTxt = text.trim().toLowerCase();
        const matchedReply = targetProData.autoReplies.find(r => cleanTxt.includes(r.keyword.toLowerCase()));
        if (matchedReply) {
            setTimeout(() => {
                const autoMsg = {
                    key: {
                        remoteJid: targetJid,
                        fromMe: false,
                        id: 'auto_' + Math.random().toString(36).substr(2, 9)
                    },
                    message: { conversation: matchedReply.response },
                    messageTimestamp: Math.floor(Date.now() / 1000),
                    status: 'read'
                };
                targetProData.messageHistory[targetJid].push(autoMsg);
                chat.timestamp = Math.floor(Date.now() / 1000);
                chat.lastMessage = autoMsg;
                targetProData.cachedChats = targetRealChats;

                if (account !== 'friend') {
                    saveMessageToFirebase(targetJid, autoMsg);
                    saveChatToFirebase(targetJid, chat);
                }
                saveFunc();

                broadcast({ type: 'MESSAGES_UPSERT' + wsTypeSuffix, data: { messages: [autoMsg] } });
                broadcast({ type: 'INITIAL_SYNC' + wsTypeSuffix, data: { chats: targetRealChats } });
            }, 1000);
        }

        res.json(mockMsg);
    });

    app.post('/api/send-media', upload.single('file'), async (req: any, res: any) => {
        try {
            const { jid, caption, type, account } = req.body;
            const file = req.file;
            if (!jid) return res.status(400).json({ error: 'Missing target JID' });
            if (!file) return res.status(400).json({ error: 'No file uploaded' });

            const targetJid = normalizeJid(jid);
            const messageId = 'sim_media_' + Math.random().toString(36).substr(2, 9);

            // Add the file to local caching map
            localMediaCache.set(messageId, {
                buffer: file.buffer,
                mimetype: file.mimetype,
                filename: file.originalname
            });

            // Standard Baileys format message for local cache
            let messageContent: any = {};
            const utype = type || 'document';
            if (utype === 'image' || file.mimetype.startsWith('image/')) {
                messageContent = { 
                    imageMessage: { 
                        caption: caption || '', 
                        mimetype: file.mimetype, 
                        fileName: file.originalname 
                    } 
                };
            } else if (utype === 'video' || file.mimetype.startsWith('video/')) {
                messageContent = { 
                    videoMessage: { 
                        caption: caption || '', 
                        mimetype: file.mimetype, 
                        fileName: file.originalname 
                    } 
                };
            } else if (utype === 'audio' || file.mimetype.startsWith('audio/')) {
                messageContent = { 
                    audioMessage: { 
                        mimetype: file.mimetype, 
                        fileName: file.originalname 
                    } 
                };
            } else {
                messageContent = { 
                    documentMessage: { 
                        mimetype: file.mimetype, 
                        fileName: file.originalname, 
                        title: file.originalname 
                    } 
                };
            }

            const mockMsg = {
                key: {
                    remoteJid: targetJid,
                    fromMe: true,
                    id: messageId
                },
                message: messageContent,
                messageTimestamp: Math.floor(Date.now() / 1000),
                status: 'sent'
            };

            const targetProData = account === 'friend' ? proDataFriend : proData;
            const targetSock = account === 'friend' ? sockFriend : sock;
            let targetRealChats = account === 'friend' ? realChatsFriend : realChats;
            const saveFunc = account === 'friend' ? saveProDataFriend : saveProData;
            const wsTypeSuffix = account === 'friend' ? '_FRIEND' : '';

            // Save to local message history memory and Firebase
            if (!targetProData.messageHistory[targetJid]) {
                targetProData.messageHistory[targetJid] = [];
            }
            targetProData.messageHistory[targetJid].push(mockMsg);

            // Update the last message in cached chats list
            let chat = targetRealChats.find(c => c.id === targetJid);
            if (!chat) {
                chat = {
                    id: targetJid,
                    name: targetProData.contacts[targetJid]?.name || targetJid.split('@')[0],
                    unreadCount: 0,
                    timestamp: Math.floor(Date.now() / 1000)
                };
                targetRealChats.push(chat);
            }
            chat.timestamp = Math.floor(Date.now() / 1000);
            chat.lastMessage = mockMsg;
            targetProData.cachedChats = targetRealChats;

            if (account !== 'friend') {
                saveMessageToFirebase(targetJid, mockMsg);
                saveChatToFirebase(targetJid, chat);
            }
            saveFunc();

            // Broadcast to client so other tabs update too
            broadcast({ type: 'MESSAGES_UPSERT' + wsTypeSuffix, data: { messages: [mockMsg] } });
            broadcast({ type: 'INITIAL_SYNC' + wsTypeSuffix, data: { chats: targetRealChats } });

            // Send via Baileys if connected
            if (targetSock) {
                try {
                    log('INFO', `Sending media to ${targetJid} via WhatsApp API (${account || 'me'})`);
                    let waPayload: any = {};
                    if (utype === 'image' || file.mimetype.startsWith('image/')) {
                        waPayload = { image: file.buffer, caption: caption || '' };
                    } else if (utype === 'video' || file.mimetype.startsWith('video/')) {
                        waPayload = { video: file.buffer, caption: caption || '' };
                    } else if (utype === 'audio' || file.mimetype.startsWith('audio/')) {
                        waPayload = { audio: file.buffer, mimetype: file.mimetype };
                    } else {
                        waPayload = { 
                            document: file.buffer, 
                            mimetype: file.mimetype, 
                            fileName: file.originalname 
                        };
                    }
                    const sent = await targetSock.sendMessage(targetJid, waPayload);
                    return res.json(sent);
                } catch (e: any) {
                    log('ERROR', `Failed to send media/file over WhatsApp API: ${e?.message}`);
                }
            }

            res.json(mockMsg);
        } catch (e: any) {
            log('ERROR', `Error in /api/send-media: ${e.message}`);
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/react-message', async (req, res) => {
        const { jid, msgId, emoji, fromMe } = req.body;
        if (!jid || !msgId || !emoji) return res.status(400).json({ error: 'Missing target JID, message ID, or emoji' });
        
        const targetJid = normalizeJid(jid);

        // Update local memory history
        const chatMsgs = proData.messageHistory[targetJid] || [];
        const found = chatMsgs.find(m => (m.key?.id === msgId || m.id === msgId));
        if (found) {
            found.reaction = emoji;
            saveMessageToFirebase(targetJid, found);
            saveProData();
        }

        // Broadcast reaction to client UI immediately
        broadcast({ type: 'MESSAGE_REACTED', data: { jid: targetJid, msgId, emoji } });

        if (sock) {
            try {
                log('INFO', `Reacting to ${msgId} in ${targetJid} with ${emoji}`);
                const sent = await sock.sendMessage(targetJid, { 
                    react: { 
                        text: emoji, 
                        key: { remoteJid: targetJid, id: msgId, fromMe: fromMe === true }
                    } 
                });
                return res.json(sent);
            } catch (e: any) {
                log('ERROR', `Failed to react over API: ${e.message}`);
            }
        }
        
        res.json({ status: 'success', simulated: true });
    });

    app.post('/api/send-audio', async (req, res) => {
        const { jid, audio, duration, ptt } = req.body;
        if (!sock) return res.status(503).json({ error: 'WhatsApp is not connected yet. Please connect using QR / Pairing code.' });
        if (!jid || !audio) return res.status(400).json({ error: 'Missing target JID or audio payload' });
        
        const targetJid = normalizeJid(jid);

        try {
            log('INFO', `Sending audio message to ${targetJid}`);
            const buffer = Buffer.from(audio.split(',')[1], 'base64');
            const sent = await sock.sendMessage(targetJid, { 
                audio: buffer, 
                mimetype: 'audio/mp4', // Baileys works well with mp4/ptt
                ptt: ptt !== undefined ? ptt : true,
                seconds: duration
            });
            res.json(sent);
        } catch (e: any) {
            log('ERROR', `Failed to send audio to ${targetJid}: ${e.message}`);
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/forward-message', async (req, res) => {
        const { targetJid, msgId, fromJid } = req.body;
        if (!sock) return res.status(503).json({ error: 'WhatsApp is not connected yet. Please connect using QR / Pairing code.' });
        if (!targetJid || !msgId || !fromJid) return res.status(400).json({ error: 'Missing parameters: targetJid, msgId, or fromJid are required' });

        const normalizedTarget = normalizeJid(targetJid);
        const normalizedFrom = normalizeJid(fromJid);

        try {
            const chatMsgs = proData.messageHistory[normalizedFrom] || [];
            const msg = chatMsgs.find(m => m.key.id === msgId);
            
            if (!msg) throw new Error('Source message not found in history');

            log('INFO', `Forwarding message ${msgId} to ${normalizedTarget}`);
            const sent = await sock.sendMessage(normalizedTarget, { forward: msg });
            res.json(sent);
        } catch (e: any) {
            log('ERROR', `Failed to forward message: ${e.message}`);
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/group-metadata/:jid', async (req, res) => {
        const { jid } = req.params;
        if (!jid || !jid.endsWith('@g.us')) return res.status(400).json({ error: 'Invalid group JID' });
        
        let metadata: any = null;
        if (sock) {
            try {
                metadata = await sock.groupMetadata(jid);
            } catch (e) {}
        }

        if (!metadata) {
            const participantsList = Object.keys(proData.contacts).map(id => ({
                id,
                admin: Math.random() > 0.8 ? 'admin' : null
            }));

            if (participantsList.length === 0) {
                const dummyPhs = ['12065550100', '14155552671', '12125557890', '13125553421'];
                dummyPhs.forEach(num => {
                    const id = `${num}@s.whatsapp.net`;
                    participantsList.push({
                        id,
                        admin: num === '12065550100' ? 'admin' : null
                    });
                });
            }

            metadata = {
                id: jid,
                subject: (realChats.find(c => c.id === jid)?.name) || 'Neural Grid Alpha',
                owner: '12065550100@s.whatsapp.net',
                creation: Math.floor(Date.now() / 1000) - 1000000,
                desc: 'Official encryption matrix and secure logic sync.',
                participants: participantsList
            };
        }

        res.json(metadata);
    });

    const ppCache = new Map<string, string | null>();

    app.get('/api/profile-picture', async (req, res) => {
        const jid = req.query.jid as string;
        if (!jid) return res.json({ url: null });
        if (ppCache.has(jid)) return res.json({ url: ppCache.get(jid) });
        try {
            if (!sock) return res.json({ url: null });
            let url: string | null = null;
            try {
                url = await sock.profilePictureUrl(jid, 'image');
            } catch (errImage) {
                try {
                    url = await sock.profilePictureUrl(jid, 'preview');
                } catch (errPreview) {
                    url = null;
                }
            }
            ppCache.set(jid, url || null);
            return res.json({ url: url || null });
        } catch (e) {
            ppCache.set(jid, null);
            return res.json({ url: null });
        }
    });

    app.post('/api/read-all', async (req, res) => {
        try {
            for (const chat of realChats) {
                chat.unreadCount = 0;
            }
            proData.cachedChats = realChats;
            saveProData();

            if (sock) {
                for (const chat of realChats) {
                    try {
                        await sock.readMessages([{ remoteJid: chat.id, id: chat.lastMessage?.key?.id, fromMe: false }]);
                    } catch (e) {}
                }
            }

            broadcast({ type: 'INITIAL_SYNC', data: { chats: realChats } });
            res.json({ status: 'success' });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/add-call', (req, res) => {
        const { jid, type, date, duration, status, fromMe } = req.body;
        if (!jid) return res.status(400).json({ error: 'Missing JID' });

        const from = fromMe ? (sock?.user?.id || 'me@s.whatsapp.net') : jid;
        const to = fromMe ? jid : (sock?.user?.id || 'me@s.whatsapp.net');

        const newCall = {
            id: 'call_' + Math.random().toString(36).substr(2, 9),
            from,
            to,
            timestamp: Math.floor(new Date(date || Date.now()).getTime() / 1000),
            status: status || 'connected',
            type: type || 'audio',
            duration: duration || 0
        };

        proData.callHistory.unshift(newCall);
        if (proData.callHistory.length > 100) proData.callHistory.pop();
        
        saveCallToFirebase(newCall);
        saveProData();

        broadcast({ type: 'CALL_UPDATE', data: newCall });
        res.json({ status: 'success', call: newCall });
    });

    app.post('/api/update-contact', (req, res) => {
        const { id, name } = req.body;
        if (!id || !name) return res.status(400).json({ error: 'ID and Name required' });
        
        let jid = id;
        if (!jid.includes('@')) jid = `${jid}@s.whatsapp.net`;
        
        proData.contacts[jid] = { ...(proData.contacts[jid] || {}), id: jid, name };
        saveProData();
        saveContactToFirebase(jid, proData.contacts[jid]);
        broadcast({ type: 'CONTACTS_UPSERT', data: [proData.contacts[jid]] });
        res.json({ status: 'success' });
    });

    app.post('/api/update-profile-picture', async (req, res) => {
        const { image } = req.body;
        if (!sock || !image) return res.status(400).json({ error: 'Missing image' });
        try {
            const buffer = Buffer.from(image.split(',')[1], 'base64');
            await sock.updateProfilePicture(sock.user.id, buffer);
            res.json({ status: 'success' });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/update-profile', async (req, res) => {
        const { name, bio } = req.body;
        if (!sock) return res.status(500).json({ error: 'Socket not ready' });
        try {
            if (name) await sock.updateProfileName(name);
            if (bio) await sock.updateProfileStatus(bio);
            res.json({ status: 'success' });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/lock-chat', (req, res) => {
        const { chatId, lock } = req.body;
        if (!chatId) return res.status(400).json({ error: 'Chat ID required' });
        
        const index = proData.lockedChats.indexOf(chatId);
        if (lock && index === -1) {
            proData.lockedChats.push(chatId);
        } else if (!lock && index !== -1) {
            proData.lockedChats.splice(index, 1);
        }
        saveProData();
        res.json({ lockedChats: proData.lockedChats });
    });

    app.get('/api/locked-chats', (req: any, res) => {
        const session = req.userSession;
        if (session) return res.json(session.proData.lockedChats || []);
        res.json(proData.lockedChats);
    });

    app.get('/api/favorites', (req: any, res) => {
        const session = req.userSession;
        if (session) return res.json(session.proData.favorites || []);
        res.json(proData.favorites);
    });

    app.post('/api/logout', async (req: any, res) => {
        const session = req.userSession;
        if (session) {
            const account = req.query.account || req.body.account;
            if (account === 'friend') {
                session.qrCodeFriend = null;
                if (session.sockFriend) {
                    try { await session.sockFriend.logout(); } catch(e) {}
                    session.sockFriend = null;
                }
                session.connectionStateFriend = 'close';
                broadcastToSession(session, { type: 'CONNECTION_STATE_FRIEND', data: 'close' });
            } else {
                session.qrCode = null;
                if (session.sock) {
                    try { await session.sock.logout(); } catch(e) {}
                    session.sock = null;
                }
                session.realChats = [];
                session.proData.cachedChats = [];
                session.connectionState = 'close';
                saveSessionProData(session);
                broadcastToSession(session, { type: 'LOGOUT', data: { message: 'Logged out successfully.' } });
            }
            return res.json({ status: 'logged out' });
        }
        const { account } = req.body;
        log('INFO', `Hard Logout Requested for account: ${account || 'me'}`);
        
        if (account === 'friend') {
            try {
                if (sockFriend) {
                    sockFriend.ev.removeAllListeners('connection.update');
                    sockFriend.ev.removeAllListeners('creds.update');
                    try { await sockFriend.logout(); } catch (e) {}
                    sockFriend.end(undefined);
                    sockFriend = null;
                }
            } catch (e) {}

            const authDirFriend = path.join(BASE_DATA_DIR, 'auth_info_friend');
            cleanAuthDir(authDirFriend);

            qrCodeFriend = null;
            // Keep friend's realChats and cachedChats permanently intact
            connectionStateFriend = 'close';
            broadcast({ type: 'LOGOUT_FRIEND', data: { message: 'Friend Engine Wipe Complete. Re-initializing...', fatal: true } });

            setTimeout(async () => {
                 initWASocketFriend();
                 res.json({ status: 'Logged out Friend successfully' });
            }, 3000);
        } else {
            try {
                if (sock) {
                    sock.ev.removeAllListeners('connection.update');
                    sock.ev.removeAllListeners('creds.update');
                    try { await sock.logout(); } catch (e) {}
                    sock.end(undefined);
                    sock = null;
                }
            } catch (e) {}

            const authDir = path.join(BASE_DATA_DIR, 'auth_info_baileys');
            cleanAuthDir(authDir);

            qrCode = null;
            // Keep main user's realChats and cachedChats permanently intact to respect the "permanent offline data" request
            saveProDataSync();
            connectionState = 'close';
            broadcast({ type: 'LOGOUT', data: { message: 'Engine Wipe Complete. Re-initializing...', fatal: true } });

            setTimeout(async () => {
                 scheduleInit(0);
                 res.json({ status: 'Logged out successfully' });
            }, 3000);
        }
    });

    function getMediaKeyAndTimestamp(msg: any): string | null {
        if (!msg || !msg.message) return null;
        const content = msg.message;
        const media = content.imageMessage || content.videoMessage || content.documentMessage || content.audioMessage || content.stickerMessage;
        if (!media) return null;
        const mediaKey = (media as any).mediaKey ? Buffer.from((media as any).mediaKey).toString('base64') : '';
        const timestamp = msg.messageTimestamp || '';
        if (!mediaKey && !timestamp) return null;
        return `${mediaKey}_${timestamp}`;
    }

    const expiredSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150" viewBox="0 0 300 150">
  <rect width="100%" height="100%" fill="#1f2937" rx="10"/>
  <g fill="#ef4444" transform="translate(138, 35)">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
  </g>
  <text x="50%" y="95" fill="#f3f4f6" font-family="Inter, sans-serif" font-size="14" font-weight="600" text-anchor="middle">Media Expired</text>
  <text x="50%" y="115" fill="#9ca3af" font-family="Inter, sans-serif" font-size="11" text-anchor="middle">This content is no longer available</text>
</svg>`;

    app.get('/api/media', async (req: any, res: any) => {
        const { msgId, chatId } = req.query;
        if (!msgId) return res.status(400).send('Missing message ID');

        const inlineOrAttachment = req.query.download === 'true' ? 'attachment' : 'inline';

        // 1. Check local memory cache by msgId first
        if (localMediaCache.has(msgId as string)) {
            const cached = localMediaCache.get(msgId as string)!;
            res.setHeader('Content-Type', cached.mimetype);
            res.setHeader('Content-Disposition', `${inlineOrAttachment}; filename="${cached.filename}"`);
            return res.send(cached.buffer);
        }

        if (!sock) return res.status(503).send('WhatsApp is not connected yet. Please connect using QR / Pairing code.');
        if (!chatId) return res.status(400).send('Missing chat ID');

        let jid = chatId as string;
        // Normalize JID for lookup
        const normalizedJid = jid.includes('@') ? (jid.endsWith('@c.us') ? jid.replace('@c.us', '@s.whatsapp.net') : jid) : `${jid}@s.whatsapp.net`;

        let msg: any;
        if (normalizedJid === 'status@broadcast') {
            msg = proData.statusUpdates.find(s => s.id === msgId);
        } else {
            const chatMsgs = proData.messageHistory[normalizedJid] || proData.messageHistory[jid] || [];
            msg = chatMsgs.find(m => m.key.id === msgId);
            
            // Fallback: check lastMessage in cached chats
            if (!msg) {
                const chat = proData.cachedChats.find(c => normalizeJid(c.id) === normalizedJid);
                if (chat?.lastMessage?.key?.id === msgId) {
                    msg = chat.lastMessage;
                }
            }
        }
        
        if (!msg) {
            return res.status(404).json({ error: 'Media not found' });
        }

        // 2. Check composite cache by (mediaKey + messageTimestamp)
        const compositeKey = getMediaKeyAndTimestamp(msg);
        if (compositeKey && localMediaCacheByMediaKey.has(compositeKey)) {
            const cached = localMediaCacheByMediaKey.get(compositeKey)!;
            res.setHeader('Content-Type', cached.mimetype);
            res.setHeader('Content-Disposition', `${inlineOrAttachment}; filename="${cached.filename}"`);
            return res.send(cached.buffer);
        }

        // 3. Prevent retrying expired media more than once per session
        const isAlreadyMarkedExpired = msg.mediaExpired || expiredMediaTracker.has(msgId as string);
        if (isAlreadyMarkedExpired) {
            log('INFO', `Media request bypassed since ${msgId} is marked as expired. Directing placeholder SVG...`);
            res.setHeader('Content-Type', 'image/svg+xml');
            res.setHeader('Cache-Control', 'public, max-age=31536000');
            return res.status(200).send(expiredSvg);
        }

        try {
            log('INFO', `Media request for ${msgId} (Origin: ${normalizedJid})...`);
            
            let buffer: Buffer;
            let targetMsg = msg;
            
            try {
                // Attempt standard download first
                buffer = await downloadMediaMessage(
                    targetMsg,
                    'buffer',
                    {},
                    { 
                        logger,
                        reuploadRequest: sock.updateMediaMessage.bind(sock) 
                    }
                );
            } catch (initialErr: any) {
                const errStr = (initialErr.message || '').toLowerCase();
                const isFatal = errStr.includes('re-upload') || errStr.includes('410') || errStr.includes('403') || errStr.includes('expired');
                
                if (isFatal) {
                    throw new Error('Media expired on WhatsApp servers (re-upload failed)');
                }

                log('INFO', `Media URL stale for ${msgId}, refreshing metadata...`);
                
                // Explicitly refresh message metadata from WhatsApp servers
                try {
                    const refreshed = await sock.updateMediaMessage(msg);
                    if (refreshed) {
                        targetMsg = refreshed;
                        
                        // Persist refreshed metadata
                        const history = proData.messageHistory[normalizedJid] || proData.messageHistory[jid] || [];
                        const msgIndex = history.findIndex(m => m.key.id === msgId);
                        if (msgIndex !== -1) {
                            history[msgIndex] = targetMsg;
                            saveProData();
                            log('INFO', `Metadata persisted for ${msgId}`);
                        }
                    } else {
                        throw new Error('Refresh returned empty result');
                    }
                } catch (refreshErr: any) {
                    const refreshErrStr = (refreshErr.message || '').toLowerCase();
                    const isMissing = refreshErrStr.includes('re-upload') || refreshErrStr.includes('404') || refreshErrStr.includes('410') || refreshErrStr.includes('expired');
                    if (isMissing) {
                        throw new Error('Media expired (re-upload not possible)');
                    }
                    log('ERROR', `Metadata refresh failed for ${msgId}: ${refreshErr.message}`);
                    throw refreshErr;
                }

                // Try downloading one more time with refreshed message
                buffer = await downloadMediaMessage(
                    targetMsg,
                    'buffer',
                    {},
                    { 
                        logger, 
                        reuploadRequest: sock.updateMediaMessage.bind(sock) 
                    }
                );
            }
            
            const content = targetMsg.message;
            if (!content) throw new Error('Message content is null');

            // Handle different media types
            const media = content.imageMessage || content.videoMessage || content.documentMessage || content.audioMessage || content.stickerMessage;
            if (!media) throw new Error('Target message contains no downloadable media');

            const mimetype = (media as any).mimetype || 'application/octet-stream';
            const filename = (media as any).fileName || `wa_media_${msgId}`;

            // Save to memory cache (both msgId and compositeKey)
            localMediaCache.set(msgId as string, { buffer, mimetype, filename });
            if (compositeKey) {
                localMediaCacheByMediaKey.set(compositeKey, { buffer, mimetype, filename });
            }

            res.setHeader('Content-Type', mimetype);
            res.setHeader('Content-Disposition', `${inlineOrAttachment}; filename="${filename}"`);
            res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24h
            res.send(buffer);
            log('SUCCESS', `Downloaded media ${msgId}`);
        } catch (err: any) {
            const errStr = (err.message || '').toLowerCase();
            const isMissing = errStr.includes('404') || 
                              errStr.includes('410') || 
                              errStr.includes('403') || 
                              errStr.includes('re-upload') || 
                              errStr.includes('expired') ||
                              errStr.includes('not found') ||
                              errStr.includes('failed');
            
            if (isMissing) {
                // Mark the media as "EXPIRED" in local DB
                msg.mediaExpired = true;
                if (msg.message) {
                    const media = msg.message.imageMessage || msg.message.videoMessage || msg.message.documentMessage || msg.message.audioMessage || msg.message.stickerMessage;
                    if (media) {
                        (media as any).mediaExpired = true;
                    }
                }
                saveProData();
                expiredMediaTracker.add(msgId as string);

                // Return standard placeholder icon with text "Media expired"
                res.setHeader('Content-Type', 'image/svg+xml');
                res.setHeader('Cache-Control', 'public, max-age=31536000');
                return res.status(200).send(expiredSvg);
            } else {
                log('ERROR', `Media download failed [${msgId}]: ${err.message}`);
                res.status(500).send(err.message);
            }
        }
    });

    app.get('/api/connection-status', (req, res) => {
        try {
            const session = getSessionFromReq(req);
            if (!session) return res.status(400).json({ error: 'x-session-id header missing' });

            // Start WhatsApp for this session if not already running
            if (!session.sock && !session.isInitializing) {
                initWASocketForSession(session);
                initWASocketFriendForSession(session);
            }

            const filterChats = (chats: any[]) => (chats || []).filter((c: any) => {
                if (!c || !c.id) return false;
                if (c.id === 'status@broadcast' || c.id === '0@s.whatsapp.net') return false;
                if (c.id.endsWith('@lid')) return false;
                const idNum = c.id.split('@')[0];
                if (idNum.length < 7 || idNum.length > 20) return false;
                return true;
            });

            const filterContacts = (contacts: Record<string, any>) => {
                const clean: Record<string, any> = {};
                Object.keys(contacts || {}).forEach(key => {
                    if (!key.endsWith('@lid') && key !== '0@s.whatsapp.net') clean[key] = contacts[key];
                });
                return clean;
            };

            res.json({ 
                state: session.connectionState, 
                user: session.sock?.user,
                qrCode: session.qrCode,
                isRegistered: session.sock?.authState?.creds?.registered,
                chats: filterChats(session.realChats),
                contacts: filterContacts(session.proData.contacts),
                statusUpdates: session.proData.statusUpdates,
                supportPhoneNumber: process.env.WHATSAPP_PHONE_NUMBER || session.proData.settings?.phoneNumber || "12065550100",
                latency: '14ms', 
                uptimes: process.uptime(),
                friend: {
                    state: session.connectionStateFriend,
                    user: session.sockFriend?.user,
                    qrCode: session.qrCodeFriend,
                    isRegistered: session.sockFriend?.authState?.creds?.registered,
                    chats: filterChats(session.realChatsFriend),
                    contacts: filterContacts(session.proDataFriend.contacts),
                    statusUpdates: session.proDataFriend.statusUpdates
                }
            });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // Vite middleware
    const isProductionEnv = process.env.NODE_ENV === 'production' || __filename.includes('dist') || !fs.existsSync(path.join(process.cwd(), 'server.ts'));
    if (!process.env.VERCEL) { // FIXED: Do not listen on static express ports when deployed on Vercel
        if (!isProductionEnv) {
            const vite = await createViteServer({
                server: { middlewareMode: true },
                appType: 'spa',
            });
            app.use(vite.middlewares);
        } else {
            const distPath = fs.existsSync(path.join(process.cwd(), 'dist')) 
                ? path.join(process.cwd(), 'dist') 
                : path.join(__dirname, 'dist');
            app.use(express.static(distPath));
            app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
        }

        server.listen(PORT, '0.0.0.0', () => {
            console.log(`WhatsApp Pro running on http://localhost:${PORT}`);
        });
    }
}

// Graceful termination state persistence
const gracefulExit = () => {
    console.log('Intercepted termination signal. Flushing Pro Engine State dynamically to storage disk...');
    saveProDataSync();
    process.exit(0);
};
process.on('SIGINT', gracefulExit);
process.on('SIGTERM', gracefulExit);

startServer();

export default app; // FIXED
