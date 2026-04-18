/**
 * index.js — Server entry point.
 * Sets up Express, Socket.io, and starts listening.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const RoomManager = require('./RoomManager');
const registerSocketHandlers = require('./socketHandlers');

const PORT = process.env.PORT || 3000;

// ── Express setup ─────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../public')));

// Health check endpoint
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: Date.now() }));

// Fallback for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── Socket.io setup ───────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  // Ping settings for detecting disconnects faster
  pingTimeout: 10000,
  pingInterval: 5000,
});

// ── Wire everything together ──────────────────────────────────────────────
const roomManager = new RoomManager(io);
registerSocketHandlers(io, roomManager);

// ── Start server ──────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║   🎭  Mafia Game Server Running      ║
  ║   http://localhost:${PORT}              ║
  ╚══════════════════════════════════════╝
  `);
});
