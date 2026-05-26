import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { fileURLToPath } from 'url';
import makeWASocket, { 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore,
    Browsers,
    downloadMediaMessage
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import cron from 'node-cron';
import { parseISO, isAfter } from 'date-fns';
import { GoogleGenAI } from "@google/genai";
import { DatabaseService } from './src/DatabaseService.js';
import { adminRouter } from './src/adminRouter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = pino({ level: 'silent' });
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(process.cwd(), 'pro_data.json');

const upload = multer({ limits: { fileSize: 100 * 1024 * 1024 } });

let sock: any = null;
let qrCode: string | null = null;
let connectionState: string = 'close';
let realChats: any[] = [];

let proData: any = {
    scheduledMessages: [],
    autoReplies: [],
    messageHistory: {},
    callHistory: [],
    statusUpdates: [],
    deletedStatuses: [],
    recycleBin: { messages: [], chats: [] },
    favorites: [],
    lockedChats: [],
    cachedChats: [],
    contacts: {},
    lidToPnMap: {},
    settings: {
        ghostMode: false,
        antiDelete: true,
        antiDeleteStatus: true,
        hideNumbers: false,
        hideBlueTicks: false,
        hideSecondTick: false,
        hideTyping: false,
        secretStatusView: true,
        dndMode: false,
        autoReply: false,
        theme: 'elegant-dark',
        font: 'Inter',
        firebaseBackupEnabled: false
    },
    logs: []
};

// Load saved data
if (fs.existsSync(DATA_FILE)) {
    try {
        const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
        proData = { ...proData, ...saved };
        console.log('✅ Pro data loaded');
    } catch (e) {
        console.log('⚠️ Failed to load pro_data.json');
    }
}

function saveProData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(proData, null, 2));
    } catch (e) {
        console.error('Failed to save proData');
    }
}

function log(level: string, msg: string) {
    const entry = { time: new Date().toISOString(), level, msg };
    console.log(`[${level}] ${msg}`);
    proData.logs.push(entry);
    if (proData.logs.length > 200) proData.logs.shift();
    saveProData();
}

function broadcast(data: any) {
    wss.clients.forEach((client: any) => {
        if (client.readyState === 1) {
            client.send(JSON.stringify(data));
        }
    });
}

// ====================== MAIN SERVER ======================
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use('/api/admin', adminRouter);

let latestVersion: any;

async function initWASocket() {
    const authDir = path.join(process.cwd(), 'auth_info_baileys');

    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    sock = makeWASocket({
        version: latestVersion,
        auth: state,
        logger,
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: true,
        markOnlineOnConnect: true,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrCode = qr;
            console.log("📱 QR Code Generated");
            broadcast({ type: 'QR_CODE', data: qr });
        }

        if (connection) {
            connectionState = connection;
            broadcast({ type: 'CONNECTION_STATE', data: connection });
        }

        if (connection === 'open') {
            console.log("✅ WhatsApp Connected Successfully!");
            qrCode = null;
            broadcast({ type: 'LOGGED_IN', data: sock.user });
            log('SUCCESS', 'WhatsApp Engine Connected');
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log("🔄 Reconnecting...");
                setTimeout(initWASocket, 3000);
            } else {
                console.log("🚪 Logged out");
                broadcast({ type: 'LOGOUT', data: { message: "Logged out from mobile" } });
            }
        }
    });

    // Other event listeners (messages, chats, etc.) remain as before
    sock.ev.on('messages.upsert', (m: any) => {
        broadcast({ type: 'MESSAGES_UPSERT', data: m });
        // ... your existing message handling
    });

    // ... (keep all your other event listeners)
}

async function startServer() {
    try {
        const { version } = await fetchLatestBaileysVersion();
        latestVersion = version;
    } catch (e) {}

    await initWASocket();

    // API Routes (keep your existing routes)
    app.get('/api/connection-status', (req, res) => {
        res.json({
            state: connectionState,
            user: sock?.user,
            qrCode: qrCode,
            chats: realChats
        });
    });

    // ... rest of your API routes (send-message, etc.)

    // Serve frontend
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));

    server.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 WhatsApp Pro running on port ${PORT}`);
    });
}

startServer();
