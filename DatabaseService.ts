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
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readDB(phone: string): any {
  ensureUserDir(phone);
  const filePath = getDBPath(phone);
  if (!fs.existsSync(filePath)) {
    const defaultDB = {
      users: {}, chats: {}, messages: {}, calls: {}, statuses: {},
      admins: {}, admin_audit_log: [], user_notifications: {},
      settings: { ghostMode: false, antiDelete: true, theme: "dark" }
    };
    fs.writeFileSync(filePath, JSON.stringify(defaultDB, null, 2));
    return defaultDB;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    return { users: {}, chats: {}, messages: {}, calls: {}, statuses: {}, admins: {}, admin_audit_log: [], user_notifications: {}, settings: {} };
  }
}

function writeDB(phone: string, data: any) {
  ensureUserDir(phone);
  const filePath = getDBPath(phone);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// Export all needed functions
export async function initDatabase(phone: string = 'default') {
  readDB(phone); // create if not exists
}

export async function getAdminByEmail(phone: string, email: string) {
  const db = readDB(phone);
  return db.admins[email] || null;
}

export const DatabaseService = {
  initDatabase,
  getAdminByEmail,
  // Add more as needed by frontend
};

export default DatabaseService;
