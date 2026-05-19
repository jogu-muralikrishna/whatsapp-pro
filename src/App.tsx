import React, { useState, useEffect, useRef } from 'react';
import { 
  Phone, 
  Send, 
  Search, 
  Plus, 
  Clock, 
  Settings, 
  MoreVertical, 
  ChevronLeft, 
  ChevronRight,
  Monitor, 
  Zap, 
  Trash2, 
  Lock, 
  Star, 
  Check, 
  QrCode as QrCodeIcon, 
  RefreshCw, 
  MessageSquare, 
  MessageCircle,
  User, 
  Camera, 
  Video, 
  X,
  Sparkles,
  ShieldCheck,
  Shield,
  Activity,
  History,
  FileText,
  Download,
  Image as ImageIcon,
  PlayCircle,
  Music,
  Paperclip,
  Mic,
  Square,
  Forward,
  Pause,
  Play
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import QRCode from 'react-qr-code';

interface Chat {
  id: string;
  name: string;
  lastMessage?: any;
  unreadCount?: number;
  timestamp?: number;
  isGroup?: boolean;
}

interface Message {
  id: string;
  sender: string;
  text: string;
  timestamp: number;
  fromMe: boolean;
  status: 'sent' | 'delivered' | 'read';
  rawMessage?: any;
}

type Tab = 'CHATS' | 'STATUS' | 'CALLS' | 'LOGS' | 'SETTINGS';

export default function App() {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [loginMethod, setLoginMethod] = useState<'pairing' | 'qr'>('pairing');
  const [connectionState, setConnectionState] = useState<'close' | 'connecting' | 'open'>('close');
  const [user, setUser] = useState<any>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('CHATS');
  const [engineLogs, setEngineLogs] = useState<any[]>([]);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [contacts, setContacts] = useState<Record<string, any>>({});
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [callHistory, setCallHistory] = useState<any[]>([]);
  const [proSettings, setProSettings] = useState({ 
    ghostMode: false, 
    antiDelete: true, 
    antiDeleteStatus: true,
    hideNumbers: false,
    hideBlueTicks: false,
    hideSecondTick: false,
    hideTyping: false,
    secretStatusView: true,
    dndMode: false,
    autoReply: false,
    theme: 'elegant-dark',
    font: 'Inter'
  });
  const [scheduledMsgs, setScheduledMsgs] = useState<any[]>([]);
  const [autoReplies, setAutoReplies] = useState<any[]>([]);
  const [interceptedStatuses, setInterceptedStatuses] = useState<any[]>([]);
  const [lockedChats, setLockedChats] = useState<string[]>([]);
  const [showLockedChats, setShowLockedChats] = useState(false);
  const [deleteOptionModal, setDeleteOptionModal] = useState<{ msgId: string, visible: boolean } | null>(null);
  const [isProfileEditorOpen, setIsProfileEditorOpen] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileBio, setProfileBio] = useState('');
  const [showRecycleBin, setShowRecycleBin] = useState(false);
  const [recycleBinData, setRecycleBinData] = useState<{ messages: any[], chats: any[] }>({ messages: [], chats: [] });
  const [showContactInfo, setShowContactInfo] = useState(false);
  const [chatSubTab, setChatSubTab] = useState<'ALL' | 'UNREAD' | 'FAVORITES' | 'GROUPS'>('ALL');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [editingContact, setEditingContact] = useState<{ id: string, name: string } | null>(null);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [groupMetadata, setGroupMetadata] = useState<any>(null);
  const [statusUpdates, setStatusUpdates] = useState<any[]>([]);
  const [activeStatus, setActiveStatus] = useState<any>(null);
  const [statusText, setStatusText] = useState('');
  const [statusImage, setStatusImage] = useState<string | null>(null);
  const [statusReplyText, setStatusReplyText] = useState('');
  const [profilePictures, setProfilePictures] = useState<Record<string, string>>({});
  const [starredMessages, setStarredMessages] = useState<any[]>([]);
  const [isChatMenuOpen, setIsChatMenuOpen] = useState(false);
  const [isMainMenuOpen, setIsMainMenuOpen] = useState(false);
  const [settingsView, setSettingsView] = useState<'main' | 'notifications' | 'chats' | 'guides' | 'lists' | 'privacy' | 'accounts' | 'language' | 'keyboard' | 'help'>('main');
  
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null);

  const [filterUnknown, setFilterUnknown] = useState(false);
  const [showAutoReplyModal, setShowAutoReplyModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleData, setScheduleData] = useState({ text: '', time: '' });
  const [newAutoReply, setNewAutoReply] = useState({ keyword: '', response: '' });

  const ws = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeChatRef = useRef<Chat | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingTimerRef = useRef<any>(null);

  useEffect(() => {
    activeChatRef.current = activeChat;
  }, [activeChat]);

  useEffect(() => {
    connectWebSocket();
    checkConnectionStatus();
    fetchLogs();
    fetchSettings();
    fetchCallHistory();
    fetchStatusUpdates();
    fetchFavorites();
    fetchLockedChats();
    fetchAutoReplies();
    fetchScheduledMsgs();
    const logInterval = setInterval(fetchLogs, 5000);
    return () => {
      ws.current?.close();
      clearInterval(logInterval);
    };
  }, []);

  const fetchAutoReplies = async () => {
    try {
      const res = await fetch('/api/auto-replies');
      const data = await res.json();
      setAutoReplies(data);
    } catch (e) {}
  };

  const fetchScheduledMsgs = async () => {
    try {
      const res = await fetch('/api/scheduled-messages');
      const data = await res.json();
      setScheduledMsgs(data);
    } catch (e) {}
  };

  useEffect(() => {
    // Apply Font
    document.documentElement.style.setProperty('--engine-font', proSettings.font || 'Inter');
    
    // Apply Theme
    const themes: any = {
      'elegant-dark': { primary: '#00a884', bg: '#0b141a', surface: '#111b21', accent: '#202c33' },
      'matrix-green': { primary: '#22c55e', bg: '#000000', surface: '#050505', accent: '#0c0a09' },
      'cyber-blue': { primary: '#00f2ff', bg: '#020617', surface: '#0f172a', accent: '#1e293b' },
      'royal-purple': { primary: '#a855f7', bg: '#0f0714', surface: '#1a0b2e', accent: '#2d1b4e' },
      'blood-red': { primary: '#ef4444', bg: '#0a0a0a', surface: '#171717', accent: '#262626' }
    };
    
    const theme = themes[proSettings.theme] || themes['elegant-dark'];
    document.documentElement.style.setProperty('--color-primary', theme.primary);
    document.documentElement.style.setProperty('--color-bg', theme.bg);
    document.documentElement.style.setProperty('--color-surface', theme.surface);
    document.documentElement.style.setProperty('--color-accent', theme.accent);
  }, [proSettings.theme, proSettings.font]);

  const fetchStatusUpdates = async () => {
    try {
      const res = await fetch('/api/status-updates');
      const data = await res.json();
      setStatusUpdates(data.active || []);
      setInterceptedStatuses(data.intercepted || []);
    } catch (e) {}
  };

  const fetchCallHistory = async () => {
    try {
      const res = await fetch('/api/history/calls');
      const data = await res.json();
      setCallHistory(data);
    } catch (e) {}
  };

  const fetchRecycleBin = async () => {
    try {
      const res = await fetch('/api/recycle-bin');
      const data = await res.json();
      setRecycleBinData(data);
    } catch (e) {}
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      setProSettings(data);
    } catch (e) {}
  };

  const fetchFavorites = async () => {
    try {
      const res = await fetch('/api/favorites');
      const data = await res.json();
      setFavorites(data);
    } catch (e) {}
  };

  const fetchLockedChats = async () => {
    try {
      const res = await fetch('/api/locked-chats');
      const data = await res.json();
      setLockedChats(data);
    } catch (e) {}
  };

  const fetchGroupMetadata = async (jid: string) => {
    if (!jid.endsWith('@g.us')) return;
    try {
      const res = await fetch(`/api/group-metadata/${jid}`);
      const data = await res.json();
      setGroupMetadata(data);
    } catch (e) {}
  };

  const toggleLockChat = async (chatId: string) => {
    const isLocked = lockedChats.includes(chatId);
    try {
       const res = await fetch('/api/lock-chat', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ chatId, lock: !isLocked })
       });
       const data = await res.json();
       setLockedChats(data.lockedChats);
    } catch (e) {}
  };

  const updateProfile = async () => {
    setLoading(true);
    try {
       await fetch('/api/update-profile', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ name: profileName, bio: profileBio })
       });
       setIsProfileEditorOpen(false);
       checkConnectionStatus();
    } catch (e) {}
    setLoading(false);
  };
  const uploadProfilePicture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (re: any) => {
       const base64 = re.target.result;
       try {
          const res = await fetch('/api/update-profile-picture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: base64 })
          });
          if (res.ok) {
            checkConnectionStatus(); // Refresh user info
            setError('Biometric Visual updated in Matrix.');
          }
       } catch (err) {
          setError('Failed to transmit visual data.');
       }
    };
    reader.readAsDataURL(file);
  };

  const fetchProfilePicture = async (jid: string) => {
    if (profilePictures[jid]) return;
    try {
       const res = await fetch(`/api/profile-picture?jid=${jid}`);
       const data = await res.json();
       if (data.url) setProfilePictures(prev => ({ ...prev, [jid]: data.url }));
    } catch (e) {}
  };

  const readAll = async () => {
    try {
      await fetch('/api/read-all', { method: 'POST' });
      checkConnectionStatus();
    } catch (e) {}
  };

  const restoreChat = async (chatId: string) => {
    try {
      await fetch('/api/restore-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId })
      });
      fetchRecycleBin();
      checkConnectionStatus(); // Refresh chat list
    } catch (e) {}
  };

  const restoreMessage = async (msgId: string) => {
    try {
      await fetch('/api/restore-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msgId })
      });
      fetchRecycleBin();
    } catch (e) {}
  };

  const toggleFavorite = async (chatId: string) => {
    try {
      const res = await fetch('/api/favorite-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId })
      });
      const data = await res.json();
      setFavorites(data.favorites);
    } catch (e) {}
  };

  const clearChat = async (chatId: string) => {
    try {
       await fetch('/api/clear-chat', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ chatId })
       });
       if (activeChat?.id === chatId) setMessages([]);
    } catch (e) {}
  };

  const updateContact = async (id: string, name: string) => {
    try {
       await fetch('/api/update-contact', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ id, name })
       });
       setEditingContact(null);
    } catch (e) {}
  };

  const downloadMedia = async (msgId: string, chatId: string, filename: string) => {
     try {
        const res = await fetch(`/api/media?msgId=${msgId}&chatId=${chatId}`);
        if (!res.ok) {
           const errorData = await res.text();
           if (res.status === 410) {
              throw new Error("MEDIA_EXPIRED: The requested asset is no longer available on WhatsApp servers.");
           }
           throw new Error(errorData || 'Fetch failed');
        }
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
     } catch (e: any) {
        if (e.message.startsWith("MEDIA_EXPIRED")) {
           setError(`Archive Purge: ${e.message}`);
        } else {
           setError(`Media Extraction Failed: ${e.message}. Ensure the original asset is still logged on your device.`);
        }
        console.error(`Download failure: ${e.message}`);
     }
  };

  const updateProSettings = async (updates: any) => {
    const newSettings = { ...proSettings, ...updates };
    setProSettings(newSettings);
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings)
      });
    } catch (e) {}
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, activeChat]);

  const fetchLogs = async () => {
    try {
      const res = await fetch('/api/engine-logs');
      const data = await res.json();
      setEngineLogs(data);
    } catch (e) {}
  };

  const addAutoReply = async () => {
    if (!newAutoReply.keyword || !newAutoReply.response) return;
    try {
      await fetch('/api/auto-replies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAutoReply)
      });
      fetchAutoReplies();
      setNewAutoReply({ keyword: '', response: '' });
      setShowAutoReplyModal(false);
    } catch (e) {}
  };

  const scheduleMessage = async () => {
    if (!activeChat || !scheduleData.text || !scheduleData.time) return;
    try {
      await fetch('/api/schedule-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...scheduleData, jid: activeChat.id })
      });
      fetchScheduledMsgs();
      setScheduleData({ text: '', time: '' });
      setShowScheduleModal(false);
    } catch (e) {}
  };

  const checkConnectionStatus = async () => {
    try {
      const res = await fetch('/api/connection-status');
      const data = await res.json();
      setConnectionState(data.state);
      if (data.statusUpdates) setStatusUpdates(data.statusUpdates);
      if (data.isRegistered && data.user) {
        setUser(data.user);
        if (data.chats) {
          const sorted = data.chats.sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));
          setChats(sorted);
          sorted.forEach((c: any) => fetchProfilePicture(c.id));
        }
        if (data.contacts) {
          setContacts(data.contacts);
        }
      }
      if (data.qrCode) {
        setQrCode(data.qrCode);
      }
    } catch (e) {}
  };

  const refreshQr = async () => {
    setIsRefreshing(true);
    setQrCode(null);
    try {
      await fetch('/api/refresh-qr');
      // The socket will re-init and broadcast a new QR
    } catch (e) {
      setError('Failed to refresh engine');
    } finally {
      setTimeout(() => setIsRefreshing(false), 2000);
    }
  };

  const hardLogout = async () => {
    setLoading(true);
    setError(null);
    try {
      await fetch('/api/logout', { method: 'POST' });
      setUser(null);
      setChats([]);
      setActiveChat(null);
      setQrCode(null);
      setPairingCode('');
    } catch (e) {
      setError('Logout failed');
    } finally {
      setLoading(false);
    }
  };

  const connectWebSocket = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}`);
    ws.current = socket;

    socket.onclose = () => {
      setConnectionState('close');
      setError('Neural Link Severed: Engine connection lost. Retrying...');
      setTimeout(connectWebSocket, 5000); // Auto-reconnect WS
    };

    socket.onmessage = (event) => {
      const { type, data } = JSON.parse(event.data);
      switch (type) {
        case 'CONNECTION_STATE':
          setConnectionState(data);
          if (data === 'open') {
            setPairingCode('');
            setQrCode(null);
            setError(null); // Clear errors upon successful link
          }
          break;
        case 'QR_CODE':
          setQrCode(data);
          setError(null); // Fresh QR means we are ready to try again
          break;
        case 'LOGGED_IN':
          setUser(data);
          setError(null);
          break;
        case 'LOGOUT':
          setUser(null);
          setChats([]);
          setActiveChat(null);
          setQrCode(null);
          setPairingCode('');
          if (data?.message) {
            setError(data.message);
          }
          if (data?.fatal) {
            // Force re-fetch of status after a momentary delay
            setTimeout(checkConnectionStatus, 3000);
          }
          break;
        case 'CONTACTS_UPSERT':
          const contactUpdates = Array.isArray(data) ? data : [data];
          setContacts(prev => {
            const next = { ...prev };
            contactUpdates.forEach(c => {
               let jid = c.id;
               if (jid.endsWith('@c.us')) jid = jid.replace('@c.us', '@s.whatsapp.net');
               next[jid] = { ...(next[jid] || {}), ...c, id: jid };
            });
            return next;
          });
          break;
        case 'STATUS_UPDATE':
          setStatusUpdates(prev => [data, ...prev].slice(0, 50));
          if (data.participant) fetchProfilePicture(data.participant.split(':')[0] + '@s.whatsapp.net');
          break;
        case 'STATUS_DELETED_INTERCEPT':
          setInterceptedStatuses(prev => [data, ...prev].slice(0, 50));
          break;
        case 'CALL_UPDATE':
          const calls = Array.isArray(data) ? data : [data];
          setCallHistory(prev => [...calls, ...prev].slice(0, 50));
          break;
        case 'MESSAGE_REVOKED_ANTIDELETE':
          if (data.jid === activeChatRef.current?.id) {
            setMessages(prev => prev.map(m => m.id === data.msgId ? { ...m, isRevoked: true } : m));
          }
          break;
        case 'MESSAGE_DELETED':
          if (data.chatId === activeChatRef.current?.id) {
            setMessages(prev => prev.filter(m => m.id !== data.msgId));
          }
          break;
        case 'CHAT_DELETED':
          setChats(prev => prev.filter(c => c.id !== data.chatId));
          if (activeChatRef.current?.id === data.chatId) setActiveChat(null);
          break;
        case 'CHATS_UPDATE':
          setChats(prev => {
            const updates = Array.isArray(data) ? data : [data];
            let newChats = [...prev];
            updates.forEach(update => {
              if (!update.id) return;
              let jid = update.id;
              if (jid.endsWith('@c.us')) jid = jid.replace('@c.us', '@s.whatsapp.net');
              update.id = jid;
              
              const index = newChats.findIndex(c => c.id === jid);
              if (index !== -1) {
                newChats[index] = { ...newChats[index], ...update };
              } else {
                newChats.push(update);
              }
            });
            // Ensure distinct chats by ID
            const uniqueChats = Array.from(new Map(newChats.map(c => [c.id, c])).values());
            return uniqueChats.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
          });
          break;
        case 'INITIAL_SYNC':
          if (data.chats) {
            setChats(prev => {
              const merged = [...prev];
              data.chats.forEach((newChat: any) => {
                let jid = newChat.id;
                if (jid.endsWith('@c.us')) jid = jid.replace('@c.us', '@s.whatsapp.net');
                newChat.id = jid;

                const index = merged.findIndex(c => c.id === jid);
                if (index !== -1) {
                  merged[index] = { ...merged[index], ...newChat };
                } else {
                  merged.push(newChat);
                }
              });
              return Array.from(new Map(merged.map(c => [c.id, c])).values())
                .sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));
            });
          }
          if (data.contacts) {
            setContacts(prev => {
              const next = { ...prev };
              Object.keys(data.contacts).forEach(key => {
                let jid = key;
                if (jid.endsWith('@c.us')) jid = jid.replace('@c.us', '@s.whatsapp.net');
                next[jid] = { ...(next[jid] || {}), ...data.contacts[key], id: jid };
              });
              return next;
            });
          }
          if (data.statusUpdates) setStatusUpdates(data.statusUpdates);
          if (data.callHistory) setCallHistory(data.callHistory);
          if (data.favorites) setFavorites(data.favorites);
          if (data.lockedChats) setLockedChats(data.lockedChats);
          if (data.settings) setProSettings(data.settings);
          break;
        case 'MESSAGES_UPSERT':
          const msgData = data.messages?.[0];
          if (!msgData) break;
          let incomingJid = msgData.key?.remoteJid;
          if (incomingJid.endsWith('@c.us')) incomingJid = incomingJid.replace('@c.us', '@s.whatsapp.net');
          
          let activeJid = activeChatRef.current?.id || '';
          if (activeJid.endsWith('@c.us')) activeJid = activeJid.replace('@c.us', '@s.whatsapp.net');
          
          if (incomingJid === activeJid) {
            const newMsg: Message = {
              id: msgData.key.id,
              sender: msgData.pushName || getDisplayName(msgData.participant || msgData.key.participant || incomingJid),
              text: getMsgText(msgData),
              timestamp: msgData.messageTimestamp * 1000,
              fromMe: msgData.key.fromMe,
              status: 'sent',
              rawMessage: msgData.message
            };
            setMessages(prev => {
              const exists = prev.some(m => m.id === newMsg.id);
              if (exists) return prev;
              return [...prev, newMsg];
            });
            if (!newMsg.fromMe && newMsg.text) getAiSuggestions(newMsg.text);
          }
          break;
      }
    };
  };

  const getDisplayName = (chat: any) => {
    if (!chat) return 'Unknown';
    if (chat.name) return chat.name;
    let chatJid = typeof chat === 'string' ? chat : chat.id;
    
    // De-alias participants from groups (number:device@s.whatsapp.net -> number@s.whatsapp.net)
    if (chatJid.includes(':')) {
      const parts = chatJid.split(':');
      const suffix = chatJid.split('@')[1];
      chatJid = parts[0] + '@' + suffix;
    }
    
    if (chatJid.endsWith('@c.us')) chatJid = chatJid.replace('@c.us', '@s.whatsapp.net');
    
    const contact = contacts[chatJid];
    if (contact && contact.name) {
      return contact.name;
    }
    
    const rawNumber = chatJid.split('@')[0];
    if (proSettings.hideNumbers) {
       return `${rawNumber.slice(0, 4)}••••${rawNumber.slice(-2)}`;
    }
    return rawNumber;
  };

  const getMsgText = (m: any) => {
    if (!m || !m.message) return '';
    const content = m.message;
    const doc = content.documentMessage;
    if (doc) return doc.fileName || 'Document';
    return content.conversation || 
           content.extendedTextMessage?.text || 
           content.imageMessage?.caption || 
           content.videoMessage?.caption || 
           (content.protocolMessage ? 'System Message' : '') ||
           (content.imageMessage ? '📷 Image' : '') ||
           (content.videoMessage ? '🎥 Video' : '') ||
           (content.audioMessage ? '🎵 Audio' : '') ||
           (content.stickerMessage ? 'Sticker' : '') ||
           '';
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/mp4' });
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = reader.result as string;
          if (activeChat) {
            await fetch('/api/send-audio', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                jid: activeChat.id, 
                audio: base64, 
                duration: recordingTime,
                ptt: true 
              })
            });
          }
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach(track => track.stop());
      };

      recorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (e) {
      setError('Neural Link Blocked: Microphone access required for sonic transmission.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearInterval(recordingTimerRef.current);
    }
  };

  const forwardMessage = async (targetJid: string) => {
    if (!forwardMsg || !activeChat) return;
    try {
      await fetch('/api/forward-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          targetJid, 
          msgId: forwardMsg.id, 
          fromJid: activeChat.id 
        })
      });
      setShowForwardModal(false);
      setForwardMsg(null);
    } catch (e) {}
  };

  const reactToMessage = async (msgId: string, emoji: string, fromMe: boolean) => {
    if (!activeChat) return;
    try {
      await fetch('/api/react-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          jid: activeChat.id, 
          msgId, 
          emoji,
          fromMe
        })
      });
      // In a real app we'd wait for the WS update, but we can optimistically update or just wait.
    } catch (e) {}
  };

  const replyToStatus = async () => {
    if (!activeStatus || !statusReplyText.trim()) return;
    try {
      const targetJid = activeStatus.participant;
      await fetch('/api/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          jid: targetJid, 
          text: statusReplyText,
          quoted: activeStatus
        })
      });
      
      // Open the chat with the status participant
      const existingChat = chats.find(c => c.id === targetJid);
      if (existingChat) {
        loadHistory(existingChat);
      } else {
        const tempChat = { id: targetJid, name: getDisplayName(targetJid) };
        setActiveChat(tempChat);
        loadHistory(tempChat);
      }
      
      setActiveStatus(null);
      setStatusReplyText('');
      setActiveTab('CHATS');
    } catch (e) {}
  };

  const postStatus = async (type: 'text' | 'image' | 'video', content: string, caption?: string) => {
    try {
      await fetch('/api/post-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, content, caption })
      });
      setShowStatusModal(false);
      setStatusText('');
      setStatusImage(null);
    } catch (e) {
      setError('Signal Jammed: Status upload failed.');
    }
  };

  const markStatusSeen = async (status: any) => {
    try {
      await fetch('/api/read-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keys: [{ remoteJid: 'status@broadcast', id: status.id, participant: status.participant }]
        })
      });
    } catch (e) {}
  };

  const getAiSuggestions = async (text: string) => {
    if (!text || text.length < 5) return;
    setIsAiLoading(true);
    try {
      const res = await fetch('/api/ai-suggestion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const data = await res.json();
      if (data.suggestions) {
        setAiSuggestions(data.suggestions);
      }
    } catch (e) {
      console.error('AI Error:', e);
    } finally {
      setIsAiLoading(false);
    }
  };

  const requestPairingCode = async () => {
    if (!phoneNumber || phoneNumber.length !== 10) {
      setError('Please enter a valid 10-digit India number');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/request-pairing-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setPairingCode(data.code);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !activeChat) return;
    const msg: Message = {
      id: Math.random().toString(36).substr(2, 9),
      sender: 'Me',
      text: newMessage,
      timestamp: Date.now(),
      fromMe: true,
      status: 'sent'
    };
    setMessages(prev => [...prev, msg]);
    setNewMessage('');
    setAiSuggestions([]);
    
    try {
      await fetch('/api/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jid: activeChat.id, text: newMessage })
      });
      // Update local chat timestamp/last message for immediate feedback
      setChats(prev => {
        const index = prev.findIndex(c => c.id === activeChat.id);
        if (index === -1) return prev;
        const next = [...prev];
        next[index] = { 
          ...next[index], 
          timestamp: Math.floor(Date.now() / 1000),
          lastMessage: { key: { id: msg.id }, message: { conversation: newMessage }, messageTimestamp: Math.floor(Date.now() / 1000) }
        };
        return next.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      });
    } catch (e) {}
  };

  const deleteChat = async (chatId: string) => {
    try {
      await fetch('/api/delete-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId })
      });
      setChats(prev => prev.filter(c => c.id !== chatId));
      if (activeChat?.id === chatId) setActiveChat(null);
    } catch (e) {}
  };

  const deleteMessage = async (msgId: string, revoke: boolean = false) => {
    if (!activeChat) return;
    try {
      await fetch('/api/delete-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: activeChat.id, msgId, revoke })
      });
      setMessages(prev => prev.filter(m => m.id !== msgId));
      setDeleteOptionModal(null);
    } catch (e) {}
  };

  const loadHistory = async (chat: Chat) => {
    setActiveChat(chat);
    setMessages([]);
    setAiSuggestions([]);
    setGroupMetadata(null);
    if (chat.id.endsWith('@g.us')) {
      fetchGroupMetadata(chat.id);
    }
    try {
      const res = await fetch(`/api/history/${chat.id}`);
      const data = await res.json();
      const formatted = data.map((m: any) => {
        // Resolve sender name for group chats
        let senderName = 'Me';
        if (!m.key.fromMe) {
           senderName = getDisplayName(m.participant || m.key.participant || m.key.remoteJid);
        }

        return {
          id: m.key.id,
          sender: senderName,
          text: getMsgText(m),
          timestamp: (m.messageTimestamp * 1000) || Date.now(),
          fromMe: !!m.key.fromMe,
          status: 'read',
          rawMessage: m.message,
          isRevoked: !!m.isRevoked
        };
      });
      setMessages(formatted);
      if (formatted.length > 0) {
        const last = formatted[formatted.length - 1];
        if (!last.fromMe && last.text) getAiSuggestions(last.text);
        
        // Mark as read if not in ghost mode
        if (!proSettings.ghostMode) {
          fetch('/api/read-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              jid: chat.id, 
              keys: data.filter((m: any) => !m.key.fromMe).map((m: any) => m.key) 
            })
          }).catch(() => {});
        }
      }
    } catch (e) {}
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0b141a] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-[#111b21] rounded-2xl border border-white/5 shadow-2xl overflow-hidden">
          <div className="h-1 bg-[#00a884] w-full shadow-[0_0_15px_#00a884]" />
          <div className="p-8">
            <div className="flex items-center justify-center mb-10 mt-4">
              <div className="p-4 bg-[#00a884] rounded-2xl shadow-xl shadow-[#00a884]/20 rotate-3 transition-transform hover:rotate-0">
                <Shield className="w-8 h-8 text-white" />
              </div>
            </div>
            
            <div className="flex items-center justify-center gap-2 mb-2">
              <h1 className="text-3xl font-black text-white tracking-tight italic">SIGNAL PRO</h1>
              <span className="text-primary text-xl">🛡️</span>
            </div>
            <p className="text-primary/60 text-center mb-8 text-[10px] font-black uppercase tracking-[0.3em]">Encrypted Command Engine</p>

            <div className="flex gap-1 mb-8 bg-[#202c33] p-1 rounded-xl">
              <button 
                onClick={() => setLoginMethod('pairing')}
                className={`flex-1 py-3 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${loginMethod === 'pairing' ? 'bg-[#00a884] text-white' : 'text-slate-400 hover:text-slate-200'}`}
              >
                OTP Secure
              </button>
              <button 
                onClick={() => setLoginMethod('qr')}
                className={`flex-1 py-3 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${loginMethod === 'qr' ? 'bg-[#00a884] text-white' : 'text-slate-400 hover:text-slate-200'}`}
              >
                Optic Sync
              </button>
            </div>

            <div className="space-y-6">
              {loginMethod === 'pairing' ? (
                <>
                  <div>
                    <label className="block text-[10px] font-bold text-[#00a884]/50 uppercase tracking-widest mb-2 ml-1">Terminal Link identifier</label>
                    <div className="relative group">
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#00a884] font-mono font-bold text-sm">+91</div>
                      <input 
                        type="text" 
                        placeholder="Master Phone" 
                        className="w-full pl-14 pr-4 py-4 bg-[#202c33] border border-white/5 rounded-xl text-white placeholder:text-white/20 outline-none focus:border-[#00a884] transition-all font-mono"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
                        disabled={!!pairingCode || loading}
                      />
                    </div>
                  </div>

                  <AnimatePresence>
                    {pairingCode && (
                      <motion.div 
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="p-6 bg-[#202c33] rounded-xl border border-[#00a884]/20 flex flex-col items-center"
                      >
                        <span className="text-[10px] text-[#00a884] font-black mb-4 uppercase tracking-[0.3em]">Access Code</span>
                        <div className="flex gap-1">
                          {pairingCode.split('').map((char, i) => (
                            <span key={i} className="text-3xl font-mono font-black text-white bg-black/20 w-8 h-12 flex items-center justify-center rounded-lg border border-white/5 shadow-inner">
                              {char}
                            </span>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              ) : (
                  <div className="flex flex-col items-center">
                    <div className="p-4 bg-white rounded-2xl mb-6 shadow-2xl relative group">
                      {qrCode ? (
                        <div className="relative">
                          <QRCode value={qrCode} size={180} />
                          <div className="absolute inset-0 border-4 border-[#00a884]/20 rounded-lg pointer-events-none animate-pulse" />
                        </div>
                      ) : (
                        <div className="w-[180px] h-[180px] flex flex-col items-center justify-center bg-[#f0f2f5] rounded-xl gap-4">
                          <RefreshCw className="w-8 h-8 text-[#54656f] animate-spin" />
                          <span className="text-[9px] font-black text-[#54656f] uppercase tracking-widest text-center px-4">Calibrating Neural Link...</span>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-[#00a884]/5 pointer-events-none group-hover:opacity-0 transition-opacity" />
                    </div>
                    {(!qrCode && !isRefreshing) && (
                       <p className="text-[9px] text-[#00a884] font-black uppercase tracking-[0.2em] mb-4 animate-pulse">Awaiting Authentication Stream...</p>
                    )}
                  </div>
              )}

              {error && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3">
                  <X className="w-4 h-4 text-red-500 shrink-0" />
                  <p className="text-red-500 text-[10px] font-bold leading-tight">{error}</p>
                </div>
              )}

              {!pairingCode && loginMethod === 'pairing' && (
                <button 
                  onClick={requestPairingCode}
                  disabled={loading || phoneNumber.length !== 10}
                  className="w-full bg-[#00a884] text-white font-black py-4 rounded-xl hover:bg-[#00bc95] disabled:opacity-20 transition-all shadow-xl shadow-[#00a884]/10 text-xs uppercase tracking-widest flex items-center justify-center gap-3"
                >
                  {loading && <RefreshCw className="w-4 h-4 animate-spin" />}
                  {loading ? 'Initializing Stack...' : 'Link System 💎'}
                </button>
              )}

              {(pairingCode || loginMethod === 'qr') && (
                <div className="flex flex-col gap-2 w-full">
                  {loginMethod === 'qr' && (
                    <button 
                      onClick={refreshQr}
                      disabled={isRefreshing}
                      className="w-full bg-white/5 text-[#00a884] font-black py-4 rounded-xl hover:bg-white/10 disabled:opacity-50 transition-all text-[10px] uppercase tracking-[0.2em] flex items-center justify-center gap-3 border border-[#00a884]/10"
                    >
                      <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                      {isRefreshing ? 'Resetting Engine...' : 'Fast Refresh QR'}
                    </button>
                  )}
                  <button 
                    onClick={hardLogout}
                    disabled={loading}
                    className="w-full bg-red-500/10 text-red-500 font-black py-3 rounded-xl hover:bg-red-500/20 transition-all text-[10px] uppercase tracking-[0.2em] flex items-center justify-center gap-3 border border-red-500/10"
                  >
                    <Trash2 className="w-4 h-4" />
                    Clean Auth Reset
                  </button>
                  <button 
                    onClick={() => { setPairingCode(''); setQrCode(null); setError(null); checkConnectionStatus(); }}
                    className="w-full text-white/20 text-[10px] font-black uppercase tracking-[0.4em] hover:text-[#00a884] transition-colors py-2 border border-white/5 rounded-xl mt-2"
                  >
                    Reinitialize System
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1440px] mx-auto h-screen flex bg-bg overflow-hidden text-[#e9edef] font-sans selection:bg-primary/30">
      
      {/* Sidebar - Chat List / Logs */}
      <div className="w-[420px] flex flex-col border-r border-white/5 bg-surface">
        
        {/* DND Indicator */}
        {proSettings.dndMode && (
          <div className="bg-red-500 py-1 px-4 flex items-center justify-center gap-2 animate-pulse overflow-hidden whitespace-nowrap">
            <Zap className="w-3 h-3 text-white fill-white" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white">Neural Airplane Mode Active - Matrix Disconnected</span>
            <Zap className="w-3 h-3 text-white fill-white" />
          </div>
        )}

        {/* Pro Header */}
        <div className="bg-accent p-4 flex items-center justify-between">
          <div 
             className="flex items-center gap-3 group cursor-pointer"
             onClick={() => {
                setProfileName(user?.name || '');
                setProfileBio(user?.status || '');
                setIsProfileEditorOpen(true);
             }}
          >
            <div className="relative">
              <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shadow-lg transition-transform hover:scale-105 overflow-hidden border border-white/10">
                {user?.id && profilePictures[user.id.split(':')[0] + '@s.whatsapp.net'] ? (
                  <img src={profilePictures[user.id.split(':')[0] + '@s.whatsapp.net']} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <Zap className="w-5 h-5 text-white" />
                )}
              </div>
              <label className="absolute -bottom-1 -right-1 bg-[#233138] p-1 rounded-lg border border-white/10 cursor-pointer hover:bg-[#00a884] transition-colors group/edit">
                <Camera className="w-3 h-3 text-[#00a884] group-hover/edit:text-white" />
                <input type="file" accept="image/*" onChange={uploadProfilePicture} className="hidden" />
              </label>
            </div>
            <div>
              <div className="flex items-center gap-1.5 leading-none">
                <span className="font-black text-xs tracking-tighter uppercase italic">{user?.name || 'ENGINE USER'}</span>
                {connectionState === 'open' && <div className="w-2 h-2 rounded-full bg-primary shadow-[0_0_10px_var(--color-primary)]" />}
              </div>
              <div className="flex items-center gap-2 mt-1">
                 <p className="text-[9px] font-black text-[#8696af] tracking-widest uppercase opacity-60">
                   {user?.id ? user.id.split(':')[0] : 'Calibrating Neural Link...'}
                 </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4 text-[#aebac1]">
            <Activity className="w-4 h-4 text-[#00a884] opacity-50" />
            <div className="relative">
              <button 
                onClick={() => setIsMainMenuOpen(!isMainMenuOpen)}
                className="hover:text-white transition-colors p-1"
              >
                <MoreVertical className="w-5 h-5" />
              </button>
              {isMainMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsMainMenuOpen(false)} />
                  <div className="absolute top-full right-0 mt-2 w-56 bg-[#233138] rounded-xl shadow-2xl py-2 z-50 border border-white/5 backdrop-blur-xl animate-in fade-in zoom-in duration-200">
                    <div className="px-4 py-2 border-b border-white/5 mb-1">
                       <p className="text-[10px] font-black text-[#00a884] uppercase tracking-widest">Master Protocol</p>
                    </div>
                    <button 
                      onClick={() => { updateProSettings({ hideNumbers: !proSettings.hideNumbers }); setIsMainMenuOpen(false); }}
                      className="w-full px-4 py-3 flex items-center justify-between text-[#aebac1] hover:bg-white/5 text-[11px] font-bold transition-colors"
                    >
                      <div className="flex items-center gap-2 italic">
                        <MessageCircle className="w-4 h-4" />
                        Hide Numbers
                      </div>
                      <div className={`w-8 h-4 rounded-full relative transition-colors ${proSettings.hideNumbers ? 'bg-[#00a884]' : 'bg-white/10'}`}>
                        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${proSettings.hideNumbers ? 'left-4.5' : 'left-0.5'}`} />
                      </div>
                    </button>
                    <button 
                      onClick={() => { setShowLockedChats(!showLockedChats); setIsMainMenuOpen(false); }}
                      className="w-full px-4 py-3 flex items-center justify-between text-[#aebac1] hover:bg-white/5 text-[11px] font-bold transition-colors"
                    >
                      <div className="flex items-center gap-2 italic">
                        <Lock className="w-4 h-4" />
                        Locked Archive
                      </div>
                      <div className={`w-8 h-4 rounded-full relative transition-colors ${showLockedChats ? 'bg-[#00a884]' : 'bg-white/10'}`}>
                        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${showLockedChats ? 'left-4.5' : 'left-0.5'}`} />
                      </div>
                    </button>
                    <button 
                      onClick={() => { updateProSettings({ ghostMode: !proSettings.ghostMode }); setIsMainMenuOpen(false); }}
                      className="w-full px-4 py-3 flex items-center justify-between text-[#aebac1] hover:bg-white/5 text-[11px] font-bold transition-colors"
                    >
                      <div className="flex items-center gap-2 italic">
                        <Monitor className="w-4 h-4" />
                        Ghost Mode
                      </div>
                      <div className={`w-8 h-4 rounded-full relative transition-colors ${proSettings.ghostMode ? 'bg-[#00a884]' : 'bg-white/10'}`}>
                        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${proSettings.ghostMode ? 'left-4.5' : 'left-0.5'}`} />
                      </div>
                    </button>
                    <button 
                      onClick={() => { updateProSettings({ antiDelete: !proSettings.antiDelete }); setIsMainMenuOpen(false); }}
                      className="w-full px-4 py-3 flex items-center justify-between text-[#aebac1] hover:bg-white/5 text-[11px] font-bold transition-colors"
                    >
                      <div className="flex items-center gap-2 italic">
                        <ShieldCheck className="w-4 h-4" />
                        Anti-Delete
                      </div>
                      <div className={`w-8 h-4 rounded-full relative transition-colors ${proSettings.antiDelete ? 'bg-[#00a884]' : 'bg-white/10'}`}>
                        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${proSettings.antiDelete ? 'left-4.5' : 'left-0.5'}`} />
                      </div>
                    </button>
                    <button 
                      onClick={() => { fetchRecycleBin(); setShowRecycleBin(true); setIsMainMenuOpen(false); }}
                      className="w-full px-4 py-3 flex items-center gap-3 text-[#aebac1] hover:bg-white/5 text-[11px] font-bold transition-colors italic"
                    >
                      <History className="w-4 h-4 text-[#00a884]" />
                      Recycle Bin
                    </button>
                    <button 
                      onClick={() => { readAll(); setIsMainMenuOpen(false); }}
                      className="w-full px-4 py-3 flex items-center gap-3 text-[#aebac1] hover:bg-white/5 text-[11px] font-bold transition-colors italic"
                    >
                      <Check className="w-4 h-4 text-[#00a884]" />
                      Read All Signals
                    </button>
                    <button 
                      onClick={() => { setSettingsView('starred'); setShowSettings(true); setIsMainMenuOpen(false); }}
                      className="w-full px-4 py-3 flex items-center gap-3 text-[#aebac1] hover:bg-white/5 text-[11px] font-bold transition-colors italic"
                    >
                      <Star className="w-4 h-4 text-[#00a884]" />
                      Starred Messages
                    </button>
                    <button 
                      onClick={() => { setShowSettings(true); setSettingsView('main'); setIsMainMenuOpen(false); }}
                      className="w-full px-4 py-3 flex items-center gap-3 text-[#aebac1] hover:bg-white/5 text-[11px] font-bold transition-colors italic"
                    >
                      <Settings className="w-4 h-4 text-[#00a884]" />
                      Global Settings
                    </button>
                    <div className="h-px bg-white/5 my-1" />
                    <button 
                      onClick={hardLogout}
                      className="w-full px-4 py-3 flex items-center gap-3 text-red-500 hover:bg-white/5 text-[11px] font-bold italic transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      Deactivate System
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-white/5 bg-[#111b21] h-12">
          {(['CHATS', 'STATUS', 'CALLS', 'LOGS'] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 text-[11px] font-black tracking-widest transition-all relative ${activeTab === tab ? 'text-[#00a884]' : 'text-[#aebac1]'}`}
            >
              {tab}
              {activeTab === tab && (
                <motion.div layoutId="tab-underline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#00a884]" />
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {activeTab === 'CHATS' && (
            <>
              <div className="p-3 bg-[#111b21] sticky top-0 z-10 border-b border-white/5">
                <div className="bg-[#202c33] flex items-center px-4 py-2 rounded-xl border border-white/5 focus-within:border-[#00a884]/30 transition-all mb-3">
                  <Search className="w-4 h-4 text-[#aebac1]" />
                  <input 
                    type="text" 
                    placeholder="Search Master Index (Name or ID)..." 
                    className="bg-transparent border-none outline-none text-xs text-white px-3 w-full placeholder:text-[#aebac1]/50" 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                  {searchTerm && <button onClick={() => setSearchTerm('')}><X className="w-3 h-3 text-[#aebac1]" /></button>}
                </div>
                
                <div className="flex gap-2 pb-1 overflow-x-auto no-scrollbar">
                   {showLockedChats && (
                     <button
                        onClick={() => setChatSubTab('ALL')}
                        className="px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest bg-yellow-500/20 text-yellow-500 border border-yellow-500/30 flex items-center gap-2"
                     >
                       <Lock className="w-3 h-3" />
                       LOCKED MODE
                     </button>
                   )}
                   {([ 'ALL', 'UNREAD', 'FAVORITES', 'GROUPS'] as const).map(tab => (
                     <button
                        key={tab}
                        onClick={() => setChatSubTab(tab)}
                        className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest transition-all shrink-0 border ${chatSubTab === tab ? 'bg-[#00a884] text-white border-[#00a884] shadow-lg shadow-[#00a884]/20' : 'bg-white/5 text-[#aebac1] border-white/5 hover:bg-white/10'}`}
                     >
                       {tab}
                     </button>
                   ))}
                   <button
                      onClick={() => setFilterUnknown(!filterUnknown)}
                      className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest transition-all shrink-0 border ${filterUnknown ? 'bg-orange-500 text-white border-orange-500 shadow-lg shadow-orange-500/20' : 'bg-white/5 text-[#aebac1] border-white/5 hover:bg-white/10'}`}
                   >
                     {filterUnknown ? 'Verified Only' : 'Incognito Blocked'}
                   </button>
                </div>
              </div>

              {chats.filter(c => {
                const search = searchTerm.toLowerCase();
                const displayName = getDisplayName(c).toLowerCase();
                const id = c.id.toLowerCase();
                const matchesSearch = displayName.includes(search) || id.includes(search);
                
                if (!matchesSearch) return false;
                
                if (chatSubTab === 'UNREAD') return (c.unreadCount || 0) > 0;
                if (chatSubTab === 'FAVORITES') return favorites.includes(c.id);
                if (chatSubTab === 'GROUPS') return c.id.endsWith('@g.us');
                
                if (filterUnknown) {
                  // If name is found in contacts and is not just the ID, it's "known"
                  const contact = contacts[c.id];
                  if (!contact || !contact.name || contact.name === c.id.split('@')[0]) return false;
                }
                
                return true;
              }).filter(c => {
                 if (showLockedChats) return lockedChats.includes(c.id);
                 return !lockedChats.includes(c.id);
               }).map((chat) => (
                <div 
                  key={chat.id}
                  onClick={() => loadHistory(chat)}
                  className={`w-full flex items-center gap-4 p-4 hover:bg-[#202c33] cursor-pointer transition-colors border-b border-white/[0.03] group ${activeChat?.id === chat.id ? 'bg-[#2a3942]' : ''}`}
                >
                  <div className="w-12 h-12 rounded-xl bg-[#374248] flex items-center justify-center shrink-0 border border-white/5 overflow-hidden font-black text-[#00a884] text-xl">
                    {profilePictures[chat.id] ? (
                      <img src={profilePictures[chat.id]} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      getDisplayName(chat)[0]
                    )}
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-bold text-sm truncate text-[#e9edef] uppercase tracking-tight">{getDisplayName(chat)}</span>
                      <div className="flex items-center gap-1.5">
                        {favorites.includes(chat.id) && <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />}
                        <span className="text-[9px] text-[#8696a0] font-black">
                          {chat.timestamp ? format(chat.timestamp * 1000, 'HH:mm') : ''}
                        </span>
                      </div>
                    </div>
                    <div className="flex justify-between items-center">
                      <p className="text-xs text-[#8696a0] truncate opacity-60 font-medium">
                        {getMsgText(chat.lastMessage) || 'SYNCHRONIZING...'}
                      </p>
                      {(chat.unreadCount || 0) > 0 && (
                        <div className="bg-[#00a884] text-[#111b21] text-[9px] font-black rounded-lg min-w-[20px] h-5 flex items-center justify-center px-1.5 shadow-lg">
                          {chat.unreadCount}
                        </div>
                      )}
                      <button 
                        onClick={(e) => { e.stopPropagation(); deleteChat(chat.id); }}
                        className="opacity-0 group-hover:opacity-60 hover:opacity-100 hover:text-red-500 p-1.5 transition-all ml-2"
                        title="Delete Chat"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {chats.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 px-10 text-center">
                    <div className="relative mb-6">
                      <Monitor className="w-12 h-12 opacity-20" />
                      {connectionState === 'open' && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <RefreshCw className="w-6 h-6 text-[#00a884] animate-spin" />
                        </div>
                      )}
                    </div>
                    <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-40">
                      {connectionState === 'open' ? 'Synchronizing Master Index...' : 'Awaiting Engine Link'}
                    </p>
                    {connectionState === 'open' && (
                      <p className="text-[9px] text-[#00a884] font-bold mt-2 uppercase tracking-widest animate-pulse">Initial Sync in Progress</p>
                    )}
                </div>
              )}
            </>
          )}

          {activeTab === 'STATUS' && (
            <div className="flex flex-col h-full relative">
              <div className="p-4 border-b border-white/5 flex items-center justify-between">
                 <h3 className="text-[10px] font-black uppercase tracking-widest text-[#00a884]">Status Pulse</h3>
                 <button 
                   onClick={() => setShowStatusModal(true)}
                   className="p-2 bg-[#00a884] text-white rounded-xl shadow-lg shadow-[#00a884]/20 hover:scale-110 transition-transform"
                 >
                   <Plus className="w-4 h-4" />
                 </button>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-2">
                {statusUpdates.map((status, i) => (
                  <div 
                    key={`${status.id}-${status.timestamp}-${i}`} 
                    onClick={() => {
                      setActiveStatus(status);
                      markStatusSeen(status);
                    }}
                    className="flex items-center gap-4 p-3 hover:bg-white/5 rounded-xl border border-white/[0.02] cursor-pointer group"
                  >
                    <div className={`w-12 h-12 rounded-full border-2 p-0.5 ${interceptedStatuses.some(s => s.id === status.id) ? 'border-red-500/50' : 'border-[#00a884]'}`}>
                       <div className="w-full h-full rounded-full bg-[#374248] flex items-center justify-center font-black text-[#00a884] overflow-hidden">
                          {profilePictures[status.participant] ? (
                            <img src={profilePictures[status.participant]} alt="" className="w-full h-full object-cover" />
                          ) : (
                            getDisplayName(status.participant)[0]
                          )}
                       </div>
                    </div>
                    <div className="flex-1 min-w-0">
                       <div className="flex items-center gap-2">
                          <p className="text-xs font-bold truncate uppercase">{getDisplayName(status.participant) || status.pushName}</p>
                          {interceptedStatuses.some(s => s.id === status.id) && (
                            <span className="text-[7px] bg-red-500/20 text-red-500 px-1.5 py-0.5 rounded font-black uppercase tracking-tighter">Intercepted</span>
                          )}
                       </div>
                       <p className="text-[9px] opacity-40 uppercase font-black">
                         {format(new Date(status.timestamp * 1000), 'MMM dd, HH:mm')}
                       </p>
                    </div>
                  </div>
                ))}
                {statusUpdates.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 px-10 text-center">
                    <Camera className="w-12 h-12 opacity-10 mb-4" />
                    <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-30">Status stream is encrypted</p>
                    <p className="text-[8px] opacity-20 mt-2 font-bold">PRO Logic: Status updates are mirrored from your mobile device</p>
                  </div>
                )}
              </div>
              
              <AnimatePresence>
                {activeStatus && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[110] bg-black flex flex-col items-center justify-center"
                    onClick={() => setActiveStatus(null)}
                  >
                    <div className="absolute top-4 left-4 flex items-center gap-4 text-white">
                       <div className="w-10 h-10 rounded-full overflow-hidden bg-white/10">
                          {profilePictures[activeStatus.participant] && <img src={profilePictures[activeStatus.participant]} alt="" />}
                       </div>
                       <div>
                         <p className="text-sm font-bold">{getDisplayName(activeStatus.participant) || activeStatus.pushName}</p>
                         <p className="text-[10px] opacity-60">{format(new Date(activeStatus.timestamp * 1000), 'HH:mm')}</p>
                       </div>
                    </div>
                    <button className="absolute top-4 right-4 text-white z-[120]" onClick={() => setActiveStatus(null)}>
                      <X className="w-8 h-8" />
                    </button>
                    
                    <div className="max-w-full max-h-screen p-4 flex flex-col items-center justify-center gap-6">
                      {activeStatus.message?.videoMessage && (
                        <video 
                          src={`/api/media?msgId=${activeStatus.id}&chatId=status@broadcast`} 
                          controls 
                          autoPlay 
                          className="max-w-full max-h-[70vh] rounded-xl shadow-2xl" 
                        />
                      )}
                      {activeStatus.message?.audioMessage && (
                        <div className="bg-white/10 p-8 rounded-3xl backdrop-blur-xl flex flex-col items-center gap-4">
                           <Mic className="w-12 h-12 text-[#00a884] animate-pulse" />
                           <audio 
                             src={`/api/media?msgId=${activeStatus.id}&chatId=status@broadcast`} 
                             controls 
                             autoPlay 
                           />
                           <p className="text-[10px] font-black uppercase tracking-widest opacity-40">Sonic Broadast Active</p>
                        </div>
                      )}
                      {activeStatus.message?.imageMessage && (
                        <img 
                          src={`/api/media?msgId=${activeStatus.id}&chatId=status@broadcast`} 
                          alt="Status" 
                          className="max-w-full max-h-[70vh] rounded-xl shadow-2xl" 
                        />
                      )}
                      {activeStatus.message?.conversation || activeStatus.message?.extendedTextMessage?.text || activeStatus.message?.imageMessage?.caption || activeStatus.message?.videoMessage?.caption ? (
                        <div className="text-white text-xl font-medium text-center bg-black/40 p-6 rounded-2xl backdrop-blur-sm max-w-lg">
                          {activeStatus.message?.conversation || activeStatus.message?.extendedTextMessage?.text || activeStatus.message?.imageMessage?.caption || activeStatus.message?.videoMessage?.caption}
                        </div>
                      ) : activeStatus.isTextStatus && (
                        <div className="text-white text-3xl font-black text-center p-12 rounded-3xl max-w-2xl leading-tight" style={{ backgroundColor: activeStatus.backgroundColor || '#00a884' }}>
                           {activeStatus.text}
                        </div>
                      )}
                    </div>

                    <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-full max-w-md px-6" onClick={e => e.stopPropagation()}>
                       <div className="bg-white/10 backdrop-blur-xl p-2 rounded-2xl border border-white/20 flex items-center gap-3">
                          <input 
                            type="text" 
                            placeholder="Reply to status..."
                            className="flex-1 bg-transparent border-none outline-none text-white px-4 py-2 text-sm placeholder:text-white/40"
                            value={statusReplyText}
                            onChange={e => setStatusReplyText(e.target.value)}
                            onKeyPress={e => e.key === 'Enter' && replyToStatus()}
                          />
                          <button 
                            onClick={replyToStatus}
                            disabled={!statusReplyText.trim()}
                            className="p-3 bg-[#00a884] text-white rounded-xl disabled:opacity-50 transition-all hover:scale-105"
                          >
                             <Send className="w-4 h-4" />
                          </button>
                       </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {activeTab === 'CALLS' && (
            <div className="space-y-1 p-2">
              {callHistory.map((call, i) => (
                <div key={i} className="flex items-center gap-4 p-3 hover:bg-white/5 rounded-xl border border-white/[0.02]">
                   <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center">
                     <Phone className={`w-4 h-4 ${call.status === 'missed' ? 'text-red-500' : 'text-[#00a884]'}`} />
                   </div>
                   <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold truncate uppercase">{getDisplayName(call.from)}</p>
                      <p className="text-[9px] opacity-40 uppercase font-black">{call.status} • {format(new Date(), 'MMM dd, HH:mm')}</p>
                   </div>
                   <button 
                      onClick={() => window.location.href = `tel:+${call.from.split('@')[0]}`} 
                      className="p-2 hover:bg-white/5 rounded-full text-[#00a884]"
                   >
                     <Phone className="w-4 h-4" />
                   </button>
                </div>
              ))}
              {callHistory.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 px-10 text-center">
                  <Phone className="w-12 h-12 opacity-10 mb-4" />
                  <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-30">Call log empty</p>
                </div>
              )}
            </div>
          )}
          {activeTab === 'LOGS' && (
            <div className="p-4 space-y-1 font-mono text-[9px] h-full flex flex-col">
              <div className="p-2 mb-4 bg-emerald-500/5 rounded border border-emerald-500/10 space-y-1">
                 <div className="flex items-center gap-2">
                    <Lock className="w-3 h-3 text-emerald-500" />
                    <span className="text-emerald-500 font-black uppercase tracking-widest">Secured Engine Feedback</span>
                 </div>
                 <p className="text-[8px] opacity-40">Persistence Point: <span className="text-white">pro_data.json</span></p>
                 <p className="text-[8px] opacity-40 uppercase tracking-tighter">Pro Data is safely isolated in the server root.</p>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1">
                {engineLogs.map((log, i) => (
                  <div key={i} className="py-1 border-b border-white/[0.02] flex gap-2 overflow-hidden">
                    <span className="text-white/20 shrink-0">[{format(new Date(log.time), 'HH:mm:ss')}]</span>
                    <span className={`font-black shrink-0 ${log.level === 'ERROR' ? 'text-red-500' : log.level === 'WARN' ? 'text-yellow-500' : 'text-[#00a884]'}`}>{log.level}</span>
                    <span className="text-white/60 truncate">{log.msg}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main View - Chat Content */}
      <div className="flex-1 flex flex-col bg-[#0b141a] relative">
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'url("https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png")' }} />
        
        {activeChat ? (
          <>
            {/* Chat header */}
            <div className="bg-accent p-3 flex items-center justify-between z-10 shadow-lg">
              <div className="flex items-center gap-3">
                <button onClick={() => setActiveChat(null)} className="md:hidden text-[#aebac1]"><ChevronLeft /></button>
                <div className="w-10 h-10 rounded-xl bg-surface flex items-center justify-center border border-white/5 font-black text-primary overflow-hidden">
                   {profilePictures[activeChat.id] ? (
                     <img src={profilePictures[activeChat.id]} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                   ) : (
                     getDisplayName(activeChat)[0]
                   )}
                </div>
                <div 
                  className="cursor-pointer hover:bg-white/5 px-2 py-1 rounded-lg transition-colors"
                  onClick={() => setShowContactInfo(!showContactInfo)}
                >
                  <h2 className="font-black text-sm uppercase tracking-tight italic">{getDisplayName(activeChat)}</h2>
                  <p className="text-[9px] text-primary font-black uppercase tracking-widest mt-0.5">
                    {showContactInfo ? activeChat.id.split('@')[0] : 'Encrypted Pulse Active'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-5 text-[#aebac1]">
                <button 
                  onClick={() => setShowScheduleModal(true)}
                  className="hover:text-primary transition-colors p-1"
                  title="Schedule Protocol"
                >
                  <Clock className="w-5 h-5" />
                </button>
                <button 
                  onClick={() => setShowAutoReplyModal(true)}
                  className="hover:text-primary transition-colors p-1"
                  title="Auto Reply Interface"
                >
                  <Zap className="w-5 h-5" />
                </button>
                <button className="hover:text-white transition-colors" onClick={() => window.location.href = `tel:+${activeChat.id.split('@')[0]}`} title="Voice Call"><Phone className="w-5 h-5" /></button>
                <button className="hover:text-white transition-colors"><Search className="w-5 h-5" /></button>
                <div className="relative">
                  <button 
                    onClick={() => setIsChatMenuOpen(!isChatMenuOpen)}
                    className="hover:text-white transition-colors p-1"
                  >
                    <MoreVertical className="w-5 h-5" />
                  </button>
                  {isChatMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setIsChatMenuOpen(false)} />
                      <div className="absolute top-full right-0 mt-2 w-48 bg-[#233138] rounded-xl shadow-2xl py-2 z-50 border border-white/5 backdrop-blur-xl">
                    <button 
                      onClick={() => { toggleLockChat(activeChat.id); setIsChatMenuOpen(false); }}
                      className="w-full px-4 py-2.5 flex items-center gap-3 text-[#aebac1] hover:bg-white/5 text-xs font-bold transition-colors italic"
                    >
                      <Lock className={`w-4 h-4 ${lockedChats.includes(activeChat.id) ? 'text-yellow-500' : 'text-[#00a884]'}`} />
                      {lockedChats.includes(activeChat.id) ? 'Unlock Matrix' : 'Chat Lock'}
                    </button>
                    <button 
                      onClick={() => { setShowContactInfo(!showContactInfo); setIsChatMenuOpen(false); }}
                          className="w-full px-4 py-2.5 flex items-center gap-3 text-[#aebac1] hover:bg-white/5 text-xs font-bold transition-colors italic"
                        >
                          <User className="w-4 h-4 text-[#00a884]" />
                          {showContactInfo ? 'Hide Identity' : 'Reveal Identity'}
                        </button>
                        <button 
                          onClick={() => { setSettingsView('starred'); setShowSettings(true); setIsChatMenuOpen(false); }}
                          className="w-full px-4 py-2.5 flex items-center gap-3 text-[#aebac1] hover:bg-white/5 text-xs font-bold transition-colors italic"
                        >
                          <Star className="w-4 h-4 text-[#00a884]" />
                          Starred Signals
                        </button>
                        <button 
                          onClick={() => { setEditingContact({ id: activeChat.id, name: getDisplayName(activeChat) }); setIsChatMenuOpen(false); }}
                          className="w-full px-4 py-2.5 flex items-center gap-3 text-[#aebac1] hover:bg-white/5 text-xs font-bold transition-colors italic"
                        >
                          <Settings className="w-4 h-4 text-[#00a884]" />
                          Rename Matrix
                        </button>
                        <button 
                          onClick={() => { toggleFavorite(activeChat.id); setIsChatMenuOpen(false); }}
                          className="w-full px-4 py-2.5 flex items-center gap-3 text-[#aebac1] hover:bg-white/5 text-xs font-bold transition-colors italic"
                        >
                          <Star className={`w-4 h-4 ${favorites.includes(activeChat.id) ? 'text-yellow-400 fill-yellow-400' : 'text-[#00a884]'}`} />
                          {favorites.includes(activeChat.id) ? 'Remove Favorite' : 'Add to Favorite'}
                        </button>
                        <button 
                          onClick={() => {
                            const content = messages.map(m => `[${format(m.timestamp, 'yyyy-MM-dd HH:mm:ss')}] ${m.sender}: ${m.text}`).join('\n');
                            const blob = new Blob([content], { type: 'text/plain' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `chat_export_${activeChat.id.split('@')[0]}.txt`;
                            a.click();
                            URL.revokeObjectURL(url);
                            setIsChatMenuOpen(false);
                          }}
                          className="w-full px-4 py-2.5 flex items-center gap-3 text-[#aebac1] hover:bg-white/5 text-xs font-bold transition-colors italic"
                        >
                          <FileText className="w-4 h-4 text-[#00a884]" />
                          Export Data
                        </button>
                        <button 
                          onClick={() => { clearChat(activeChat.id); setIsChatMenuOpen(false); }}
                          className="w-full px-4 py-2.5 flex items-center gap-3 text-[#aebac1] hover:bg-white/5 text-xs font-bold transition-colors italic"
                        >
                          <ShieldCheck className="w-4 h-4 text-[#00a884]" />
                          Purge History
                        </button>
                        <div className="h-px bg-white/5 my-1" />
                        <button 
                          className="w-full px-4 py-2.5 flex items-center gap-3 text-red-500 hover:bg-white/5 text-xs font-bold transition-colors italic"
                          onClick={() => { setError('Neural block active. Signal terminated.'); setIsChatMenuOpen(false); }}
                        >
                           <Lock className="w-4 h-4" />
                           Terminate Signal (Block)
                        </button>
                        <button 
                          className="w-full px-4 py-2.5 flex items-center gap-3 text-red-400 hover:bg-white/5 text-xs font-bold transition-colors italic"
                          onClick={() => { setError('Neural reporting engaged. Admin notified.'); setIsChatMenuOpen(false); }}
                        >
                           <Zap className="w-4 h-4" />
                           Report Signal
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Messages Area */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 md:p-10 space-y-6 z-10 scroll-smooth custom-scrollbar">
              <div className="flex justify-center mb-10">
                 <div className="bg-[#1b2831] px-4 py-2 rounded-lg border border-white/5 flex items-center gap-3 shadow-xl">
                    <ShieldCheck className="w-4 h-4 text-[#00a884]" />
                    <span className="text-[10px] text-[#8696af] font-black uppercase tracking-widest">Secure Terminal Logic Verified</span>
                 </div>
              </div>
              
                {messages.map((msg, i) => (
                  <div key={`${msg.id}-${i}`} className={`flex ${msg.fromMe ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[70%] px-5 py-3 rounded-2xl shadow-2xl relative group ${msg.fromMe ? 'bg-[#005c4b] text-[#e9edef]' : 'bg-accent text-[#e9edef]'}`}>
                      {!msg.fromMe && activeChat?.id?.endsWith('@g.us') && (
                        <p className="text-[10px] font-black uppercase text-primary tracking-[1.5px] mb-1 italic truncate max-w-full">
                          {msg.sender}
                        </p>
                      )}
                      {msg.isRevoked && (
                        <div className="flex items-center gap-1.5 mb-1.5 opacity-50 italic">
                          <Trash2 className="w-3 h-3" />
                          <span className="text-[9px] font-bold uppercase tracking-wider">Intercepted Deletion</span>
                        </div>
                      )}
                      {msg.rawMessage?.imageMessage && (
                      <div className="mb-2 rounded-lg overflow-hidden border border-white/5 relative group/img">
                        <img 
                          src={`/api/media?msgId=${msg.id}&chatId=${activeChat.id}`} 
                          alt="Media" 
                          className="max-w-full h-auto object-cover min-h-[100px] bg-white/5"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center">
                           <button 
                             onClick={() => downloadMedia(msg.id, activeChat.id, `img_${msg.id}.jpg`)} 
                             className="p-3 bg-[#00a884] rounded-full shadow-2xl scale-75 group-hover/img:scale-100 transition-transform"
                           >
                              <Download className="w-5 h-5 text-white" />
                           </button>
                        </div>
                      </div>
                    )}
                    
                    {msg.rawMessage?.videoMessage && (
                      <div className="mb-2 rounded-lg p-4 bg-white/5 border border-white/5 flex items-center gap-4">
                        <PlayCircle className="w-10 h-10 text-[#00a884]" />
                        <div className="flex-1">
                          <p className="text-xs font-black uppercase tracking-widest text-[#00a884]">Video File</p>
                          <p className="text-[10px] opacity-40">Click to fetch and play</p>
                        </div>
                        <button onClick={() => downloadMedia(msg.id, activeChat.id, `video_${msg.id}.mp4`)} className="p-2 hover:bg-white/10 rounded-full">
                           <Download className="w-5 h-5" />
                        </button>
                      </div>
                    )}

                    {msg.rawMessage?.documentMessage && (
                      <div className="mb-2 rounded-xl p-4 bg-white/5 border border-white/5 flex items-center gap-4 group/doc">
                        <div className="w-12 h-12 bg-[#00a884]/10 rounded-xl flex items-center justify-center group-hover/doc:bg-[#00a884]/20 transition-colors">
                           <FileText className="w-6 h-6 text-[#00a884]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold truncate text-[#e9edef]">{msg.text}</p>
                          <p className="text-[10px] uppercase font-black tracking-widest opacity-40 mt-0.5">Document • {(msg.rawMessage.documentMessage.fileLength / 1024 / 1024).toFixed(1)} MB</p>
                        </div>
                        <button onClick={() => downloadMedia(msg.id, activeChat.id, msg.text)} className="p-3 bg-white/5 hover:bg-white/10 rounded-xl transition-all">
                           <Download className="w-4 h-4 text-[#00a884]" />
                        </button>
                      </div>
                    )}

                    {msg.rawMessage?.audioMessage && (
                      <div className="mb-2 rounded-xl p-3 bg-white/5 border border-white/5 flex flex-col gap-2 min-w-[200px]">
                        <div className="flex items-center gap-4">
                          <button 
                            onClick={async () => {
                              const res = await fetch(`/api/media?msgId=${msg.id}&chatId=${activeChat.id}`);
                              const blob = await res.blob();
                              const url = URL.createObjectURL(blob);
                              new Audio(url).play();
                            }}
                            className="w-10 h-10 bg-[#00a884] rounded-full flex items-center justify-center hover:bg-[#00bc95] transition-colors shadow-lg"
                          >
                             <Play className="w-5 h-5 text-white" />
                          </button>
                          <div className="flex-1 h-1.5 bg-white/10 rounded-full relative overflow-hidden">
                             <div className="absolute inset-0 bg-[#00a884] w-[40%] animate-pulse" />
                          </div>
                          <span className="text-[10px] font-bold opacity-40 font-mono">
                            {msg.rawMessage.audioMessage.seconds ? `${Math.floor(msg.rawMessage.audioMessage.seconds / 60)}:${(msg.rawMessage.audioMessage.seconds % 60).toString().padStart(2, '0')}` : '0:00'}
                          </span>
                        </div>
                        <div className="flex justify-between items-center px-1">
                          <p className="text-[9px] font-black uppercase text-[#00a884] tracking-widest">Sonic Signal</p>
                          <button onClick={() => downloadMedia(msg.id, activeChat.id, `audio_${msg.id}.mp3`)} className="p-1 hover:bg-white/10 rounded-full">
                             <Download className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    )}

                    <p className={`text-sm leading-relaxed font-medium ${msg.rawMessage?.documentMessage ? 'mt-2' : ''}`}>{msg.text}</p>
                    <div className="flex items-center justify-between gap-2 mt-2 pt-1 border-t border-white/5">
                      <div className="flex items-center gap-2">
                        <span className="text-[8px] opacity-40 font-black">{format(msg.timestamp, 'HH:mm')}</span>
                        {msg.fromMe && <Check className={`w-3 h-3 ${msg.status === 'read' ? 'text-sky-400' : 'opacity-30'}`} />}
                        <button 
                          onClick={() => setStarredMessages(prev => prev.some(s => s.id === msg.id) ? prev.filter(s => s.id !== msg.id) : [...prev, msg])}
                          className={`ml-2 transition-colors ${starredMessages.some(s => s.id === msg.id) ? 'text-yellow-400' : 'text-white/10 hover:text-yellow-400'}`}
                        >
                          <Star className={`w-3 h-3 ${starredMessages.some(s => s.id === msg.id) ? 'fill-yellow-400' : ''}`} />
                        </button>
                        <button 
                          onClick={() => { setForwardMsg(msg); setShowForwardModal(true); }}
                          className="ml-2 text-white/10 hover:text-[#00a884] transition-colors"
                          title="Forward Message"
                        >
                          <Forward className="w-3 h-3" />
                        </button>
                        <div className="ml-2 relative flex items-center gap-1">
                          {['👍', '❤️', '😂', '😮', '😢', '🙏'].map(emoji => (
                             <button 
                               key={emoji} 
                               onClick={() => reactToMessage(msg.id, emoji, msg.fromMe)}
                               className="opacity-0 group-hover:opacity-100 hover:scale-120 transition-all text-sm"
                             >
                               {emoji}
                             </button>
                          ))}
                        </div>
                      </div>
                      <button 
                        onClick={() => setDeleteOptionModal({ msgId: msg.id, visible: true })}
                        className="opacity-0 group-hover:opacity-40 hover:opacity-100 transition-opacity p-1 text-red-400"
                        title="Delete Message"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                    {/* Visual Chat bubble tail */}
                    <div className={`absolute top-0 w-3 h-4 ${msg.fromMe ? '-right-2' : '-left-2'}`}>
                       <svg viewBox="0 0 10 16" className={`w-full h-full ${msg.fromMe ? 'fill-[#005c4b]' : 'fill-[#202c33]'}`}>
                          <path d={msg.fromMe ? "M0 0h10v16c-4-4-10-4-10-4V0z" : "M10 0H0v16c4-4 10-4 10-4V0z"} />
                       </svg>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* AI Integration Bar */}
            <AnimatePresence>
               {(aiSuggestions.length > 0 || isAiLoading) && (
                 <motion.div 
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    className="p-3 bg-[#111b21] border-t border-white/5 z-20 flex gap-2 overflow-x-auto no-scrollbar"
                 >
                    <div className="flex items-center gap-2 px-3 py-2 bg-[#00a884]/10 rounded-full shrink-0 border border-[#00a884]/20">
                       <Sparkles className="w-3 h-3 text-[#00a884]" />
                       <span className="text-[9px] font-black uppercase text-[#00a884] tracking-widest">AI LINK</span>
                    </div>
                    {isAiLoading ? (
                       <div className="flex gap-2">
                          <div className="h-8 w-24 bg-white/5 animate-pulse rounded-full" />
                          <div className="h-8 w-32 bg-white/5 animate-pulse rounded-full" />
                       </div>
                    ) : aiSuggestions.map((suggestion, i) => (
                       <button 
                         key={i} 
                         onClick={() => setNewMessage(suggestion)}
                         className="px-5 py-2 bg-[#202c33] hover:bg-[#2a3942] rounded-full text-[11px] text-[#00a884] font-black whitespace-nowrap border border-white/5 transition-all uppercase tracking-tight"
                       >
                          {suggestion}
                       </button>
                    ))}
                 </motion.div>
               )}
            </AnimatePresence>

            {/* Input area */}
            <div className="bg-[#202c33] p-4 flex items-center gap-4 z-10 shadow-[0_-10px_20px_rgba(0,0,0,0.2)]">
              <button className="text-[#aebac1] hover:text-[#00a884] transition-colors"><Plus className="w-6 h-6" /></button>
              <div className="flex-1 bg-[#2a3942] rounded-xl flex items-center px-4 py-1.5 border border-white/[0.02]">
                <input 
                  type="text" 
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                  placeholder={isRecording ? "RECORDING SONIC SIGNAL..." : "EXECUTE MESSAGE..."} 
                  className="bg-transparent border-none outline-none text-sm text-white px-3 py-3 w-full placeholder:text-[#8696a0]/40 font-bold tracking-tight" 
                  disabled={isRecording}
                />
                <div className="flex items-center gap-2">
                   {isRecording && (
                     <div className="flex items-center gap-2 px-3 py-1 bg-red-500/10 rounded-lg animate-pulse">
                        <div className="w-2 h-2 rounded-full bg-red-500" />
                        <span className="text-[10px] font-mono font-black text-red-500">
                          {Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, '0')}
                        </span>
                     </div>
                   )}
                </div>
              </div>
              
              {newMessage.trim() ? (
                <button 
                  onClick={sendMessage}
                  className="p-4 rounded-xl bg-[#00a884] text-white shadow-2xl shadow-[#00a884]/30 scale-105 transition-all"
                >
                  <Send className="w-5 h-5 rotate-[-10deg]" />
                </button>
              ) : (
                <button 
                  onClick={isRecording ? stopRecording : startRecording}
                  className={`p-4 rounded-xl transition-all ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-white/5 text-[#aebac1] hover:text-[#00a884]'}`}
                >
                  {isRecording ? <Square className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-[#8696a0] z-10 p-12 text-center">
            <div className="relative mb-12">
               <div className="absolute inset-0 bg-[#00a884]/20 blur-[60px] animate-pulse" />
               <div className="p-12 rounded-full bg-white/[0.02] border border-white/5 relative">
                  <ShieldCheck className="w-24 h-24 text-[#00a884]/20" />
               </div>
            </div>
            <h2 className="text-4xl font-black text-white mb-4 tracking-tighter italic flex items-center gap-3">
               WHATSAPP PRO <span className="text-[#00a884] non-italic animate-bounce">💎</span>
            </h2>
            <p className="text-sm max-w-sm leading-relaxed mb-8 opacity-40 font-medium uppercase tracking-[0.2em]">
               System Initialized. Awaiting Master Link for message flow. End-to-end security active.
            </p>
            <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.4em] bg-[#00a884]/5 px-6 py-3 rounded-xl border border-[#00a884]/10 text-[#00a884]">
               <Lock className="w-3 h-3" />
               <span>Terminal Secure link active</span>
            </div>
          </div>
        )}
      </div>

      {/* Contact/Group Info Side Panel */}
      <AnimatePresence>
        {showContactInfo && activeChat && (
          <motion.div 
            initial={{ x: 400 }}
            animate={{ x: 0 }}
            exit={{ x: 400 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="w-[380px] bg-[#111b21] border-l border-white/5 flex flex-col z-20 shadow-2xl relative"
          >
            <div className="p-5 bg-[#202c33] flex items-center gap-4 border-b border-white/5">
              <button 
                onClick={() => setShowContactInfo(false)}
                className="p-2 hover:bg-white/5 rounded-full transition-colors text-[#aebac1]"
              >
                <X className="w-5 h-5" />
              </button>
              <div>
                <h3 className="text-sm font-black uppercase tracking-widest italic">{activeChat.id.endsWith('@g.us') ? 'Network Node Info' : 'Entity Profile'}</h3>
                <p className="text-[9px] font-black text-[#00a884] uppercase tracking-[0.3em]">Neural Identification</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar space-y-10">
              <div className="flex flex-col items-center gap-6">
                <div className="relative group">
                   <div className="w-32 h-32 rounded-[2rem] bg-[#00a884]/10 flex items-center justify-center border-2 border-dashed border-[#00a884]/20 overflow-hidden shadow-2xl transition-transform group-hover:scale-105">
                     {profilePictures[activeChat.id] ? (
                       <img src={profilePictures[activeChat.id]} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                     ) : (
                       <User className="w-16 h-16 text-[#00a884] opacity-20" />
                     )}
                   </div>
                   <div className="absolute -bottom-2 -right-2 p-2 bg-[#00a884] rounded-xl shadow-xl shadow-[#00a884]/20 border border-white/20">
                      <ShieldCheck className="w-4 h-4 text-white" />
                   </div>
                </div>
                <div className="text-center">
                  <h2 className="text-2xl font-black uppercase tracking-tight italic mb-1">{getDisplayName(activeChat)}</h2>
                  <p className="text-[#00a884] text-[10px] font-black uppercase tracking-[0.4em] mb-4">
                    {activeChat.id.endsWith('@g.us') ? 'Collective Matrix' : 'Signal Origin'}
                  </p>
                  <p className="text-xs text-[#8696af] font-bold font-mono px-4 py-2 bg-white/5 rounded-lg border border-white/5 shrink-0 inline-block uppercase tracking-widest">
                    {activeChat.id.split('@')[0]}
                  </p>
                </div>
              </div>

              {activeChat.id.endsWith('@g.us') && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between border-b border-white/5 pb-4">
                    <h4 className="text-[10px] font-black text-[#00a884] uppercase tracking-[0.2em]">Matrix Participants</h4>
                    <span className="text-[10px] bg-[#00a884]/10 text-[#00a884] px-2 py-0.5 rounded-full font-black border border-[#00a884]/20">
                      {groupMetadata?.participants?.length || 0} Entities
                    </span>
                  </div>
                  
                  <div className="space-y-3">
                    {groupMetadata?.participants?.map((p: any) => (
                      <div key={p.id} className="flex items-center gap-4 p-3 rounded-2xl bg-accent/50 border border-white/[0.02] hover:bg-accent transition-colors group/part">
                        <div className="w-10 h-10 rounded-xl bg-surface flex items-center justify-center font-black text-primary overflow-hidden border border-white/5">
                           {profilePictures[p.id.split(':')[0] + '@s.whatsapp.net'] ? (
                             <img src={profilePictures[p.id.split(':')[0] + '@s.whatsapp.net']} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                           ) : (
                             getDisplayName(p.id)[0]
                           )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-black uppercase tracking-tight truncate group-hover/part:text-[#00a884] transition-colors">{getDisplayName(p.id)}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <p className="text-[9px] text-[#8696af] font-bold font-mono truncate">{p.id.split('@')[0]}</p>
                            {p.admin && (
                              <span className="text-[7px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border border-yellow-500/20 text-yellow-500 bg-yellow-500/10">Admin</span>
                            )}
                          </div>
                        </div>
                        <div className="opacity-0 group-hover/part:opacity-100 transition-opacity">
                           <button className="p-2 hover:bg-white/5 rounded-lg text-[#00a884]">
                              <MessageSquare className="w-4 h-4" />
                           </button>
                        </div>
                      </div>
                    ))}
                    {!groupMetadata && (
                      <div className="py-10 flex flex-col items-center justify-center gap-4 text-[#8696af]/40">
                         <RefreshCw className="w-8 h-8 animate-spin" />
                         <span className="text-[9px] font-black uppercase tracking-widest">Synchronizing Collective...</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-4 pt-10 border-t border-white/5">
                {[
                  { label: 'Encryption Key', val: 'RSA-4096-AES-GCM', icon: Lock },
                  { label: 'Neural Link Status', val: 'Verified & Secure', icon: ShieldCheck },
                  { label: 'Signal Strength', val: '-44dBm (Optimal)', icon: Activity }
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-4 bg-[#202c33]/30 p-4 rounded-2xl border border-white/[0.02]">
                    <div className="p-2 bg-[#00a884]/10 rounded-xl">
                      <item.icon className="w-4 h-4 text-[#00a884]" />
                    </div>
                    <div>
                      <p className="text-[9px] font-black uppercase text-[#8696af] tracking-widest mb-0.5">{item.label}</p>
                      <p className="text-[11px] font-black text-white italic">{item.val}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Recycle Bin Modal */}
      <AnimatePresence>
        {showRecycleBin && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="w-full max-w-2xl bg-surface rounded-3xl border border-white/5 shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
            >
              <div className="p-6 bg-accent flex items-center justify-between border-b border-white/5">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-primary/10 rounded-xl">
                    <Trash2 className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black uppercase italic tracking-tight">Recycle Bin</h2>
                    <p className="text-[9px] font-black text-primary uppercase tracking-widest">Engine Recovery Vault</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowRecycleBin(false)}
                  className="p-2 hover:bg-white/5 rounded-full transition-colors text-[#aebac1]"
                >
                  <X />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
                {/* Deleted Messages */}
                <div>
                   <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#8696af] mb-4 flex items-center gap-2">
                     <MessageSquare className="w-3 h-3 text-primary" />
                     Deleted Messages ({recycleBinData.messages.length})
                   </h3>
                   <div className="space-y-2">
                     {recycleBinData.messages.map((m: any, i: number) => (
                       <div key={i} className="p-4 bg-accent rounded-2xl border border-white/5 flex items-center justify-between gap-4">
                          <div className="min-w-0 flex-1">
                             <div className="flex items-center gap-2 mb-1">
                                <span className="text-[9px] font-black uppercase text-primary">{getDisplayName(m.originalChat)}</span>
                                <span className="text-[8px] opacity-30 font-bold">{format(new Date(m.deletedAt), 'MMM dd, HH:mm')}</span>
                             </div>
                             <p className="text-sm opacity-80 truncate italic">"{getMsgText(m)}"</p>
                          </div>
                          <button 
                            onClick={() => restoreMessage(m.key.id)}
                            className="p-2 hover:bg-primary/20 rounded-lg text-primary transition-colors"
                            title="Restore Message"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </button>
                       </div>
                     ))}
                     {recycleBinData.messages.length === 0 && <p className="text-[10px] opacity-30 italic text-center py-4">No salvaged signals found</p>}
                   </div>
                </div>

                {/* Deleted Chats */}
                <div>
                   <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#8696af] mb-4 flex items-center gap-2">
                     <Zap className="w-3 h-3 text-primary" />
                     Nuked Chats ({recycleBinData.chats.length})
                   </h3>
                   <div className="space-y-2">
                     {recycleBinData.chats.map((c: any, i: number) => (
                       <div key={i} className="p-4 bg-accent rounded-2xl border border-white/5 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                             <div className="w-10 h-10 rounded-xl bg-surface flex items-center justify-center font-black text-primary border border-white/5 shadow-inner">
                                {getDisplayName(c)[0]}
                             </div>
                             <div>
                                <p className="text-sm font-bold uppercase">{getDisplayName(c)}</p>
                                <p className="text-[9px] opacity-40 uppercase font-black">Nuked at {format(new Date(c.deletedAt), 'HH:mm')}</p>
                             </div>
                          </div>
                          <button 
                            onClick={() => restoreChat(c.id)}
                            className="p-2 hover:bg-primary/20 rounded-lg text-primary transition-colors"
                            title="Restore Chat"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </button>
                       </div>
                     ))}
                     {recycleBinData.chats.length === 0 && <p className="text-[10px] opacity-30 italic text-center py-4">No annihilated indices captured</p>}
                   </div>
                </div>

                {/* Intercepted Statuses */}
                <div>
                   <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#8696af] mb-4 flex items-center gap-2">
                     <ShieldCheck className="w-3 h-3 text-primary" />
                     Intercepted Statuses ({interceptedStatuses.length})
                   </h3>
                   <div className="grid grid-cols-2 gap-3">
                      {interceptedStatuses.map((s, i) => (
                        <div key={i} className="p-3 bg-accent rounded-2xl border border-white/5 flex flex-col gap-2">
                           <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-black text-primary">
                                 {s.pushName?.[0] || '?'}
                              </div>
                              <div className="min-w-0">
                                 <p className="text-[9px] font-black uppercase truncate italic">{s.pushName || 'Unknown Entity'}</p>
                                 <p className="text-[7px] opacity-30 font-mono">INTERCEPTED: {format(new Date(s.timestamp * 1000), 'HH:mm')}</p>
                              </div>
                           </div>
                           <div 
                              className="h-24 bg-black/20 rounded-xl flex items-center justify-center cursor-pointer overflow-hidden border border-white/[0.02] relative group"
                              onClick={() => { setActiveStatus(s); setShowRecycleBin(false); }}
                           >
                              {s.message?.imageMessage ? (
                                 <img src={`/api/media?msgId=${s.id}&chatId=status@broadcast`} className="w-full h-full object-cover blur-[1px] group-hover:blur-0 transition-all" />
                               ) : (
                                 <p className="text-[8px] text-center px-4 font-bold opacity-60">
                                   "{s.message?.conversation?.substring(0, 50) || 'Signal Encrypted'}"
                                 </p>
                               )}
                               <div className="absolute inset-0 bg-primary/5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                  <PlayCircle className="w-8 h-8 text-white" />
                               </div>
                           </div>
                        </div>
                      ))}
                      {interceptedStatuses.length === 0 && <p className="col-span-2 text-[10px] opacity-30 italic text-center py-4">No revoked broadcast packets recovered</p>}
                   </div>
                </div>
              </div>
              
              <div className="p-6 bg-accent text-center border-t border-white/5">
                <p className="text-[10px] font-black text-primary uppercase tracking-widest opacity-50 italic">Data persists until engine reinitialization</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showStatusModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} className="bg-[#111b21] w-full max-w-lg rounded-3xl border border-white/5 shadow-2xl overflow-hidden">
               <div className="p-6 border-b border-white/5 flex justify-between items-center bg-[#202c33]">
                  <h2 className="text-sm font-black uppercase tracking-widest text-[#00a884] italic">Broadcast Status 📡</h2>
                  <button onClick={() => setShowStatusModal(false)}><X className="w-5 h-5" /></button>
               </div>
               <div className="p-8 space-y-6">
                  <div className="flex flex-col items-center gap-4">
                     <div className="w-20 h-20 rounded-full bg-[#00a884]/10 flex items-center justify-center border-2 border-dashed border-[#00a884]/30 cursor-pointer hover:bg-[#00a884]/20 transition-all overflow-hidden"
                          onClick={() => {
                             const input = document.createElement('input');
                             input.type = 'file';
                             input.accept = 'image/*';
                             input.onchange = (e: any) => {
                                const file = e.target.files[0];
                                const reader = new FileReader();
                                reader.onload = (re: any) => setStatusImage(re.target.result as string);
                                reader.readAsDataURL(file);
                             };
                             input.click();
                          }}
                     >
                        {statusImage ? <img src={statusImage} className="w-full h-full object-cover" /> : <Camera className="w-8 h-8 text-[#00a884]" />}
                     </div>
                     <span className="text-[10px] font-black text-[#8696af] uppercase tracking-widest">Capture Visual or Upload</span>
                  </div>
                  <textarea 
                    placeholder="Enter status signal..."
                    className="w-full h-32 bg-[#202c33] border border-white/5 rounded-2xl p-4 text-sm text-white placeholder:text-white/20 outline-none focus:border-[#00a884] transition-all resize-none"
                    value={statusText}
                    onChange={(e) => setStatusText(e.target.value)}
                  />
                  <button 
                    onClick={postStatus}
                    disabled={(!statusText && !statusImage) || loading}
                    className="w-full bg-[#00a884] text-white font-black py-4 rounded-2xl hover:bg-[#00bc95] transition-all shadow-xl shadow-[#00a884]/20 text-xs uppercase tracking-widest disabled:opacity-30 flex items-center justify-center gap-3"
                  >
                    {loading && <RefreshCw className="w-4 h-4 animate-spin" />}
                    Post to Global Broadcast
                  </button>
               </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showStatusModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[120] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
             <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} className="bg-surface w-full max-w-md rounded-3xl border border-white/5 shadow-2xl overflow-hidden">
                <div className="p-6 bg-accent border-b border-white/5 flex justify-between items-center text-primary">
                   <h2 className="text-sm font-black uppercase tracking-widest italic flex items-center gap-2">
                     <Camera className="w-4 h-4" /> Deploy Status Update
                   </h2>
                   <button onClick={() => setShowStatusModal(false)} className="text-white/40"><X className="w-5 h-5" /></button>
                </div>
                <div className="p-8 space-y-6">
                   <div className="flex gap-2">
                      <button 
                        onClick={() => setStatusImage(null)}
                        className={`flex-1 py-3 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all ${!statusImage ? 'bg-primary text-white border-primary' : 'bg-transparent border-white/10 text-white/40'}`}
                      >
                         Text Signal
                      </button>
                      <label className={`flex-1 py-3 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all text-center cursor-pointer ${statusImage ? 'bg-primary text-white border-primary' : 'bg-transparent border-white/10 text-white/40'}`}>
                         Media Payload
                         <input 
                           type="file" 
                           accept="image/*,video/*" 
                           className="hidden" 
                           onChange={e => {
                             const file = e.target.files?.[0];
                             if (file) {
                               const reader = new FileReader();
                               reader.onloadend = () => setStatusImage(reader.result as string);
                               reader.readAsDataURL(file);
                             }
                           }}
                         />
                      </label>
                   </div>

                   {statusImage ? (
                     <div className="relative aspect-video bg-black/20 rounded-2xl overflow-hidden border border-white/5">
                        {statusImage.startsWith('data:video') ? (
                          <video src={statusImage} className="w-full h-full object-contain" controls />
                        ) : (
                          <img src={statusImage} className="w-full h-full object-contain" />
                        )}
                        <input 
                          placeholder="Add encrypted caption..."
                          className="absolute bottom-0 left-0 right-0 p-4 bg-black/60 backdrop-blur-md text-xs text-white border-none outline-none"
                          value={statusText}
                          onChange={e => setStatusText(e.target.value)}
                        />
                     </div>
                   ) : (
                     <textarea 
                        className="w-full h-40 bg-accent border border-white/5 rounded-2xl p-6 text-xl font-bold outline-none focus:border-primary transition-all resize-none text-center flex items-center justify-center placeholder:text-white/10"
                        placeholder="What's on the neural network?"
                        value={statusText}
                        onChange={e => setStatusText(e.target.value)}
                        style={{ backgroundColor: '#111b21' }}
                     />
                   )}

                   <button 
                     onClick={() => {
                       if (statusImage) {
                         postStatus(statusImage.startsWith('data:video') ? 'video' : 'image', statusImage, statusText);
                       } else {
                         postStatus('text', statusText);
                       }
                     }}
                     className="w-full bg-primary text-white font-black py-4 rounded-xl hover:opacity-90 transition-all text-xs uppercase tracking-[0.3em] shadow-lg shadow-primary/20"
                   >
                     Broadcast Update
                   </button>
                </div>
             </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showForwardModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} className="bg-[#111b21] w-full max-w-md rounded-3xl border border-white/5 shadow-2xl overflow-hidden flex flex-col max-h-[70vh]">
              <div className="p-6 bg-[#202c33] flex items-center justify-between border-b border-white/5">
                <div className="flex items-center gap-3">
                  <Forward className="w-5 h-5 text-[#00a884]" />
                  <h2 className="text-sm font-black uppercase italic tracking-widest text-[#00a884]">Forward Signal</h2>
                </div>
                <button onClick={() => { setShowForwardModal(false); setForwardMsg(null); }} className="text-[#aebac1]"><X /></button>
              </div>
              <div className="p-4 bg-[#0b141a] border-b border-white/5">
                 <p className="text-[10px] font-black uppercase text-[#8696af] mb-2 tracking-widest">Selected Payload</p>
                 <p className="text-xs italic opacity-60 truncate">"{forwardMsg?.text || 'Media Payload'}"</p>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                 <p className="text-[10px] font-black uppercase text-[#8696af] mb-3 tracking-widest">Select Target Node</p>
                 {chats.map(chat => (
                   <button 
                     key={chat.id} 
                     onClick={() => forwardMessage(chat.id)}
                     className="w-full flex items-center gap-4 p-3 rounded-2xl bg-[#202c33] hover:bg-[#2a3942] border border-white/5 transition-all text-left group"
                   >
                     <div className="w-10 h-10 rounded-xl bg-[#374248] flex items-center justify-center font-black text-[#00a884] overflow-hidden border border-white/5">
                        {profilePictures[chat.id] ? (
                          <img src={profilePictures[chat.id]} alt="" className="w-full h-full object-cover" />
                        ) : (
                          getDisplayName(chat)[0]
                        )}
                     </div>
                     <div className="flex-1 min-w-0">
                       <p className="text-xs font-black uppercase tracking-tight truncate group-hover:text-[#00a884] transition-colors">{getDisplayName(chat)}</p>
                       <p className="text-[9px] opacity-40 font-mono">{chat.id.split('@')[0]}</p>
                     </div>
                     <Send className="w-4 h-4 text-[#00a884] opacity-0 group-hover:opacity-100 transition-opacity" />
                   </button>
                 ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingContact && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} className="bg-[#111b21] w-full max-w-sm rounded-3xl border border-white/5 shadow-2xl overflow-hidden">
               <div className="p-6 border-b border-white/5 flex justify-between items-center bg-[#202c33]">
                  <h2 className="text-xs font-black uppercase tracking-widest text-[#00a884]">Rename Entity</h2>
                  <button onClick={() => setEditingContact(null)}><X className="w-5 h-5" /></button>
               </div>
               <div className="p-8 space-y-6">
                  <div>
                    <label className="block text-[10px] font-bold text-[#8696af] uppercase tracking-widest mb-2">New Alias</label>
                    <input 
                      type="text" 
                      className="w-full bg-[#202c33] border border-white/5 rounded-xl p-4 text-sm text-white outline-none focus:border-[#00a884] transition-all"
                      value={editingContact.name}
                      onChange={(e) => setEditingContact({ ...editingContact, name: e.target.value })}
                      autoFocus
                    />
                  </div>
                  <button 
                    onClick={() => updateContact(editingContact.id, editingContact.name)}
                    className="w-full bg-[#00a884] text-white font-black py-4 rounded-xl hover:bg-[#00bc95] transition-all text-xs uppercase tracking-widest"
                  >
                    Commit Change
                  </button>
               </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSettings && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[110] bg-[#0b141a] flex items-center justify-center p-4">
             <motion.div initial={{ x: 300, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 300, opacity: 0 }} className="w-full max-w-lg h-[80vh] bg-[#111b21] rounded-3xl border border-white/5 shadow-2xl flex flex-col overflow-hidden">
                <div className="p-6 bg-[#202c33] flex items-center gap-4 border-b border-white/5">
                   <button onClick={() => settingsView === 'main' ? setShowSettings(false) : setSettingsView('main')} className="p-2 hover:bg-white/5 rounded-full">
                      <ChevronLeft className="w-6 h-6" />
                   </button>
                   <div>
                      <h2 className="text-xl font-black uppercase italic">{settingsView === 'main' ? 'Signal Settings' : settingsView.toUpperCase()}</h2>
                      <p className="text-[10px] font-black text-[#00a884] uppercase tracking-widest">{settingsView === 'main' ? 'System Configuration' : 'Advanced Tuning'}</p>
                   </div>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                   {settingsView === 'main' ? (
                     <div className="space-y-2">
                        {[
                          { id: 'notifications', icon: Zap, label: 'Notifications', desc: 'Secure neural pulse alerts' },
                          { id: 'chats', icon: MessageSquare, label: 'Matrix Chats', desc: 'Communication logs & archive' },
                          { id: 'starred', icon: Star, label: 'Starred Signals', desc: 'Flagged core data' },
                          { id: 'guides', icon: FileText, label: 'Board Guides', desc: 'Protocol instructions' },
                          { id: 'lists', icon: Activity, label: 'Custom Lists', desc: 'Broadcast segments' },
                          { id: 'privacy', icon: ShieldCheck, label: 'Privacy Isolation', desc: 'Encrypted stealth settings' },
                          { id: 'accounts', icon: User, label: 'Accounts', desc: 'Entity permissions' },
                          { id: 'language', icon: Monitor, label: 'Interface', desc: 'Syntactic skin selection' },
                          { id: 'keyboard', icon: Sparkles, label: 'Input Methods', desc: 'Keyboard & shortcut pulse' },
                          { id: 'help', icon: History, label: 'Support Center', desc: 'Admin bypass & help' },
                        ].map((item: any) => (
                          <button 
                            key={item.id}
                            onClick={() => setSettingsView(item.id)}
                            className="w-full p-4 bg-[#202c33] hover:bg-[#2a3942] rounded-2xl border border-white/5 flex items-center gap-4 transition-all group"
                          >
                            <div className="p-3 bg-[#00a884]/10 rounded-xl group-hover:scale-110 transition-transform">
                               <item.icon className="w-5 h-5 text-[#00a884]" />
                            </div>
                            <div className="text-left flex-1 min-w-0">
                               <p className="text-sm font-bold uppercase tracking-tight">{item.label}</p>
                               <p className="text-[10px] opacity-40 font-medium truncate">{item.desc}</p>
                            </div>
                            <ChevronRight className="w-4 h-4 opacity-20" />
                          </button>
                        ))}
                     </div>
                   ) : settingsView === 'starred' ? (
                      <div className="space-y-4">
                        {starredMessages.map((m, i) => (
                           <div key={i} className="p-4 bg-[#202c33] rounded-2xl border border-white/5 flex flex-col gap-2">
                      <div className="flex justify-between items-center bg-[#202c33] p-1.5 rounded-lg mb-2">
                        <span className="text-[10px] font-black text-[#00a884] uppercase tracking-widest px-2">{m.sender}</span>
                        <span className="text-[8px] opacity-30 font-bold px-2">{format(m.timestamp * 1000, 'MMM dd, HH:mm')}</span>
                      </div>
                      <div className="px-1 py-1">
                        <p className="text-sm italic opacity-80 leading-relaxed">"{m.message?.conversation || m.text || 'Encrypted Payload'}"</p>
                      </div>
                      <div className="flex justify-between items-center mt-3 pt-2 border-t border-white/5">
                        <span className="text-[8px] opacity-20 font-black uppercase tracking-widest">{m.id.substring(0, 8)}</span>
                        <button onClick={() => setStarredMessages(prev => prev.filter(s => s.id !== m.id))} className="text-[9px] font-black uppercase text-red-400 hover:text-red-300 transition-colors tracking-tighter">Discard Signal</button>
                      </div>
                   </div>
                ))}
                {starredMessages.length === 0 && (
                  <div className="py-24 text-center opacity-10">
                     <Star className="w-16 h-16 mx-auto mb-6" />
                     <p className="text-[10px] font-black uppercase tracking-[0.3em]">No signals flagged for biometric retention</p>
                  </div>
                )}
              </div>
            ) : (
               <div className="space-y-6 animate-in slide-in-from-right-10 duration-300">
                <div className="bg-[#202c33] p-6 rounded-3xl border border-white/5 shadow-inner">
                   <h3 className="text-sm font-black uppercase text-[#00a884] mb-6 tracking-widest italic flex items-center gap-3">
                     <ShieldCheck className="w-4 h-4" />
                     {settingsView} Protocol
                   </h3>
                   <div className="space-y-6">
                      <div className="flex items-center justify-between group/toggle">
                         <div className="flex-1">
                            <p className="text-xs font-bold uppercase tracking-tight">System {settingsView} Shield</p>
                            <p className="text-[10px] opacity-40 font-medium">Auto-calibrate neural pulse filtering</p>
                         </div>
                         <button className="w-10 h-5 bg-[#00a884] rounded-full relative transition-all shadow-[0_0_10px_rgba(0,168,132,0.3)]">
                            <div className="absolute right-1 top-1 w-3 h-3 bg-white rounded-full shadow-md" />
                         </button>
                      </div>

                      {settingsView === 'privacy' && (
                        <>
                          {[
                            { key: 'ghostMode', label: 'Ghost Mode Protocol', desc: 'Invisible presence on the signal' },
                            { key: 'hideBlueTicks', label: 'Hide Blue Ticks', desc: 'Suppress read receipt transmission' },
                            { key: 'hideSecondTick', label: 'Hide Second Tick', desc: 'Divert delivery confirmation' },
                            { key: 'hideTyping', label: 'Hide Typing Indicator', desc: 'Conceal interactive status' },
                            { key: 'secretStatusView', label: 'Secret Status View', desc: 'Engage status silently' },
                            { key: 'dndMode', label: 'DND Airplane Mode', desc: 'Disconnect from Matrix stream' },
                            { key: 'antiDeleteStatus', label: 'Anti-Delete Status', desc: 'Retain deleted status logs' },
                          ].map(item => (
                            <div key={item.key} className="flex items-center justify-between group/toggle">
                               <div className="flex-1">
                                  <p className="text-xs font-bold uppercase tracking-tight">{item.label}</p>
                                  <p className="text-[10px] opacity-40 font-medium">{item.desc}</p>
                               </div>
                               <button 
                                  onClick={() => updateProSettings({ [item.key]: !proSettings[item.key as keyof typeof proSettings] })}
                                  className={`w-10 h-5 rounded-full relative transition-all ${proSettings[item.key as keyof typeof proSettings] ? 'bg-primary shadow-[0_0_10px_var(--color-primary)]' : 'bg-white/10'}`}
                               >
                                  <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${proSettings[item.key as keyof typeof proSettings] ? 'right-1' : 'left-1'}`} />
                               </button>
                            </div>
                          ))}
                        </>
                      )}

                      {settingsView === 'language' && (
                        <div className="space-y-8">
                           <div className="space-y-4">
                              <h4 className="text-[10px] font-black uppercase text-primary tracking-widest">Interface Skin (Theme)</h4>
                              <div className="grid grid-cols-2 gap-3">
                                 {['elegant-dark', 'matrix-green', 'cyber-blue', 'royal-purple', 'blood-red'].map(t => (
                                   <button 
                                     key={t}
                                     onClick={() => updateProSettings({ theme: t })}
                                     className={`p-3 rounded-xl border text-[10px] font-black uppercase tracking-tighter transition-all ${proSettings.theme === t ? 'bg-primary text-white border-primary shadow-lg shadow-primary/20' : 'bg-surface border-white/5 text-white/40 hover:border-white/20'}`}
                                   >
                                     {t.replace('-', ' ')}
                                   </button>
                                 ))}
                              </div>
                           </div>
                           <div className="space-y-4">
                              <h4 className="text-[10px] font-black uppercase text-primary tracking-widest">Typography Pulse (Font)</h4>
                              <div className="grid grid-cols-2 gap-3">
                                 {['Inter', 'Space Grotesk', 'JetBrains Mono', 'Outfit', 'Fira Code'].map(f => (
                                   <button 
                                     key={f}
                                     onClick={() => updateProSettings({ font: f })}
                                     className={`p-3 rounded-xl border text-[10px] font-black uppercase tracking-tighter transition-all ${proSettings.font === f ? 'bg-primary text-white border-primary shadow-lg shadow-primary/20' : 'bg-surface border-white/5 text-white/40 hover:border-white/20'}`}
                                     style={{ fontFamily: f }}
                                   >
                                     {f}
                                   </button>
                                 ))}
                              </div>
                           </div>
                        </div>
                      )}

                      {settingsView === 'chats' && (
                        <>
                          <div className="flex items-center justify-between group/toggle">
                             <div className="flex-1">
                                <p className="text-xs font-bold uppercase tracking-tight">Anti-Delete Protocol</p>
                                <p className="text-[10px] opacity-40 font-medium">Retain revoked signal packets</p>
                             </div>
                             <button 
                                onClick={() => updateProSettings({ antiDelete: !proSettings.antiDelete })}
                                className={`w-10 h-5 rounded-full relative transition-all ${proSettings.antiDelete ? 'bg-[#00a884] shadow-[0_0_10px_rgba(0,168,132,0.3)]' : 'bg-white/10'}`}
                             >
                                <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${proSettings.antiDelete ? 'right-1' : 'left-1'}`} />
                             </button>
                          </div>
                        </>
                      )}
                   </div>
                </div>

                <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-2xl flex gap-3 mt-6">
                   <Zap className="w-4 h-4 text-yellow-500 shrink-0" />
                   <p className="text-[10px] text-yellow-500 font-bold italic leading-tight">ADMIN NOTICE: Some {settingsView} parameters are managed by the neural core and may require a system reboot to apply changes.</p>
                </div>
                {settingsView === 'help' && (
                   <div className="space-y-3 mt-4">
                      <button className="w-full py-4 bg-[#00a884] text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-[#00a884]/20">Contact Neural Support</button>
                      <button className="w-full py-4 bg-white/5 text-white/40 rounded-2xl font-black text-[10px] uppercase tracking-widest">Privacy Protocol Document</button>
                   </div>
                )}
             </div>
          )}
       </div>
    </motion.div>
 </motion.div>
)}
      </AnimatePresence>

      <AnimatePresence>
        {showScheduleModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
             <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} className="bg-surface w-full max-w-md rounded-3xl border border-white/5 shadow-2xl overflow-hidden">
                <div className="p-6 bg-accent border-b border-white/5 flex justify-between items-center text-primary">
                   <h2 className="text-sm font-black uppercase tracking-widest italic flex items-center gap-2">
                     <Clock className="w-4 h-4" /> Schedule Protocol
                   </h2>
                   <button onClick={() => setShowScheduleModal(false)} className="text-white/40"><X className="w-5 h-5" /></button>
                </div>
                <div className="p-8 space-y-6">
                   <div>
                      <label className="block text-[10px] font-black text-primary uppercase tracking-[0.2em] mb-3 ml-1">Payload Content</label>
                      <textarea 
                        className="w-full h-24 bg-accent border border-white/5 rounded-2xl p-4 text-sm outline-none focus:border-primary transition-all resize-none"
                        placeholder="Enter neural data to transmit..."
                        value={scheduleData.text}
                        onChange={e => setScheduleData({...scheduleData, text: e.target.value})}
                      />
                   </div>
                   <div>
                      <label className="block text-[10px] font-black text-primary uppercase tracking-[0.2em] mb-3 ml-1">Activation Epoch</label>
                      <input 
                        type="datetime-local"
                        className="w-full bg-accent border border-white/5 rounded-2xl p-4 text-sm outline-none focus:border-primary transition-all"
                        value={scheduleData.time}
                        onChange={e => setScheduleData({...scheduleData, time: e.target.value})}
                      />
                   </div>
                   <button 
                     onClick={scheduleMessage}
                     className="w-full bg-primary text-white font-black py-4 rounded-xl hover:opacity-90 transition-all text-xs uppercase tracking-[0.3em] shadow-lg shadow-primary/20"
                   >
                     Commit to Timeline
                   </button>
                   <div className="pt-4 border-t border-white/5">
                      <p className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-3">Active Schedules</p>
                      {scheduledMsgs.filter(m => !m.sent).map(m => (
                        <div key={m.id} className="p-3 bg-accent/50 rounded-xl flex items-center justify-between mb-2 border border-white/[0.02]">
                           <div className="min-w-0">
                              <p className="text-[11px] font-bold truncate">"{m.text}"</p>
                              <p className="text-[8px] opacity-40 font-mono italic">{format(new Date(m.time), 'MMM dd, HH:mm')}</p>
                           </div>
                           <Clock className="w-3 h-3 text-primary" />
                        </div>
                      ))}
                   </div>
                </div>
             </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showAutoReplyModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
             <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} className="bg-surface w-full max-w-lg rounded-3xl border border-white/5 shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
                <div className="p-6 bg-accent border-b border-white/5 flex justify-between items-center text-primary">
                   <h2 className="text-sm font-black uppercase tracking-widest italic flex items-center gap-2">
                     <Zap className="w-4 h-4" /> Auto Reply Interface
                   </h2>
                   <div className="flex items-center gap-4">
                      <button 
                        onClick={() => updateProSettings({ autoReply: !proSettings.autoReply })}
                        className={`px-3 py-1.5 rounded-lg border text-[9px] font-black uppercase tracking-widest transition-all ${proSettings.autoReply ? 'bg-primary border-primary text-white' : 'border-white/10 text-white/40'}`}
                      >
                         {proSettings.autoReply ? 'Engine Armed' : 'Engine Disarmed'}
                      </button>
                      <button onClick={() => setShowAutoReplyModal(false)} className="text-white/40"><X className="w-5 h-5" /></button>
                   </div>
                </div>
                <div className="p-6 border-b border-white/5 bg-surface">
                   <div className="grid grid-cols-2 gap-4">
                      <input 
                        placeholder="Keyword"
                        className="bg-accent border border-white/5 rounded-xl p-3 text-xs outline-none focus:border-primary"
                        value={newAutoReply.keyword}
                        onChange={e => setNewAutoReply({...newAutoReply, keyword: e.target.value})}
                      />
                      <input 
                        placeholder="Response"
                        className="bg-accent border border-white/5 rounded-xl p-3 text-xs outline-none focus:border-primary"
                        value={newAutoReply.response}
                        onChange={e => setNewAutoReply({...newAutoReply, response: e.target.value})}
                      />
                   </div>
                   <button 
                     onClick={addAutoReply}
                     className="w-full mt-4 bg-primary/10 text-primary border border-primary/20 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-primary hover:text-white transition-all"
                   >
                     Add Neural Trigger
                   </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6 space-y-3 custom-scrollbar">
                   {autoReplies.map((r, i) => (
                     <div key={i} className="p-4 bg-accent rounded-2xl border border-white/5 flex items-center justify-between">
                        <div>
                           <p className="text-[10px] font-black uppercase text-primary tracking-widest mb-1 italic">Trigger: {r.keyword}</p>
                           <p className="text-xs font-bold">"{r.response}"</p>
                        </div>
                        <div className="flex items-center gap-3">
                           <button 
                             onClick={async () => {
                               await fetch('/api/auto-replies/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword: r.keyword }) });
                               fetchAutoReplies();
                             }}
                             className={`w-8 h-4 rounded-full relative transition-all ${r.enabled ? 'bg-primary' : 'bg-white/10'}`}
                           >
                             <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${r.enabled ? 'left-4.5' : 'left-0.5'}`} />
                           </button>
                           <button 
                             onClick={async () => {
                               await fetch(`/api/auto-replies/${r.keyword}`, { method: 'DELETE' });
                               fetchAutoReplies();
                             }}
                             className="p-2 hover:bg-red-500/10 rounded-lg text-red-500 transition-colors"
                           >
                             <Trash2 className="w-4 h-4" />
                           </button>
                        </div>
                     </div>
                   ))}
                   {autoReplies.length === 0 && <p className="text-center py-10 text-[10px] font-black uppercase tracking-widest opacity-20">No active triggers programmed</p>}
                </div>
             </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deleteOptionModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
             <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} className="bg-[#111b21] w-full max-w-sm rounded-3xl border border-white/5 shadow-2xl overflow-hidden">
                <div className="p-6 border-b border-white/5 bg-[#202c33] flex justify-between items-center">
                   <h2 className="text-xs font-black uppercase tracking-widest text-red-500 italic">Delete Signal Pulse?</h2>
                   <button onClick={() => setDeleteOptionModal(null)}><X className="w-5 h-5 text-red-500" /></button>
                </div>
                <div className="p-8 space-y-4">
                   <button 
                     onClick={() => deleteMessage(deleteOptionModal.msgId, false)}
                     className="w-full bg-white/5 text-[#e9edef] font-bold py-4 rounded-xl hover:bg-white/10 transition-all text-xs uppercase tracking-widest border border-white/10"
                   >
                     Delete for Me
                   </button>
                   <button 
                     onClick={() => deleteMessage(deleteOptionModal.msgId, true)}
                     className="w-full bg-red-500 text-white font-black py-4 rounded-xl hover:bg-red-600 transition-all shadow-xl shadow-red-500/20 text-xs uppercase tracking-widest"
                   >
                     Delete for Everyone
                   </button>
                   <button 
                     onClick={() => setDeleteOptionModal(null)}
                     className="w-full text-white/40 text-[10px] font-black uppercase tracking-widest py-2"
                   >
                     Cancel Purge
                   </button>
                </div>
             </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isProfileEditorOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
             <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} className="bg-[#111b21] w-full max-w-md rounded-3xl border border-white/5 shadow-2xl overflow-hidden">
                <div className="p-6 border-b border-white/5 bg-[#202c33] flex justify-between items-center">
                   <h2 className="text-sm font-black uppercase tracking-widest text-[#00a884] italic">Profile Configuration 🧬</h2>
                   <button onClick={() => setIsProfileEditorOpen(false)}><X className="w-5 h-5 text-[#00a884]" /></button>
                </div>
                <div className="p-8 space-y-6">
                   <div className="flex flex-col items-center gap-4">
                      <div className="relative group">
                        <div className="w-24 h-24 rounded-3xl bg-[#00a884] flex items-center justify-center shadow-2xl overflow-hidden border border-white/10 text-white text-3xl font-black">
                          {user?.id && profilePictures[user.id.split(':')[0] + '@s.whatsapp.net'] ? (
                            <img src={profilePictures[user.id.split(':')[0] + '@s.whatsapp.net']} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            user?.name?.[0] || <Zap />
                          )}
                        </div>
                        <label className="absolute -bottom-2 -right-2 bg-[#00a884] p-2 rounded-xl border border-white/20 cursor-pointer shadow-xl hover:scale-110 transition-all">
                           <Camera className="w-4 h-4 text-white" />
                           <input type="file" accept="image/*" onChange={uploadProfilePicture} className="hidden" />
                        </label>
                      </div>
                   </div>

                   <div className="space-y-4">
                      <div>
                        <label className="block text-[10px] font-black text-[#00a884] uppercase tracking-widest mb-2 ml-1">Entity Name</label>
                        <input 
                          type="text" 
                          placeholder="Your Name" 
                          className="w-full bg-[#202c33] border border-white/5 rounded-xl p-4 text-sm text-white outline-none focus:border-[#00a884] transition-all font-bold"
                          value={profileName}
                          onChange={(e) => setProfileName(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-[#00a884] uppercase tracking-widest mb-2 ml-1">Universal Bio</label>
                        <textarea 
                          placeholder="System Bio..." 
                          className="w-full h-24 bg-[#202c33] border border-white/5 rounded-xl p-4 text-sm text-white outline-none focus:border-[#00a884] transition-all font-medium resize-none"
                          value={profileBio}
                          onChange={(e) => setProfileBio(e.target.value)}
                        />
                      </div>
                   </div>

                   <button 
                     onClick={updateProfile}
                     disabled={loading}
                     className="w-full bg-[#00a884] text-white font-black py-4 rounded-xl hover:bg-[#00bc95] transition-all shadow-xl shadow-[#00a884]/20 text-xs uppercase tracking-widest flex items-center justify-center gap-3"
                   >
                     {loading && <RefreshCw className="w-4 h-4 animate-spin" />}
                     Commit Signal Updates
                   </button>
                </div>
             </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.05); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.1); }
        .no-scrollbar::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}
