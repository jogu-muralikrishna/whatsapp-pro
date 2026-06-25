// whatsapp-pro-main/DatabaseService.ts  (replace entire file)
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';

const BASE_DATA_DIR = process.env.DATA_DIR || process.cwd();

function getUserDataDir(phone: string): string {
  const clean = phone.replace(/[^0-9]/g, '');
  return path.join(BASE_DATA_DIR, 'users', clean);
}

function getDBPath(phone: string): string {
  return path.join(getUserDataDir(phone), 'pro_data.db.json');
}

function readDB(phone: string): any {
  const filePath = getDBPath(phone);
  if (!fs.existsSync(filePath)) {
    const defaultDB = {
      users: {}, chats: {}, messages: {}, calls: {}, statuses: {},
      admins: {}, admin_audit_log: [], user_notifications: {},
      settings: { /* defaults */ }
    };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(defaultDB, null, 2));
    return defaultDB;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    return { users: {}, chats: {}, ... };
  }
}

function writeDB(phone: string, data: any) {
  const filePath = getDBPath(phone);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// All existing functions now take `phone: string` as first param (or optional for global admin)
export async function initDatabase(phone: string = 'default'): Promise<void> { ... }
export async function insertUser(phone: string, user: any) { ... }
// ... (update all other functions similarly)

export const DatabaseService = { /* all functions with phone param */ };
