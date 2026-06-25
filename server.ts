// whatsapp-pro-main/server.ts
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

// ESM __dirname fix
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;
const BASE_DATA_DIR = process.env.DATA_DIR || process.cwd();

const userSockets = new Map<string, any>(); // phone -> Baileys socket

// ====================== HELPER ======================
function getCleanPhone(phone: string): string {
  return phone.replace(/[^0-9]/g, '') || 'default';
}

// ====================== CONNECT USER ======================
async function connectUser(phone: string) {
  const cleanPhone = getCleanPhone(phone);
  if (userSockets.has(cleanPhone)) return userSockets.get(cleanPhone);

  const userDir = path.join(BASE_DATA_DIR, 'users', cleanPhone);
  const authFolder = path.join(userDir, 'auth_info_baileys');

  if (!fs.existsSync(authFolder)) fs.mkdirSync(authFolder, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authFolder);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: ['WhatsApp Pro', 'Chrome', '1.0'],
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      wss.clients.forEach(client => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({ type: 'QR_CODE', phone: cleanPhone, qr }));
        }
      });
    }

    if (connection === 'open') {
      console.log(`✅ Connected: ${cleanPhone}`);
      wss.clients.forEach(client => client.send(JSON.stringify({ type: 'LOGGED_IN', phone: cleanPhone })));
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
      if (statusCode !== DisconnectReason.loggedOut) {
        setTimeout(() => connectUser(phone), 3000);
      }
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    try {
      for (const msg of m.messages) {
        await DatabaseService.insertMessage(cleanPhone, msg);
      }
    } catch (e) {
      console.error('Message save error:', e);
    }
  });

  userSockets.set(cleanPhone, sock);
  return sock;
}

// ====================== API ROUTES ======================
app.post('/api/connect', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone number required' });

  try {
    await DatabaseService.initDatabase(phone);
    await connectUser(phone);
    res.json({ success: true, message: 'Connection started' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/connection-status', (req, res) => {
  const { phone } = req.query;
  const clean = getCleanPhone(phone as string);
  res.json({
    connected: userSockets.has(clean),
    phone: clean
  });
});

// Admin Routes (you can expand later)
app.use('/api/admin', (req, res) => {
  res.json({ message: "Admin API ready - multi-user supported" });
});

// Serve Frontend
app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ====================== START SERVER ======================
server.listen(PORT, () => {
  console.log(`🚀 WhatsApp Pro Multi-User Server running on port ${PORT}`);
});
