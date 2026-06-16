// middleware/checkFrozen.js
const User = require("../models/User");

const checkFrozen = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('isFrozen freezeUntil freezeMessage freezeReason');
    if (!user) return res.status(404).json({ error: "User not found" });

    // Auto-unfreeze if freezeUntil has passed
    if (user.isFrozen && user.freezeUntil && new Date() > user.freezeUntil) {
      await User.findByIdAndUpdate(req.user.id, {
        isFrozen: false,
        freezeReason: null,
        freezeUntil: null,
        freezeMessage: null,
        frozenCount: user.frozenCount+1 || 1
      });
      return next();
    }

    if (user.isFrozen) {
      return res.status(403).json({
        error: "account_frozen",
        message: user.freezeMessage,
        freezeUntil: user.freezeUntil,
        freezeReason: user.freezeReason,
      });
    }

    next();
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

module.exports = checkFrozen;