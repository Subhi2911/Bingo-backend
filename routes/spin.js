const express = require("express");
const router = express.Router();
const User = require("../models/User");
const fetchuser = require("../middleware/fetchuser");
const checkFrozen = require('../middleware/checkFrozen');


const rewards = [
    { label: "50 Coins", type: "coins", value: 50 },
    { label: "100 Coins", type: "coins", value: 100 },
    { label: "250 Coins", type: "coins", value: 250 },
    { label: "500 Coins", type: "coins", value: 500 },

    { label: "10 XP", type: "xp", value: 10 },
    { label: "+1 Star ⭐", type: "levelxp", value: 20 },
    { label: "50 XP", type: "xp", value: 50 },

    { label: "Nothing 😢", type: "none", value: 0 },
    { label: "Nothing 😢", type: "none", value: 0 },
];


// GET rewards for frontend wheel
router.get("/rewards", (req, res) => {
    res.json(rewards);
});

// SPIN
router.post("/spin", fetchuser, checkFrozen, async (req, res) => {
    try {
        const userId = req.user.id; // from auth middleware
        const user = await User.findById(userId);

        // 24 hour cooldown
        if (user.lastSpin) {
            const diff = Date.now() - new Date(user.lastSpin).getTime();
            const hours = diff / (1000 * 60 * 60);
            const hasExtraSpin = (user.extraSpins || 0) > 0;

            if (hours < 24 && !hasExtraSpin) {
                return res.status(400).json({
                    message: "You can spin only once in 24 hours"
                });
            }

            if (hours < 24 && hasExtraSpin) {
                user.extraSpins -= 1;
            }
        }

        // Pick random reward
        const prizeIndex = Math.floor(Math.random() * rewards.length);
        const reward = rewards[prizeIndex];

        // Update user balance
        if (reward.type === "coins") {
            user.money += reward.value;
        } else if (reward.type === "xp") {
            user.totalXp += reward.value;
            user.levelXp += reward.value;
        }


        user.lastSpin = new Date();
        await user.save();

        res.json({
            prizeIndex,
            reward,
            coins: user.money,
            TotalXp: user.totalXp,

        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// /status — add the extraSpins check alongside your existing cooldown check
router.get("/status", fetchuser, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ message: "User not found" });

        const COOLDOWN_MS = 24 * 60 * 60 * 1000;
        const now = Date.now();
        const lastSpin = user.lastSpin ? new Date(user.lastSpin).getTime() : 0;
        const dailySpinAvailable = now - lastSpin >= COOLDOWN_MS;
        const hasExtraSpin = (user.extraSpins || 0) > 0;

        const canSpin = dailySpinAvailable || hasExtraSpin;
        const message = canSpin ? "" : "Come back tomorrow for your next spin!";

        res.json({ canSpin, message, extraSpins: user.extraSpins || 0 });
    } catch (err) {
        res.status(500).json({ message: "Server error", error: err.message });
    }
});

router.post("/grant-extra", fetchuser, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);

        user.extraSpins = (user.extraSpins || 0) + 1;

        await user.save();

        res.json({
            success: true,
            extraSpins: user.extraSpins,
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});

module.exports = router;
