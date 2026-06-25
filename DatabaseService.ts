// whatsapp-pro-main/DatabaseService.ts
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';

const BASE_DATA_DIR = process.env.DATA_DIR || process.cwd();

function getCleanPhone(phone: string): string {
  return phone.replace(/[^0-9]/g, '') || 'default';
}

function getUserDataDir(phone: string): string {
  return path.join(BASE_DATA_DIR, 'users', getCleanPhone(phone));
}

function getDBPath(phone: string): string {
  return path.join(getUserDataDir(phone), 'pro_data.db.json');
}

function ensureUserDir(phone: string) {
  const dir = getUserDataDir(phone);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readDB(phone: string): any {
  ensureUserDir(phone);
  const filePath = getDBPath(phone);
  if (!fs.existsSync(filePath)) {
    const defaultDB = {
      users: {},
      chats: {},
      messages: {},
      calls: {},
      statuses: {},
      admins: {},
      admin_audit_log: [],
      user_notifications: {},
      settings: {
        autoTranslate: false,
        theme: "elegant-dark",
        ghostMode: false,
        antiDelete: true,
        antiDeleteStatus: true,
        hideNumbers: false,
        hideBlueTicks: false,
        dndMode: false,
        autoReply: false
      }
    };
    fs.writeFileSync(filePath, JSON.stringify(defaultDB, null, 2), 'utf-8');
    return defaultDB;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('DB Read Error:', e);
    return { users: {}, chats: {}, messages: {}, calls: {}, statuses: {}, admins: {}, admin_audit_log: [], user_notifications: {}, settings: {} };
  }
}

function writeDB(phone: string, data: any) {
  ensureUserDir(phone);
  const filePath = getDBPath(phone);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to write DB:', e);
  }
}

export async function initDatabase(phone: string = 'default'): Promise<void> {
  const db = readDB(phone);
  writeDB(phone, db);
  await seedDefaultAdmin(phone);
}

export async function seedDefaultAdmin(phone: string): Promise<void> {
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'ADMIN#123', salt);
  const db = readDB(phone);
  db.admins[process.env.ADMIN_EMAIL || 'admin@pro.com'] = {
    email: process.env.ADMIN_EMAIL || 'admin@pro.com',
    password: passwordHash,
    password_hash: passwordHash,
    role: 'Super Admin',
    createdAt: Date.now()
  };
  writeDB(phone, db);
}

// ==================== USER FUNCTIONS ====================
export async function insertUser(phone: string, user: any): Promise<any> {
  const db = readDB(phone);
  const id = user.id || user.phone || Math.random().toString(36).substring(7);
  db.users[id] = { id, ...user };
  writeDB(phone, db);
  return db.users[id];
}

export async function getUser(phone: string, idOrEmailOrPhone: string): Promise<any> {
  const db = readDB(phone);
  if (db.users[idOrEmailOrPhone]) return db.users[idOrEmailOrPhone];
  return Object.values(db.users).find((u: any) => 
    u.id === idOrEmailOrPhone || u.phone === idOrEmailOrPhone || u.email === idOrEmailOrPhone
  ) || null;
}

// ==================== MESSAGE FUNCTIONS ====================
export async function insertMessage(phone: string, message: any): Promise<any> {
  const db = readDB(phone);
  const msgId = message.id || message.key?.id || Math.random().toString(36).substring(7);
  db.messages[msgId] = { id: msgId, ...message };
  writeDB(phone, db);
  return db.messages[msgId];
}

export async function getMessages(phone: string, chatIdOrConditions?: any): Promise<any[]> {
  const db = readDB(phone);
  const allMsgs = Object.values(db.messages);
  if (!chatIdOrConditions) return allMsgs;
  if (typeof chatIdOrConditions === 'string') {
    return allMsgs.filter((m: any) => m.chatId === chatIdOrConditions || m.jid === chatIdOrConditions);
  }
  return allMsgs.filter((m: any) => {
    for (const [key, val] of Object.entries(chatIdOrConditions)) {
      if (m[key] !== val) return false;
    }
    return true;
  });
}

// ==================== OTHER FUNCTIONS ====================
export async function insertChat(phone: string, chat: any): Promise<any> {
  const db = readDB(phone);
  const id = chat.id || chat.jid || Math.random().toString(36).substring(7);
  db.chats[id] = { id, ...chat };
  writeDB(phone, db);
  return db.chats[id];
}

export async function getAllChats(phone: string): Promise<any[]> {
  const db = readDB(phone);
  return Object.values(db.chats);
}

export async function insertStatus(phone: string, status: any): Promise<any> {
  const db = readDB(phone);
  const id = status.id || Math.random().toString(36).substring(7);
  db.statuses[id] = { id, ...status, timestamp: Date.now() };
  writeDB(phone, db);
  return db.statuses[id];
}

export async function getStatuses(phone: string): Promise<any[]> {
  const db = readDB(phone);
  return Object.values(db.statuses).sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));
}

export async function insertCall(phone: string, call: any): Promise<any> {
  const db = readDB(phone);
  const id = call.id || Math.random().toString(36).substring(7);
  db.calls[id] = { id, ...call, timestamp: Date.now() };
  writeDB(phone, db);
  return db.calls[id];
}

export async function updateSettings(phone: string, settings: any): Promise<any> {
  const db = readDB(phone);
  db.settings = { ...(db.settings || {}), ...settings };
  writeDB(phone, db);
  return db.settings;
}

export async function createAdmin(phone: string, email: string, passwordHashOrPlain: string, role: string = 'admin') {
  const db = readDB(phone);
  db.admins[email] = {
    email,
    password: passwordHashOrPlain,
    password_hash: passwordHashOrPlain,
    role,
    createdAt: Date.now()
  };
  writeDB(phone, db);
  return db.admins[email];
}

export async function getAdminByEmail(phone: string, email: string) {
  const db = readDB(phone);
  return db.admins[email] || null;
}

export async function insertAuditLog(phone: string, log: any) {
  const db = readDB(phone);
  const entry = { id: Math.random().toString(36).substring(7), timestamp: Date.now(), ...log };
  db.admin_audit_log.push(entry);
  writeDB(phone, db);
  return entry;
}

export async function getAuditLogs(phone: string) {
  const db = readDB(phone);
  return db.admin_audit_log;
}

// Add more functions as needed...

export const DatabaseService = {
  initDatabase,
  insertUser,
  getUser,
  insertMessage,
  getMessages,
  insertChat,
  getAllChats,
  insertStatus,
  getStatuses,
  insertCall,
  updateSettings,
  createAdmin,
  getAdminByEmail,
  insertAuditLog,
  getAuditLogs,
  // ... add others when used
};

export default DatabaseService;
