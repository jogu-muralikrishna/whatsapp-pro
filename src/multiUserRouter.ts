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
import { upload, localMediaCache } from './mediaCache.js';

function normalizeJidLocal(jid: string): string {
  if (!jid) return jid;
  if (jid.includes('@')) {
    const [userWithDevice, domain] = jid.split('@');
    const user = userWithDevice.split(':')[0];
    jid = `${user}@${domain}`;
  } else if (jid.includes(':')) {
    jid = jid.split(':')[0];
  }
  if (jid.endsWith('@c.us')) jid = jid.replace('@c.us', '@s.whatsapp.net');
  return jid;
}

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
  const { id, jid: bodyJid, name, ...rest } = req.body;
  const jid = bodyJid || id;
  if (!jid) return res.status(400).json({ error: 'jid required' });
  session.proData.contacts[jid] = { ...(session.proData.contacts[jid] || {}), id: jid, name, ...rest };
  sessionManager.saveProData(session);
  sessionManager.broadcast(session, { type: 'CONTACTS_UPSERT', data: [session.proData.contacts[jid]], userId: session.userId });
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

// ════════════════════════════════════════════════════════════════════════════
// Stage 2: remaining per-user-isolated endpoints (media, group admin, profile,
// privacy, search, etc.) — ported from the old shared server.ts handlers to
// use session.sock / session.proData instead of the global ones.
// ════════════════════════════════════════════════════════════════════════════

// ─── POST /send-media ──────────────────────────────────────────────────────────

router.post('/send-media', upload.single('file'), async (req: any, res: Response) => {
  const session = (req as any).userSession;
  try {
    const { jid, caption, type } = req.body;
    const file = req.file;
    if (!jid) return res.status(400).json({ error: 'Missing target JID' });
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    const targetJid = normalizeJidLocal(jid);
    const messageId = 'sim_media_' + Math.random().toString(36).substr(2, 9);

    localMediaCache.set(messageId, {
      buffer: file.buffer,
      mimetype: file.mimetype,
      filename: file.originalname,
    });

    const utype = type || 'document';
    let messageContent: any = {};
    if (utype === 'image' || file.mimetype.startsWith('image/')) {
      messageContent = { imageMessage: { caption: caption || '', mimetype: file.mimetype, fileName: file.originalname } };
    } else if (utype === 'video' || file.mimetype.startsWith('video/')) {
      messageContent = { videoMessage: { caption: caption || '', mimetype: file.mimetype, fileName: file.originalname } };
    } else if (utype === 'audio' || file.mimetype.startsWith('audio/')) {
      messageContent = { audioMessage: { mimetype: file.mimetype, fileName: file.originalname } };
    } else {
      messageContent = { documentMessage: { mimetype: file.mimetype, fileName: file.originalname, title: file.originalname } };
    }

    const mockMsg = {
      key: { remoteJid: targetJid, fromMe: true, id: messageId },
      message: messageContent,
      messageTimestamp: Math.floor(Date.now() / 1000),
      status: 'sent',
    };

    if (!session.proData.messageHistory[targetJid]) session.proData.messageHistory[targetJid] = [];
    session.proData.messageHistory[targetJid].push(mockMsg);

    let chat = session.realChats.find((c: any) => c.id === targetJid);
    if (!chat) {
      chat = { id: targetJid, name: session.proData.contacts[targetJid]?.name || targetJid.split('@')[0], unreadCount: 0, timestamp: Math.floor(Date.now() / 1000) };
      session.realChats.push(chat);
    }
    chat.timestamp = Math.floor(Date.now() / 1000);
    chat.lastMessage = mockMsg;
    session.proData.cachedChats = session.realChats;
    sessionManager.saveProData(session);

    sessionManager.broadcast(session, { type: 'NEW_MESSAGE', data: mockMsg, userId: session.userId });

    if (session.sock) {
      try {
        let waPayload: any = {};
        if (utype === 'image' || file.mimetype.startsWith('image/')) {
          waPayload = { image: file.buffer, caption: caption || '' };
        } else if (utype === 'video' || file.mimetype.startsWith('video/')) {
          waPayload = { video: file.buffer, caption: caption || '' };
        } else if (utype === 'audio' || file.mimetype.startsWith('audio/')) {
          waPayload = { audio: file.buffer, mimetype: file.mimetype };
        } else {
          waPayload = { document: file.buffer, mimetype: file.mimetype, fileName: file.originalname };
        }
        const sent = await session.sock.sendMessage(targetJid, waPayload);
        return res.json(sent);
      } catch (e: any) {
        sessionManager.log(session, 'ERROR', `Failed to send media: ${e?.message}`);
      }
    }
    res.json(mockMsg);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /send-audio ───────────────────────────────────────────────────────────

router.post('/send-audio', async (req: Request, res: Response) => {
  const session = (req as any).userSession;
  const { jid, audio, duration, ptt } = req.body;
  if (!session.sock) return res.status(503).json({ error: 'WhatsApp is not connected yet.' });
  if (!jid || !audio) return res.status(400).json({ error: 'Missing target JID or audio payload' });
  const targetJid = normalizeJidLocal(jid);
  try {
    const buffer = Buffer.from(audio.split(',')[1], 'base64');
    const sent = await session.sock.sendMessage(targetJid, {
      audio: buffer,
      mimetype: 'audio/mp4',
      ptt: ptt !== undefined ? ptt : true,
      seconds: duration,
    });
    res.json(sent);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /react-message ─────────────────────────────────────────────────────────

router.post('/react-message', async (req: Request, res: Response) => {
  const session = (req as any).userSession;
  const { jid, msgId, emoji, fromMe } = req.body;
  if (!jid || !msgId || !emoji) return res.status(400).json({ error: 'Missing target JID, message ID, or emoji' });
  const targetJid = normalizeJidLocal(jid);

  const chatMsgs = session.proData.messageHistory[targetJid] || [];
  const found = chatMsgs.find((m: any) => (m.key?.id === msgId || m.id === msgId));
  if (found) {
    found.reaction = emoji;
    sessionManager.saveProData(session);
  }
  sessionManager.broadcast(session, { type: 'MESSAGE_REACTED', data: { jid: targetJid, msgId, emoji }, userId: session.userId });

  if (session.sock) {
    try {
      const sent = await session.sock.sendMessage(targetJid, { react: { text: emoji, key: { remoteJid: targetJid, id: msgId, fromMe: fromMe === true } } });
      return res.json(sent);
    } catch (e: any) {
      sessionManager.log(session, 'ERROR', `Failed to react: ${e.message}`);
    }
  }
  res.json({ status: 'success', simulated: true });
});

// ─── POST /forward-message ───────────────────────────────────────────────────────

router.post('/forward-message', async (req: Request, res: Response) => {
  const session = (req as any).userSession;
  const { targetJid, msgId, fromJid } = req.body;
  if (!session.sock) return res.status(503).json({ error: 'WhatsApp is not connected yet.' });
  if (!targetJid || !msgId || !fromJid) return res.status(400).json({ error: 'Missing parameters' });

  const normalizedTarget = normalizeJidLocal(targetJid);
  const normalizedFrom = normalizeJidLocal(fromJid);

  try {
    const chatMsgs = session.proData.messageHistory[normalizedFrom] || [];
    const msg = chatMsgs.find((m: any) => m.key.id === msgId);
    if (!msg) throw new Error('Source message not found in history');
    const sent = await session.sock.sendMessage(normalizedTarget, { forward: msg });
    res.json(sent);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Status viewers, polls, group admin ──────────────────────────────────────────

router.get('/status-viewers', (req: Request, res: Response) => {
  const session = (req as any).userSession;
  const { msgId } = req.query;
  const viewers = (session.proData as any).statusViewers?.[msgId as string] || [];
  res.json({ viewers });
});

router.post('/send-poll', async (req: Request, res: Response) => {
  const session = (req as any).userSession;
  const { jid, question, options } = req.body;
  if (!jid || !question || !options?.length) return res.status(400).json({ error: 'Missing fields' });
  if (!session.sock) return res.status(503).json({ error: 'Not connected' });
  try {
    await session.sock.sendMessage(jid, { poll: { name: question, values: options, selectableCount: 1 } });
    res.json({ status: 'sent' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/vote-poll', (req: Request, res: Response) => {
  const { jid, msgId, option } = req.body;
  if (!jid || !msgId || !option) return res.status(400).json({ error: 'Missing fields' });
  res.json({ status: 'voted', option });
});

router.post('/group-remove', async (req: Request, res: Response) => {
  const session = (req as any).userSession;
  const { jid, participant } = req.body;
  if (!jid || !participant) return res.status(400).json({ error: 'Missing fields' });
  if (!session.sock) return res.status(503).json({ error: 'Not connected' });
  try {
    await session.sock.groupParticipantsUpdate(jid, [participant], 'remove');
    res.json({ status: 'removed' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/group-admin', async (req: Request, res: Response) => {
  const session = (req as any).userSession;
  const { jid, participant, action } = req.body;
  if (!jid || !participant || !action) return res.status(400).json({ error: 'Missing fields' });
  if (!session.sock) return res.status(503).json({ error: 'Not connected' });
  try {
    await session.sock.groupParticipantsUpdate(jid, [participant], action === 'promote' ? 'promote' : 'demote');
    res.json({ status: action });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/group-invite/:jid', async (req: Request, res: Response) => {
  const session = (req as any).userSession;
  if (!session.sock) return res.status(503).json({ error: 'Not connected' });
  try {
    const code = await session.sock.groupInviteCode(req.params.jid);
    res.json({ code });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/group-revoke-invite', async (req: Request, res: Response) => {
  const session = (req as any).userSession;
  const { jid } = req.body;
  if (!jid) return res.status(400).json({ error: 'Missing jid' });
  if (!session.sock) return res.status(503).json({ error: 'Not connected' });
  try {
    await session.sock.groupRevokeInvite(jid);
    res.json({ status: 'revoked' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Privacy, two-step, profile updates ──────────────────────────────────────────

router.post('/privacy-settings', async (req: Request, res: Response) => {
  const session = (req as any).userSession;
  const { lastSeen, profilePic, status, readReceipts } = req.body;
  try {
    if (session.sock) {
      if (lastSeen !== undefined) await session.sock.updateLastSeenPrivacy(lastSeen);
      if (profilePic !== undefined) await session.sock.updateProfilePicturePrivacy(profilePic);
      if (status !== undefined) await session.sock.updateStatusPrivacy(status);
      if (readReceipts !== undefined) await session.sock.updateReadReceiptsPrivacy(readReceipts ? 'all' : 'none');
    }
    res.json({ status: 'updated' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/two-step', async (req: Request, res: Response) => {
  const session = (req as any).userSession;
  const { pin, enabled } = req.body;
  try {
    if (session.sock && enabled && pin) await session.sock.register(pin);
    res.json({ status: 'set' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/update-profile-picture', async (req: Request, res: Response) => {
  const session = (req as any).userSession;
  const { image } = req.body;
  if (!session.sock || !image) return res.status(400).json({ error: 'Missing image' });
  try {
    const buffer = Buffer.from(image.split(',')[1], 'base64');
    await session.sock.updateProfilePicture(session.sock.user.id, buffer);
    res.json({ status: 'success' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/update-profile', async (req: Request, res: Response) => {
  const session = (req as any).userSession;
  const { name, bio } = req.body;
  if (!session.sock) return res.status(500).json({ error: 'Socket not ready' });
  try {
    if (name) await session.sock.updateProfileName(name);
    if (bio) await session.sock.updateProfileStatus(bio);
    res.json({ status: 'success' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Chat/message cleanup, search, presence, disappearing messages ──────────────

router.post('/clear-chat', (req: Request, res: Response) => {
  const session = (req as any).userSession;
  const chatId = normalizeJidLocal(req.body.chatId);
  session.proData.messageHistory[chatId] = [];
  sessionManager.saveProData(session);
  sessionManager.broadcast(session, { type: 'CHAT_CLEARED', data: { chatId }, userId: session.userId });
  res.json({ status: 'success' });
});

router.post('/restore-chat', (req: Request, res: Response) => {
  const session = (req as any).userSession;
  const { chatId } = req.body;
  if (!session.proData.recycleBin) session.proData.recycleBin = { messages: [], chats: [] };
  const idx = session.proData.recycleBin.chats.findIndex((c: any) => c.id === chatId);
  if (idx !== -1) {
    const restored = session.proData.recycleBin.chats.splice(idx, 1)[0];
    session.realChats.push(restored);
    session.proData.cachedChats = session.realChats;
    sessionManager.saveProData(session);
    sessionManager.broadcast(session, { type: 'CHATS_UPDATE', data: session.realChats, userId: session.userId });
    return res.json({ status: 'success' });
  }
  res.status(404).json({ error: 'Chat not found in recycle bin' });
});

router.post('/restore-message', (req: Request, res: Response) => {
  const session = (req as any).userSession;
  const { msgId } = req.body;
  if (!session.proData.recycleBin) session.proData.recycleBin = { messages: [], chats: [] };
  const idx = session.proData.recycleBin.messages.findIndex((m: any) => m.key.id === msgId);
  if (idx !== -1) {
    const restored = session.proData.recycleBin.messages.splice(idx, 1)[0];
    const chatId = restored.originalChat || restored.key?.remoteJid;
    if (!session.proData.messageHistory[chatId]) session.proData.messageHistory[chatId] = [];
    session.proData.messageHistory[chatId].push(restored);
    sessionManager.saveProData(session);
    sessionManager.broadcast(session, { type: 'NEW_MESSAGE', data: restored, userId: session.userId });
    return res.json({ status: 'success' });
  }
  res.status(404).json({ error: 'Message not found in recycle bin' });
});

router.get('/search-messages', (req: Request, res: Response) => {
  const session = (req as any).userSession;
  const q = ((req.query.q as string) || '').toLowerCase();
  if (!q) return res.json({ results: [] });
  const results: any[] = [];
  const chats = session.proData.cachedChats || [];
  for (const chat of chats.slice(0, 20)) {
    if (chat.lastMessage?.message) {
      const text = chat.lastMessage.message.conversation || chat.lastMessage.message.extendedTextMessage?.text || '';
      if (text.toLowerCase().includes(q)) {
        results.push({ chat: { id: chat.id, name: chat.name }, msg: { id: chat.lastMessage.key?.id, text, timestamp: chat.lastMessage.messageTimestamp * 1000 } });
      }
    }
  }
  res.json({ results });
});

router.post('/subscribe-presence', async (req: Request, res: Response) => {
  const session = (req as any).userSession;
  const { jid } = req.body;
  if (!session.sock || !jid) return res.status(400).json({ error: 'Missing jid or not connected' });
  try {
    await session.sock.presenceSubscribe(jid);
    res.json({ status: 'subscribed' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/disappearing-messages', async (req: Request, res: Response) => {
  const session = (req as any).userSession;
  const { jid, duration } = req.body;
  if (!jid) return res.status(400).json({ error: 'Missing jid' });
  try {
    if (session.sock) await session.sock.sendMessage(jid, { disappearingMessagesInChat: duration });
    res.json({ status: 'success', duration });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/add-call', (req: Request, res: Response) => {
  const session = (req as any).userSession;
  const { jid, type, date, duration, status, fromMe } = req.body;
  if (!jid) return res.status(400).json({ error: 'Missing JID' });
  const me = session.sock?.user?.id || 'me@s.whatsapp.net';
  const newCall = {
    id: 'call_' + Math.random().toString(36).substr(2, 9),
    from: fromMe ? me : jid,
    to: fromMe ? jid : me,
    timestamp: Math.floor(new Date(date || Date.now()).getTime() / 1000),
    status: status || 'connected',
    type: type || 'audio',
    duration: duration || 0,
  };
  if (!session.proData.callHistory) session.proData.callHistory = [];
  session.proData.callHistory.unshift(newCall);
  if (session.proData.callHistory.length > 100) session.proData.callHistory.pop();
  sessionManager.saveProData(session);
  sessionManager.broadcast(session, { type: 'CALL_UPDATE', data: newCall, userId: session.userId });
  res.json({ status: 'success', call: newCall });
});
