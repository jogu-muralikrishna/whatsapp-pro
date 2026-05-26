import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import fs from 'fs';
import makeWASocket, { 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    Browsers 
} from '@whiskeysockets/baileys';
import pino from 'pino';

const logger = pino({ level: 'silent' });
const PORT = process.env.PORT || 3000;

let sock: any = null;
let qrCode: string | null = null;
let connectionState: string = 'close';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());

app.get('/api/connection-status', (req, res) => {
    res.json({ state: connectionState, qrCode });
});

app.get('/api/refresh-qr', (req, res) => {
    if (sock) sock.end();
    qrCode = null;
    setTimeout(initWASocket, 1000);
    res.json({ status: 'QR refreshed' });
});

// Serve frontend
const distPath = path.join(process.cwd(), 'dist');
app.use(express.static(distPath));
app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
});

async function initWASocket() {
    const authDir = path.join(process.cwd(), 'auth_info_baileys');
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    sock = makeWASocket({
        version: (await fetchLatestBaileysVersion()).version,
        auth: state,
        logger,
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update: any) => {
        const { connection, qr } = update;

        if (qr) {
            qrCode = qr;
            broadcast({ type: 'QR_CODE', data: qr });
        }

        if (connection) {
            connectionState = connection;
            broadcast({ type: 'CONNECTION_STATE', data: connection });
        }

        if (connection === 'open') {
            console.log("✅ Connected!");
            qrCode = null;
            broadcast({ type: 'LOGGED_IN', data: sock.user });
        }

        if (connection === 'close') {
            setTimeout(initWASocket, 3000);
        }
    });
}

function broadcast(data: any) {
    wss.clients.forEach((client: any) => {
        if (client.readyState === 1) client.send(JSON.stringify(data));
    });
}

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});

initWASocket();
