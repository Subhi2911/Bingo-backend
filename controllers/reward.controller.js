const User = require("../models/User");

exports.claimDailyReward = async (req, res) => {

  const MYSTERY_PRIZES = [
    { label: "50 coins", type: "coins", value: 50, weight: 40 },
    { label: "200 coins", type: "coins", value: 200, weight: 25 },
    { label: "500 coins", type: "coins", value: 500, weight: 10 },
    { label: "2 XP", type: "xp", value: 2, weight: 30 },
    { label: "10 XP", type: "xp", value: 10, weight: 20 },
    { label: "25 XP", type: "xp", value: 25, weight: 8 },
    { label: "+1 Day", type: "days", value: 1, weight: 5 },
  ];

  function pickMysteryPrize() {
    const totalWeight = MYSTERY_PRIZES.reduce((s, p) => s + p.weight, 0);
    let rand = Math.random() * totalWeight;
    for (const prize of MYSTERY_PRIZES) {
      rand -= prize.weight;
      if (rand <= 0) return prize;
    }
    return MYSTERY_PRIZES[0]; // fallback
  }

  const DAILY_REWARDS = {
    1: { type: "coins", value: 100 },
    2: { type: "xp", value: 2 },
    3: { type: "coins", value: 150 },
    4: { type: "mystery" },   // resolved below
    5: { type: "spin", value: 1 },
    6: { type: "xp", value: 4 },
    7: { type: "coins", value: 1000 },
  };
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const now = Date.now();
    const lastClaim = user.lastDailyClaim ? new Date(user.lastDailyClaim).getTime() : null;
    const MS_24H = 24 * 60 * 60 * 1000;
    const MS_48H = 48 * 60 * 60 * 1000;

    // ── Guard: already claimed today ─────────────────────────────────
    if (lastClaim && now - lastClaim < MS_24H) {
      return res.status(400).json({ message: "Already claimed today. Come back tomorrow!" });
    }

    // ── BUG FIX: reset streak if user missed a day (gap > 48h) ──────
    // We allow up to 48 h so timezone differences don't punish users.
    if (lastClaim && now - lastClaim >= MS_48H) {
      user.daysLoggedIn = 0;   // streak broken — reset to 0
    }

    // ── Increment streak ─────────────────────────────────────────────
    user.daysLoggedIn = (user.daysLoggedIn || 0) + 1;

    // ── Determine today's reward slot (1–7, cycling) ─────────────────
    // Use real calendar weekday: Mon=1 … Sun=7
    const jsDay = new Date().getDay();          // 0=Sun … 6=Sat
    const daySlot = jsDay === 0 ? 7 : jsDay;     // Sun→7, Mon→1 … Sat→6

    const reward = DAILY_REWARDS[daySlot];

    // ── Apply reward ─────────────────────────────────────────────────
    let mysteryPrize = null;

    if (reward.type === "coins") {
      user.money = (user.money || 0) + reward.value;

    } else if (reward.type === "xp") {
      user.totalXp = (user.totalXp || 0) + reward.value;
      user.levelXp = (user.levelXp || 0) + reward.value;
      // Level-up check (every 100 XP)
      while (user.levelXp >= 100) {
        user.levelXp -= 100;
        user.level = (user.level || 1) + 1;
      }

    } else if (reward.type === "spin") {
      user.spins = (user.spins || 0) + reward.value;

    } else if (reward.type === "mystery") {
      // Pick a random prize and apply it
      mysteryPrize = pickMysteryPrize();

      if (mysteryPrize.type === "coins") {
        user.money = (user.money || 0) + mysteryPrize.value;

      } else if (mysteryPrize.type === "xp") {
        user.totalXp = (user.totalXp || 0) + mysteryPrize.value;
        user.levelXp = (user.levelXp || 0) + mysteryPrize.value;
        while (user.levelXp >= 100) {
          user.levelXp -= 100;
          user.level = (user.level || 1) + 1;
        }

      } else if (mysteryPrize.type === "days") {
        // Bonus streak day — don't reset; just add
        user.daysLoggedIn += mysteryPrize.value;
      }
    }

    // ── Stamp claim time ─────────────────────────────────────────────
    user.lastDailyClaim = new Date(now);

    await user.save();

    return res.json({
      success: true,
      user,
      // Only present on Mystery Box day so frontend knows to show modal
      mysteryPrize: mysteryPrize || undefined,
    });

  } catch (error) {
    console.error("daily-claim error:", error);
    res.status(500).json({ message: "Server error" });
  }
};
