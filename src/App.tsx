import React, { useState, useEffect, useRef } from "react";
import QRCode from "react-qr-code";

function App() {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState("close");

  return (
    <div style={{ 
      padding: "40px", 
      textAlign: "center", 
      fontFamily: "system-ui, sans-serif",
      backgroundColor: "#000",
      color: "#fff",
      minHeight: "100vh"
    }}>
      <h1>WhatsApp Pro</h1>
      <p>Frontend is working.</p>

      {qrCode && (
        <div style={{ margin: "20px auto", padding: "20px", background: "#fff", display: "inline-block" }}>
          <QRCode value={qrCode} size={256} />
        </div>
      )}

      <p>Connection Status: <strong>{connectionState}</strong></p>
    </div>
  );
}

export default App;
