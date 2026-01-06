const express = require("express");
const router = express.Router();
const { claimDailyReward } = require("../controllers/reward.controller");
const fetchuser = require('../middleware/fetchuser');

router.post("/daily-claim", fetchuser, claimDailyReward);
module.exports = router;