/* eslint-disable no-shadow */
const games = {};
let queue = [];
const privateRooms = {};
const socketUserMap = {}; // socket.id -> userId

require("dotenv").config({ path: ".env.local" });

const express = require("express");
const cors = require("cors");
const connectToMongo = require("./db");
const Notification = require("./models/Notification");
const { createServer } = require("http");
const { Server } = require("socket.io");
const Room = require("./models/Room");
const { decrypt } = require("./utils/encryption");
const safeDecrypt = (text) => {
  try {
    if (!text || !text.includes(":")) return text;
    return decrypt(text);
  } catch (err) {
    console.error("Decrypt failed:", err.message, "for text:", text);
    return text;
  }
};
const Chat = require("./models/Chat");
const activeChats = {}; // chatId -> Set of socketIds

const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});


// ─────────────────────────────────────────────
// POWER DEFINITIONS
// ─────────────────────────────────────────────
const POWER_GROUPS = {
  EXTRA_TURN: ["Swift Dash", "Pack Howl", "Dominance", "Blood Frenzy", "Panic Flap"],
  FREE_MARK: ["Shadow Step", "Mega Jump"],
  RANDOM_MARK: ["Tree Leap", "Tracker Sense", "Charge Run"],
  FREEZE: ["Fear Aura", "Hoof Strike", "Venom Bite"],
  IMMUNITY: ["Loyal Guard", "Iron Hide", "Steadfast"],
  REMOVE_MARK: ["Silent Claws", "Ambush Pounce", "Sneak Bite", "Sticky Tongue", "Egg Bomb", "Ground Slam"],
  REFLECT: ["Nine Lives", "Poison Skin", "Feather Shield", "Tiny Target"],
  NOT_IMPLEMENTED: ["Mischief Steal", "King's Roar", "Predator Focus", "Illusion Clone",
    "Trick Swap", "Mind Games", "Quick Escape", "Coil Trap", "Heat Sense"],
};

const getPowerGroup = (power) => {
  for (const [group, powers] of Object.entries(POWER_GROUPS)) {
    if (powers.includes(power)) return group;
  }
  return null;
};

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
app.set("io", io);

// MongoDB
connectToMongo();

// Middleware
app.use(cors({ origin: ["http://localhost:8081"], credentials: true }));
app.use(express.json());

// Routes
app.use("/api/auth", require("./routes/auth"));
app.use("/api/emailverification", require("./routes/emailverification"));
app.use("/api/games", require("./routes/gameRoutes"));
app.use("/api/chat", require("./routes/chat"));
app.use("/api/messages", require("./routes/messages"));
app.use("/api/rooms", require("./routes/rooms"));
app.use("/api/notifications", require("./routes/notification"));
app.use('/api/spin', require("./routes/spin"));

// ─────────────────────────────────────────────
// SOCKET.IO
// ─────────────────────────────────────────────
const onlineUsers = {};
app.set("onlineUsers", onlineUsers);

const generateRoomCode = () =>
  Math.random().toString(36).substring(2, 8).toUpperCase();

// ─────────────────────────────────────────────
// TURN TIMER HELPERS  (defined outside io.on so
// startTurnTimer is reachable from power handler)
// ─────────────────────────────────────────────
const GAME_RULES = {
  classic: { TURN_TIME: 15 },
  fast: { TURN_TIME: 5 },
};
const turnTimers = {}; // roomCode -> timeoutId

// socket.id -> chatId

function startTurnTimer(roomCode) {
  const game = games[roomCode];

  if (!game || game.status === "ended" || !game.turns.length) {
    return;
  }

  clearTimeout(turnTimers[roomCode]);

  const currentPlayer = game.turns[game.currentTurn];

  const availableNumbers = Array.from(
    { length: 25 },
    (_, i) => i + 1
  ).filter(n => !game.picked.includes(n));

  if (!availableNumbers.length) {
    return;
  }

  // Initialize missed turns tracker
  if (!game.missedTurns) {
    game.missedTurns = {};
  }

  const misses = game.missedTurns[currentPlayer.userId] || 0;

  // Normal game timer
  const defaultTurnTime =
    GAME_RULES[game.gameType]?.TURN_TIME || 15;

  // AFK penalty after 3 missed turns
  const turnTime =
    misses >= 3
      ? Math.min(5, defaultTurnTime)
      : defaultTurnTime;

  // Handle frozen player
  const effect = game.effects?.[currentPlayer.userId];

  if (
    effect?.frozenUntil &&
    effect.frozenUntil > Date.now()
  ) {
    game.currentTurn =
      (game.currentTurn + 1) % game.turns.length;

    io.to(roomCode).emit(
      "current_turn",
      game.turns[game.currentTurn]
    );

    startTurnTimer(roomCode);
    return;
  }

  turnTimers[roomCode] = setTimeout(() => {
    const randomNumber =
      availableNumbers[
      Math.floor(Math.random() * availableNumbers.length)
      ];

    game.picked.push(randomNumber);

    // Increase missed turn count
    game.missedTurns[currentPlayer.userId] =
      (game.missedTurns[currentPlayer.userId] || 0) + 1;

    // Optional AFK notification
    if (game.missedTurns[currentPlayer.userId] === 3) {
      io.to(roomCode).emit("player_afk", {
        userId: currentPlayer.userId,
      });
    }

    // Track marked number
    if (!game.playerMarkedNumbers) {
      game.playerMarkedNumbers = {};
    }

    if (!game.playerMarkedNumbers[currentPlayer.userId]) {
      game.playerMarkedNumbers[currentPlayer.userId] = [];
    }

    game.playerMarkedNumbers[currentPlayer.userId].push(
      randomNumber
    );

    Room.updateOne(
      { code: roomCode },
      { $addToSet: { selected: randomNumber } }
    ).catch(console.error);

    io.to(roomCode).emit(
      "number_picked",
      game.picked
    );

    game.currentTurn =
      (game.currentTurn + 1) % game.turns.length;

    io.to(roomCode).emit(
      "current_turn",
      game.turns[game.currentTurn]
    );

    startTurnTimer(roomCode);
  }, turnTime * 1000);
}

// ─────────────────────────────────────────────
// POWER HANDLER  (pure function, called inside
// the socket's "use_power" listener)
// ─────────────────────────────────────────────
function handleUsePower(socket, io, { roomCode, userId, power, group, targetId, number }) {
  const game = games[roomCode];

  // ── Validation ────────────────────────────
  if (!game) return socket.emit("power_failed", { reason: "Room not found" });
  if (game.status === "ended") return socket.emit("power_failed", { reason: "Game has ended" });
  if (!game.powerUsed) game.powerUsed = {};
  if (!game.effects) game.effects = {};
  if (!game.playerMarkedNumbers) game.playerMarkedNumbers = {};

  if (game.powerUsed[userId])
    return socket.emit("power_failed", { reason: "Power already used" });

  const resolvedGroup = group || getPowerGroup(power);
  if (!resolvedGroup)
    return socket.emit("power_failed", { reason: "Unknown power" });

  // ── NOT_IMPLEMENTED placeholder ──────────
  if (resolvedGroup === "NOT_IMPLEMENTED") {
    game.powerUsed[userId] = true;
    socket.emit("power_not_implemented", { power });
    return;
  }

  // ── Helper: apply negative effect with immunity / reflect checks ──
  const applyNegativeEffect = (effFn, reflectFn) => {
    if (!targetId) return socket.emit("power_failed", { reason: "No target selected" });

    const targetEffect = game.effects[targetId] || {};

    // IMMUNITY check
    if (targetEffect.immuneUntil && targetEffect.immuneUntil > Date.now()) {
      socket.emit("power_failed", { reason: "Target is immune" });
      return false;
    }

    // REFLECT check
    if (targetEffect.reflectNext) {
      game.effects[targetId].reflectNext = false;
      // Reflect back onto caster
      effFn(userId);
      io.to(roomCode).emit("power_reflected", {
        power,
        reflectedFrom: targetId,
        reflectedTo: userId,
      });
      game.powerUsed[userId] = true;
      io.to(roomCode).emit("power_used", {
        power, userId, group: resolvedGroup,
        message: `↩ ${power} reflected back on user!`,
      });
      return false; // signal that reflect happened
    }

    // Normal application
    effFn(targetId);
    return true;
  };

  // ── GROUP HANDLERS ────────────────────────

  // GROUP 1 — EXTRA TURN
  if (resolvedGroup === "EXTRA_TURN") {
    const playerIndex = game.turns.findIndex(p => p.userId === userId);
    if (playerIndex === -1) return socket.emit("power_failed", { reason: "Player not found" });

    clearTimeout(turnTimers[roomCode]);
    game.currentTurn = playerIndex;
    game.powerUsed[userId] = true;

    io.to(roomCode).emit("current_turn", game.turns[game.currentTurn]);
    io.to(roomCode).emit("extra_turn", { playerId: userId });
    io.to(roomCode).emit("power_used", {
      power, userId, group: resolvedGroup,
      message: `⚡ ${power} — extra turn granted!`,
    });
    startTurnTimer(roomCode);
    return;
  }

  // GROUP 2 — FREE MARK
  if (resolvedGroup === "FREE_MARK") {
    if (number === undefined || number === null)
      return socket.emit("power_failed", { reason: "No number selected" });

    if (game.picked.includes(number))
      return socket.emit("power_failed", { reason: "Number already picked" });

    game.picked.push(number);
    if (!game.playerMarkedNumbers[userId]) game.playerMarkedNumbers[userId] = [];
    game.playerMarkedNumbers[userId].push(number);
    game.powerUsed[userId] = true;

    Room.updateOne({ code: roomCode }, { $addToSet: { selected: number } }).catch(console.error);

    io.to(roomCode).emit("number_picked", game.picked);
    io.to(roomCode).emit("power_used", {
      power, userId, group: resolvedGroup,
      message: `👣 ${power} — free mark on ${number}!`,
    });
    return;
  }

  // GROUP 3 — RANDOM MARK
  if (resolvedGroup === "RANDOM_MARK") {
    // Find player's unmarked numbers (numbers 1-25, not yet picked)
    const allUnpicked = Array.from({ length: 25 }, (_, i) => i + 1)
      .filter(n => !game.picked.includes(n));

    if (!allUnpicked.length)
      return socket.emit("power_failed", { reason: "No numbers left to mark" });

    const randomNum = allUnpicked[Math.floor(Math.random() * allUnpicked.length)];
    game.picked.push(randomNum);
    if (!game.playerMarkedNumbers[userId]) game.playerMarkedNumbers[userId] = [];
    game.playerMarkedNumbers[userId].push(randomNum);
    game.powerUsed[userId] = true;

    Room.updateOne({ code: roomCode }, { $addToSet: { selected: randomNum } }).catch(console.error);

    io.to(roomCode).emit("number_picked", game.picked);
    io.to(roomCode).emit("power_used", {
      power, userId, group: resolvedGroup,
      message: `🎲 ${power} — random mark on ${randomNum}!`,
    });
    return;
  }

  // GROUP 4 — FREEZE
  if (resolvedGroup === "FREEZE") {
    const applied = applyNegativeEffect(
      (tid) => {
        const frozenUntil = Date.now() + 5000;
        if (!game.effects[tid]) game.effects[tid] = {};
        game.effects[tid].frozenUntil = frozenUntil;

        // Find target username
        const targetPlayer = game.turns.find(p => p.userId === tid);

        io.to(roomCode).emit("player_frozen", {
          targetId: tid,
          frozenUntil,
          message: `❄ ${power} froze ${targetPlayer?.username || "a player"} for 5s`,
        });
        io.to(roomCode).emit("power_effect", {
          effect: "frozenUntil", targetId: tid, value: frozenUntil,
        });
      }
    );
    if (applied !== false) {
      game.powerUsed[userId] = true;
      io.to(roomCode).emit("power_used", {
        power, userId, group: resolvedGroup,
        message: `❄ ${power} activated`,
      });
    }
    return;
  }

  // GROUP 5 — IMMUNITY
  if (resolvedGroup === "IMMUNITY") {
    const immuneUntil = Date.now() + 15000;
    if (!game.effects[userId]) game.effects[userId] = {};
    game.effects[userId].immuneUntil = immuneUntil;
    game.powerUsed[userId] = true;

    io.to(roomCode).emit("player_immune", {
      userId,
      immuneUntil,
      message: `🛡 ${power} — immune for 15s!`,
    });
    io.to(roomCode).emit("power_effect", {
      effect: "immuneUntil", targetId: userId, value: immuneUntil,
    });
    io.to(roomCode).emit("power_used", {
      power, userId, group: resolvedGroup,
      message: `🛡 ${power} activated`,
    });
    return;
  }

  // GROUP 6 — REMOVE MARK
  if (resolvedGroup === "REMOVE_MARK") {
    const applied = applyNegativeEffect(
      (tid) => {
        const markedByTarget = game.playerMarkedNumbers[tid];
        if (!markedByTarget || !markedByTarget.length) {
          socket.emit("power_failed", { reason: "Target has no marked numbers" });
          return;
        }

        // Remove latest marked number
        const removedNumber = markedByTarget.pop();
        const idx = game.picked.lastIndexOf(removedNumber);
        if (idx !== -1) game.picked.splice(idx, 1);

        Room.updateOne({ code: roomCode }, { $pull: { selected: removedNumber } }).catch(console.error);

        io.to(roomCode).emit("number_picked", game.picked);
        io.to(roomCode).emit("mark_removed", {
          targetId: tid,
          number: removedNumber,
        });

        const targetPlayer = game.turns.find(p => p.userId === tid);
        io.to(roomCode).emit("power_used", {
          power, userId, group: resolvedGroup,
          message: `💥 ${power} removed ${targetPlayer?.username || "a player"}'s mark`,
        });
      }
    );
    if (applied !== false) {
      game.powerUsed[userId] = true;
    }
    return;
  }

  // GROUP 7 — REFLECT / SHIELD
  if (resolvedGroup === "REFLECT") {
    if (!game.effects[userId]) game.effects[userId] = {};
    game.effects[userId].reflectNext = true;
    game.powerUsed[userId] = true;

    io.to(roomCode).emit("power_effect", {
      effect: "reflectNext", targetId: userId, value: true,
    });
    io.to(roomCode).emit("power_used", {
      power, userId, group: resolvedGroup,
      message: `↩ ${power} — next attack will be reflected!`,
    });
    return;
  }

  socket.emit("power_failed", { reason: "Unknown power group" });
}

// ─────────────────────────────────────────────
// CONNECTION
// ─────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log("🟢 User connected:", socket.id);

  socket.on("userOnline", (userId) => {
    onlineUsers[userId] = socket.id;
    io.emit("updateOnlineUsers", Object.keys(onlineUsers));
  });

  // ─────────────────────────────────────────
  // JOIN ROOM
  // ─────────────────────────────────────────
  socket.on("join_room", async ({ roomCode, userId, username, avatar = "", gameType }) => {
    try {
      socket.join(roomCode);
      socket.userId = userId;
      socketUserMap[socket.id] = userId;

      if (!games[roomCode]) {
        games[roomCode] = {
          players: [],
          turns: [],
          currentTurn: 0,
          picked: [],
          finished: [],
          status: "playing",
          gameType: "",
          powerUsed: {},
          effects: {},
          playerMarkedNumbers: {},
          missedTurns: 0,
        };
      }

      const game = games[roomCode];

      // Ensure power fields exist on older rooms
      if (!game.powerUsed) game.powerUsed = {};
      if (!game.effects) game.effects = {};
      if (!game.playerMarkedNumbers) game.playerMarkedNumbers = {};

      const existing = game.players.find((p) => p.userId === userId);
      if (existing) {
        existing.socketId = socket.id;
        const turnPlayer = game.turns.find((p) => p.userId === userId);
        if (turnPlayer) turnPlayer.socketId = socket.id;
      } else {
        game.players.push({ userId, socketId: socket.id, username, avatar, gameType });
      }

      if (game.turns.length) {
        socket.emit("turn_order", game.turns);
        socket.emit("current_turn", game.turns[game.currentTurn]);
      }

      if (game.players.length >= 2 && !game.turns.length) {
        game.turns = [...game.players].sort(() => Math.random() - 0.5);
        game.currentTurn = 0;
        io.to(roomCode).emit("turn_order", game.turns);
        io.to(roomCode).emit("current_turn", game.turns[0]);
      }

      io.to(roomCode).emit("update_players", game.players);
      console.log(`✅ ${username} joined room ${roomCode}`);
    } catch (err) {
      console.error(err);
      socket.emit("error", "Failed to join room");
    }
  });

  // ─────────────────────────────────────────
  // START GAME
  // ─────────────────────────────────────────
  socket.on("start_game", (roomCode) => {
    const room = games[roomCode];
    if (!room || room.status === "ended") return;
    const game = games[roomCode];
    if (!game || game.turns.length) return;
    game.turns = [...game.players].sort(() => Math.random() - 0.5);
    game.currentTurn = 0;
    io.to(roomCode).emit("turn_order", game.turns);
    io.to(roomCode).emit("current_turn", game.turns[0]);
  });

  socket.on("online_status", ({ userId, isOnline }) => {
    const onlinePlayers = Object.values(socketUserMap).filter((id) => id === userId);
    const status = onlinePlayers.length > 0;
    io.emit("user_online_status", { userId, isOnline: status });
  });

  // ─────────────────────────────────────────
  // NUMBER PICK
  // ─────────────────────────────────────────
  socket.on("select_number", async ({ roomCode, number }) => {
    const room = games[roomCode];
    if (!room || room.status === "ended") return;

    const game = games[roomCode];
    if (!game) return;

    if (!game.missedTurns) {
      game.missedTurns = {};
    }


    const current = game.turns[game.currentTurn];
    if (!current || current.socketId !== socket.id) return;

    // Player acted manually, reset AFK counter
    game.missedTurns[current.userId] = 0;


    // Check frozen
    const fx = game.effects?.[current.userId];
    if (fx?.frozenUntil && fx.frozenUntil > Date.now()) {
      socket.emit("power_failed", { reason: "You are frozen!" });
      return;
    }

    clearTimeout(turnTimers[roomCode]);

    if (!game.picked.includes(number)) {
      game.picked.push(number);

      // Track who marked this number
      if (!game.playerMarkedNumbers) game.playerMarkedNumbers = {};
      if (!game.playerMarkedNumbers[current.userId]) game.playerMarkedNumbers[current.userId] = [];
      game.playerMarkedNumbers[current.userId].push(number);

      await Room.updateOne(
        { code: roomCode },
        { $addToSet: { selected: number } }
      );
    }

    io.to(roomCode).emit("number_picked", game.picked);

    game.currentTurn = (game.currentTurn + 1) % game.turns.length;
    io.to(roomCode).emit("current_turn", game.turns[game.currentTurn]);

    if (game.status === "ended") return;
    startTurnTimer(roomCode);
  });

  // ─────────────────────────────────────────
  // USE POWER  ← primary new handler
  // ─────────────────────────────────────────
  socket.on("use_power", (payload) => {
    handleUsePower(socket, io, payload);
  });

  // ─────────────────────────────────────────
  // GAME END
  // ─────────────────────────────────────────
  socket.on("game_end", async ({ roomCode, winnerId }) => {
    const game = games[roomCode];
    if (!game || game.status === "ended") return;

    game.status = "ended";
    clearTimeout(turnTimers[roomCode]);
    delete turnTimers[roomCode];

    const losers = game.players.filter(p => p.userId !== winnerId);
    io.to(roomCode).emit("show_results", {
      winnerId,
      losers: losers.map(l => l.userId),
    });

    const winner = game.players.find(p => p.userId === winnerId);
    if (!winner) {
      console.error(`Winner not found for room ${roomCode}.`);
      return;
    }

    try {
      await Room.updateOne(
        { code: roomCode },
        {
          $set: {
            status: "ended",
            winner: { userId: winner.userId, username: winner.username, avatar: winner.avatar },
          },
        }
      );
    } catch (err) {
      console.error("Failed to save winner:", err);
    }
  });

  // ─────────────────────────────────────────
  // RESTART GAME
  // ─────────────────────────────────────────
  const readyPlayers = {};

  function restartGame(roomCode) {
    const game = games[roomCode];
    if (!game) return;
    game.status = "playing";
    game.picked = [];
    game.finished = [];
    game.powerUsed = {};
    game.effects = {};
    game.playerMarkedNumbers = {};
    game.turns = [...game.players].sort(() => Math.random() - 0.5);
    game.currentTurn = 0;
    game.missedTurns = 0;
    io.to(roomCode).emit("restart_game", { turns: game.turns, currentTurn: game.turns[0] });
    startTurnTimer(roomCode);
  }

  socket.on("player_ready", ({ roomCode, userId }) => {
    const game = games[roomCode];
    if (!game || game.status !== "ended") return;
    if (!readyPlayers[roomCode]) readyPlayers[roomCode] = {};
    readyPlayers[roomCode][userId] = true;
    io.to(roomCode).emit("ready_update", { readyPlayers: { ...readyPlayers[roomCode] } });
    const allReady = game.players.every(p => readyPlayers[roomCode][p.userId]);
    if (allReady) {
      readyPlayers[roomCode] = {};
      restartGame(roomCode);
    }
  });

  // ─────────────────────────────────────────
  // MATCHMAKING
  // ─────────────────────────────────────────
  socket.on("find_match", async ({ userId, username, avatar = "", size, gameType, selectedPower = "" }) => {
    const alreadyQueued = queue.find((p) => p.userId === userId);
    if (!alreadyQueued) {
      queue.push({ socketId: socket.id, userId, username, avatar, size, gameType, selectedPower });
    }

    const group = queue
      .filter((p) => p.size === size)
      .filter((p) => p.gameType === gameType)
      .filter((p, i, arr) => arr.findIndex((x) => x.userId === p.userId) === i);

    if (group.length >= size) {
      const players = group.slice(0, size);
      players.forEach((p) => {
        const i = queue.findIndex((q) => q.socketId === p.socketId);
        if (i !== -1) queue.splice(i, 1);
      });

      const roomCode = generateRoomCode();
      games[roomCode] = {
        players,
        turns: [],
        currentTurn: 0,
        picked: [],
        status: "playing",
        finished: [],
        gameType,
        powerUsed: {},
        effects: {},
        playerMarkedNumbers: {},
        missedTurns: 0,
      };

      await Room.create({
        code: roomCode,
        players: players.map((p) => ({ userId: p.userId, username: p.username, avatar: p.avatar })),
        status: "waiting",
        turn: 0,
        selected: [],
        gameType,
        powerUsed: false,
      });

      players.forEach((p) => io.sockets.sockets.get(p.socketId)?.join(roomCode));
      players.forEach((p) => {
        io.to(p.socketId).emit("match_found", {
          roomCode,
          players: players.map((x) => ({ userId: x.userId, username: x.username, avatar: x.avatar })),
        });
      });

      const game = games[roomCode];
      if (!game.turns.length) {
        game.turns = [...game.players].sort(() => Math.random() - 0.5);
        game.currentTurn = 0;
        io.to(roomCode).emit("turn_order", game.turns);
        io.to(roomCode).emit("current_turn", game.turns[0]);
      }
    }
  });

  // ─────────────────────────────────────────
  // PRIVATE ROOMS
  // ─────────────────────────────────────────
  socket.on("create_private_room", async ({ size, userId, username, avatar, gameType, password }) => {
    try {
      const roomCode = generateRoomCode();
      const players = [{ socketId: socket.id, userId, username, avatar, ready: true, isAdmin: true }];
      privateRooms[roomCode] = { roomCode, size, hostId: userId, gameType, password: password || null, players };

      await Room.create({
        code: roomCode,
        players: players.map(p => ({ userId: p.userId, username: p.username, avatar: p.avatar, socketId: p.socketId })),
        size,
        status: "waiting",
        turn: 0,
        selected: [],
        gameType,
        isPrivate: true,
        password,
      });

      socket.join(roomCode);
      socket.emit("private_room_created", { roomCode, players });
    } catch (err) {
      console.error("❌ Private room creation failed:", err);
      socket.emit("error", "Failed to create private room");
    }
  });

  socket.on("invite_to_private_room", ({ receiverId, payload }) => {
    const receiverSocketId = onlineUsers[receiverId];
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("private_room_invite", { fromUser: socket.userId, ...payload });
    }
  });

  socket.on("join_private_room", ({ roomCode, userId, username, avatar }) => {
    const room = privateRooms[roomCode];
    if (!room) return;
    socket.join(roomCode);
    const player = room.players.find(p => p.userId === userId);
    if (player) {
      player.socketId = socket.id;
      player.username = username;
      player.avatar = avatar;
    } else {
      room.players.push({ userId, username, avatar, ready: false, isAdmin: false, socketId: socket.id });
    }
    io.to(roomCode).emit("private_room_updated", { roomCode, players: room.players });
  });

  socket.on("private_player_ready", ({ userId, roomCode }) => {
    const room = privateRooms[roomCode];
    if (!room) return;
    const player = room.players.find(p => p.userId.toString() === userId);
    if (!player) return;
    player.ready = !player.ready;
    io.to(roomCode).emit("private_room_updated", { roomCode, players: room.players });
  });

  socket.on("start_private_game", ({ roomCode }) => {
    const room = privateRooms[roomCode];
    if (!room) return;
    const allReady = room.players.length === room.size && room.players.every(p => p.ready);
    if (!allReady) return;

    games[roomCode] = {
      players: room.players.map(p => ({ userId: p.userId, username: p.username, avatar: p.avatar, socketId: p.socketId })),
      turns: [],
      currentTurn: 0,
      picked: [],
      finished: [],
      status: "playing",
      gameType: room.gameType,
      powerUsed: {},
      effects: {},
      playerMarkedNumbers: {},
      missedTurns: 0,
    };

    const game = games[roomCode];
    game.turns = [...game.players].sort(() => Math.random() - 0.5);
    game.currentTurn = 0;

    io.to(roomCode).emit("private_game_started", {
      roomCode, gameType: game.gameType, players: game.players, turns: game.turns,
    });
    io.to(roomCode).emit("turn_order", game.turns);
    io.to(roomCode).emit("current_turn", game.turns[0]);
    startTurnTimer(roomCode);
  });

  // ─────────────────────────────────────────
  // CHAT
  // ─────────────────────────────────────────
  socket.on("joinChat", (chatId) => {
    socket.join(chatId);
  });
  socket.on("active_chat", ({ chatId }) => {
    activeChats[socket.id] = chatId;
  });

  socket.on("leave_active_chat", () => {
    delete activeChats[socket.id];
  });

  socket.on("sendMessage", async (message) => {
    const decryptedMessage = { ...message, text: safeDecrypt(message.text) };
    socket.to(message.chatId).emit("receiveMessage", decryptedMessage);

    const chat = await Chat.findById(message.chatId);
    const receivers = chat.participants.filter(
      // ✅ FIX: normalize both sides to strings so ObjectId vs string never mismatches
      p => p.toString() !== message?.sender._id?.toString()
    );

    receivers.forEach(userId => {
      // ✅ FIX: stringify the ObjectId before looking up in onlineUsers
      const socketId = onlineUsers[userId.toString()];
      if (!socketId) return; // user is offline — no notification needed

      // ✅ activeChats is now the shared module-level map, so this lookup
      //    correctly reflects what the *receiver's* socket registered
      const isInSameChat = activeChats[socketId] === message.chatId;

      if (!isInSameChat) {
        io.to(socketId).emit("newNotification", {
          type: "message",
          title: message.senderName,
          body: decryptedMessage.text.length > 100 ? decryptedMessage.text.substring(0, 100) + "..." : decryptedMessage.text,
          chatId: message.chatId,
          sender: {
            _id: message.sender._id,
            username: message.sender.username,
            avatar: message.sender.avatar,
          },
        });
      }
    });
    const User = require("./models/User");

    for (const userId of receivers) {
      const receiver = await User.findById(userId);
      if (!receiver?.fcmToken) continue;

      try {
        await admin.messaging().send({
          token: receiver.fcmToken,
          notification: {
            title: `Message From ${message.sender.username}`,
            body: decryptedMessage.text,
          },
          data: {
            chatId: message.chatId.toString(),
            senderId: message.sender._id.toString(),
            senderUsername: message.sender.username,
            senderAvatar: message.sender.avatar || "",
            type: "message",
          },
          // ✅ Android: high priority + channel so it shows in drawer when killed
          android: {
            priority: "high",
            notification: {
              channelId: "default",
              sound: "default",
              priority: "high",
              defaultSound: true,
              defaultVibrateTimings: true,
            },
          },
          // ✅ iOS: sound when killed
          apns: {
            payload: {
              aps: {
                sound: "default",
                badge: 1,
              },
            },
            headers: {
              "apns-priority": "10",
            },
          },
        });
        console.log("✅ Push sent to", receiver.username);
      } catch (err) {
        console.error("❌ Push failed:", err.message);
      }
    }
  });


  socket.on("join_chat_room", (roomCode) => {
    socket.join(roomCode);
  });

  socket.on("send_message", (data) => {
    const { roomCode, username, text } = data;
    io.to(roomCode).emit("receive_message", { username, text, time: new Date().toISOString() });
  });

  // ─────────────────────────────────────────
  // DISCONNECT
  // ─────────────────────────────────────────
  socket.on("disconnect", async () => {
    console.log("❌ User disconnected:", socket.id);
    for (let [userId, sId] of Object.entries(onlineUsers)) {
      if (sId === socket.id) { delete onlineUsers[userId]; break; }
    }
    io.emit("updateOnlineUsers", Object.keys(onlineUsers));

    const userId = socketUserMap[socket.id];
    delete socketUserMap[socket.id];
    if (!userId) return;

    for (const roomCode of Object.keys(games)) {
      const game = games[roomCode];
      if (!game) continue;
      const player = game.players.find(p => p.userId === userId);
      if (!player) continue;

      if (game.status === "playing") {
        player.disconnected = true;
        io.to(roomCode).emit("update_players", game.players);
      } else if (game.status === "waiting") {
        game.players = game.players.filter(p => p.userId !== userId);
        game.turns = game.turns.filter(p => p.userId !== userId);
        await Room.updateOne({ code: roomCode }, { $pull: { players: { userId } } }).catch(console.error);
        io.to(roomCode).emit("update_players", game.players);
        if (game.players.length === 0) delete games[roomCode];
      } else if (game.status === "ended") {
        player.disconnected = true;
        io.to(roomCode).emit("update_players", game.players);
      }
    }
  });
});

// ─────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────
httpServer.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});