const express = require("express");
//const User = require('../models/User');
const router = express.Router();
const fetchuser = require('../middleware/fetchuser');
const User = require("../models/User");
const checkFrozen = require("../middleware/checkFrozen");

router.post("/shop-coins", fetchuser, checkFrozen, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        user.money = (user.money || 0) + 100;
        await user.save();

        res.json({ money: user.money });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error", error: err.message });
    }
});

router.post("/grant-extra", fetchuser, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ message: "User not found" });

        user.extraSpins = (user.extraSpins || 0) + 1;
        await user.save();

        res.json({ extraSpins: user.extraSpins });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error", error: err.message });
    }
});

router.post("/shop-xp", fetchuser, checkFrozen, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ message: "User not found" });

        user.xp = (user.xp || 0) + 50;
        await user.save();

        res.json({ xp: user.xp });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error", error: err.message });
    }
});

module.exports= router;