import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import fs from 'fs';
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import { DatabaseService } from './DatabaseService.js';
import { adminRouter } from './src/adminRouter.js';
import cors from 'cors';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors({ origin: '*' }));
app.use(express.json());

const BASE_DATA_DIR = process.env.DATA_DIR || process.cwd();
const userSockets = new Map<string, any>(); // phone -> sock
const userConnections = new Map<string, any>(); // runtime state per user

// Helper
function getCleanPhone(phone: string): string {
  return phone.replace(/[^0-9]/g, '');
}

// Main connection handler (per user)
async function connectUser(phone: string) {
  if (userSockets.has(phone)) return userSockets.get(phone);

  const userDir = path.join(BASE_DATA_DIR, 'users', getCleanPhone(phone));
  const authFolder = path.join(userDir, 'auth_info_baileys');

  const { state, saveCreds } = await useMultiFileAuthState(authFolder);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: ['WhatsApp Pro', 'Chrome', '1.0'],
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      // Send QR to frontend for this user
      wss.clients.forEach(client => client.send(JSON.stringify({ type: 'QR_CODE', phone, qr })));
    }
    if (connection === 'open') {
      console.log(`✅ User ${phone} connected`);
    }
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) connectUser(phone);
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    const db = await DatabaseService.getMessages(phone); // etc.
    // Handle per-user logic
  });

  userSockets.set(phone, sock);
  return sock;
}

// API Routes
app.post('/api/connect', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone required' });
  const sock = await connectUser(phone);
  res.json({ success: true, status: 'connecting' });
});

// Admin routes already imported
app.use('/api/admin', adminRouter);

// Serve frontend
app.use(express.static(path.join(__dirname, 'dist')));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 WhatsApp Pro Multi-User Server running on port ${PORT}`);
});
