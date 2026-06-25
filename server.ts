// server.ts
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import cors from 'cors';
import { DatabaseService } from './DatabaseService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BASE_DATA_DIR = process.env.DATA_DIR || process.cwd();

const userSockets = new Map();

// Helper
function getCleanPhone(phone: string) {
  return phone.replace(/[^0-9]/g, '') || 'default';
}

// Connect User
async function connectUser(phone: string) {
  const clean = getCleanPhone(phone);
  if (userSockets.has(clean)) return userSockets.get(clean);

  const userDir = path.join(BASE_DATA_DIR, 'users', clean);
  const authFolder = path.join(userDir, 'auth_info_baileys');
  fs.mkdirSync(authFolder, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authFolder);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: ['WhatsApp Pro', 'Chrome', '1.0'],
  });

  sock.ev.on('connection.update', (update) => {
    const { qr, connection, lastDisconnect } = update;

    if (qr) {
      wss.clients.forEach(client => {
        client.send(JSON.stringify({ type: 'QR_CODE', phone: clean, qr }));
      });
    }

    if (connection === 'open') {
      console.log(`✅ ${clean} Connected`);
      wss.clients.forEach(client => client.send(JSON.stringify({ type: 'LOGGED_IN', phone: clean })));
    }

    if (connection === 'close') {
      if ((lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut) {
        setTimeout(() => connectUser(phone), 2000);
      }
    }
  });

  userSockets.set(clean, sock);
  return sock;
}

// ====================== API ======================
app.post('/api/connect', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone required' });

  await DatabaseService.initDatabase(phone);
  await connectUser(phone);
  res.json({ success: true });
});

app.get('/api/connection-status', (req, res) => {
  const { phone } = req.query;
  const clean = getCleanPhone(phone as string);
  res.json({ connected: userSockets.has(clean), phone: clean });
});

// Catch-all for frontend
app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
