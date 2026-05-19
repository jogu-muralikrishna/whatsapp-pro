import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
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
import { parseISO, isAfter } from 'date-fns';
import { GoogleGenAI } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = pino({ level: 'silent' });
const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'pro_data.json');

// Initialize data storage with persistence
let proData = {
    scheduledMessages: [] as any[],
    autoReplies: [] as { keyword: string, response: string, enabled: boolean }[],
    messageHistory: {} as Record<string, any[]>,
    callHistory: [] as any[],
    statusUpdates: [] as any[],
    deletedStatuses: [] as any[],
    recycleBin: {
        messages: [] as any[],
        chats: [] as any[]
    },
    favorites: [] as string[],
    lockedChats: [] as string[],
    cachedChats: [] as any[],
    contacts: {} as Record<string, any>,
    settings: {
        autoTranslate: false,
        theme: 'elegant-dark',
        font: 'Inter',
        aiContext: 'Professional Assistant',
        ghostMode: false,
        antiDelete: true,
        antiDeleteStatus: true,
        hideNumbers: false,
        hideBlueTicks: false,
        hideSecondTick: false,
        hideTyping: false,
        secretStatusView: true,
        dndMode: false,
        autoReply: false
    },
    logs: [] as { time: string, level: string, msg: string }[]
};

function log(level: string, msg: string) {
    const entry = { time: new Date().toISOString(), level, msg };
    console.log(`[${level}] ${msg}`);
    proData.logs.push(entry);
    if (proData.logs.length > 100) proData.logs.shift(); // Keep last 100 logs
}

if (fs.existsSync(DATA_FILE)) {
    try {
        const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
        proData = { ...proData, ...saved };
        log('INFO', 'Pro Engine Data Loaded');
    } catch (e) {
        log('ERROR', 'Failed to load pro_data.json');
    }
}

function saveProData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(proData, null, 2));
    } catch (e) {
        log('ERROR', 'Failed to save proData');
    }
}

async function startServer() {
    const app = express();
    const server = createServer(app);
    const wss = new WebSocketServer({ server });

    app.use(express.json());

    let latestVersion: any = null;
    try {
        const { version } = await fetchLatestBaileysVersion();
        latestVersion = version;
        log('INFO', `Baileys Version Fetched: ${version.join('.')}`);
    } catch (e) {
        latestVersion = [2, 3000, 1015901307]; // Fallback
        log('WARN', 'Using fallback Baileys version');
    }

    let sock: any = null;
    let qrCode: string | null = null;
    let connectionState: any = 'close';
    let realChats: any[] = proData.cachedChats || [];

    function broadcast(data: any) {
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(data));
            }
        });
    }

    // Normalize JID function to handle linked devices, LIDs and @c.us vs @s.whatsapp.net
function normalizeJid(jid: string): string {
    if (!jid) return jid;
    if (jid.includes(':')) {
        const parts = jid.split(':');
        const domain = jid.split('@')[1];
        jid = parts[0] + '@' + domain;
    }
    if (jid.endsWith('@c.us')) jid = jid.replace('@c.us', '@s.whatsapp.net');
    // Basic LID normalization if encountered
    if (jid.endsWith('@lid')) {
        // Keep as lid, but ensure no device suffix
    }
    return jid;
}

async function initWASocket() {
        qrCode = null; // Reset QR state on start
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
        
        if (sock) {
            try { 
                sock.ev.removeAllListeners('connection.update');
                sock.ev.removeAllListeners('creds.update');
                sock.ev.removeAllListeners('messages.upsert');
                sock.end(undefined); 
            } catch (e) {}
        }
        
        sock = makeWASocket({
            version: latestVersion || [2, 3000, 1015901307],
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

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('QR_CODE', (qr: string) => {
            qrCode = qr;
            broadcast({ type: 'QR_CODE', data: qr });
        });

        sock.ev.on('connection.update', (update: Partial<ConnectionState>) => {
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
                
                // Detailed reason mapping
                const reasonMap: any = {
                    [DisconnectReason.loggedOut]: 'Logged out from device. Clean auth required.',
                    [DisconnectReason.restartRequired]: 'Restart required. Rebooting engine...',
                    [DisconnectReason.connectionClosed]: 'Connection closed. Re-establishing link...',
                    [DisconnectReason.connectionReplaced]: 'Connection replaced by another session.',
                    [DisconnectReason.badSession]: 'Bad session file. Wiping and retrying...',
                };
                
                // Handle potential 408 collisions
                reasonMap[DisconnectReason.timedOut] = 'Connection timed out. Retrying...';
                reasonMap[DisconnectReason.connectionLost] = 'Network lost. Reconnecting...';

                const message = reasonMap[statusCode] || `Engine link severed (Code: ${statusCode}). Recovering...`;
                const isLoggedOut = statusCode === DisconnectReason.loggedOut;
                const isBadSession = statusCode === DisconnectReason.badSession;

                if (isLoggedOut || isBadSession) {
                    log('ERROR', message);
                    qrCode = null;
                    realChats = [];
                    proData.cachedChats = [];
                    saveProData();
                    
                    broadcast({ type: 'LOGOUT', data: { message, fatal: true } });

                    // Cleanup auth for fresh start - More immediate destruction
                    if (sock) {
                        try {
                            sock.ev.removeAllListeners('connection.update');
                            sock.ev.removeAllListeners('creds.update');
                            sock.end(undefined);
                            sock = null;
                        } catch (e) {}
                    }

                    const authDir = path.join(__dirname, 'auth_info_baileys');
                    setTimeout(async () => {
                        try {
                            if (fs.existsSync(authDir)) {
                                fs.rmSync(authDir, { recursive: true, force: true });
                                log('SUCCESS', 'Session storage sanitized for core recovery.');
                            }
                        } catch (e: any) {
                            log('ERROR', `Sanitization failure: ${e.message}`);
                        }
                        // Fresh start
                        await initWASocket();
                    }, 5000); // Increased timeout for stability
                } else {
                    log('WARN', message);
                    
                    // Reconnect for other reasons
                    setTimeout(initWASocket, 2000);
                }
            } else if (connection === 'open') {
                log('SUCCESS', 'WhatsApp Pro Engine: CONNECTED and SYNCED');
                qrCode = null;
                broadcast({ type: 'LOGGED_IN', data: sock.user });
                // Force an immediate status check broadcast
                broadcast({ type: 'SYNC_START', data: true });
            }
        });

        sock.ev.on('messages.upsert', (m: any) => {
            if (proData.settings.dndMode) return; // Silent Drop in DND
            broadcast({ type: 'MESSAGES_UPSERT', data: m });
            
            m.messages.forEach(async (msg: any) => {
                let jid = msg.key.remoteJid;
                if (!jid) return;

                // Normalize JID early
                jid = normalizeJid(jid);
                msg.key.remoteJid = jid; // Mutate for consistency

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
            broadcast({ type: 'STATUS_UPDATE', data: status });
            return;
        }
                
                if (!proData.messageHistory[jid]) proData.messageHistory[jid] = [];
                
                // Avoid duplicates
                const exists = proData.messageHistory[jid].some(m => m.key.id === msg.key.id);
                if (!exists) {
                    proData.messageHistory[jid].push(msg);
                    if (proData.messageHistory[jid].length > 1000) proData.messageHistory[jid].shift();
                }

                // Auto Reply Logic
                if (proData.settings.autoReply && !msg.key.fromMe && !jid.endsWith('@g.us')) {
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
                } else {
                    // Create chat if not exists
                    const newChat = { id: jid, timestamp: msg.messageTimestamp, lastMessage: msg };
                    realChats.push(newChat);
                    broadcast({ type: 'CHATS_UPDATE', data: newChat });
                }
                
                proData.cachedChats = realChats;
                saveProData();
            });
        });

        sock.ev.on('messages.update', (m: any) => {
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
            newContacts.forEach((c: any) => {
                const jid = normalizeJid(c.id);
                proData.contacts[jid] = { ...(proData.contacts[jid] || {}), ...c, id: jid };
            });
            saveProData();
            broadcast({ type: 'CONTACTS_UPSERT', data: newContacts });
        });

        sock.ev.on('contacts.update', (updates: any) => {
            updates.forEach((u: any) => {
                const jid = normalizeJid(u.id);
                proData.contacts[jid] = { ...(proData.contacts[jid] || {}), ...u, id: jid };
            });
            saveProData();
            broadcast({ type: 'CONTACTS_UPSERT', data: updates }); // Re-use UPSERT listener in frontend
        });

        sock.ev.on('chats.upsert', (newChats: any) => {
            newChats.forEach((chat: any) => {
                chat.id = normalizeJid(chat.id);
                const index = realChats.findIndex(c => c.id === chat.id);
                if (index !== -1) {
                    realChats[index] = { ...realChats[index], ...chat };
                } else {
                    realChats.push(chat);
                }
            });
            proData.cachedChats = realChats;
            saveProData();
            broadcast({ type: 'CHATS_UPDATE', data: newChats });
        });

        sock.ev.on('chats.update', (updates: any) => {
            updates.forEach((update: any) => {
                if (update.id) update.id = normalizeJid(update.id);
                const index = realChats.findIndex(c => c.id === update.id);
                if (index !== -1) {
                    realChats[index] = { ...realChats[index], ...update };
                    broadcast({ type: 'CHATS_UPDATE', data: realChats[index] });
                } else {
                    realChats.push(update);
                    broadcast({ type: 'CHATS_UPDATE', data: update });
                }
            });
            proData.cachedChats = realChats;
            saveProData();
        });

        sock.ev.on('presence.update', (m: any) => {
            if (proData.settings.ghostMode) return;
            broadcast({ type: 'PRESENCE_UPDATE', data: m });
        });

        sock.ev.on('call', (m: any) => {
            log('INFO', `Incoming Call: ${m[0].from}`);
            proData.callHistory.unshift(...m);
            if (proData.callHistory.length > 100) proData.callHistory.pop();
            saveProData();
            broadcast({ type: 'CALL_UPDATE', data: m });
        });

        sock.ev.on('messaging-history.set', (history: any) => {
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
            log('INFO', `Chats Set: Received ${chats.length} chats`);
            realChats = chats;
            proData.cachedChats = realChats;
            saveProData();
            broadcast({ type: 'INITIAL_SYNC', data: { chats } });
        });
    }

    await initWASocket();

    // Scheduling Loop (every minute)
    cron.schedule('* * * * *', async () => {
        if (connectionState !== 'open' || !sock) return;

        const now = new Date();
        const pending = proData.scheduledMessages.filter(m => !m.sent && isAfter(now, parseISO(m.time)));

        for (const msg of pending) {
            try {
                await sock.sendMessage(msg.jid, { text: msg.text });
                msg.sent = true;
                msg.sentAt = now.toISOString();
                console.log(`Scheduled message sent to ${msg.jid}`);
                saveProData();
                broadcast({ type: 'SCHEDULED_SENT', data: msg });
            } catch (e) {
                console.error(`Failed to send scheduled message to ${msg.jid}`, e);
            }
        }
    });

    // API Routes
    app.post('/api/request-pairing-code', async (req, res) => {
        let { phoneNumber } = req.body;
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
            if (!sock.authState.creds.registered) {
                const code = await sock.requestPairingCode(phoneNumber);
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

    app.get('/api/scheduled-messages', (req, res) => {
        res.json(proData.scheduledMessages);
    });

    app.get('/api/auto-replies', (req, res) => {
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

    app.get('/api/settings', (req, res) => {
        res.json(proData.settings);
    });

    app.post('/api/settings', (req, res) => {
        proData.settings = { ...proData.settings, ...req.body };
        saveProData();
        res.json(proData.settings);
    });

    app.get('/api/refresh-qr', async (req, res) => {
        log('INFO', 'Manual QR Refresh Triggered');
        qrCode = null;
        await initWASocket();
        res.json({ status: 'Refreshing engine...' });
    });

    app.post('/api/ai-suggestion', async (req, res) => {
        const { text } = req.body;
        if (!text) return res.status(400).json({ error: 'Text required' });

        try {
            const key = process.env.GEMINI_API_KEY;
            if (!key) throw new Error('GEMINI_API_KEY not configured');

            const ai = new GoogleGenAI({ apiKey: key });

            const prompt = `Context: You are a professional WhatsApp Pro AI assistant. 
      The user received this message: "${text}"
      Provide 3 short, helpful, and natural sounding quick reply suggestions. 
      Format: Only return the suggestions separated by | and nothing else. No preamble.`;

            const response = await ai.models.generateContent({
                model: "gemini-1.5-flash",
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

    app.get('/api/status-updates', (req, res) => {
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
        const { jid, keys } = req.body;
        if (!sock || !jid) return res.status(400).json({ error: 'Missing sock or jid' });
        
        if (proData.settings.ghostMode || proData.settings.hideBlueTicks) {
            return res.json({ status: 'Privacy Shield Active: Read receipt supressed.' });
        }

        try {
            await sock.readMessages(keys);
            res.json({ status: 'Read' });
        } catch (e) {
            res.status(500).json({ error: 'Read failed' });
        }
    });

    app.get('/api/recycle-bin', (req, res) => {
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
        if (proData.messageHistory[chatId]) {
            proData.messageHistory[chatId] = [];
            saveProData();
            broadcast({ type: 'CHAT_CLEARED', data: { chatId } });
            return res.json({ status: 'success' });
        }
        res.status(404).json({ error: 'Chat history not found' });
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

    app.post('/api/send-message', async (req, res) => {
        const { jid, text, quoted } = req.body;
        if (!sock || !jid || !text) return res.status(400).json({ error: 'Missing params' });
        
        const targetJid = normalizeJid(jid);

        try {
            log('INFO', `Sending message to ${targetJid}`);
            const options: any = {};
            if (quoted) {
                options.quoted = quoted;
            }
            const sent = await sock.sendMessage(targetJid, { text }, options);
            res.json(sent);
        } catch (e: any) {
            log('ERROR', `Failed to send to ${targetJid}: ${e.message}`);
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/react-message', async (req, res) => {
        const { jid, msgId, emoji, fromMe } = req.body;
        if (!sock || !jid || !msgId || !emoji) return res.status(400).json({ error: 'Missing params' });
        
        const targetJid = normalizeJid(jid);

        try {
            log('INFO', `Reacting to ${msgId} in ${targetJid} with ${emoji}`);
            const sent = await sock.sendMessage(targetJid, { 
                react: { 
                    text: emoji, 
                    key: { remoteJid: targetJid, id: msgId, fromMe: fromMe === true }
                } 
            });
            res.json(sent);
        } catch (e: any) {
            log('ERROR', `Failed to react to ${msgId}: ${e.message}`);
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/send-audio', async (req, res) => {
        const { jid, audio, duration, ptt } = req.body;
        if (!sock || !jid || !audio) return res.status(400).json({ error: 'Missing params' });
        
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
        if (!sock || !targetJid || !msgId || !fromJid) return res.status(400).json({ error: 'Missing params' });

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
        if (!sock || !jid || !jid.endsWith('@g.us')) return res.status(400).json({ error: 'Invalid group JID' });
        try {
            const metadata = await sock.groupMetadata(jid);
            res.json(metadata);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/profile-picture', async (req, res) => {
        const { jid } = req.query;
        if (!sock || !jid) return res.status(400).send('Missing JID');
        
        const targetJid = normalizeJid(jid as string);

        try {
            const url = await sock.profilePictureUrl(targetJid, 'image');
            res.json({ url });
        } catch (e) {
            res.status(404).json({ error: 'Not found' });
        }
    });

    app.post('/api/read-all', async (req, res) => {
        if (!sock) return res.status(500).json({ error: 'Socket not ready' });
        try {
            // This is a bit complex in Baileys, usually you'd mark specific chats.
            // For now, we'll iterate through realChats with unread counts.
            for (const chat of realChats) {
                if (chat.unreadCount > 0) {
                    await sock.readMessages([{ remoteJid: chat.id, id: chat.lastMessage?.key.id, fromMe: false }]);
                }
            }
            res.json({ status: 'success' });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/update-contact', (req, res) => {
        const { id, name } = req.body;
        if (!id || !name) return res.status(400).json({ error: 'ID and Name required' });
        
        let jid = id;
        if (!jid.includes('@')) jid = `${jid}@s.whatsapp.net`;
        
        proData.contacts[jid] = { ...(proData.contacts[jid] || {}), id: jid, name };
        saveProData();
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

    app.get('/api/locked-chats', (req, res) => {
        res.json(proData.lockedChats);
    });

    app.get('/api/favorites', (req, res) => {
        res.json(proData.favorites);
    });

    app.post('/api/logout', async (req, res) => {
        log('INFO', 'Hard Logout Requested');
        try {
            if (sock) {
                sock.ev.removeAllListeners('connection.update');
                sock.ev.removeAllListeners('creds.update');
                try { await sock.logout(); } catch (e) {}
                sock.end(undefined);
                sock = null;
            }
        } catch (e) {}
        
        const authDir = path.join(__dirname, 'auth_info_baileys');
        if (fs.existsSync(authDir)) {
            try {
                fs.rmSync(authDir, { recursive: true, force: true });
                log('SUCCESS', 'Manual wipe executed.');
            } catch (e) {}
        }
        
        qrCode = null;
        realChats = [];
        proData.cachedChats = [];
        saveProData();
        connectionState = 'close';
        
        broadcast({ type: 'LOGOUT', data: { message: 'Engine Wipe Complete. Re-initializing...', fatal: true } });
        
        setTimeout(async () => {
             await initWASocket();
             res.json({ status: 'Logged out successfully' });
        }, 3000);
    });

    app.get('/api/media', async (req: any, res: any) => {
        const { msgId, chatId } = req.query;
        if (!sock || !msgId || !chatId) return res.status(400).send('Missing params');

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
            log('WARN', `Media failed: Message ${msgId} not found in history for ${normalizedJid}`);
            return res.status(404).send('Message not found in history');
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
                const isFatal = initialErr.message?.includes('re-upload media (2)') || initialErr.message?.includes('410');
                
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
                    const isMissing = refreshErr.message?.includes('re-upload media (2)') || refreshErr.message?.includes('404') || refreshErr.message?.includes('410');
                    if (isMissing) {
                        log('WARN', `Media ${msgId} has expired permanently.`);
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

            res.setHeader('Content-Type', mimetype);
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24h
            res.send(buffer);
            log('SUCCESS', `Downloaded media ${msgId}`);
        } catch (err: any) {
            const isMissing = err.message?.includes('404') || err.message?.includes('410') || err.message?.includes('re-upload media (2)') || err.message?.includes('expired');
            const errorMsg = isMissing ? 'Media no longer available (Expired on WhatsApp)' : err.message;
            
            if (isMissing) {
                log('WARN', `Media expired: ${msgId}`);
            } else {
                log('ERROR', `Media download failed [${msgId}]: ${err.message}`);
            }
            
            res.status(isMissing ? 410 : 500).send(errorMsg);
        }
    });

    app.get('/api/connection-status', (req, res) => {
        res.json({ 
            state: connectionState, 
            user: sock?.user,
            qrCode: qrCode,
            isRegistered: sock?.authState.creds.registered,
            chats: realChats,
            contacts: proData.contacts,
            statusUpdates: proData.statusUpdates,
            latency: '14ms', 
            uptimes: process.uptime()
        });
    });

    // Vite middleware
    if (process.env.NODE_ENV !== 'production') {
        const vite = await createViteServer({
            server: { middlewareMode: true },
            appType: 'spa',
        });
        app.use(vite.middlewares);
    } else {
        const distPath = path.join(process.cwd(), 'dist');
        app.use(express.static(distPath));
        app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
    }

    server.listen(PORT, '0.0.0.0', () => {
        console.log(`WhatsApp Pro running on http://localhost:${PORT}`);
    });
}

startServer();
