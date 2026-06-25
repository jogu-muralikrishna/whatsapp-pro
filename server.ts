// /home/workdir/whatsapp-pro-main/server.ts
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const userSockets = new Map();

function getCleanPhone(phone: string): string {
  return phone.replace(/[^0-9]/g, '') || 'default';
}

// ==================== BAILEYS QR DEBUG ====================
async function connectUser(phone: string) {
  const cleanPhone = getCleanPhone(phone);
  if (userSockets.has(cleanPhone)) return userSockets.get(cleanPhone);

  console.log(`[DEBUG] Starting connection for ${cleanPhone}`);

  const userDir = path.join(process.env.DATA_DIR || process.cwd(), 'users', cleanPhone);
  const authFolder = path.join(userDir, 'auth_info_baileys');
  fs.mkdirSync(authFolder, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authFolder);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,           // Enable terminal QR for debug
    logger: pino({ level: 'silent' }),
    browser: ['WhatsApp Pro', 'Chrome', '1.0'],
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    console.log(`[DEBUG] Connection update: ${connection} | QR: ${!!qr}`);

    if (qr) {
      console.log(`[DEBUG] QR Generated for ${cleanPhone}`);
      // Send to all connected clients
      wss.clients.forEach((client) => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({ 
            type: 'QR_CODE', 
            phone: cleanPhone, 
            qr 
          }));
        }
      });
    }

    if (connection === 'open') {
      console.log(`✅ ${cleanPhone} Successfully Connected!`);
      wss.clients.forEach((client) => {
        if (client.readyState === 1) client.send(JSON.stringify({ type: 'LOGGED_IN', phone: cleanPhone }));
      });
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
      if (statusCode !== DisconnectReason.loggedOut) {
        console.log(`[DEBUG] Reconnecting ${cleanPhone}...`);
        setTimeout(() => connectUser(phone), 2000);
      }
    }
  });

  userSockets.set(cleanPhone, sock);
  return sock;
}

// ==================== API ROUTES ====================
app.post('/api/connect', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone number required' });

    await connectUser(phone);
    res.json({ success: true, message: 'Connection started. Scan QR.' });
  } catch (error) {
    console.error('[ERROR]', error);
    res.status(500).json({ error: 'Failed to start connection' });
  }
});

app.get('/api/connection-status', (req, res) => {
  try {
    const { phone } = req.query;
    const clean = getCleanPhone(phone as string);
    res.json({ 
      connected: userSockets.has(clean), 
      phone: clean 
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/request-pairing-code', (req, res) => {
  res.json({ success: true, code: "000-000-00" });
});

app.post('/api/logout', (req, res) => {
  const { phone } = req.body;
  if (phone) userSockets.delete(getCleanPhone(phone));
  res.json({ success: true });
});

// Serve React App
app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`🚀 WhatsApp Pro Server running on port ${PORT}`);
  console.log(`📡 WebSocket + Baileys QR debugging enabled`);
});
