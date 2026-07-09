/**
 * MultiUserEngine.ts
 *
 * Wraps the Baileys WhatsApp socket lifecycle so each user gets an independent,
 * isolated session.  Import and call `initUserEngine(session, deps)` instead
 * of the old `initWASocket()` / `initWASocketFriend()` functions.
 *
 * This module is intentionally self-contained so it can be dropped into the
 * existing server without rewriting every API endpoint at once.
 */

import path from 'path';
import fs from 'fs';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';

import { UserSession, sessionManager } from './UserSessionManager.js';
import { DatabaseService } from './DatabaseService.js';
import { notifyUser } from './pushService.js';

const silentLogger = pino({ level: 'silent' });

// ─── Shared Baileys version cache ────────────────────────────────────────────
let cachedBaileysVersion: number[] | undefined;

async function getBaileysVersion(): Promise<number[] | undefined> {
  if (cachedBaileysVersion) return cachedBaileysVersion;
  try {
    const { version } = await fetchLatestBaileysVersion();
    cachedBaileysVersion = version;
    return version;
  } catch {
    return undefined; // Baileys uses built-in default
  }
}

function extractPlainText(message: any): string {
  if (!message) return '';
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    (message.imageMessage && '📷 Photo') ||
    (message.videoMessage && '🎥 Video') ||
    (message.audioMessage && '🎤 Audio') ||
    (message.documentMessage && `📄 ${message.documentMessage?.fileName || 'Document'}`) ||
    (message.stickerMessage && '💫 Sticker') ||
    ''
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeJid(jid: string, session: UserSession): string {
  if (!jid) return jid;
  if (jid.includes('@')) {
    const [userWithDevice, domain] = jid.split('@');
    const user = userWithDevice.split(':')[0];
    jid = `${user}@${domain}`;
  } else if (jid.includes(':')) {
    jid = jid.split(':')[0];
  }
  if (jid.endsWith('@c.us')) jid = jid.replace('@c.us', '@s.whatsapp.net');
  if (jid.endsWith('@lid') && session.proData.lidToPnMap?.[jid]) {
    jid = session.proData.lidToPnMap[jid];
  }
  return jid;
}

function cleanAuthDir(authDir: string) {
  const timestamp = Date.now();
  const backupDir = `${authDir}_corrupt_${timestamp}`;
  try {
    if (fs.existsSync(authDir)) {
      const files = fs.readdirSync(authDir);
      for (const file of files) {
        const filePath = path.join(authDir, file);
        try {
          if (fs.statSync(filePath).isDirectory()) {
            fs.rmSync(filePath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(filePath);
          }
        } catch {}
      }
    }
  } catch {}
  try {
    if (fs.existsSync(authDir)) {
      fs.renameSync(authDir, backupDir);
    }
  } catch {}
  try {
    fs.mkdirSync(authDir, { recursive: true });
  } catch {}
}

function wrapSignalKeyStore(keysState: any, authDir: string) {
  if (!keysState) return keysState;
  const originalGet = keysState.get;
  const originalSet = keysState.set;

  keysState.get = async (type: string, ids: string[]) => {
    try {
      return await originalGet.call(keysState, type, ids);
    } catch (e: any) {
      console.error(`[SignalKeyStore] Get error (${type}): ${e.message}`);
      return {};
    }
  };

  keysState.set = async (data: any) => {
    try {
      return await originalSet.call(keysState, data);
    } catch (e: any) {
      console.error(`[SignalKeyStore] Set error: ${e.message}`);
    }
  };

  return keysState;
}

// ─── Schedule init with debounce per session ─────────────────────────────────

function scheduleInit(session: UserSession, delay: number) {
  if (session.initTimeout) {
    clearTimeout(session.initTimeout);
  }
  session.initTimeout = setTimeout(() => {
    session.initTimeout = null;
    initUserEngine(session);
  }, delay);
}

// ─── Automated session recovery ───────────────────────────────────────────────

async function handleAutomatedSessionRecovery(session: UserSession) {
  sessionManager.log(session, 'WARN', 'Initiating automated session recovery...');

  if (session.sock) {
    try {
      session.sock.ev.removeAllListeners('connection.update');
      session.sock.ev.removeAllListeners('creds.update');
      if (typeof session.sock.end === 'function') await session.sock.end(undefined);
    } catch {}
    session.sock = null;
  }

  // Back up creds
  let credsBuffer: Buffer | null = null;
  const oldCredsFile = path.join(session.authDir, 'creds.json');
  try {
    if (fs.existsSync(oldCredsFile)) {
      credsBuffer = fs.readFileSync(oldCredsFile);
    }
  } catch {}

  cleanAuthDir(session.authDir);

  if (!fs.existsSync(session.authDir)) {
    try { fs.mkdirSync(session.authDir, { recursive: true }); } catch {}
  }

  if (credsBuffer) {
    try {
      fs.writeFileSync(path.join(session.authDir, 'creds.json'), credsBuffer);
      sessionManager.log(session, 'SUCCESS', 'Restored credentials in new clean session dir.');
    } catch {}
  }

  scheduleInit(session, 3000);
}

// ─── Session health check ─────────────────────────────────────────────────────

function startSessionHealthCheck(session: UserSession) {
  const interval = setInterval(async () => {
    if (!session.sock || session.connectionState !== 'open') return;

    const timeSinceLastInteraction = Date.now() - session.lastInteractionTime;
    if (timeSinceLastInteraction < 5 * 60 * 1000) return; // Active recently, skip

    sessionManager.log(session, 'INFO', 'Session Health Check: Pinging Baileys socket...');
    try {
      const pingTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('ping timeout')), 30000)
      );
      let pingResult: Promise<any>;
      if (typeof session.sock.query === 'function') {
        pingResult = session.sock.query({ tag: 'iq', attrs: { to: '@s.whatsapp.net', type: 'get', xmlns: 'w:p' }, content: [{ tag: 'ping', attrs: {} }] });
      } else {
        pingResult = session.sock.onWhatsApp(session.sock.user?.id || '');
      }
      await Promise.race([pingResult, pingTimeout]);
      session.consecutiveStreamErrors = 0;
    } catch (e: any) {
      if (e.message === 'ping timeout') {
        sessionManager.log(session, 'ERROR', 'Session Health Check: No ping response. Rebooting socket...');
        session.connectionState = 'connecting';
        if (session.sock) {
          try {
            session.sock.ev.removeAllListeners('connection.update');
            session.sock.ev.removeAllListeners('creds.update');
            if (typeof session.sock.end === 'function') session.sock.end(undefined);
          } catch {}
          session.sock = null;
        }
        clearInterval(interval);
        scheduleInit(session, 2000);
      }
    }
  }, 5 * 60 * 1000); // every 5 minutes
}

// ─── Main engine initializer ──────────────────────────────────────────────────

export async function initUserEngine(session: UserSession) {
  if (session.isInitializing) {
    sessionManager.log(session, 'WARN', 'initUserEngine already in progress, skipping duplicate call.');
    return;
  }
  session.isInitializing = true;
  session.qrCode = null;

  const latestVersion = await getBaileysVersion();

  // Ensure auth dir exists
  if (!fs.existsSync(session.authDir)) {
    try { fs.mkdirSync(session.authDir, { recursive: true }); } catch {}
  }

  let state: any;
  let saveCreds: any;

  try {
    const authData = await useMultiFileAuthState(session.authDir);
    state = authData.state;
    saveCreds = authData.saveCreds;
    if (!state || !state.creds || typeof state.creds !== 'object') {
      throw new Error('State credentials are corrupt or missing');
    }
  } catch (err: any) {
    sessionManager.log(session, 'ERROR', `Auth dir corrupted: ${err.message}. Cleaning...`);
    cleanAuthDir(session.authDir);
    const authData = await useMultiFileAuthState(session.authDir);
    state = authData.state;
    saveCreds = authData.saveCreds;
  }

  state.keys = wrapSignalKeyStore(state.keys, session.authDir);

  // Close existing socket
  if (session.sock) {
    try {
      session.sock.ev.removeAllListeners('connection.update');
      session.sock.ev.removeAllListeners('creds.update');
      session.sock.ev.removeAllListeners('messages.upsert');
      session.sock.end(undefined);
    } catch {}
    session.sock = null;
  }

  // Construct socket with retries
  let constructRetries = 0;
  while (constructRetries < 3) {
    try {
      session.sock = makeWASocket({
        version: latestVersion,
        logger: silentLogger,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, silentLogger),
        },
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: true,
        markOnlineOnConnect: !session.proData.settings.ghostMode,
        connectTimeoutMs: 60000,
        generateHighQualityLinkPreview: true,
        getMessage: async (key) => {
          const jid = normalizeJid(key.remoteJid!, session);
          const msgs = session.proData.messageHistory[jid] || [];
          return msgs.find((m: any) => m.key.id === key.id)?.message || undefined;
        },
      });
      break;
    } catch (socketError: any) {
      constructRetries++;
      sessionManager.log(session, 'ERROR', `Socket construction attempt ${constructRetries}/3 failed: ${socketError.message}`);
      if (constructRetries >= 3) {
        sessionManager.log(session, 'ERROR', 'Max socket retries. Recovering via sanitization...');
        cleanAuthDir(session.authDir);
        session.isInitializing = false;
        scheduleInit(session, 3000);
        return;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  session.isInitializing = false;
  const socketInstance = session.sock;

  // ── creds.update ──────────────────────────────────────────────────────────
  session.sock.ev.on('creds.update', (...args: any[]) => {
    if (socketInstance !== session.sock) return;
    saveCreds(...args);
  });

  // ── QR_CODE (legacy event) ────────────────────────────────────────────────
  session.sock.ev.on('QR_CODE', (qr: string) => {
    if (socketInstance !== session.sock) return;
    session.qrCode = qr;
    sessionManager.broadcast(session, { type: 'QR_CODE', data: qr, userId: session.userId });
  });

  // ── connection.update ─────────────────────────────────────────────────────
  session.sock.ev.on('connection.update', async (update: any) => {
    if (socketInstance !== session.sock) return;
    session.lastInteractionTime = Date.now();

    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      session.qrCode = qr;
      sessionManager.broadcast(session, { type: 'QR_CODE', data: qr, userId: session.userId });
    }

    if (connection) {
      session.connectionState = connection;
      sessionManager.broadcast(session, { type: 'CONNECTION_STATE', data: connection, userId: session.userId });
    }

    if (connection === 'open') {
      sessionManager.log(session, 'SUCCESS', 'WhatsApp CONNECTED and SYNCED');
      session.consecutiveBadSessions = 0;
      session.consecutiveStreamErrors = 0;
      startSessionHealthCheck(session);

      // Record this user's connected WhatsApp number in the global username
      // registry, so other users can reach them via @username without ever
      // seeing this number.
      try {
        const rawId: string = session.sock.user?.id || '';
        const number = rawId.split('@')[0].split(':')[0];
        if (number) {
          DatabaseService.setUserWhatsappNumber(session.userId, number);
        }
      } catch (e: any) {
        sessionManager.log(session, 'WARN', `Could not register WhatsApp number for username routing: ${e.message}`);
      }
    }

    if (connection === 'close') {
      const error = lastDisconnect?.error as Boom;
      const statusCode = error?.output?.statusCode;
      const errMessage = error?.message || 'none';
      const errOutputPayloadMsg = (error?.output?.payload as any)?.message || '';
      const fullErrorString = `${errMessage} ${error?.stack || ''} ${errOutputPayloadMsg}`.toLowerCase();

      const isQrTimeout =
        fullErrorString.includes('qr refs attempts ended') ||
        fullErrorString.includes('qr refs') ||
        (statusCode === 408 && fullErrorString.includes('qr'));

      const isLoggedOut =
        statusCode === DisconnectReason.loggedOut ||
        fullErrorString.includes('logged out') ||
        fullErrorString.includes('logout');

      const isBadSession =
        (statusCode === DisconnectReason.badSession &&
          !fullErrorString.includes('stream errored') &&
          !fullErrorString.includes('connection reset') &&
          !fullErrorString.includes('socket hang up')) ||
        (statusCode === 401 && !isLoggedOut) ||
        fullErrorString.includes('bad session') ||
        fullErrorString.includes('invalid credentials') ||
        fullErrorString.includes('decryption failed');

      const isTransient =
        statusCode === 515 || statusCode === 408 || statusCode === 428 || statusCode === 500 ||
        fullErrorString.includes('restart required') ||
        fullErrorString.includes('connection lost') ||
        fullErrorString.includes('connection closed') ||
        fullErrorString.includes('timed out') ||
        fullErrorString.includes('socket hang up') ||
        fullErrorString.includes('connection reset');

      const isStreamError =
        !isTransient &&
        (fullErrorString.includes('stream errored') || fullErrorString.includes('xml-not-well-formed'));

      const closeSock = () => {
        if (session.sock) {
          try {
            session.sock.ev.removeAllListeners('connection.update');
            session.sock.ev.removeAllListeners('creds.update');
            session.sock.end(undefined);
          } catch {}
          session.sock = null;
        }
      };

      if (isQrTimeout) {
        sessionManager.log(session, 'WARN', 'QR timeout. Wiping stale state and restarting...');
        session.qrCode = null;
        closeSock();
        cleanAuthDir(session.authDir);
        sessionManager.broadcast(session, { type: 'QR_TIMEOUT', data: { message: 'QR timed out. Generating fresh code...' }, userId: session.userId });
        scheduleInit(session, 3000);
        return;
      }

      if (isLoggedOut) {
        sessionManager.log(session, 'ERROR', 'Logged out from mobile. Requiring fresh auth.');
        session.qrCode = null;
        session.realChats = [];
        session.proData.cachedChats = [];
        sessionManager.saveProData(session);
        sessionManager.broadcast(session, { type: 'LOGOUT', data: { message: 'Logged out. Please re-scan QR.', fatal: true }, userId: session.userId });
        closeSock();
        setTimeout(() => { cleanAuthDir(session.authDir); scheduleInit(session, 1000); }, 1500);
        return;
      }

      if (isTransient) {
        sessionManager.log(session, 'INFO', `Transient disconnect (${statusCode}). Reconnecting...`);
        closeSock();
        scheduleInit(session, 3000);
        return;
      }

      if (isBadSession) {
        session.consecutiveBadSessions++;
        sessionManager.log(session, 'WARN', `Bad session (${session.consecutiveBadSessions}/3). statusCode: ${statusCode}`);
        closeSock();
        if (session.consecutiveBadSessions >= 3) {
          session.consecutiveBadSessions = 0;
          await handleAutomatedSessionRecovery(session);
        } else {
          scheduleInit(session, 3000);
        }
        return;
      }

      if (isStreamError) {
        session.consecutiveStreamErrors++;
        const delay = session.consecutiveStreamErrors > 3 ? 8000 : 3000;
        if (session.consecutiveStreamErrors >= 30) session.consecutiveStreamErrors = 0;
        sessionManager.log(session, 'WARN', `Stream error (${session.consecutiveStreamErrors}). Reconnecting in ${delay / 1000}s...`);
        closeSock();
        scheduleInit(session, delay);
        return;
      }

      // Fallback
      sessionManager.log(session, 'WARN', `Disconnect: statusCode=${statusCode}, msg=${errMessage}. Rebooting...`);
      closeSock();
      scheduleInit(session, 2000);
    }
  });

  // ── messages.upsert ───────────────────────────────────────────────────────
  session.sock.ev.on('messages.upsert', async (m: any) => {
    if (socketInstance !== session.sock) return;
    session.lastInteractionTime = Date.now();

    const messages = m.messages || [];
    for (const msg of messages) {
      if (!msg.key?.remoteJid) continue;
      const realJid = normalizeJid(msg.key.remoteJid, session);

      // If this contact is behind a username mask, file the message under
      // their masked id instead of their real number.
      const maskedEntry = Object.entries(session.proData.usernameContacts || {})
        .find(([, v]: [string, any]) => v.realJid === realJid);
      const jid = maskedEntry ? maskedEntry[0] : realJid;
      const outgoingMsg = maskedEntry ? { ...msg, key: { ...msg.key, remoteJid: jid } } : msg;

      if (!session.proData.messageHistory[jid]) {
        session.proData.messageHistory[jid] = [];
      }

      const antiDelete = session.proData.settings.antiDelete;
      if (antiDelete && msg.message) {
        session.proData.messageHistory[jid].push(outgoingMsg);
        if (session.proData.messageHistory[jid].length > 1000) {
          session.proData.messageHistory[jid].splice(0, 100);
        }
      }

      sessionManager.broadcast(session, { type: 'NEW_MESSAGE', data: outgoingMsg, userId: session.userId });

      // Background push notification (works even if the app/tab is fully closed).
      if (!msg.key.fromMe) {
        const senderName =
          maskedEntry ? `@${(maskedEntry[1] as any).username}` :
          msg.pushName || session.proData.contacts?.[jid]?.name || jid.split('@')[0];
        const bodyText = extractPlainText(msg.message) || 'New message';
        notifyUser(
          session.proData.pushSubscriptions || [],
          { title: senderName, body: bodyText, tag: jid, url: '/' },
          (expiredEndpoint: string) => {
            session.proData.pushSubscriptions = (session.proData.pushSubscriptions || []).filter(
              (s: any) => s.endpoint !== expiredEndpoint
            );
            sessionManager.saveProData(session);
          }
        ).catch(() => {});
      }
    }
    sessionManager.saveProData(session);
  });

  // ── chats.upsert ──────────────────────────────────────────────────────────
  session.sock.ev.on('chats.upsert', (chats: any[]) => {
    if (socketInstance !== session.sock) return;
    const maskedRealJids = new Set(
      Object.values(session.proData.usernameContacts || {}).map((v: any) => v.realJid)
    );
    for (const chat of chats) {
      if (maskedRealJids.has(chat.id)) continue; // keep this contact hidden behind its @username
      const existing = session.realChats.find((c: any) => c.id === chat.id);
      if (existing) {
        Object.assign(existing, chat);
      } else {
        session.realChats.push(chat);
      }
    }
    session.proData.cachedChats = session.realChats;
    sessionManager.saveProData(session);
    sessionManager.broadcast(session, { type: 'CHATS_UPDATE', data: session.realChats, userId: session.userId });
  });

  // ── contacts.upsert ───────────────────────────────────────────────────────
  session.sock.ev.on('contacts.upsert', (contacts: any[]) => {
    if (socketInstance !== session.sock) return;
    const maskedRealJids = new Set(
      Object.values(session.proData.usernameContacts || {}).map((v: any) => v.realJid)
    );
    for (const contact of contacts) {
      if (!contact.id || maskedRealJids.has(contact.id)) continue; // keep hidden behind its @username
      session.proData.contacts[contact.id] = { ...session.proData.contacts[contact.id], ...contact };
    }
    sessionManager.saveProData(session);
    sessionManager.broadcast(session, { type: 'CONTACTS_UPDATE', data: session.proData.contacts, userId: session.userId });
  });

  sessionManager.log(session, 'INFO', `Engine started for user: ${session.userId}`);
}

// ─── Logout helper ────────────────────────────────────────────────────────────

export async function logoutUserSession(session: UserSession) {
  if (session.sock) {
    try {
      session.sock.ev.removeAllListeners('connection.update');
      session.sock.ev.removeAllListeners('creds.update');
      try { await session.sock.logout(); } catch {}
      session.sock.end(undefined);
    } catch {}
    session.sock = null;
  }
  session.qrCode = null;
  session.connectionState = 'close';
  cleanAuthDir(session.authDir);
  sessionManager.saveProDataSync(session);
  sessionManager.broadcast(session, {
    type: 'LOGOUT',
    data: { message: 'Logged out. Re-scan QR to reconnect.', fatal: true },
    userId: session.userId,
  });
  setTimeout(() => scheduleInit(session, 1000), 3000);
}
