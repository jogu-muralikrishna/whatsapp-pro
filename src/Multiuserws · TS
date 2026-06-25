/**
 * multiUserWS.ts
 *
 * Patches the WebSocketServer so each connected client is associated with a
 * userId.  The frontend sends a JSON handshake immediately after connecting:
 *
 *   { "type": "IDENTIFY", "userId": "user_abc123" }
 *
 * Before identification, no session-scoped events are sent to that client.
 * After identification, only events for that userId are forwarded.
 *
 * Global admin broadcasts (sent via broadcastAll) still reach every client.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { sessionManager } from './UserSessionManager.js';

export function patchWSSForMultiUser(wss: WebSocketServer) {
  wss.on('connection', (ws: WebSocket, req: any) => {
    // Try to extract userId from query string first (e.g. ?userId=abc)
    const url = new URL(req.url || '/', `http://localhost`);
    const queryUserId = url.searchParams.get('userId');

    if (queryUserId) {
      sessionManager.registerWsClient(queryUserId, ws);
      ws.send(JSON.stringify({ type: 'IDENTIFIED', userId: queryUserId }));
    }

    ws.on('message', (raw: any) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === 'IDENTIFY' && msg.userId) {
          sessionManager.registerWsClient(msg.userId, ws);
          ws.send(JSON.stringify({ type: 'IDENTIFIED', userId: msg.userId }));
          return;
        }

        // Handle client-initiated pings to keep the connection alive
        if (msg.type === 'PING') {
          ws.send(JSON.stringify({ type: 'PONG' }));
          return;
        }

        // Optionally: route other messages back to the session
      } catch {}
    });
  });
}
