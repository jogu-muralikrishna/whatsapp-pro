import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';

const filePath = path.join(process.env.DATA_DIR || process.cwd(), 'pro_data.db.json');

function readDB(): any {
  if (!fs.existsSync(filePath)) {
    return {
      users: {},
      chats: {},
      messages: {},
      calls: {},
      statuses: {},
      admins: {},
      admin_audit_log: [],
      user_notifications: {}
    };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return {
      users: {},
      chats: {},
      messages: {},
      calls: {},
      statuses: {},
      admins: {},
      admin_audit_log: [],
      user_notifications: {}
    };
  }
}

function writeDB(data: any) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to write JSON DB file:', e);
  }
}

export async function initDatabase(): Promise<void> {
  const db = readDB();
  writeDB(db);
  await seedDefaultAdmin();
}

export async function seedDefaultAdmin(): Promise<void> {
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash('ADMIN#123', salt);
  const db = readDB();
  db.admins['admin@pro.com'] = {
    email: 'admin@pro.com',
    password: passwordHash,
    password_hash: passwordHash,
    role: 'Super Admin',
    createdAt: db.admins['admin@pro.com']?.createdAt || Date.now()
  };
  writeDB(db);
}

export async function insertUser(user: any): Promise<any> {
  const db = readDB();
  const id = user.id || user.phone || user.email || Math.random().toString(36).substring(7);
  db.users[id] = { id, ...user };
  writeDB(db);
  return db.users[id];
}

export async function getUser(idOrEmailOrPhone: string): Promise<any> {
  const db = readDB();
  if (db.users[idOrEmailOrPhone]) {
    return db.users[idOrEmailOrPhone];
  }
  const found = Object.values(db.users).find((u: any) => 
    u.id === idOrEmailOrPhone || 
    u.phone === idOrEmailOrPhone || 
    u.email === idOrEmailOrPhone
  );
  return found || null;
}

export async function insertMessage(message: any): Promise<any> {
  const db = readDB();
  const msgId = message.id || message.key?.id || Math.random().toString(36).substring(7);
  
  const processedMessage = { ...message };
  if (processedMessage.video) {
    if (typeof processedMessage.video === 'object' && Buffer.isBuffer(processedMessage.video)) {
      processedMessage.video_as_text = '/media/video_' + msgId + '.mp4';
      delete processedMessage.video;
    } else if (typeof processedMessage.video === 'string') {
      processedMessage.video_as_text = processedMessage.video;
    }
  }
  
  db.messages[msgId] = { id: msgId, ...processedMessage };
  writeDB(db);
  return db.messages[msgId];
}

export async function getMessages(chatIdOrConditions?: any): Promise<any[]> {
  const db = readDB();
  const allMsgs = Object.values(db.messages);
  if (!chatIdOrConditions) {
    return allMsgs;
  }
  if (typeof chatIdOrConditions === 'string') {
    return allMsgs.filter((m: any) => m.chatId === chatIdOrConditions || m.chat_id === chatIdOrConditions || m.jid === chatIdOrConditions);
  }
  if (typeof chatIdOrConditions === 'object') {
    return allMsgs.filter((m: any) => {
      for (const [key, val] of Object.entries(chatIdOrConditions)) {
        if (m[key] !== val) return false;
      }
      return true;
    });
  }
  return allMsgs;
}

export async function insertStatus(status: any): Promise<any> {
  const db = readDB();
  const id = status.id || Math.random().toString(36).substring(7);
  db.statuses[id] = { id, ...status, timestamp: status.timestamp || Date.now() };
  writeDB(db);
  return db.statuses[id];
}

export async function getStatuses(): Promise<any[]> {
  const db = readDB();
  return Object.values(db.statuses).sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));
}

export async function insertCall(call: any): Promise<any> {
  const db = readDB();
  const id = call.id || Math.random().toString(36).substring(7);
  db.calls[id] = { id, ...call, timestamp: call.timestamp || Date.now() };
  writeDB(db);
  return db.calls[id];
}

export async function updateSettings(settings: any): Promise<any> {
  const db = readDB();
  db.settings = { ...(db.settings || {}), ...settings };
  writeDB(db);
  return db.settings;
}

export async function backupToFile(filePathToSave: string): Promise<void> {
  const db = readDB();
  fs.writeFileSync(filePathToSave, JSON.stringify(db, null, 2), 'utf-8');
}

export async function insertChat(chat: any): Promise<any> {
  const db = readDB();
  const id = chat.id || chat.jid || Math.random().toString(36).substring(7);
  db.chats[id] = { id, ...chat };
  writeDB(db);
  return db.chats[id];
}

export async function getChat(chatId: string): Promise<any> {
  const db = readDB();
  return db.chats[chatId] || null;
}

export async function getAllChats(): Promise<any[]> {
  const db = readDB();
  return Object.values(db.chats);
}

export async function createAdmin(email: string, passwordHashOrPlain: string, role: string = 'admin'): Promise<any> {
  const db = readDB();
  db.admins[email] = {
    email,
    password: passwordHashOrPlain,
    password_hash: passwordHashOrPlain, // Support both named properties for absolute compatibility with route handlers
    role,
    createdAt: Date.now()
  };
  writeDB(db);
  return db.admins[email];
}

export async function getAdminByEmail(email: string): Promise<any> {
  const db = readDB();
  return db.admins[email] || null;
}

export async function insertAuditLog(log: any): Promise<any> {
  const db = readDB();
  const entry = {
    id: Math.random().toString(36).substring(7),
    timestamp: Date.now(),
    ...log
  };
  db.admin_audit_log.push(entry);
  writeDB(db);
  return entry;
}

export async function getAuditLogs(): Promise<any[]> {
  const db = readDB();
  return db.admin_audit_log;
}

export async function insertNotification(notification: any): Promise<any> {
  const db = readDB();
  const id = notification.id || Math.random().toString(36).substring(7);
  db.user_notifications[id] = {
    id,
    userId: notification.userId || notification.phone || 'all',
    read: false,
    timestamp: Date.now(),
    ...notification
  };
  writeDB(db);
  return db.user_notifications[id];
}

export async function getUserNotifications(userIdOrPhone: string): Promise<any[]> {
  const db = readDB();
  return Object.values(db.user_notifications).filter((n: any) => 
    n.userId === userIdOrPhone || n.phone === userIdOrPhone || n.userId === 'all'
  );
}

export async function markNotificationsRead(userIdOrPhone: string): Promise<void> {
  const db = readDB();
  for (const key of Object.keys(db.user_notifications)) {
    const n = db.user_notifications[key];
    if (n.userId === userIdOrPhone || n.phone === userIdOrPhone || n.userId === 'all') {
      n.read = true;
    }
  }
  writeDB(db);
}

export const DatabaseService = {
  initDatabase,
  insertUser,
  getUser,
  insertMessage,
  getMessages,
  insertStatus,
  getStatuses,
  insertCall,
  updateSettings,
  backupToFile,
  insertChat,
  getChat,
  getAllChats,
  createAdmin,
  getAdminByEmail,
  insertAuditLog,
  getAuditLogs,
  insertNotification,
  getUserNotifications,
  markNotificationsRead
};

export default DatabaseService;
