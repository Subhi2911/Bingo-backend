const User = require("../models/User");

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
  return MYSTERY_PRIZES[0];
}

const DAILY_REWARDS = {
  1: { type: "coins", value: 100 },
  2: { type: "xp", value: 2 },
  3: { type: "coins", value: 150 },
  4: { type: "mystery" },
  5: { type: "spin", value: 1 },
  6: { type: "xp", value: 4 },
  7: { type: "coins", value: 1000 },
};

// Monday 00:00 of the week containing `date`
function getWeekAnchor(date) {
  const d = new Date(date);
  const diff = (d.getDay() + 6) % 7; // days since Monday
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - diff);
  return d;
}

exports.claimDailyReward = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const now = new Date();
    const lastClaim = user.lastDailyClaim ? new Date(user.lastDailyClaim) : null;
    const MS_24H = 24 * 60 * 60 * 1000;

    if (lastClaim && now.getTime() - lastClaim.getTime() < MS_24H) {
      return res.status(400).json({ message: "Already claimed today. Come back tomorrow!" });
    }

    // ── Weekly claim tracker — reset only when the week actually rolls over ──
    const thisWeekAnchor = getWeekAnchor(now);
    const storedAnchor = user.weekAnchor ? new Date(user.weekAnchor).getTime() : null;
    if (storedAnchor !== thisWeekAnchor.getTime() || !Array.isArray(user.weeklyClaims) || user.weeklyClaims.length !== 7) {
      user.weeklyClaims = [false, false, false, false, false, false, false];
      user.weekAnchor = thisWeekAnchor;
    }

    // ── Streak (separate from lifetime daysLoggedIn) ──────────────────────
    if (!lastClaim) {
      user.streak = 1;
    } else {
      const todayMid = new Date(now); todayMid.setHours(0, 0, 0, 0);
      const lastMid = new Date(lastClaim); lastMid.setHours(0, 0, 0, 0);
      const daysDiff = Math.round((todayMid - lastMid) / (1000 * 60 * 60 * 24));
      user.streak = daysDiff === 1 ? (user.streak || 0) + 1 : 1;
    }
    user.daysLoggedIn = (user.daysLoggedIn || 0) + 1; // lifetime total, never resets

    // ── Resolve today's slot & reward ──────────────────────────────────────
    const jsDay = now.getDay();
    const daySlot = jsDay === 0 ? 7 : jsDay; // Mon=1 ... Sun=7
    const reward = DAILY_REWARDS[daySlot];

    let mysteryPrize = null;

    if (reward.type === "coins") {
      user.money = (user.money || 0) + reward.value;
    } else if (reward.type === "xp") {
      user.totalXp = (user.totalXp || 0) + reward.value;
      user.levelXp = (user.levelXp || 0) + reward.value;
      while (user.levelXp >= 100) { user.levelXp -= 100; user.level = (user.level || 1) + 1; }
    } else if (reward.type === "spin") {
      user.spins = (user.spins || 0) + reward.value;
    } else if (reward.type === "mystery") {
      mysteryPrize = pickMysteryPrize();
      if (mysteryPrize.type === "coins") {
        user.money = (user.money || 0) + mysteryPrize.value;
      } else if (mysteryPrize.type === "xp") {
        user.totalXp = (user.totalXp || 0) + mysteryPrize.value;
        user.levelXp = (user.levelXp || 0) + mysteryPrize.value;
        while (user.levelXp >= 100) { user.levelXp -= 100; user.level = (user.level || 1) + 1; }
      } else if (mysteryPrize.type === "days") {
        user.streak += mysteryPrize.value;
      }
    }

    // ── Mark this slot claimed & stamp time (single source of truth) ──────
    user.weeklyClaims[daySlot - 1] = true;
    user.lastDailyClaim = now;

    await user.save();

    return res.json({ success: true, user, mysteryPrize: mysteryPrize || undefined });
  } catch (error) {
    console.error("daily-claim error:", error);
    res.status(500).json({ message: "Server error" });
  }
};