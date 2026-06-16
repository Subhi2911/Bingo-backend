const router = require("express").Router();
const Notification = require("../models/Notification");
const fetchuser = require("../middleware/fetchuser");
const { decrypt } = require("../utils/encryption");
const checkFrozen = require('../middleware/checkFrozen');

// GET all notifications for a user
router.get("/", fetchuser, checkFrozen, async (req, res) => {
  try {
    const notifications = await Notification.find({ user: req.user.id })
      .sort({ createdAt: -1 });
    res.status(200).json(notifications);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

// MARK A NOTIFICATION AS READ
router.patch("/:id/read", fetchuser, checkFrozen, async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);
    if (!notification) return res.status(404).json({ error: "Notification not found" });
    if (notification.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not allowed" });
    }

    notification.read = true;
    await notification.save();

    res.status(200).json(notification);
  } catch (err) {
    res.status(500).json({ error: "Failed to update notification" });
  }
});

module.exports = router;