import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';

const BASE_DATA_DIR = process.env.DATA_DIR || process.cwd();

function getUserDataDir(phone: string): string {
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  return path.join(BASE_DATA_DIR, 'users', cleanPhone || 'default');
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
        theme: 'elegant-dark',
        ghostMode: false,
        antiDelete: true,
        // ... other defaults
      }
    };
    fs.writeFileSync(filePath, JSON.stringify(defaultDB, null, 2));
    return defaultDB;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    return { users: {}, chats: {}, messages: {}, ... };
  }
}

function writeDB(phone: string, data: any) {
  ensureUserDir(phone);
  const filePath = getDBPath(phone);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// All functions updated to accept phone parameter
export async function initDatabase(phone: string = 'default'): Promise<void> {
  const db = readDB(phone);
  writeDB(phone, db);
  await seedDefaultAdmin(phone);
}

export async function seedDefaultAdmin(phone: string): Promise<void> {
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash('ADMIN#123', salt);
  const db = readDB(phone);
  db.admins['admin@pro.com'] = {
    email: 'admin@pro.com',
    password: passwordHash,
    password_hash: passwordHash,
    role: 'Super Admin',
    createdAt: Date.now()
  };
  writeDB(phone, db);
}

// Update ALL other functions similarly (insertUser, getUser, insertMessage, etc.)
// Example:
export async function insertMessage(phone: string, message: any): Promise<any> {
  const db = readDB(phone);
  const msgId = message.id || message.key?.id || Math.random().toString(36).substring(7);
  db.messages[msgId] = { id: msgId, ...message };
  writeDB(phone, db);
  return db.messages[msgId];
}

// ... (repeat pattern for getMessages, insertChat, etc.)

export const DatabaseService = {
  initDatabase,
  insertUser: (phone: string, user: any) => { /* impl */ },
  // ... all functions
};

export default DatabaseService;
