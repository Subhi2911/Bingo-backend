exports.getMe = async (req, res) => {
  const user = req.user;
  const now = new Date();

  const isNewDay =
    !user.lastSessionAt ||
    now.toDateString() !== user.lastSessionAt.toDateString();

  if (isNewDay) {
    user.dailySessionCount += 1;
    user.lastSessionAt = now;
    await user.save();
  }

  res.json({ user });
};
