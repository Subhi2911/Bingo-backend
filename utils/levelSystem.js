const MAX_STARS = 5;
const MAX_LEVEL = 100;

const XP_PER_LEVEL = 100;

const XP_MAP = {
    classic: 10,
    fast: 15,
    power: 20,
};

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const updateProgressWithXP = (
    user,
    didWin,
    gameType,
    bonusXP = 0
) => {
    let level = user.level || 1;
    let levelXp = user.levelXp || 0;
    let totalXp = user.totalXp || 0;

    const baseXP = XP_MAP[gameType] || 0;
    const earnedXP = (didWin ? baseXP : -baseXP) + bonusXP;

    // ✅ Total XP only increases
    if (earnedXP > 0) {
        totalXp += earnedXP;
    }

    // ✅ Level XP rolls forward/backward
    levelXp += earnedXP;

    // Clamp level 1
    if (level === 1 && levelXp < 0) {
        levelXp = 0;
    }

    // 🔼 Level up (rollover XP)
    while (levelXp >= XP_PER_LEVEL && level < MAX_LEVEL) {
        levelXp -= XP_PER_LEVEL;
        level++;
    }

    // 🔽 Level down (optional but consistent)
    while (levelXp < 0 && level > 1) {
        level--;
        levelXp += XP_PER_LEVEL;
    }

    // ⭐ Stars derived from level XP
    const stars = Math.floor(
        (levelXp / XP_PER_LEVEL) * MAX_STARS
    );

    return {
        level,
        levelXp,
        totalXp,
        stars,
        xpNeeded: XP_PER_LEVEL,
        earnedXP,
    };
};

module.exports = { updateProgressWithXP };
