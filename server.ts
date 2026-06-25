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

// ====================== MULTI-USER STATE ======================
const userSockets = new Map<string, any>();

function getCleanPhone(phone: string): string {
  return phone.replace(/[^0-9]/g, '') || 'default';
}

// ====================== BAILEYS CONNECT ======================
async function connectUser(phone: string) {
  const clean = getCleanPhone(phone);
  if (userSockets.has(clean)) return userSockets.get(clean);

  const userDir = path.join(process.env.DATA_DIR || process.cwd(), 'users', clean);
  const authFolder = path.join(userDir, 'auth_info_baileys');
  fs.mkdirSync(authFolder, { recursive: true });

  const { state } = await useMultiFileAuthState(authFolder);

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
        if (client.readyState === 1) client.send(JSON.stringify({ type: 'QR_CODE', phone: clean, qr }));
      });
    }
    if (connection === 'open') {
      console.log(`✅ ${clean} Connected`);
      wss.clients.forEach(client => client.send(JSON.stringify({ type: 'LOGGED_IN', phone: clean })));
    }
    if (connection === 'close' && (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut) {
      setTimeout(() => connectUser(phone), 2000);
    }
  });

  userSockets.set(clean, sock);
  return sock;
}

// ====================== API ROUTES ======================
app.post('/api/connect', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone required' });
    await DatabaseService.initDatabase(phone);
    await connectUser(phone);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get('/api/connection-status', (req, res) => {
  try {
    const { phone } = req.query;
    const clean = getCleanPhone(phone as string);
    res.json({ connected: userSockets.has(clean), phone: clean });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/request-pairing-code', async (req, res) => {
  // Placeholder - Baileys pairing code logic can be added later
  res.json({ success: true, code: "123-456-78" });
});

app.post('/api/logout', (req, res) => {
  const { phone } = req.body;
  const clean = getCleanPhone(phone);
  userSockets.delete(clean);
  res.json({ success: true });
});

app.get('/api/session/init', (req, res) => {
  res.json({ success: true });
});

// ====================== STATIC + FALLBACK ======================
app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Multi-User WhatsApp Pro Server on port ${PORT}`);
});
