const MAX_STARS = 5;
const MAX_LEVEL = 100;

const WIN_XP = 10;
const LOSS_XP = -10;

const getXpNeeded = (level) => 10 + level * 6;

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const updateProgressWithXP = (user, didWin, bonusXP = 0) => {
    let level = user.level || 1;
    let xp = user.xp || 0;

    const earnedXP = (didWin ? WIN_XP : LOSS_XP) + bonusXP;

    xp = clamp(xp + earnedXP, 0, Infinity);

    let xpNeeded = getXpNeeded(level);

    //Level up if xp crosses level bar
    while (xp >= xpNeeded && level < MAX_LEVEL) {
        xp -= xpNeeded;
        level += 1;
        xpNeeded = getXpNeeded(level);
    }

    // 🔻 Level down if xp goes negative
    while (xp < 0 && level > 1) {
        level -= 1;
        xp += getXpNeeded(level);
        xpNeeded = getXpNeeded(level);
    }

    // ⭐ Stars are derived, not stored
    const starSize = xpNeeded / MAX_STARS;
    const stars = Math.floor(xp / starSize);

    return {
        level,
        xp,
        stars,
        xpNeeded,
        earnedXP,
    };
};

module.exports = { updateProgressWithXP, getXpNeeded };
