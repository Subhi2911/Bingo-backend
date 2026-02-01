const express = require("express");
const router = express.Router();
const { claimDailyReward } = require("../controllers/reward.controller");
const fetchuser = require('../middleware/fetchuser');
const User = require("../models/User");
const Room = require("../models/Room");
const mongoose = require("mongoose");
const { updateProgressWithXP } = require('../utils/levelSystem');

router.post("/daily-claim", fetchuser, claimDailyReward);


router.get("/gamehistory", fetchuser, async (req, res) => {
    try {
        const userId = String(req.user.id);

        const userObjectId = new mongoose.Types.ObjectId(userId);

        const rooms = await Room.find({
            "players.userId": userObjectId,
        }).sort({ createdAt: -1 });

        return res.json({ success: true, rooms });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            error: "Internal Server Error",
        });
    }
});

// POST /api/game/update-progress
router.post('/update-progress', fetchuser, async (req, res) => {
    const { gameId, didWin, bonusXP, gameType, playerCount } = req.body;

    if (!gameId) {
        return res.status(400).json({ error: "gameId required" });
    }

    const user = await User.findById(req.user.id);

    // 🔒 BLOCK DUPLICATES
    if (user.lastProcessedGame === gameId) {
        return res.json({
            message: "Game already processed",
            money: user.money,
            level: user.level,
            levelXp: user.levelXp,
            totalXp: user.totalXp,
            stars: user.stars
        });
    }

    user.lastProcessedGame = gameId;

    const oldLevelXp = user.levelXp;
    const result = updateProgressWithXP(user, didWin, gameType, bonusXP);

    user.level = result.level;
    user.levelXp = result.levelXp;
    user.totalXp = result.totalXp;
    user.stars = result.stars;

    // 💰 money (safe)
    if (gameType && playerCount) {
        const costMap = { classic: 20, fast: 15, power: 40 };
        const cost = costMap[gameType] || 0;

        if (didWin) {
            user.money += cost * (playerCount - 1);
        } else {
            user.money = Math.max(0, user.money - cost);
        }
    }

    await user.save();
    console.log(user);
    res.json({
        ...result,
        oldXP: oldLevelXp,
        money: user.money
    });
});


module.exports = router;