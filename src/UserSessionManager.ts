/**
 * UserSessionManager.ts
 * 
 * Manages isolated WhatsApp sessions for multiple users.
 * Each user gets their own:
 *   - Baileys socket (sock)
 *   - QR code / connection state
 *   - proData (message history, settings, chats, etc.)
 *   - auth_info_baileys_<userId> directory
 *   - pro_data_<userId>.json file
 *   - WebSocket clients set (for targeted broadcasts)
 */

import fs from 'fs';
import path from 'path';
import { WebSocket } from 'ws';

// ─── Default proData shape ───────────────────────────────────────────────────

export function createDefaultProData() {
  return {
    scheduledMessages: [] as any[],
    autoReplies: [] as { keyword: string; response: string; enabled: boolean }[],
    messageHistory: {} as Record<string, any[]>,
    callHistory: [] as any[],
    callRecords: [] as any[],
    statusUpdates: [] as any[],
    deletedStatuses: [] as any[],
    recycleBin: { messages: [] as any[], chats: [] as any[] },
    favorites: [] as string[],
    lockedChats: [] as string[],
    cachedChats: [] as any[],
    contacts: {} as Record<string, any>,
    lidToPnMap: {} as Record<string, string>,
    // Username Messaging (privacy feature): maps a masked chat id (e.g.
    // "masked_ammu") to the real WhatsApp jid it's actually sent to. This
    // masked id is what's stored in cachedChats / messageHistory / contacts
    // for that conversation, so the other person's real mobile number is
    // never sent back down to the frontend.
    usernameContacts: {} as Record<string, { realJid: string; username: string }>,
    // Web Push subscriptions (one per browser/device the user granted notification permission on)
    pushSubscriptions: [] as { endpoint: string; keys: { p256dh: string; auth: string } }[],
    logs: [] as any[],
    settings: {
      autoTranslate: false,
      theme: 'elegant-dark',
      font: 'Inter',
      aiContext: 'Professional Assistant',
      ghostMode: false,
      antiDelete: true,
      antiDeleteStatus: true,
      hideNumbers: false,
      hideBlueTicks: false,
      hideSecondTick: false,
      phoneNumber: '',
      firebaseBackupEnabled: false,
    } as Record<string, any>,
  };
}

// ─── Session shape ────────────────────────────────────────────────────────────

export interface UserSession {
  userId: string;

  // Baileys
  sock: any;
  qrCode: string | null;
  connectionState: string;

  // Data
  proData: ReturnType<typeof createDefaultProData>;
  realChats: any[];

  // Persistence
  dataFile: string;
  authDir: string;

  // Debounce timer for saveProData
  saveTimeout: NodeJS.Timeout | null;

  // WebSocket clients subscribed to this user
  wsClients: Set<WebSocket>;

  // Init state
  isInitializing: boolean;
  initTimeout: NodeJS.Timeout | null;
  consecutiveBadSessions: number;
  consecutiveStreamErrors: number;
  lastInteractionTime: number;
}

// ─── Manager ──────────────────────────────────────────────────────────────────

class UserSessionManager {
  private sessions = new Map<string, UserSession>();
  private baseDataDir: string;

  constructor(baseDataDir: string) {
    this.baseDataDir = baseDataDir;
  }

  /** Sanitise userId to safe filesystem chars */
  sanitizeUserId(userId: string): string {
    return userId.replace(/[^a-zA-Z0-9_\-+]/g, '_').substring(0, 64);
  }

  /** Get or create a session for userId */
  getOrCreate(rawUserId: string): UserSession {
    const userId = this.sanitizeUserId(rawUserId);
    if (this.sessions.has(userId)) return this.sessions.get(userId)!;

    const authDir = path.join(this.baseDataDir, `auth_info_baileys_${userId}`);
    const dataFile = path.join(this.baseDataDir, `pro_data_${userId}.json`);

    let proData = createDefaultProData();
    if (fs.existsSync(dataFile)) {
      try {
        const saved = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
        proData = { ...proData, ...saved };
      } catch (e) {
        console.error(`[UserSessionManager] Failed to load data for ${userId}:`, e);
      }
    }

    const session: UserSession = {
      userId,
      sock: null,
      qrCode: null,
      connectionState: 'close',
      proData,
      realChats: proData.cachedChats || [],
      dataFile,
      authDir,
      saveTimeout: null,
      wsClients: new Set(),
      isInitializing: false,
      initTimeout: null,
      consecutiveBadSessions: 0,
      consecutiveStreamErrors: 0,
      lastInteractionTime: Date.now(),
    };

    this.sessions.set(userId, session);
    return session;
  }

  /** Get session (returns null if not created yet) */
  get(rawUserId: string): UserSession | null {
    const userId = this.sanitizeUserId(rawUserId);
    return this.sessions.get(userId) || null;
  }

  /** List all active userIds */
  listUserIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /** Remove a session entirely */
  remove(rawUserId: string) {
    const userId = this.sanitizeUserId(rawUserId);
    this.sessions.delete(userId);
  }

  // ─── Per-session persistence ────────────────────────────────────────────────

  saveProData(session: UserSession) {
    if (session.saveTimeout) {
      clearTimeout(session.saveTimeout);
    }
    session.saveTimeout = setTimeout(() => {
      session.saveTimeout = null;
      try {
        const tmp = `${session.dataFile}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(session.proData), 'utf-8');
        fs.renameSync(tmp, session.dataFile);
      } catch (e: any) {
        console.error(`[UserSessionManager] Failed to save proData for ${session.userId}:`, e.message);
      }
    }, 1500);
  }

  saveProDataSync(session: UserSession) {
    if (session.saveTimeout) {
      clearTimeout(session.saveTimeout);
      session.saveTimeout = null;
    }
    try {
      const tmp = `${session.dataFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(session.proData), 'utf-8');
      fs.renameSync(tmp, session.dataFile);
    } catch (e: any) {
      console.error(`[UserSessionManager] Failed to sync-save proData for ${session.userId}:`, e.message);
    }
  }

  // ─── Per-session WebSocket broadcast ────────────────────────────────────────

  /** Register a WS client as belonging to a userId */
  registerWsClient(rawUserId: string, ws: WebSocket) {
    const session = this.getOrCreate(rawUserId);
    session.wsClients.add(ws);
    ws.on('close', () => {
      session.wsClients.delete(ws);
    });
  }

  /** Broadcast only to clients of a specific user */
  broadcast(session: UserSession, data: any) {
    session.lastInteractionTime = Date.now();
    const msg = JSON.stringify(data);
    session.wsClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  }

  /** Broadcast to ALL connected clients (admin-level) */
  broadcastAll(data: any, wss: any) {
    const msg = JSON.stringify(data);
    wss.clients.forEach((client: WebSocket) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  }

  // ─── Session log helper ──────────────────────────────────────────────────────

  log(session: UserSession, level: string, msg: string) {
    const entry = { time: new Date().toISOString(), level, msg };
    console.log(`[${level}][${session.userId}] ${msg}`);
    session.proData.logs = session.proData.logs || [];
    session.proData.logs.push(entry);
    if (session.proData.logs.length > 100) session.proData.logs.shift();
  }
}

// Singleton export
export let sessionManager: UserSessionManager;

export function initSessionManager(baseDataDir: string) {
  sessionManager = new UserSessionManager(baseDataDir);
  return sessionManager;
}
