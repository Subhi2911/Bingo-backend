/* eslint-disable no-unused-vars */
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
const User = require("./models/User");
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
  MISCHIEF_STEAL: ["Mischief Steal"],
  KINGS_ROAR: ["King's Roar"],
  PREDATOR_FOCUS: ["Predator Focus"],
  ILLUSION_CLONE: ["Illusion Clone"],
  TRICK_SWAP: ["Trick Swap"],
  MIND_GAMES: ["Mind Games"],
  QUICK_ESCAPE: ["Quick Escape"],
  COIL_TRAP: ["Coil Trap"],
  HEAT_SENSE: ["Heat Sense"],
  ENDURANCE: ["Endurance"],
  NOT_IMPLEMENTED: [],
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

  // KING'S ROAR skip check
  const currentEffect = game.effects?.[currentPlayer.userId];
  if (currentEffect?.skipNextTurn) {
    delete game.effects[currentPlayer.userId].skipNextTurn;
    io.to(roomCode).emit("turn_skipped", { userId: currentPlayer.userId, message: `👑 ${currentPlayer.username || "Player"}'s turn was skipped!` });
    game.currentTurn = (game.currentTurn + 1) % game.turns.length;
    io.to(roomCode).emit("current_turn", game.turns[game.currentTurn]);
    startTurnTimer(roomCode);
    return;
  }

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
  const baseTurnTime = misses >= 3 ? Math.min(5, defaultTurnTime) : defaultTurnTime;
  const enduranceTurns = game.effects?.[currentPlayer.userId]?.enduranceTurns || 0;
  if (enduranceTurns > 0) {
    game.effects[currentPlayer.userId].enduranceTurns--;
    io.to(roomCode).emit('endurance_active', { userId: currentPlayer.userId, remainingTurns: game.effects[currentPlayer.userId].enduranceTurns });
  }
  const turnTime = enduranceTurns > 0 ? baseTurnTime * 3 : baseTurnTime;

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

  // ── Helper: apply negative effect with immunity / reflect checks ──
  const applyNegativeEffect = (effFn, overrideTargetId) => {
    const tid = overrideTargetId || targetId;
    if (!tid) return socket.emit("power_failed", { reason: "No target selected" });

    const targetEffect = game.effects[tid] || {};

    if (targetEffect.immuneUntil && targetEffect.immuneUntil > Date.now()) {
      socket.emit("power_failed", { reason: "Target is immune" });
      return false;
    }

    if (targetEffect.reflectNext) {
      game.effects[tid].reflectNext = false;
      effFn(userId);
      io.to(roomCode).emit("power_reflected", { power, reflectedFrom: tid, reflectedTo: userId });
      game.powerUsed[userId] = true;
      io.to(roomCode).emit("power_used", {
        power, userId, group: resolvedGroup,
        message: `↩ ${power} reflected back on user!`,
      });
      return false;
    }

    effFn(tid);
    return true;
  };

  // ─────────────────────────────────────────────────────────────────────────
  // EXISTING GROUPS (unchanged)
  // ─────────────────────────────────────────────────────────────────────────

  if (resolvedGroup === "EXTRA_TURN") {
    const playerIndex = game.turns.findIndex(p => p.userId === userId);
    if (playerIndex === -1) return socket.emit("power_failed", { reason: "Player not found" });
    clearTimeout(turnTimers[roomCode]);
    game.currentTurn = playerIndex;
    game.powerUsed[userId] = true;
    io.to(roomCode).emit("current_turn", game.turns[game.currentTurn]);
    io.to(roomCode).emit("extra_turn", { playerId: userId });
    io.to(roomCode).emit("power_used", { power, userId, group: resolvedGroup, message: `⚡ ${power} — extra turn granted!` });
    startTurnTimer(roomCode);
    return;
  }

  if (resolvedGroup === "FREE_MARK") {
    if (number === undefined || number === null)
      return socket.emit("power_failed", { reason: "No number selected" });
    if (game.picked.includes(number))
      return socket.emit("power_failed", { reason: "Number already picked" });
    game.picked.push(number);
    if (!game.playerMarkedNumbers[userId]) game.playerMarkedNumbers[userId] = [];
    game.playerMarkedNumbers[userId].push(number);
    game.powerUsed[userId] = true;
    require("./models/Room").updateOne({ code: roomCode }, { $addToSet: { selected: number } }).catch(console.error);
    io.to(roomCode).emit("number_picked", game.picked);
    io.to(roomCode).emit("power_used", { power, userId, group: resolvedGroup, message: `👣 ${power} — free mark on ${number}!` });
    return;
  }

  if (resolvedGroup === "RANDOM_MARK") {
    const allUnpicked = Array.from({ length: 25 }, (_, i) => i + 1).filter(n => !game.picked.includes(n));
    if (!allUnpicked.length)
      return socket.emit("power_failed", { reason: "No numbers left to mark" });
    const randomNum = allUnpicked[Math.floor(Math.random() * allUnpicked.length)];
    game.picked.push(randomNum);
    if (!game.playerMarkedNumbers[userId]) game.playerMarkedNumbers[userId] = [];
    game.playerMarkedNumbers[userId].push(randomNum);
    game.powerUsed[userId] = true;
    require("./models/Room").updateOne({ code: roomCode }, { $addToSet: { selected: randomNum } }).catch(console.error);
    io.to(roomCode).emit("number_picked", game.picked);
    io.to(roomCode).emit("power_used", { power, userId, group: resolvedGroup, message: `🎲 ${power} — random mark on ${randomNum}!` });
    return;
  }

  if (resolvedGroup === "FREEZE") {
    const applied = applyNegativeEffect((tid) => {
      const frozenUntil = Date.now() + 5000;
      if (!game.effects[tid]) game.effects[tid] = {};
      game.effects[tid].frozenUntil = frozenUntil;
      const targetPlayer = game.turns.find(p => p.userId === tid);
      io.to(roomCode).emit("player_frozen", { targetId: tid, frozenUntil, message: `❄ ${power} froze ${targetPlayer?.username || "a player"} for 5s` });
      io.to(roomCode).emit("power_effect", { effect: "frozenUntil", targetId: tid, value: frozenUntil });
    });
    if (applied !== false) {
      game.powerUsed[userId] = true;
      io.to(roomCode).emit("power_used", { power, userId, group: resolvedGroup, message: `❄ ${power} activated` });
    }
    return;
  }

  if (resolvedGroup === "IMMUNITY") {
    const immuneUntil = Date.now() + 15000;
    if (!game.effects[userId]) game.effects[userId] = {};
    game.effects[userId].immuneUntil = immuneUntil;
    game.powerUsed[userId] = true;
    io.to(roomCode).emit("player_immune", { userId, immuneUntil, message: `🛡 ${power} — immune for 15s!` });
    io.to(roomCode).emit("power_effect", { effect: "immuneUntil", targetId: userId, value: immuneUntil });
    io.to(roomCode).emit("power_used", { power, userId, group: resolvedGroup, message: `🛡 ${power} activated` });
    return;
  }

  if (resolvedGroup === "REMOVE_MARK") {
    const applied = applyNegativeEffect((tid) => {
      const markedByTarget = game.playerMarkedNumbers[tid];
      if (!markedByTarget || !markedByTarget.length) {
        socket.emit("power_failed", { reason: "Target has no marked numbers" });
        return;
      }
      const removedNumber = markedByTarget.pop();
      const idx = game.picked.lastIndexOf(removedNumber);
      if (idx !== -1) game.picked.splice(idx, 1);
      require("./models/Room").updateOne({ code: roomCode }, { $pull: { selected: removedNumber } }).catch(console.error);
      io.to(roomCode).emit("number_picked", game.picked);
      io.to(roomCode).emit("mark_removed", { targetId: tid, number: removedNumber });
      const targetPlayer = game.turns.find(p => p.userId === tid);
      io.to(roomCode).emit("power_used", { power, userId, group: resolvedGroup, message: `💥 ${power} removed ${targetPlayer?.username || "a player"}'s mark` });
    });
    if (applied !== false) {
      game.powerUsed[userId] = true;
    }
    return;
  }

  if (resolvedGroup === "REFLECT") {
    if (!game.effects[userId]) game.effects[userId] = {};
    game.effects[userId].reflectNext = true;
    game.powerUsed[userId] = true;
    io.to(roomCode).emit("power_effect", { effect: "reflectNext", targetId: userId, value: true });
    io.to(roomCode).emit("power_used", { power, userId, group: resolvedGroup, message: `↩ ${power} — next attack will be reflected!` });
    return;
  }

  // ── MISCHIEF STEAL ───────────────────────────────────────────────────────
  // Steal the target's most recently marked number and add it to your own marks.
  if (power === "Mischief Steal") {
    if (!targetId) return socket.emit("power_failed", { reason: "No target selected" });

    const targetEffect = game.effects[targetId] || {};
    if (targetEffect.immuneUntil && targetEffect.immuneUntil > Date.now())
      return socket.emit("power_failed", { reason: "Target is immune" });

    if (targetEffect.reflectNext) {
      game.effects[targetId].reflectNext = false;
      // Reflect: steal from the caster instead (undo their last mark)
      const myMarked = game.playerMarkedNumbers[userId] || [];
      if (myMarked.length) {
        const stolen = myMarked.pop();
        const idx = game.picked.lastIndexOf(stolen);
        if (idx !== -1) game.picked.splice(idx, 1);
        require("./models/Room").updateOne({ code: roomCode }, { $pull: { selected: stolen } }).catch(console.error);
        io.to(roomCode).emit("number_picked", game.picked);
        io.to(roomCode).emit("mark_removed", { targetId: userId, number: stolen });
      }
      game.powerUsed[userId] = true;
      io.to(roomCode).emit("power_reflected", { power, reflectedFrom: targetId, reflectedTo: userId });
      io.to(roomCode).emit("power_used", { power, userId, group: resolvedGroup, message: `↩ Mischief Steal reflected!` });
      return;
    }

    const markedByTarget = game.playerMarkedNumbers[targetId] || [];
    if (!markedByTarget.length)
      return socket.emit("power_failed", { reason: "Target has no marked numbers to steal" });

    // Remove from target, give to caster
    const stolenNumber = markedByTarget.pop();
    if (!game.playerMarkedNumbers[userId]) game.playerMarkedNumbers[userId] = [];
    game.playerMarkedNumbers[userId].push(stolenNumber);
    // picked list stays the same (the number is still marked, just ownership changed)

    game.powerUsed[userId] = true;

    const targetPlayer = game.turns.find(p => p.userId === targetId);
    const casterPlayer = game.turns.find(p => p.userId === userId);

    // Tell the target their mark was stolen
    io.to(roomCode).emit("mark_removed", { targetId, number: stolenNumber });
    // Tell caster the number is now theirs (re-add as their mark)
    io.to(roomCode).emit("mark_stolen", {
      fromId: targetId,
      toId: userId,
      number: stolenNumber,
      message: `🃏 ${casterPlayer?.username || "Someone"} stole ${stolenNumber} from ${targetPlayer?.username || "a player"}!`,
    });
    io.to(roomCode).emit("power_used", {
      power, userId, group: "MISCHIEF_STEAL",
      message: `🃏 Mischief Steal — swiped ${stolenNumber} from ${targetPlayer?.username || "a player"}!`,
    });
    return;
  }

  // ── KING'S ROAR ──────────────────────────────────────────────────────────
  // Skip the next player in turn order (they lose their upcoming turn).
  if (power === "King's Roar") {
    const nextTurnIndex = (game.currentTurn + 1) % game.turns.length;
    const skippedPlayer = game.turns[nextTurnIndex];

    if (!skippedPlayer || skippedPlayer.userId === userId) {
      // Only one player left to affect — skip self is meaningless
      return socket.emit("power_failed", { reason: "No valid player to skip" });
    }

    // Mark that player as having their turn skipped once
    if (!game.effects[skippedPlayer.userId]) game.effects[skippedPlayer.userId] = {};
    game.effects[skippedPlayer.userId].skipNextTurn = true;

    game.powerUsed[userId] = true;

    io.to(roomCode).emit("power_effect", { effect: "skipNextTurn", targetId: skippedPlayer.userId, value: true });
    io.to(roomCode).emit("power_used", {
      power, userId, group: "KINGS_ROAR",
      message: `👑 King's Roar — ${skippedPlayer.username || "next player"}'s turn will be skipped!`,
    });
    return;
  }

  // ── PREDATOR FOCUS ───────────────────────────────────────────────────────
  // Reveal all opponents' boards to the caster for 6 seconds.
  if (power === "Predator Focus") {
    const opponents = game.turns.filter(p => p.userId !== userId);
    const boardReveal = opponents.map(p => ({
      userId: p.userId,
      username: p.username,
      avatar: p.avatar,
      markedNumbers: game.playerMarkedNumbers[p.userId] || [],
    }));

    game.powerUsed[userId] = true;

    // Only emit to the caster's socket
    socket.emit("predator_focus_reveal", {
      boards: boardReveal,
      duration: 6000,
      message: "👁 Predator Focus — opponent boards revealed for 6s!",
    });
    io.to(roomCode).emit("power_used", {
      power, userId, group: "PREDATOR_FOCUS",
      message: `👁 ${game.turns.find(p => p.userId === userId)?.username || "A player"} used Predator Focus!`,
    });
    return;
  }

  // ── ILLUSION CLONE ───────────────────────────────────────────────────────
  // Makes opponents see a fake extra BINGO letter on caster's display for 5s.
  if (power === "Illusion Clone") {
    game.powerUsed[userId] = true;
    const fakeLetter = ["B", "I", "N", "G", "O"][Math.floor(Math.random() * 5)];

    io.to(roomCode).emit("illusion_clone", {
      userId,
      fakeLetter,
      duration: 5000,
      message: `🌀 Illusion Clone activated by ${game.turns.find(p => p.userId === userId)?.username || "a player"}!`,
    });
    io.to(roomCode).emit("power_used", {
      power, userId, group: "ILLUSION_CLONE",
      message: `🌀 Illusion Clone — opponents see a false BINGO letter!`,
    });
    return;
  }

  // ── TRICK SWAP ───────────────────────────────────────────────────────────
  // Swap one random marked number between caster and target
  // (changes ownership in playerMarkedNumbers without altering picked list).
  if (power === "Trick Swap") {
    if (!targetId) return socket.emit("power_failed", { reason: "No target selected" });

    const targetEffect = game.effects[targetId] || {};
    if (targetEffect.immuneUntil && targetEffect.immuneUntil > Date.now())
      return socket.emit("power_failed", { reason: "Target is immune" });

    const myMarked = game.playerMarkedNumbers[userId] || [];
    const theirMarked = game.playerMarkedNumbers[targetId] || [];

    if (!myMarked.length || !theirMarked.length)
      return socket.emit("power_failed", { reason: "Both players need at least one marked number" });

    const myNum = myMarked[Math.floor(Math.random() * myMarked.length)];
    const theirNum = theirMarked[Math.floor(Math.random() * theirMarked.length)];

    // Swap in arrays
    const myIdx = myMarked.indexOf(myNum);
    const theirIdx = theirMarked.indexOf(theirNum);
    game.playerMarkedNumbers[userId][myIdx] = theirNum;
    game.playerMarkedNumbers[targetId][theirIdx] = myNum;

    game.powerUsed[userId] = true;

    const targetPlayer = game.turns.find(p => p.userId === targetId);
    io.to(roomCode).emit("trick_swap", {
      userId,
      targetId,
      myNum,
      theirNum,
      message: `🔀 Trick Swap — ${myNum} ↔ ${theirNum} swapped with ${targetPlayer?.username || "opponent"}!`,
    });
    io.to(roomCode).emit("power_used", {
      power, userId, group: "TRICK_SWAP",
      message: `🔀 Trick Swap — board numbers swapped!`,
    });
    return;
  }

  // ── MIND GAMES ───────────────────────────────────────────────────────────
  // Shuffles the visual display of the target's board for 8 seconds.
  // Numbers are the same; only the display order scrambles client-side.
  if (power === "Mind Games") {
    if (!targetId) return socket.emit("power_failed", { reason: "No target selected" });

    const targetEffect = game.effects[targetId] || {};
    if (targetEffect.immuneUntil && targetEffect.immuneUntil > Date.now())
      return socket.emit("power_failed", { reason: "Target is immune" });

    game.powerUsed[userId] = true;

    // Generate a stable shuffle seed so all clients agree (not needed since
    // only the target's client shuffles, but we send duration + seed)
    const shuffleSeed = Math.floor(Math.random() * 100000);
    io.to(roomCode).emit("mind_games", {
      targetId,
      shuffleSeed,
      duration: 8000,
      message: `🌀 Mind Games — target's board is scrambled for 8s!`,
    });
    io.to(roomCode).emit("power_used", {
      power, userId, group: "MIND_GAMES",
      message: `🌀 Mind Games activated!`,
    });
    return;
  }

  // ── QUICK ESCAPE ─────────────────────────────────────────────────────────
  // Undo the caster's most recent manually-marked number (remove from picked).
  if (power === "Quick Escape") {
    const myMarked = game.playerMarkedNumbers[userId] || [];
    if (!myMarked.length)
      return socket.emit("power_failed", { reason: "You have no marks to undo" });

    const undoneNumber = myMarked.pop();
    const idx = game.picked.lastIndexOf(undoneNumber);
    if (idx !== -1) game.picked.splice(idx, 1);

    require("./models/Room").updateOne({ code: roomCode }, { $pull: { selected: undoneNumber } }).catch(console.error);

    game.powerUsed[userId] = true;

    io.to(roomCode).emit("number_picked", game.picked);
    io.to(roomCode).emit("mark_removed", { targetId: userId, number: undoneNumber });
    io.to(roomCode).emit("power_used", {
      power, userId, group: "QUICK_ESCAPE",
      message: `💨 Quick Escape — ${undoneNumber} unmarked!`,
    });
    return;
  }

  // ── COIL TRAP ────────────────────────────────────────────────────────────
  // The NEXT number any opponent marks is immediately removed from their board.
  if (power === "Coil Trap") {
    if (!game.coilTraps) game.coilTraps = {};

    // Set a trap that triggers once for any non-caster pick
    game.coilTraps[userId] = {
      setCasterId: userId,
      active: true,
    };

    game.powerUsed[userId] = true;

    io.to(roomCode).emit("power_effect", { effect: "coilTrap", targetId: userId, value: true });
    io.to(roomCode).emit("power_used", {
      power, userId, group: "COIL_TRAP",
      message: `🐍 Coil Trap set — the next opponent to mark a number will lose it!`,
    });
    return;
  }

  // ── HEAT SENSE ───────────────────────────────────────────────────────────
  // Shows the caster which numbers opponents need most to complete a line.
  if (power === "Heat Sense") {
    // Build a frequency map: for each unpicked number, how many opponent
    // winning lines does it complete or contribute to?
    const opponents = game.turns.filter(p => p.userId !== userId);
    const unpicked = Array.from({ length: 25 }, (_, i) => i + 1).filter(n => !game.picked.includes(n));

    // We don't store boards server-side (boards are generated client-side),
    // so we use playerMarkedNumbers as a proxy for "numbers they want".
    // Count how many opponents still need each number (haven't marked it).
    const numberHeat = {};
    unpicked.forEach(n => {
      numberHeat[n] = 0;
      opponents.forEach(opp => {
        const marked = game.playerMarkedNumbers[opp.userId] || [];
        if (!marked.includes(n)) numberHeat[n]++;
      });
    });

    // Sort by highest demand
    const hotNumbers = Object.entries(numberHeat)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([num, count]) => ({ number: parseInt(num), opponentCount: count }));

    game.powerUsed[userId] = true;

    // Only send to caster
    socket.emit("heat_sense_result", {
      hotNumbers,
      duration: 8000,
      message: "🔥 Heat Sense — most-wanted numbers revealed!",
    });
    io.to(roomCode).emit("power_used", {
      power, userId, group: "HEAT_SENSE",
      message: `🔥 ${game.turns.find(p => p.userId === userId)?.username || "A player"} used Heat Sense!`,
    });
    return;
  }

  // power== endurance 
  if (power === 'Endurance') {
    if (!game.effects[userId]) game.effects[userId] = {};
    // Mark that this player gets 3x the turn time for their next 3 turns
    game.effects[userId].enduranceTurns = 3;
    game.powerUsed[userId] = true;

    io.to(roomCode).emit('power_effect', { effect: 'enduranceTurns', targetId: userId, value: 3 });
    io.to(roomCode).emit('power_used', {
      power, userId, group: 'ENDURANCE',
      message: `🐴 Endurance — next 3 turns get extended time!`,
    });
    return;
  }

  socket.emit("power_failed", { reason: "Unknown power group" });
}

// ─────────────────────────────────────────────
// CONNECTION
// ─────────────────────────────────────────────
io.on("connection", (socket) => {
 
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

    // COIL TRAP check — if any opponent has set a trap, trigger it on this pick
    if (game.coilTraps) {
      for (const [casterId, trap] of Object.entries(game.coilTraps)) {
        if (trap.active && casterId !== current.userId) {
          // Trap fires: remove the number we just tried to add
          delete game.coilTraps[casterId];
          io.to(roomCode).emit("coil_trap_triggered", {
            victimId: current.userId,
            number,
            casterId,
            message: `🐍 Coil Trap! ${current.username || "Player"}'s mark on ${number} was destroyed!`,
          });
          // Advance turn without counting the pick
          game.currentTurn = (game.currentTurn + 1) % game.turns.length;
          io.to(roomCode).emit("current_turn", game.turns[game.currentTurn]);
          if (game.status !== "ended") startTurnTimer(roomCode);
          return;
        }
      }
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
  // Rejoin game
  // ─────────────────────────────────────────

  // ─── ADD THIS: Check if user has an ongoing game they can rejoin ───────────
  socket.on("check_rejoin", ({ userId }) => {
    for (const [roomCode, game] of Object.entries(games)) {
      if (game.status !== "playing") continue;
      const player = game.players.find(p => p.userId === userId);
      if (!player) continue;

      // Found an active game — update socket and notify client
      player.socketId = socket.id;
      player.disconnected = false;
      socketUserMap[socket.id] = userId;
      socket.join(roomCode);

      socket.emit("rejoin_available", {
        roomCode,
        gameType: game.gameType,
        players: game.players,
        pickedNumbers: game.picked,
        currentTurn: game.turns[game.currentTurn],
        turnOrder: game.turns,
      });

      io.to(roomCode).emit("update_players", game.players);
      return;
    }
    // No active game found
    socket.emit("no_rejoin_available");
  });

  // ─────────────────────────────────────────
  // GAME END
  // ─────────────────────────────────────────
  socket.on("game_end", async ({ roomCode, winnerId, gameType }) => {
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

    // ── GUARD: don't save if all players are disconnected (ghost game) ──
    const anyConnected = game.players.some(p => !p.disconnected);
    if (!anyConnected) {
      delete games[roomCode];
      return;
    }

    const winner = game.players.find(p => p.userId === winnerId);
    if (!winner) {
      console.error(`Winner not found for room ${roomCode}.`);
      return;
    }

    try {
      const user = await User.findById(winner.userId);
      if (user) {
        if (!user.wins || typeof user.wins !== "object") {
          user.wins = { classic: 0, fast: 0, power: 0, private: 0 };
        }
        // Fix the original bug: was `user.wins.gameType` (always undefined)
        if (user.wins[gameType] !== undefined) {
          user.wins[gameType] += 1;
        } else {
          user.wins.power = (user.wins.power || 0) + 1; // fallback
        }
        await user.save();
      }
    } catch (err) {
      console.error("Failed to update winner stats:", err);
    }

    try {
      await Room.updateOne(
        { code: roomCode },
        {
          $set: {
            status: "ended",
            winner: {
              userId: winner.userId,
              username: winner.username,
              avatar: winner.avatar,
            },
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
    game.coilTraps = {};         // ← ADD THIS
    game.turns = [...game.players].sort(() => Math.random() - 0.5);
    game.currentTurn = 0;
    game.missedTurns = {};       // ← also fix: was 0, should be {} (object not number)
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

    // ── 1. Remove any stale entry for this userId (reconnect / retry) ──────
    queue = queue.filter(p => p.userId !== userId);

    // ── 2. Add fresh entry ─────────────────────────────────────────────────
    queue.push({ socketId: socket.id, userId, username, avatar, size, gameType, selectedPower });

    // ── 3. Build candidate group: same size + gameType, unique userIds ─────
    const candidates = queue.filter(
      p => p.size === size && p.gameType === gameType
    );

    // ── 4. Only proceed if we have exactly enough ──────────────────────────
    if (candidates.length < size) return;

    const players = candidates.slice(0, size);
    const matchedUserIds = new Set(players.map(p => p.userId));

    // ── 5. Atomically remove ALL matched players from the queue ────────────
    //    (do this BEFORE any async work so no second match_found is emitted)
    queue = queue.filter(p => !matchedUserIds.has(p.userId));

    // ── 6. Verify all sockets are still connected ──────────────────────────
    const livePlayers = players.filter(p => io.sockets.sockets.has(p.socketId));

    if (livePlayers.length < size) {
      // Put still-connected players back and wait for more
      livePlayers.forEach(p => queue.push(p));
      return;
    }

    // ── 7. Create room ─────────────────────────────────────────────────────
    const roomCode = generateRoomCode();
    games[roomCode] = {
      players: livePlayers,
      turns: [],
      currentTurn: 0,
      picked: [],
      status: "playing",
      finished: [],
      gameType,
      powerUsed: {},
      effects: {},
      playerMarkedNumbers: {},
      missedTurns: {},
    };

    await Room.create({
      code: roomCode,
      players: livePlayers.map(p => ({ userId: p.userId, username: p.username, avatar: p.avatar })),
      status: "waiting",
      turn: 0,
      selected: [],
      gameType,
      powerUsed: false,
    });

    livePlayers.forEach(p => io.sockets.sockets.get(p.socketId)?.join(roomCode));
    livePlayers.forEach(p => {
      io.to(p.socketId).emit("match_found", {
        roomCode,
        players: livePlayers.map(x => ({ userId: x.userId, username: x.username, avatar: x.avatar })),
      });
    });

    const game = games[roomCode];
    game.turns = [...game.players].sort(() => Math.random() - 0.5);
    game.currentTurn = 0;
    io.to(roomCode).emit("turn_order", game.turns);
    io.to(roomCode).emit("current_turn", game.turns[0]);
    startTurnTimer(roomCode);
  });

  socket.on("cancel_match", ({ userId }) => {
    queue = queue.filter(p => p.userId !== userId);
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
      console.error("Private room creation failed:", err);
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
      // FIX: normalize both sides to strings so ObjectId vs string never mismatches
      p => p.toString() !== message?.sender._id?.toString()
    );

    receivers.forEach(userId => {
      // FIX: stringify the ObjectId before looking up in onlineUsers
      const socketId = onlineUsers[userId.toString()];
      if (!socketId) return; // user is offline — no notification needed

      // activeChats is now the shared module-level map, so this lookup
      //    correctly reflects what the *receiver's* socket registered
      const isInSameChat = activeChats[socketId] === message.chatId;

      if (!isInSameChat) {
        io.to(socketId).emit("newNotification", {
          type: "message",
          title: message.sender.username,
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
      const socketId = onlineUsers[userId.toString()];
      if (socketId) continue;

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
          // Android: high priority + channel so it shows in drawer when killed
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

  socket.on("mark_seen", ({ messageId, chatId, seenBy }) => {
    // Relay to everyone else in the chat room so their double-tick updates live
    socket.to(chatId).emit("message_seen", { messageId, seenBy });
  });

  //______________________________________________
  // NOTIFICATIONS
  //______________________________________________
  socket.on("sendFriendRequest", async ({ receiverId, senderId, senderName, senderAvatar }) => {
    const receiverSocketId = onlineUsers[receiverId];
    //when user is online, send real-time notification via Socket.IO
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("newNotification", {
        type: "friendRequest",
        title: "Friend Request",
        body: `You have a new friend request from ${senderName}.`,
        senderId: senderId,
        receiverId: receiverId,
        senderAvatar: senderAvatar
      });
    } else {
      //when user is offline, send push notification via FCM
      const User = require("./models/User");
      const receiver = await User.findById(receiverId);
      if (!receiver?.fcmToken) return;
      try {
        await admin.messaging().send({
          token: receiver.fcmToken,
          notification: {
            title: "Friend Request",
            body: `You have a new friend request from ${senderName}.`,
          },
          data: {
            senderId,
            receiverId,
          },
        });
      } catch (err) {
        console.error("Push failed:", err.message);
      }
    }
    //save in database 
    const Notification = require("./models/Notification");
    await Notification.create({
      type: "FRIEND_REQUEST",
      user: receiverId,
      title: "Friend Request",
      body: `You have a new friend request from ${senderName}.`,
      data: { senderId, receiverId },
    });
  });

  // ─────────────────────────────────────────
  // DISCONNECT
  // ─────────────────────────────────────────
  socket.on("disconnect", async () => {
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
        const allGone = game.players.every(p => p.disconnected);
        if (allGone) {
          // No one is watching — clean up without saving
          clearTimeout(turnTimers[roomCode]);
          delete turnTimers[roomCode];
          delete games[roomCode];
          await Room.deleteOne({ code: roomCode }).catch(console.error);
          console.log(`🗑️ Room ${roomCode} deleted — all players disconnected.`);
        }
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