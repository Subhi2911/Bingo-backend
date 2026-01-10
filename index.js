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
      socket.userId = userId;
      socketUserMap[socket.id] = userId;


      // MongoDB (no duplicates)
      await Room.findOneAndUpdate(
        { code: roomCode },
        {
          $setOnInsert: { status: "waiting", turn: 0, selected: [] },
          $addToSet: {
            players: {
              userId,
              socketId: socket.id,
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
          status: "playing"
        };
      }

      const game = games[roomCode];

      // Prevent duplicate users
      const existing = game.players.find((p) => p.userId === userId);
      if (existing) {
        existing.socketId = socket.id; // reconnect
        // Also update turn order socketId if user is in turns
        const turnPlayer = game.turns.find((p) => p.userId === userId);
        if (turnPlayer) turnPlayer.socketId = socket.id;
      } else {
        game.players.push({ userId, socketId: socket.id, username, avatar });
      }

      // If turn order already exists, send to this user
      if (game.turns.length) {
        socket.emit("turn_order", game.turns);
        socket.emit("current_turn", game.turns[game.currentTurn]);
      }

      // If enough players and turns not yet created, initialize turn order
      if (game.players.length >= 2 && !game.turns.length) {
        game.turns = [...game.players].sort(() => Math.random() - 0.5);
        game.currentTurn = 0;

        io.to(roomCode).emit("turn_order", game.turns);
        io.to(roomCode).emit("current_turn", game.turns[0]);
      }

      // Emit updated players
      io.to(roomCode).emit("update_players", game.players);
      console.log(game.players);
      console.log(`✅ ${username} joined room ${roomCode}`);
    } catch (err) {
      console.error(err);
      socket.emit("error", "Failed to join room");
    }
  });

  // ================= START GAME =================
  socket.on("start_game", (roomCode) => {
    const room = games[roomCode];
    if (!room || room.status === "ended") return;

    const game = games[roomCode];
    if (!game || game.turns.length) return; // Prevent reshuffle

    game.turns = [...game.players].sort(() => Math.random() - 0.5);
    game.currentTurn = 0;

    io.to(roomCode).emit("turn_order", game.turns);
    io.to(roomCode).emit("current_turn", game.turns[0]);
  });

  // ================= NUMBER PICK =================
  const TURN_TIME = 15; // seconds per turn
  const turnTimers = {}; // roomCode -> timeoutId

  // ================= NUMBER PICK =================
  socket.on("select_number", async ({ roomCode, number }) => {
    const room = games[roomCode];
    if (!room || room.status === "ended") return;

    const game = games[roomCode];
    if (!game) return;

    const current = game.turns[game.currentTurn];
    if (!current || current.socketId !== socket.id) return;

    clearTimeout(turnTimers[roomCode]); // stop existing timer

    if (!game.picked.includes(number)) {
      game.picked.push(number);

      await Room.updateOne(
        { code: roomCode },
        { $addToSet: { selected: number } }
      );
    }

    io.to(roomCode).emit("number_picked", game.picked);

    // move to next turn
    game.currentTurn = (game.currentTurn + 1) % game.turns.length;
    io.to(roomCode).emit("current_turn", game.turns[game.currentTurn]);

    if (game.status === "ended") return;
    startTurnTimer(roomCode); // start timer for next player
  });

  // ================= START TURN TIMER =================
  function startTurnTimer(roomCode) {

    const game = games[roomCode];
    if (!game || game.status === "ended" || !game.turns.length) return;

    clearTimeout(turnTimers[roomCode]);

    const currentPlayer = game.turns[game.currentTurn];
    const availableNumbers = Array.from({ length: 25 }, (_, i) => i + 1)
      .filter(n => !game.picked.includes(n));

    if (!availableNumbers.length) return; // all numbers picked

    turnTimers[roomCode] = setTimeout(() => {
      // pick random number if player didn't
      const randomNumber = availableNumbers[Math.floor(Math.random() * availableNumbers.length)];
      console.log(`Auto-picked ${randomNumber} for ${currentPlayer.username}`);

      game.picked.push(randomNumber);
      Room.updateOne({ code: roomCode }, { $addToSet: { selected: randomNumber } }).catch(console.error);

      io.to(roomCode).emit("number_picked", game.picked);

      // move to next turn
      game.currentTurn = (game.currentTurn + 1) % game.turns.length;
      io.to(roomCode).emit("current_turn", game.turns[game.currentTurn]);

      startTurnTimer(roomCode); // start next timer
    }, TURN_TIME * 1000);
  }
  // ================= GAME RESULT =================

  // socket.on("declare_win", ({ roomCode, winnerId }) => {
  //   const game = games[roomCode];
  //   if (!game || game.finished.includes(winnerId)) return;

  //   game.finished.push(winnerId);

  //   io.to(roomCode).emit("game_result", {
  //     winnerId,
  //   });

  //   console.log("🏆 Winner declared:", winnerId);
  // });

  // socket.on("game_end", ({ roomCode }) => {
  //   const room = games[roomCode];
  //   if (!room || room.status === "ended") return;

  //   if (!socket.userId) {
  //     console.error("❌ socket.userId missing");
  //     return;
  //   }

  //   // prevent duplicates
  //   if (room.finished.includes(socket.userId)) return;

  //   room.finished.push(socket.userId);

  //   // when all losers have reported
  //   if (room.finished.length === room.players.length - 1) {

  //     const winner = room.players.find(
  //       p => !room.finished.includes(p.userId)
  //     );

  //     room.status = "ended";

  //     // 🔒 STOP ALL TIMERS
  //     clearTimeout(turnTimers[roomCode]);
  //     delete turnTimers[roomCode];

  //     io.to(roomCode).emit("show_results", {
  //       winnerId: winner.userId,
  //       losers: room.finished,
  //     });
  //   }
  // });

  socket.on("game_end", async ({ roomCode, winnerId }) => {
    const game = games[roomCode];
    if (!game || game.status === "ended") return;

    game.status = "ended";

    // Stop timers
    clearTimeout(turnTimers[roomCode]);
    delete turnTimers[roomCode];

    // Broadcast results
    const losers = game.players.filter(p => p.userId !== winnerId);
    io.to(roomCode).emit("show_results", {
      winnerId,
      losers: losers.map(l => l.userId)
    });

    // ==== CLEANUP ====
    // Remove room from in-memory games
    //delete games[roomCode];

    // Remove players from queue if they are trying to rejoin
    //queue = queue.filter(p => !game.players.some(gp => gp.userId === p.userId));

    // Optional: mark MongoDB room as ended
    await Room.updateOne({ code: roomCode }, { status: "ended" }).catch(console.error);
  });

  const readyPlayers = {};
  function restartGame(roomCode) {
    const game = games[roomCode];
    if (!game) return;

    game.status = "playing";
    game.picked = [];
    game.finished = [];

    game.turns = [...game.players].sort(() => Math.random() - 0.5);
    game.currentTurn = 0;

    io.to(roomCode).emit("restart_game", {
      turns: game.turns,
      currentTurn: game.turns[0],
    });

    startTurnTimer(roomCode);
  }


  socket.on("player_ready", ({ roomCode, userId }) => {
    const game = games[roomCode];
    if (!game || game.status !== "ended") return;

    // Make sure the room exists in readyPlayers
    if (!readyPlayers[roomCode]) {
      readyPlayers[roomCode] = {};
    }

    // ✅ Mark this user as ready without overwriting others
    readyPlayers[roomCode][userId] = true;

    // Broadcast ready update
    io.to(roomCode).emit("ready_update", {
      readyPlayers: { ...readyPlayers[roomCode] }, // send a copy
    });

    // Check if all players are ready
    const allReady = game.players.every(
      (p) => readyPlayers[roomCode][p.userId]
    );

    if (allReady) {
      readyPlayers[roomCode] = {}; // clear after game restart
      restartGame(roomCode);
    }
  });

  // ================= MATCHMAKING =================
  socket.on("find_match", async ({ userId, username, avatar = "", size }) => {

    const alreadyQueued = queue.find((p) => p.userId === userId);
    if (!alreadyQueued) {
      queue.push({ socketId: socket.id, userId, username, avatar, size });
    }

    const group = queue
      .filter((p) => p.size === size)
      .filter((p, i, arr) => arr.findIndex((x) => x.userId === p.userId) === i);

    if (group.length >= size) {
      const players = group.slice(0, size);
      players.forEach((p) => {
        const i = queue.findIndex((q) => q.socketId === p.socketId);
        if (i !== -1) queue.splice(i, 1);
      });

      const roomCode = "ROOM" + Math.floor(Math.random() * 999999);
      games[roomCode] = { players, turns: [], currentTurn: 0, picked: [], finished: [] };

      await Room.create({
        code: roomCode,
        players: players.map((p) => ({ userId: p.userId, username: p.username, avatar: p.avatar })),
        status: "waiting",
        turn: 0,
        selected: [],
      });

      players.forEach((p) => io.sockets.sockets.get(p.socketId)?.join(roomCode));

      // Notify each player
      players.forEach((p) => {
        io.to(p.socketId).emit("match_found", {
          roomCode,
          players: players.map((x) => ({ userId: x.userId, username: x.username, avatar: x.avatar })),
        });
      });

      // Initialize turn order if not yet created
      const game = games[roomCode];
      if (!game.turns.length) {
        game.turns = [...game.players].sort(() => Math.random() - 0.5);
        game.currentTurn = 0;
        io.to(roomCode).emit("turn_order", game.turns);
        io.to(roomCode).emit("current_turn", game.turns[0]);
      }
    }
  });

  // ================= DISCONNECT =================
  socket.on("disconnect", async () => {
    console.log("❌ User disconnected:", socket.id);

    const userId = socketUserMap[socket.id];
    delete socketUserMap[socket.id];

    if (!userId) return;

    await Room.updateOne({ "players.userId": userId }, { $pull: { players: { userId } } }).catch(console.error);

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
    Object.keys(readyPlayers).forEach(room => {
      if (readyPlayers[room][socketUserMap[socket.id]]) {
        delete readyPlayers[room][socketUserMap[socket.id]];
      }
    });
  });
});

// ================= START SERVER =================
httpServer.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
