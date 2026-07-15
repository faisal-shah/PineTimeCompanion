#!/usr/bin/env node
// WebSocket <-> TCP proxy for web development against InfiniSim.
//
// Browsers can't open raw TCP sockets, so the web build reaches the sim's TCP
// GATT bridge (pinetime-dev-tools/simctl.py start; listens on 18632) through
// this proxy: each WebSocket client gets its own TCP connection, and bytes are
// forwarded verbatim in both directions. The bridge protocol is
// length-prefixed (src/ble/bridgeFraming.ts), so chunk boundaries don't matter.
//
// Usage: npm run sim:proxy   (or: node scripts/ws-tcp-proxy.mjs)
// Env: WS_PORT (default 18633), BRIDGE_HOST (127.0.0.1), BRIDGE_PORT (18632).

import { WebSocketServer } from 'ws';
import net from 'node:net';

const WS_PORT = Number(process.env.WS_PORT ?? 18633);
const BRIDGE_HOST = process.env.BRIDGE_HOST ?? '127.0.0.1';
const BRIDGE_PORT = Number(process.env.BRIDGE_PORT ?? 18632);

const wss = new WebSocketServer({ port: WS_PORT });

wss.on('connection', (ws, req) => {
  const peer = req.socket.remoteAddress;
  const tcp = net.createConnection({ host: BRIDGE_HOST, port: BRIDGE_PORT });

  tcp.on('connect', () => console.log(`[proxy] ${peer} -> bridge connected`));
  tcp.on('data', (data) => ws.readyState === ws.OPEN && ws.send(data));
  tcp.on('error', (e) => {
    console.error(`[proxy] bridge error: ${e.message} (is the sim running? ./simctl.py start)`);
    ws.close(1011, 'bridge unreachable');
  });
  tcp.on('close', () => ws.close(1000, 'bridge closed'));

  ws.on('message', (data) => tcp.write(data));
  ws.on('close', () => {
    console.log(`[proxy] ${peer} disconnected`);
    tcp.destroy();
  });
  ws.on('error', () => tcp.destroy());
});

console.log(`[proxy] ws://localhost:${WS_PORT} <-> tcp ${BRIDGE_HOST}:${BRIDGE_PORT}`);
