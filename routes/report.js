// routes/report.js
const router = require("express").Router();
const fetchuser = require("../middleware/fetchuser");
const Report = require("../models/Report");
const User = require("../models/User");

module.exports = (io) => {
  router.post("/report/:userId", fetchuser, async (req, res) => {
    try {
      const { reason } = req.body;
      const reportedId = req.params.userId;
      const reporterId = req.user.id;

      if (reportedId === reporterId)
        return res.status(400).json({ error: "Cannot report yourself" });

      const existing = await Report.findOne({
        reporter: reporterId,
        reported: reportedId,
        status: "pending",
      });
      if (existing)
        return res.status(400).json({ error: "Already reported this user" });

      const report = new Report({ reporter: reporterId, reported: reportedId, reason });
      await report.save();

      // Freeze reported user in DB
      const updatedUser = await User.findByIdAndUpdate(
        reportedId,
        {
          isFrozen: true,
          freezeReason: "reported",
          freezeUntil: null,
          freezeMessage: "Your account has been temporarily frozen due to a report. Our team is reviewing it.",
          $inc: { freezeCount: 1 },
        },
        
        { new: true }
      );

      // Emit to reported user's socket immediately
      io.to(reportedId.toString()).emit("accountFrozen", {
        message: updatedUser.freezeMessage,
        freezeUntil: updatedUser.freezeUntil,
        reason: updatedUser.freezeReason,
      });

      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // resolve + unfreeze routes stay same, just add emit there too:
  router.post("/resolve/:reportId", fetchuser, async (req, res) => {
    try {
      const { verdict, freezeDays, adminMessage } = req.body;
      const report = await Report.findById(req.params.reportId);
      if (!report) return res.status(404).json({ error: "Report not found" });
      if (report.status !== "pending") return res.status(400).json({ error: "Already resolved" });

      report.status = verdict;
      report.resolvedAt = new Date();
      await report.save();

      const freezeUntil = freezeDays
        ? new Date(Date.now() + freezeDays * 24 * 60 * 60 * 1000)
        : null;

      if (verdict === "guilty") {
        const updated = await User.findByIdAndUpdate(report.reported, {
          isFrozen: true,
          freezeUntil,
          freezeMessage: adminMessage || `Account frozen for a violation.${freezeDays ? ` Duration: ${freezeDays} days.` : ""}`,
        }, { new: true });

        io.to(report.reported.toString()).emit("accountFrozen", {
          message: updated.freezeMessage,
          freezeUntil: updated.freezeUntil,
          reason: updated.freezeReason,
        });

        // Unfreeze reporter
        await User.findByIdAndUpdate(report.reporter, {
          isFrozen: false, freezeReason: null, freezeUntil: null, freezeMessage: null,
        });
        io.to(report.reporter.toString()).emit("accountUnfrozen");

      } else if (verdict === "innocent") {
        // Unfreeze reported
        await User.findByIdAndUpdate(report.reported, {
          isFrozen: false, freezeReason: null, freezeUntil: null, freezeMessage: null,
        });
        io.to(report.reported.toString()).emit("accountUnfrozen");

        // Freeze reporter
        const updated = await User.findByIdAndUpdate(report.reporter, {
          isFrozen: true,
          freezeReason: "wrongful_report",
          freezeUntil,
          freezeMessage: adminMessage || `Account frozen for filing a false report.${freezeDays ? ` Duration: ${freezeDays} days.` : ""}`,
        }, { new: true });

        io.to(report.reporter.toString()).emit("accountFrozen", {
          message: updated.freezeMessage,
          freezeUntil: updated.freezeUntil,
          reason: updated.freezeReason,
        });
      }

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Server error" });
    }
  });

  return router;
};