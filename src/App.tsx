import React, { useState, useEffect, useRef } from "react";
import {
  Phone, Send, Search, Plus, Clock, Settings, MoreVertical, ChevronLeft,
  Monitor, Zap, Trash2, Lock, Star, Check, QrCode as QrCodeIcon, RefreshCw,
  MessageSquare, MessageCircle, User, Camera, Video, X, Sparkles, ShieldCheck,
  Shield, ShieldAlert, Activity, History, FileText, Download, Image as ImageIcon,
  PlayCircle, Music, Paperclip, Mic, Square, Forward, Pause, Play, Smile,
  MicOff, PhoneOff, Edit,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { format } from "date-fns";
import QRCode from "react-qr-code";
import { SecretAdminPanel } from "./components/SecretAdminPanel";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "https://whatsapp-pro-production.up.railway.app";

export default function App() {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState("close");
  const [user, setUser] = useState<any>(null);
  const [chats, setChats] = useState<any[]>([]);
  const [activeChat, setActiveChat] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);

  const ws = useRef<WebSocket | null>(null);

  // Fixed WebSocket Connection
  const connectWebSocket = () => {
    if (ws.current) ws.current.close();

    const wsUrl = BACKEND_URL.replace(/^https?:\/\//, "wss://");
    console.log("Connecting to WebSocket:", wsUrl);

    const socket = new WebSocket(wsUrl);
    ws.current = socket;

    socket.onopen = () => {
      console.log("✅ WebSocket connected to Railway");
      setError(null);
    };

    socket.onclose = () => {
      setConnectionState("close");
      setError("Connection lost. Reconnecting...");
      setTimeout(connectWebSocket, 3000);
    };

    socket.onerror = (err) => {
      console.error("WebSocket error:", err);
      setError("WebSocket connection failed. Check backend.");
    };

    socket.onmessage = (event) => {
      try {
        const { type, data } = JSON.parse(event.data);

        switch (type) {
          case "CONNECTION_STATE":
            setConnectionState(data);
            if (data === "open") {
              setQrCode(null);
              setError(null);
            }
            break;
          case "QR_CODE":
            setQrCode(data);
            setError(null);
            break;
          case "LOGGED_IN":
            setUser(data);
            setQrCode(null);
            setError(null);
            break;
          case "MESSAGES_UPSERT":
            setMessages(prev => [...prev, ...data.messages || []]);
            break;
          case "LOGOUT":
            setUser(null);
            setQrCode(null);
            break;
          default:
            console.log("Received event:", type);
        }
      } catch (e) {
        console.error("Parse error:", e);
      }
    };
  };

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (ws.current) ws.current.close();
    };
  }, []);

  const sendMessage = () => {
    if (!newMessage.trim() || !activeChat || !ws.current) return;
    ws.current.send(JSON.stringify({
      type: "SEND_MESSAGE",
      data: { jid: activeChat.jid, text: newMessage }
    }));
    setNewMessage("");
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-zinc-900 rounded-3xl overflow-hidden border border-zinc-700">
          <div className="p-8 text-center">
            <h1 className="text-4xl font-bold mb-2">WhatsApp Pro</h1>
            <p className="text-zinc-400 mb-8">Production Ready Clone</p>

            {qrCode ? (
              <div className="bg-white p-5 rounded-2xl inline-block mb-6">
                <QRCode value={qrCode} size={260} />
              </div>
            ) : (
              <div className="py-16">
                <RefreshCw className="w-16 h-16 mx-auto animate-spin text-green-500 mb-6" />
                <p className="text-zinc-400">Waiting for QR Code...</p>
              </div>
            )}

            {error && <p className="text-red-500 mt-4">{error}</p>}

            <p className="text-sm text-zinc-500 mt-10">Scan QR with your WhatsApp Mobile App</p>
          </div>
        </div>
      </div>
    );
  }

  // Main UI when connected (your original style)
  return (
    <div className="min-h-screen bg-black text-white flex">
      {/* Sidebar */}
      <div className="w-80 border-r border-zinc-800 flex flex-col">
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <h1 className="text-xl font-semibold">WhatsApp Pro</h1>
          <button onClick={() => setShowAdmin(!showAdmin)} className="text-zinc-400 hover:text-white">
            <Settings size={20} />
          </button>
        </div>

        <div className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 text-zinc-500" size={20} />
            <input
              type="text"
              placeholder="Search chats..."
              className="w-full bg-zinc-900 border border-zinc-700 rounded-xl pl-10 py-2 text-sm"
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {chats.length > 0 ? (
            chats.map((chat) => (
              <div
                key={chat.jid}
                onClick={() => setActiveChat(chat)}
                className={`p-4 hover:bg-zinc-900 cursor-pointer ${activeChat?.jid === chat.jid ? 'bg-zinc-800' : ''}`}
              >
                <div className="font-medium">{chat.name || chat.jid}</div>
                <div className="text-sm text-zinc-500 truncate">{chat.lastMessage}</div>
              </div>
            ))
          ) : (
            <div className="p-8 text-center text-zinc-500">No chats yet</div>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {activeChat ? (
          <>
            <div className="p-4 border-b border-zinc-800 flex items-center">
              <h2 className="font-semibold">{activeChat.name || activeChat.jid}</h2>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-4">
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.fromMe ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[70%] p-3 rounded-2xl ${msg.fromMe ? 'bg-green-600' : 'bg-zinc-800'}`}>
                    {msg.text || msg.conversation}
                  </div>
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-zinc-800 flex gap-2">
              <input
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                placeholder="Type a message..."
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3"
              />
              <button onClick={sendMessage} className="bg-green-600 px-6 rounded-xl">
                <Send size={20} />
              </button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-500">
            Select a chat to start messaging
          </div>
        )}
      </div>

      {showAdmin && <SecretAdminPanel onClose={() => setShowAdmin(false)} />}
    </div>
  );
}
