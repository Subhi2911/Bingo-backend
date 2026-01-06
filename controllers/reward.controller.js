const User = require("../models/User");

exports.claimDailyReward = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const now = new Date();

    // ✅ If already claimed → block
    if (user.lastDailyClaim) {
      const diff = now - user.lastDailyClaim; // ms
      const hoursPassed = diff / (1000 * 60 * 60);

      if (hoursPassed < 24) {
        const remaining = Math.ceil(24 - hoursPassed);
        return res.status(400).json({
          message: `Daily reward already claimed. Come back in ${remaining}h`,
          reward:0,
          user,
        });
      }
    }

    // ✅ NEW DAY → allow claim
    user.daysLoggedIn += 1;

    // 🎁 Reward mapping
    const rewards = {
      1: { coins: 100 },
      2: { xp: 2 },
      3: { coins: 150 },
      4: { mystery: true },
      5: { spin: 1 },
      6: { xp: 4 },
      7: { coins: 1000 },
    };

    const day = ((user.daysLoggedIn - 1) % 7) + 1;
    const reward = rewards[day];

    if (reward.coins) user.money += reward.coins;
    if (reward.xp) user.xp += reward.xp;

    user.lastDailyClaim = now;

    await user.save();

    res.json({
      message: "Daily reward claimed!",
      reward,
      user,
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};
