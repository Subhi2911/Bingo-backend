const mongoose = require('mongoose');

const userMissionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  missionId: { type: Number, required: true },
  progress: { type: Number, default: 0 },
  claimed: { type: Boolean, default: false },
  claimedAt: { type: Date },
  timesClaimed: { type: Number, default: 0 },
});

userMissionSchema.index({ userId: 1, missionId: 1 }, { unique: true });

module.exports = mongoose.model('UserMission', userMissionSchema);