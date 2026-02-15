const express = require("express");
const router = express.Router();
const User = require("../models/User");
const fetchuser = require("../middleware/fetchuser");
const rewards = [
    { label: "50 Coins", type: "coins", value: 50 },
    { label: "100 Coins", type: "coins", value: 100 },
    { label: "20 XP", type: "xp", value: 20 },
    { label: "50 XP", type: "xp", value: 50 },
    { label: "Nothing 😢", type: "none", value: 0 }
];


// GET rewards for frontend wheel
router.get("/rewards", (req, res) => {
    res.json(rewards);
});

// SPIN
router.post("/spin", fetchuser, async (req, res) => {
    try {
        const userId = req.user.id; // from auth middleware
        const user = await User.findById(userId);

        // 24 hour cooldown
        if (user.lastSpin) {
            const diff = Date.now() - new Date(user.lastSpin).getTime();
            const hours = diff / (1000 * 60 * 60);
            if (hours < 24) {
                return res.status(400).json({
                    message: "You can spin only once in 24 hours"
                });
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
            coins: user.coins,
            TotalXp: user.totalXp,

        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
