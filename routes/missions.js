const express = require('express');
const router = express.Router();
const Mission = require('../models/Missions');
const UserMission = require('../models/UserMissions');
const User = require('../models/User');
const fetchuser = require('../middleware/fetchuser');

// GET /api/missions
router.get('/', fetchuser, async (req, res) => {
  try {
    const userId = req.user._id;

    const [missions, userMissions] = await Promise.all([
      Mission.find().sort({ id: 1 }),
      UserMission.find({ userId }),
    ]);

    const progressMap = {};
    userMissions.forEach(um => { progressMap[um.missionId] = um; });

    const result = missions.map(m => {
      const um = progressMap[m.id];
      const progress = um ? um.progress : 0;
      const completed = progress >= m.target;
      return {
        id: m.id,
        title: m.title,
        description: m.description,
        reward: m.reward,
        rewardType: m.rewardType,
        progress,
        target: m.target,
        repeatable: m.repeatable,
        completed,
        // For repeatable missions this is always false once a claim resets
        // progress — claimed only sticks for one-time, non-repeatable missions.
        claimed: um?.claimed || false,
      };
    });

    res.json({ success: true, missions: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/missions/:missionId/claim
router.post('/:missionId/claim', fetchuser, async (req, res) => {
  try {
    const userId = req.user._id;
    const missionId = parseInt(req.params.missionId);

    const mission = await Mission.findOne({ id: missionId });
    if (!mission) return res.status(404).json({ success: false, message: 'Mission not found' });

    // Make sure a progress record exists
    await UserMission.findOneAndUpdate(
      { userId, missionId },
      { $setOnInsert: { progress: 0, claimed: false } },
      { upsert: true }
    );

    // Atomic guard: this only succeeds if progress has actually reached the
    // target AND it hasn't already been claimed. Kills both "claim with no
    // progress" and double-claim race conditions in one query.
    const claimedRecord = await UserMission.findOneAndUpdate(
      { userId, missionId, progress: { $gte: mission.target }, claimed: false },
      { $set: { claimed: true, claimedAt: new Date() } },
      { new: true }
    );

    if (!claimedRecord) {
      return res.status(400).json({ success: false, message: 'Mission not completed yet' });
    }

    const updateField = mission.rewardType === 'XP' ? { xp: mission.rewardAmount } : { coins: mission.rewardAmount };
    await User.findByIdAndUpdate(userId, { $inc: updateField });

    // Repeatable missions reset right away so they go back to "in progress"
    // and can be earned + claimed again. One-time missions stay claimed.
    let updatedState = { progress: claimedRecord.progress, claimed: true, completed: true };
    if (mission.repeatable) {
      await UserMission.updateOne(
        { userId, missionId },
        { $set: { progress: 0, claimed: false }, $inc: { timesClaimed: 1 } }
      );
      updatedState = { progress: 0, claimed: false, completed: false };
    }

    res.json({
      success: true,
      message: 'Reward claimed!',
      rewardType: mission.rewardType,
      rewardAmount: mission.rewardAmount,
      mission: updatedState,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;