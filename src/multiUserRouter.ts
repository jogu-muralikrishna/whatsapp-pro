/**
 * multiUserRouter.ts
 *
 * Mounts all user-scoped WhatsApp API endpoints under /api/u/:userId/...
 * The frontend should include the logged-in user's ID in every request,
 * either via the URL param or the X-User-Id header.
 *
 * Existing endpoints on the root /api path continue to work for the
 * "default" user (userId = "default") for full backwards compatibility.
 */

import { Router, Request, Response } from 'express';
import { sessionManager } from './UserSessionManager.js';
import { initUserEngine, logoutUserSession } from './MultiUserEngine.js';

const router = Router({ mergeParams: true });

// ─── Middleware: resolve session from :userId param or X-User-Id header ──────

function resolveSession(req: Request, res: Response, next: Function) {
  const userId =
    (req.params as any).userId ||
    (req.headers['x-user-id'] as string) ||
    req.query.userId as string ||
    req.body?.userId ||
    'default';

  const session = sessionManager.getOrCreate(userId);
  (req as any).userSession = session;
  next();
}

router.use(resolveSession);

// ─── GET /connection-status ──────────────────────────────────────────────────

router.get('/connection-status', (req: Request, res: Response) => {
  const session = (req as any).userSession;

  const cleanChats = (session.realChats || []).filter((c: any) => {
    if (!c?.id) return false;
    if (c.id === 'status@broadcast' || c.id === '0@s.whatsapp.net') return false;
    if (c.id.endsWith('@lid')) return false;
    const idNum = c.id.split('@')[0];
    if (idNum.length < 7 || idNum.length > 20) return false;
    return true;
  });

  const cleanContacts: Record<string, any> = {};
  if (session.proData.contacts) {
    Object.keys(session.proData.contacts).forEach((key) => {
      if (!key.endsWith('@lid') && key !== '0@s.whatsapp.net') {
        cleanContacts[key] = session.proData.contacts[key];
      }
    });
  }

  res.json({
    userId: session.userId,
    state: session.connectionState,
    user: session.sock?.user,
    qrCode: session.qrCode,
    isRegistered: session.sock?.authState?.creds?.registered,
    chats: cleanChats,
    contacts: cleanContacts,
    statusUpdates: session.proData.statusUpdates,
    latency: '14ms',
    uptimes: process.uptime(),
  });
});

// ─── GET /refresh-qr ─────────────────────────────────────────────────────────

router.get('/refresh-qr', async (req: Request, res: Response) => {
  const session = (req as any).userSession;
  session.qrCode = null;
  await initUserEngine(session);
  res.json({ status: `Refreshing engine for user ${session.userId}...` });
});

// ─── POST /request-pairing-code ──────────────────────────────────────────────

router.post('/request-pairing-code', async (req: Request, res: Response) => {
  const session = (req as any).userSession;
  let { phoneNumber } = req.body;
  if (!phoneNumber) return res.status(400).json({ error: 'Phone number required' });

  phoneNumber = phoneNumber.replace(/\D/g, '');
  if (!phoneNumber.startsWith('91')) {
    if (phoneNumber.length === 10) {
      phoneNumber = '91' + phoneNumber;
    } else {
      return res.status(400).json({ error: 'Invalid phone number. Must be 10 digits (India).' });
    }
  }

  if (!session.sock) {
    return res.status(400).json({ error: 'WhatsApp engine not initialized. Please wait for QR.' });
  }
  if (session.sock.authState?.creds?.registered) {
    return res.status(400).json({ error: 'Device already registered. Logout first to re-pair.' });
  }

  try {
    const code = await session.sock.requestPairingCode(phoneNumber);
    res.json({ code });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /settings ────────────────────────────────────────────────────────────

router.get('/settings', (req: Request, res: Response) => {
  const session = (req as any).userSession;
  res.json(session.proData.settings);
});

// ─── POST /settings ───────────────────────────────────────────────────────────

router.post('/settings', (req: Request, res: Response) => {
  const session = (req as any).userSession;
  session.proData.settings = { ...session.proData.settings, ...req.body };
  sessionManager.saveProData(session);
  res.json({ status: 'Settings saved', settings: session.proData.settings });
});

// ─── POST /send-message ───────────────────────────────────────────────────────

router.post('/send-message', async (req: Request, res: Response) => {
  const session = (req as any).userSession;
  const { jid, text, quoted } = req.body;
  if (!jid || !text) return res.status(400).json({ error: 'Missing jid or text' });

  if (!session.sock) {
    return res.status(503).json({ error: 'WhatsApp not connected. Please scan QR first.' });
  }

  try {
    const opts: any = {};
    if (quoted) opts.quoted = quoted;
    const sent = await session.sock.sendMessage(jid, { text }, opts);

    const mockMsg = {
      key: { remoteJid: jid, fromMe: true, id: sent?.key?.id || 'sim_' + Math.random().toString(36).substr(2, 9) },
      message: { conversation: text },
      messageTimestamp: Math.floor(Date.now() / 1000),
      status: 'sent',
    };

    if (!session.proData.messageHistory[jid]) session.proData.messageHistory[jid] = [];
    session.proData.messageHistory[jid].push(mockMsg);
    sessionManager.saveProData(session);
    sessionManager.broadcast(session, { type: 'MESSAGE_SENT', data: mockMsg, userId: session.userId });
    res.json(sent);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /read-chat ──────────────────────────────────────────────────────────

router.post('/read-chat', async (req: Request, res: Response) => {
  const session = (req as any).userSession;
  const { jid, keys } = req.body;
  if (!session.sock) return res.status(503).json({ error: 'WhatsApp not connected.' });
  if (!jid) return res.status(400).json({ error: 'Missing jid' });

  if (session.proData.settings.ghostMode || session.proData.settings.hideBlueTicks) {
    return res.json({ status: 'Privacy Shield Active: Read receipt suppressed.' });
  }

  try {
    await session.sock.readMessages(keys);
    res.json({ status: 'Read' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /history/:jid ────────────────────────────────────────────────────────

router.get('/history/:jid', (req: Request, res: Response) => {
  const session = (req as any).userSession;
  const jid = req.params.jid;
  const msgs = session.proData.messageHistory[jid] || [];
  res.json(msgs);
});

// ─── POST /delete-message ─────────────────────────────────────────────────────

router.post('/delete-message', async (req: Request, res: Response) => {
  const session = (req as any).userSession;
  let { chatId, msgId, revoke } = req.body;

  const history = session.proData.messageHistory[chatId] || [];
  const msgIndex = history.findIndex((m: any) => m.key?.id === msgId);

  if (msgIndex !== -1) {
    const msg = history[msgIndex];
    if (revoke && session.sock) {
      try { await session.sock.sendMessage(chatId, { delete: msg.key }); } catch {}
    }
    if (!session.proData.recycleBin) session.proData.recycleBin = { messages: [], chats: [] };
    session.proData.recycleBin.messages.push({ ...msg, deletedAt: Date.now() });
    history.splice(msgIndex, 1);
    sessionManager.saveProData(session);
    sessionManager.broadcast(session, { type: 'MESSAGE_DELETED', data: { chatId, msgId }, userId: session.userId });
    return res.json({ status: 'Deleted' });
  }
  res.status(404).json({ error: 'Message not found' });
});

// ─── POST /logout ─────────────────────────────────────────────────────────────

router.post('/logout', async (req: Request, res: Response) => {
  const session = (req as any).userSession;
  await logoutUserSession(session);
  res.json({ status: 'Logged out successfully' });
});

// ─── GET /auto-replies ────────────────────────────────────────────────────────

router.get('/auto-replies', (req: Request, res: Response) => {
  const session = (req as any).userSession;
  res.json(session.proData.autoReplies || []);
});

router.post('/auto-replies', (req: Request, res: Response) => {
  const session = (req as any).userSession;
  const { keyword, response, enabled = true } = req.body;
  if (!keyword || !response) return res.status(400).json({ error: 'keyword and response required' });
  if (!session.proData.autoReplies) session.proData.autoReplies = [];
  session.proData.autoReplies.push({ keyword, response, enabled });
  sessionManager.saveProData(session);
  res.json({ status: 'Auto-reply added' });
});

router.delete('/auto-replies/:keyword', (req: Request, res: Response) => {
  const session = (req as any).userSession;
  const keyword = req.params.keyword;
  session.proData.autoReplies = (session.proData.autoReplies || []).filter(
    (r: any) => r.keyword !== keyword
  );
  sessionManager.saveProData(session);
  res.json({ status: 'Deleted' });
});

// ─── GET /status-updates ──────────────────────────────────────────────────────

router.get('/status-updates', (req: Request, res: Response) => {
  const session = (req as any).userSession;
  res.json({ active: session.proData.statusUpdates, intercepted: session.proData.deletedStatuses });
});

// ─── POST /post-status ────────────────────────────────────────────────────────

router.post('/post-status', async (req: Request, res: Response) => {
  const session = (req as any).userSession;
  const { type, content, caption, backgroundColor, font } = req.body;
  if (!session.sock) return res.status(503).json({ error: 'Socket not connected' });

  try {
    let statusMessage: any = {};
    if (type === 'text') {
      statusMessage = { text: content, background: backgroundColor || '#111b21', font: font || 1 };
    } else if (type === 'image') {
      statusMessage = { image: Buffer.from(content.split(',')[1], 'base64'), caption };
    } else if (type === 'video') {
      statusMessage = { video: Buffer.from(content.split(',')[1], 'base64'), caption };
    }
    const sent = await session.sock.sendMessage('status@broadcast', statusMessage);
    res.json(sent);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /recycle-bin ────────────────────────────────────────────────────────

router.get('/recycle-bin', (req: Request, res: Response) => {
  const session = (req as any).userSession;
  res.json(session.proData.recycleBin || { messages: [], chats: [] });
});

// ─── GET /favorites ───────────────────────────────────────────────────────────

router.get('/favorites', (req: Request, res: Response) => {
  const session = (req as any).userSession;
  res.json(session.proData.favorites || []);
});

router.post('/favorite-chat', (req: Request, res: Response) => {
  const session = (req as any).userSession;
  const { jid, favorite } = req.body;
  if (!session.proData.favorites) session.proData.favorites = [];
  if (favorite) {
    if (!session.proData.favorites.includes(jid)) session.proData.favorites.push(jid);
  } else {
    session.proData.favorites = session.proData.favorites.filter((f: string) => f !== jid);
  }
  sessionManager.saveProData(session);
  res.json({ status: 'Updated' });
});

// ─── GET /locked-chats ────────────────────────────────────────────────────────

router.get('/locked-chats', (req: Request, res: Response) => {
  const session = (req as any).userSession;
  res.json(session.proData.lockedChats || []);
});

router.post('/lock-chat', (req: Request, res: Response) => {
  const session = (req as any).userSession;
  const { jid, lock } = req.body;
  if (!session.proData.lockedChats) session.proData.lockedChats = [];
  if (lock) {
    if (!session.proData.lockedChats.includes(jid)) session.proData.lockedChats.push(jid);
  } else {
    session.proData.lockedChats = session.proData.lockedChats.filter((c: string) => c !== jid);
  }
  sessionManager.saveProData(session);
  res.json({ status: 'Updated' });
});

// ─── GET /engine-logs ─────────────────────────────────────────────────────────

router.get('/engine-logs', (req: Request, res: Response) => {
  const session = (req as any).userSession;
  res.json(session.proData.logs || []);
});

// ─── GET /calls ───────────────────────────────────────────────────────────────

router.get('/calls/records', (req: Request, res: Response) => {
  const session = (req as any).userSession;
  res.json(session.proData.callRecords || []);
});

// ─── POST /block-contact ──────────────────────────────────────────────────────

router.post('/block-contact', async (req: Request, res: Response) => {
  const session = (req as any).userSession;
  const { jid, block } = req.body;
  if (!session.sock) return res.status(503).json({ error: 'Not connected' });
  try {
    await session.sock.updateBlockStatus(jid, block ? 'block' : 'unblock');
    res.json({ status: block ? 'Blocked' : 'Unblocked' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /update-contact ─────────────────────────────────────────────────────

router.post('/update-contact', (req: Request, res: Response) => {
  const session = (req as any).userSession;
  const { jid, name, ...rest } = req.body;
  if (!jid) return res.status(400).json({ error: 'jid required' });
  session.proData.contacts[jid] = { ...(session.proData.contacts[jid] || {}), jid, name, ...rest };
  sessionManager.saveProData(session);
  res.json({ status: 'Contact updated' });
});

// ─── GET /group-metadata/:jid ─────────────────────────────────────────────────

router.get('/group-metadata/:jid', async (req: Request, res: Response) => {
  const session = (req as any).userSession;
  if (!session.sock) return res.status(503).json({ error: 'Not connected' });
  try {
    const meta = await session.sock.groupMetadata(req.params.jid);
    res.json(meta);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /profile-picture ─────────────────────────────────────────────────────

router.get('/profile-picture', async (req: Request, res: Response) => {
  const session = (req as any).userSession;
  const { jid } = req.query;
  if (!session.sock) return res.status(503).json({ error: 'Not connected' });
  try {
    const url = await session.sock.profilePictureUrl(jid as string, 'image');
    res.json({ url });
  } catch {
    res.json({ url: null });
  }
});

// ─── GET /scheduled-messages ──────────────────────────────────────────────────

router.get('/scheduled-messages', (req: Request, res: Response) => {
  const session = (req as any).userSession;
  res.json(session.proData.scheduledMessages || []);
});

router.post('/schedule-message', (req: Request, res: Response) => {
  const session = (req as any).userSession;
  const { jid, text, time } = req.body;
  if (!jid || !text || !time) return res.status(400).json({ error: 'jid, text, time required' });
  if (!session.proData.scheduledMessages) session.proData.scheduledMessages = [];
  const id = 'sched_' + Date.now();
  session.proData.scheduledMessages.push({ id, jid, text, time, createdAt: Date.now() });
  sessionManager.saveProData(session);
  res.json({ status: 'Scheduled', id });
});

// ─── POST /read-all ───────────────────────────────────────────────────────────

router.post('/read-all', async (req: Request, res: Response) => {
  const session = (req as any).userSession;
  if (!session.sock) return res.status(503).json({ error: 'Not connected' });
  try {
    // Mark all chats as read by clearing unread counts
    session.realChats.forEach((c: any) => { c.unreadCount = 0; });
    session.proData.cachedChats = session.realChats;
    sessionManager.saveProData(session);
    res.json({ status: 'All marked as read' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export { router as multiUserRouter };
