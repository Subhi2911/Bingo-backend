const express = require("express");
const router = express.Router();
const { claimDailyReward } = require("../controllers/reward.controller");
const fetchuser = require('../middleware/fetchuser');
const User = require("../models/User");
const Room = require("../models/Room");
const mongoose = require("mongoose");
const { updateProgressWithXP } = require('../utils/levelSystem');
const { setMissionProgress, } = require("../utils/missionProgress");
const checkFrozen = require('../middleware/checkFrozen');


router.post("/daily-claim", fetchuser, checkFrozen, claimDailyReward);


router.get("/gamehistory", fetchuser, checkFrozen, async (req, res) => {
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

const getTimeBonus = (seconds, gameType) => {
    if (!seconds) return 0;

    if (gameType === 'fast') {
        if (seconds <= 60) return 30;
        if (seconds <= 90) return 20;
        if (seconds <= 120) return 15;
        else return 10
    }

    if (gameType === 'classic') {
        if (seconds <= 120) return 45;
        if (seconds <= 180) return 30;
        if (seconds <= 240) return 25;
        else return 15
    }

    if (gameType === 'power') {
        if (seconds <= 180) return 60;
        if (seconds <= 240) return 45;
        if (seconds <= 300) return 25;
        else return 10
    }

    return 0;
};


// POST /api/game/update-progress
router.post('/update-progress', fetchuser, checkFrozen, async (req, res) => {
    const { gameId, didWin, gameType, playerCount, duration } = req.body;

    if (!gameId) {
        return res.status(400).json({ error: "gameId required" });
    }
    const bonusXP = didWin ? getTimeBonus(duration, gameType) : 0;
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
    setMissionProgress(user._id, 'reach_level', result.level);
    res.json({
        ...result,
        oldXP: oldLevelXp,
        money: user.money
    });
});

// routes/leaderboard.js
router.get('/leaderboard', fetchuser, checkFrozen, async (req, res) => {
    try {
        const userId = req.user.id;

        const currentUser = await User.findById(userId).select('totalXp username avatar friends');
        if (!currentUser) return res.status(404).json({ msg: 'User not found' });

        // ── WORLD ──
        const topUsers = await User.find({})
            .sort({ totalXp: -1 })
            .limit(20)
            .select('username avatar totalXp');

        const higherXpCount = await User.countDocuments({ totalXp: { $gt: currentUser.totalXp } });
        const userRank = higherXpCount + 1;

        // ── FRIENDS ──
        const friendIds = currentUser.friends || [];
        const friendUsers = await User.find({ _id: { $in: [...friendIds, userId] } })
            .sort({ totalXp: -1 })
            .select('username avatar totalXp');

        const friendRank = friendUsers.findIndex(u => u._id.toString() === userId.toString()) + 1;

        res.json({
            topUsers,
            userRank,
            currentUser,
            friendUsers,
            friendRank,
        });

    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

router.get("/ranking", async (req, res) => {
    try {
        const users = await User.find();

        const avatarMap = {};

        users.forEach(user => {
            const avatar = user.avatar;

            if (!avatarMap[avatar]) {
                avatarMap[avatar] = {
                    avatar,
                    totalXp: 0,
                    users: []
                };
            }

            avatarMap[avatar].totalXp += user.totalXp;

            avatarMap[avatar].users.push({
                name: user.username,
                xp: user.totalXp,
                level: user.level
            });
        });

        let avatars = Object.values(avatarMap);

        // Sort users inside each avatar
        avatars.forEach(avatarGroup => {
            avatarGroup.users.sort((a, b) => b.xp - a.xp);

            avatarGroup.users = avatarGroup.users.map((user, index) => ({
                ...user,
                rank: index + 1
            }));
        });

        // Sort avatars by total XP
        avatars.sort((a, b) => b.totalXp - a.totalXp);

        res.json({
            avatarOfWeek: avatars[0],
            avatars
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


module.exports = router;