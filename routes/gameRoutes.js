const express = require("express");
const router = express.Router();
const { claimDailyReward } = require("../controllers/reward.controller");
const fetchuser = require('../middleware/fetchuser');
const User = require("../models/User");
const Room = require("../models/Room");
const mongoose = require("mongoose");

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




module.exports = router;