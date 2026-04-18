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

const app = express();
const server = http.createServer(app);

// Serve static frontend files from /public
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Home page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Optional: only fallback for non-file routes
app.get(/^\/(?!css\/|js\/|socket\.io\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 10000,
  pingInterval: 5000,
});

const roomManager = new RoomManager(io);
registerSocketHandlers(io, roomManager);

server.listen(PORT, () => {
  console.log(`Mafia Game Server running on port ${PORT}`);
});
