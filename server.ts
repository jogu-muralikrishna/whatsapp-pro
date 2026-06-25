import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
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

const userSockets = new Map();

function getCleanPhone(phone: string) {
  return phone.replace(/[^0-9]/g, '') || 'default';
}

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
  });

  sock.ev.on('connection.update', (update) => {
    const { qr, connection } = update;
    if (qr) {
      wss.clients.forEach(c => c.send(JSON.stringify({ type: 'QR_CODE', phone: clean, qr })));
    }
    if (connection === 'open') {
      wss.clients.forEach(c => c.send(JSON.stringify({ type: 'LOGGED_IN', phone: clean })));
    }
  });

  userSockets.set(clean, sock);
  return sock;
}

// API Routes
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

app.post('/api/request-pairing-code', (req, res) => {
  res.json({ success: true, code: "123-456-78" });
});

app.post('/api/logout', (req, res) => {
  res.json({ success: true });
});

// Static files
app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
