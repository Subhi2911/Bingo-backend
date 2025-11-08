const games = {};
let queue = [];

require('dotenv').config({ path: '.env.local' });
const express = require('express');
const cors = require('cors');
const connectToMongo = require('./db');
const { createServer } = require('http');
const { Server } = require('socket.io');

// Initialize Express
const app = express();
const port = 5000;

// Create HTTP server for sockets
const httpServer = createServer(app);

// Initialize Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: ['http://localhost:8081'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  },
});

// Connect to MongoDB
connectToMongo();

// Middleware
app.use(cors({
  origin: ['http://localhost:8081'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));

app.use(express.json());

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/emailverification', require('./routes/emailverification'));

// Socket.IO Handlers
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Join/Create room
  socket.on("join_room", ({ roomCode, username }) => {
    if (!games[roomCode]) {
      games[roomCode] = {
        players: [],
        turns: [],
        currentTurn: 0,
        picked: []
      };
    }

    // Add player if not already in room
    if (!games[roomCode].players.some(p => p.id === socket.id)) {
      games[roomCode].players.push({ id: socket.id, username });
    }

    socket.join(roomCode);

    // Emit updated player list
    io.to(roomCode).emit("update_players", games[roomCode].players);

    // If game has started, send turn info to new player
    const game = games[roomCode];
    if (game.turns.length > 0) {
      socket.emit("turn_order", game.turns);
      socket.emit("current_turn", game.turns[game.currentTurn]);
      socket.emit("number_picked", game.picked);
    }

    console.log(`Player joined room: ${roomCode}`);
  });

  // Start game manually
  socket.on("start_game", (roomCode) => {
    const game = games[roomCode];
    if (!game) return;

    // Shuffle players for turn order
    game.turns = [...game.players].sort(() => Math.random() - 0.5);
    game.currentTurn = 0;

    io.to(roomCode).emit("turn_order", game.turns);
    io.to(roomCode).emit("current_turn", game.turns[0]);
  });

  // Number selection
  socket.on("select_number", ({ roomCode, number }) => {
    const game = games[roomCode];
    if (!game) return;

    // Only allow current player to pick
    if (!game.turns[game.currentTurn] || socket.id !== game.turns[game.currentTurn].id) return;

    if (!game.picked.includes(number)) {
      game.picked.push(number);
    }

    // Broadcast picked numbers
    io.to(roomCode).emit("number_picked", game.picked);

    // Move to next turn
    game.currentTurn = (game.currentTurn + 1) % game.turns.length;
    io.to(roomCode).emit("current_turn", game.turns[game.currentTurn]);
  });

  // Matchmaking
  socket.on("find_match", ({ username, size }) => {
    queue.push({ id: socket.id, username, size });
    const group = queue.filter(p => p.size === size);

    if (group.length >= size) {
      const players = group.slice(0, size);
      players.forEach(p => {
        const index = queue.findIndex(q => q.id === p.id);
        if (index !== -1) queue.splice(index, 1);
      });

      const roomCode = "ROOM" + Math.floor(Math.random() * 999999);
      games[roomCode] = { players, turns: [], currentTurn: 0, picked: [] };

      // Join players to room
      players.forEach(p => io.sockets.sockets.get(p.id)?.join(roomCode));

      // Notify players match found
      io.to(roomCode).emit("match_found", { roomCode, players });

      // Start game after short delay
      setTimeout(() => {
        const game = games[roomCode];
        game.turns = [...players].sort(() => Math.random() - 0.5);
        game.currentTurn = 0;
        io.to(roomCode).emit("turn_order", game.turns);
        io.to(roomCode).emit("current_turn", game.turns[0]);
      }, 500);
    }
  });

  // Disconnect
  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);

    Object.keys(games).forEach(roomCode => {
      const game = games[roomCode];
      if (!game) return;

      game.players = game.players.filter(p => p.id !== socket.id);

      if (game.players.length === 0) {
        delete games[roomCode];
      } else {
        io.to(roomCode).emit("update_players", game.players);

        // If current turn player left, move to next turn
        if (game.turns.length > 0 && game.turns[game.currentTurn]?.id === socket.id) {
          game.currentTurn = game.currentTurn % game.turns.length;
          io.to(roomCode).emit("current_turn", game.turns[game.currentTurn]);
        }
      }
    });
  });
});

// Start server
httpServer.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
