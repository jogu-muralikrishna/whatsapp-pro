import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
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
import { GoogleGenAI } from "@google/genai";
import { DatabaseService } from './DatabaseService.js';
import { adminRouter, adminAuthMiddleware } from './src/adminRouter.js';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = pino({ level: 'silent' });
const BASE_DATA_DIR = process.env.DATA_DIR || process.cwd();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

const upload = multer({ limits: { fileSize: 100 * 1024 * 1024 } });

// ================ MULTI-USER CORE ================
const activeSockets = new Map<string, any>(); // userId (phone) -> sock
const userWS = new Map<string, WebSocket[]>();

function getUserDataDir(userId: string, subdir = '') {
  const dir = path.join(BASE_DATA_DIR, `users/${userId}`, subdir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function getSocketForUser(userId: string) {
  if (activeSockets.has(userId)) return activeSockets.get(userId);

  const authDir = getUserDataDir(userId, 'auth_info_baileys');
  
  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  const sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'),
    logger,
    markRead: true,
  });

  sock.ev.on('connection.update', (update) => {
    handleConnectionUpdate(userId, update, sock);
  });

  sock.ev.on('messages.upsert', (m) => handleMessages(userId, m));
  sock.ev.on('chats.upsert', (chats) => handleChatsUpdate(userId, chats));
  // Add more events as needed...

  activeSockets.set(userId, sock);
  return sock;
}

// Connection Handler
function handleConnectionUpdate(userId: string, update: any, sock: any) {
  const { connection, lastDisconnect, qr } = update;

  if (qr) {
    broadcastToUser(userId, { type: 'QR_CODE', data: qr });
  }

  if (connection === 'open') {
    broadcastToUser(userId, { type: 'LOGGED_IN', data: { userId } });
  }

  if (connection === 'close') {
    const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
    if (shouldReconnect) {
      setTimeout(() => getSocketForUser(userId), 2000);
    }
  }
}

// Message Handler
async function handleMessages(userId: string, m: any) {
  for (const msg of m.messages) {
    await DatabaseService.insertMessage(userId, msg);
    broadcastToUser(userId, { type: 'MESSAGES_UPSERT', data: msg });
  }
}

async function handleChatsUpdate(userId: string, chats: any[]) {
  for (const chat of chats) {
    await DatabaseService.insertChat(userId, chat);
  }
  broadcastToUser(userId, { type: 'CHATS_UPDATE', data: chats });
}

function broadcastToUser(userId: string, payload: any) {
  const clients = userWS.get(userId) || [];
  clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  });
}

// ================ API ROUTES ================

app.use('/api/admin', adminRouter);

// WhatsApp Connection
app.post('/api/connect', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    await getSocketForUser(userId);
    res.json({ success: true, message: 'Socket initialized' });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Send Message
app.post('/api/send-message', async (req, res) => {
  const { userId, jid, text } = req.body;
  if (!userId || !jid || !text) return res.status(400).json({ error: 'Missing params' });

  const sock = await getSocketForUser(userId);
  await sock.sendMessage(jid, { text });
  res.json({ success: true });
});

// Other routes (add userId to all)
app.get('/api/chats', async (req, res) => {
  const userId = req.query.userId as string;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const chats = await DatabaseService.getAllChats(userId);
  res.json(chats);
});

// WebSocket
wss.on('connection', (ws, req) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const userId = url.searchParams.get('userId') || 'default';

  if (!userWS.has(userId)) userWS.set(userId, []);
  userWS.get(userId)!.push(ws);

  ws.on('close', () => {
    const clients = userWS.get(userId);
    if (clients) {
      userWS.set(userId, clients.filter(w => w !== ws));
    }
  });
});

server.listen(PORT, () => {
  console.log(`🚀 WhatsApp Pro Multi-User Server running on port ${PORT}`);
});
