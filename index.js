const games = {};
let queue = [];
const socketUserMap = {}; // socket.id -> userId

require("dotenv").config({ path: ".env.local" });

const express = require("express");
const cors = require("cors");
const connectToMongo = require("./db");
const { createServer } = require("http");
const { Server } = require("socket.io");
const Room = require("./models/Room");

// Initialize Express
const app = express();
const port = 5000;

// HTTP server
const httpServer = createServer(app);

// Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: ["http://localhost:8081"],
    credentials: true,
  },
});

// MongoDB
connectToMongo();

// Middleware
app.use(cors({ origin: ["http://localhost:8081"], credentials: true }));
app.use(express.json());

// Routes
app.use("/api/auth", require("./routes/auth"));
app.use("/api/emailverification", require("./routes/emailverification"));
app.use("/api/games", require("./routes/gameRoutes"));

// ================= SOCKET.IO =================
io.on("connection", (socket) => {
  console.log("🟢 User connected:", socket.id);

  // ================= JOIN ROOM =================
  socket.on("join_room", async ({ roomCode, userId, username, avatar = "" }) => {
    try {
      socket.join(roomCode);
      socketUserMap[socket.id] = userId;

      // MongoDB (no duplicates)
      await Room.findOneAndUpdate(
        { code: roomCode },
        {
          $setOnInsert: { status: "waiting", turn: 0, selected: [] },
          $addToSet: {
            players: {
              userId,
              username,
              avatar,
            },
          },
        },
        { upsert: true, new: true }
      );

      // In-memory game
      if (!games[roomCode]) {
        games[roomCode] = {
          players: [],
          turns: [],
          currentTurn: 0,
          picked: [],
          finished: [],
        };
      }

      // Prevent duplicate users
      const existing = games[roomCode].players.find(
        (p) => p.userId === userId
      );

      if (existing) {
        existing.socketId = socket.id; // reconnect case
      } else {
        games[roomCode].players.push({
          userId,
          socketId: socket.id,
          username,
        });
      }

      io.to(roomCode).emit("update_players", games[roomCode].players);

      console.log(`✅ ${username} joined room ${roomCode}`);
    } catch (err) {
      console.error(err);
      socket.emit("error", "Failed to join room");
    }
  });

  // ================= START GAME =================
  socket.on("start_game", (roomCode) => {
    const game = games[roomCode];
    if (!game) return;

    game.turns = [...game.players].sort(() => Math.random() - 0.5);
    game.currentTurn = 0;

    io.to(roomCode).emit("turn_order", game.turns);
    io.to(roomCode).emit("current_turn", game.turns[0]);
  });

  // ================= NUMBER PICK =================
  socket.on("select_number", async ({ roomCode, number }) => {
    const game = games[roomCode];
    if (!game) return;

    const current = game.turns[game.currentTurn];
    if (!current || current.socketId !== socket.id) return;

    if (!game.picked.includes(number)) {
      game.picked.push(number);

      await Room.updateOne(
        { code: roomCode },
        { $addToSet: { selected: number } }
      );
    }

    io.to(roomCode).emit("number_picked", game.picked);

    game.currentTurn = (game.currentTurn + 1) % game.turns.length;
    io.to(roomCode).emit("current_turn", game.turns[game.currentTurn]);
  });

  // ================= MATCHMAKING =================
  socket.on("find_match", async ({ userId, username, avatar = "", size }) => {
    const alreadyQueued = queue.find(p => p.userId === userId);
    if (!alreadyQueued) {
      queue.push({ socketId: socket.id, userId, username, avatar, size });
    }

    const group = queue
      .filter(p => p.size === size)
      .filter(
        (p, i, arr) =>
          arr.findIndex(x => x.userId === p.userId) === i
      );

    console.log(
      "MATCH GROUP:",
      group.map(p => p.username)
    );

    if (group.length >= size) {
      const players = group.slice(0, size);

      players.forEach((p) => {
        const i = queue.findIndex((q) => q.socketId === p.socketId);
        if (i !== -1) queue.splice(i, 1);
      });

      const roomCode = "ROOM" + Math.floor(Math.random() * 999999);

      games[roomCode] = {
        players,
        turns: [],
        currentTurn: 0,
        picked: [],
        finished: [],
      };

      await Room.create({
        code: roomCode,
        players: players.map((p) => ({
          userId: p.userId,
          username: p.username,
          avatar: p.avatar,  // now avatar is included
        })),
        status: "waiting",
        turn: 0,
        selected: [],
      });


      players.forEach((p) =>
        io.sockets.sockets.get(p.socketId)?.join(roomCode)
      );
      console.log(players);
      players.forEach((p) => {
        io.to(p.socketId).emit("match_found", {
          roomCode,
          players: players.map(x => ({
            userId: x.userId,
            username: x.username,
            avatar: x.avatar
          }))
        });
      });

      setTimeout(() => {
        const game = games[roomCode];
        game.turns = [...players].sort(() => Math.random() - 0.5);
        game.currentTurn = 0;

        io.to(roomCode).emit("turn_order", game.turns);
        io.to(roomCode).emit("current_turn", game.turns[0]);
      }, 500);
    }
  });

  // ================= DISCONNECT =================
  socket.on("disconnect", async () => {
    console.log("❌ User disconnected:", socket.id);

    const userId = socketUserMap[socket.id];
    delete socketUserMap[socket.id];

    if (!userId) return;

    await Room.updateOne(
      { "players.userId": userId },
      { $pull: { players: { userId } } }
    ).catch(console.error);

    Object.keys(games).forEach((roomCode) => {
      const game = games[roomCode];
      if (!game) return;

      game.players = game.players.filter((p) => p.userId !== userId);
      game.turns = game.turns.filter((p) => p.userId !== userId);

      if (game.players.length === 0) {
        delete games[roomCode];
      } else {
        io.to(roomCode).emit("update_players", game.players);
      }
    });
  });
});

// ================= START SERVER =================
httpServer.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
