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

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "https://whatsapp-pro-production.up.railway.app";

export default function App() {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<"close" | "connecting" | "open">("close");
  const [user, setUser] = useState<any>(null);
  const [chats, setChats] = useState<any[]>([]);
  const [activeChat, setActiveChat] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const ws = useRef<WebSocket | null>(null);

  // Connect WebSocket
  const connectWebSocket = () => {
    const wsUrl = BACKEND_URL.replace(/^http/, "ws");
    const socket = new WebSocket(wsUrl);
    ws.current = socket;

    socket.onopen = () => console.log("WebSocket connected");
    socket.onclose = () => {
      setConnectionState("close");
      setTimeout(connectWebSocket, 3000);
    };

    socket.onmessage = (event) => {
      const { type, data } = JSON.parse(event.data);

      if (type === "QR_CODE") setQrCode(data);
      if (type === "CONNECTION_STATE") setConnectionState(data);
      if (type === "LOGGED_IN") {
        setUser(data);
        setQrCode(null);
      }
      if (type === "MESSAGES_UPSERT") {
        // Handle messages (simplified)
        setMessages((prev) => [...prev, ...data.messages]);
      }
    };
  };

  useEffect(() => {
    connectWebSocket();
    return () => ws.current?.close();
  }, []);

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-zinc-900 rounded-3xl overflow-hidden border border-zinc-700">
        <div className="p-6 text-center border-b border-zinc-700">
          <h1 className="text-3xl font-bold">WhatsApp Pro</h1>
          <p className="text-zinc-400 mt-1">Production Ready Clone</p>
        </div>

        {!user ? (
          <div className="p-8 flex flex-col items-center">
            {qrCode ? (
              <div className="bg-white p-4 rounded-2xl">
                <QRCode value={qrCode} size={280} />
              </div>
            ) : (
              <div className="text-center py-12">
                <RefreshCw className="w-12 h-12 mx-auto animate-spin text-green-500" />
                <p className="mt-6 text-zinc-400">Waiting for QR Code...</p>
              </div>
            )}

            <p className="text-sm text-zinc-500 mt-8">Scan with WhatsApp Mobile</p>
          </div>
        ) : (
          <div className="p-8 text-center">
            <h2 className="text-xl font-semibold">✅ Connected as {user.name || "User"}</h2>
            <p className="text-green-500 mt-2">WhatsApp Engine is Live</p>
          </div>
        )}
      </div>
    </div>
  );
}
