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
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
import { db as clientDb } from "./lib/firebaseClient";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "https://whatsapp-pro-production.up.railway.app";

function safeFormat(dateVal: any, formatStr: string, fallback: string = ""): string {
  if (dateVal === undefined || dateVal === null) return fallback;
  try {
    let d: Date;
    if (typeof dateVal === "number") {
      const val = dateVal < 100000000000 ? dateVal * 1000 : dateVal;
      d = new Date(val);
    } else {
      d = new Date(dateVal);
    }
    if (isNaN(d.getTime())) return fallback;
    return format(d, formatStr);
  } catch (e) {
    return fallback;
  }
}

// ... (all your interfaces remain the same)

export default function App() {
  // ... (all your state variables remain the same)

  const ws = useRef<WebSocket | null>(null);

  // Fixed WebSocket Connection
  const connectWebSocket = () => {
    if (ws.current) ws.current.close();

    const wsUrl = BACKEND_URL.replace(/^https?:\/\//, "wss://");
    console.log("Connecting to WebSocket:", wsUrl);

    const socket = new WebSocket(wsUrl);
    ws.current = socket;

    socket.onopen = () => {
      console.log("WebSocket connected successfully");
      setError(null);
    };

    socket.onclose = () => {
      setConnectionState("close");
      setError("Connection lost. Reconnecting...");
      setTimeout(connectWebSocket, 3000); // Auto-reconnect
    };

    socket.onerror = (err) => {
      console.error("WebSocket error:", err);
      setError("WebSocket connection failed. Check backend status.");
    };

    socket.onmessage = (event) => {
      try {
        const { type, data } = JSON.parse(event.data);
        // ... (your existing onmessage logic remains unchanged)
        switch (type) {
          case "CONNECTION_STATE":
            setConnectionState(data);
            if (data === "open") {
              setPairingCode("");
              setQrCode(null);
              setError(null);
            }
            break;
          case "QR_CODE":
            setQrCode(data);
            setError(null);
            break;
          // ... (rest of your cases remain the same)
        }
      } catch (e) {
        console.error("Failed to parse message:", e);
      }
    };
  };

  // Rest of your component code remains the same...
  // (I'm not repeating the entire 1000+ lines here, only the changed part)

  useEffect(() => {
    connectWebSocket();
    checkConnectionStatus();
    // ... other useEffects
    return () => {
      if (ws.current) ws.current.close();
    };
  }, []);

  // ... rest of your functions (sendMessage, loadHistory, etc.) stay the same

  // Make sure to update any fetch calls if needed (they should already use relative /api which is rewritten in vercel.json)

  return (
    // ... your entire JSX remains unchanged
  );
}
