import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import makeWASocket, { 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    Browsers 
} from '@whiskeysockets/baileys';
import pino from 'pino';

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
    },
    logs: []
};

// Load saved data
if (fs.existsSync(DATA_FILE)) {
    try {
        const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
        proData = { ...proData, ...saved };
        console.log('✅ Pro data loaded successfully');
    } catch (e) {
        console.log('⚠️ Could not load pro_data.json');
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

async function initWASocket() {
    const authDir = path.join(process.cwd(), 'auth_info_baileys');
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    sock = makeWASocket({
        version: (await fetchLatestBaileysVersion()).version,
        auth: state,
        logger,
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: true,
        markOnlineOnConnect: true,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrCode = qr;
            console.log("📱 New QR Code Generated");
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
            const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log("🔄 Reconnecting in 3 seconds...");
                setTimeout(initWASocket, 3000);
            } else {
                console.log("🚪 Logged out from device");
                broadcast({ type: 'LOGOUT', data: { message: "Logged out. Scan QR again." } });
            }
        }
    });

    // Add your other event listeners here (messages.upsert, chats.update, etc.)
    // For now keeping minimal to fix build
}

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());

// Basic routes for testing
app.get('/api/connection-status', (req, res) => {
    res.json({ 
        state: connectionState, 
        user: sock?.user || null,
        qrCode: qrCode 
    });
});

app.get('/api/refresh-qr', (req, res) => {
    qrCode = null;
    if (sock) {
        sock.end();
    }
    setTimeout(initWASocket, 1000);
    res.json({ status: 'QR refresh triggered' });
});

// Serve React frontend
const distPath = path.join(process.cwd(), 'dist');
app.use(express.static(distPath));
app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 WhatsApp Pro Server running on http://0.0.0.0:${PORT}`);
});

// Start Baileys
initWASocket();
