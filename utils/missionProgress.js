const Mission = require('../models/Missions');
const UserMission = require('../models/UserMissions');

/**
 * Call this anywhere in the app when a user does something that might
 * count toward a mission, e.g.:
 *   incrementMissionProgress(userId, 'win_games', 1);
 *
 * Finds every mission with a matching `type`, bumps progress (capped at
 * the mission's target), and leaves claiming entirely to the
 * /api/missions/:id/claim route.
 */
async function incrementMissionProgress(userId, type, amount = 1) {
    try {
        const missions = await Mission.find({ type });
        if (!missions.length) return;

        for (const mission of missions) {
            const um = await UserMission.findOneAndUpdate(
                { userId, missionId: mission.id },
                { $setOnInsert: { progress: 0, claimed: false } },
                { upsert: true, new: true }
            );

            if (um.progress < mission.target) {
                const newProgress = Math.min(um.progress + amount, mission.target);
                await UserMission.updateOne({ _id: um._id }, { $set: { progress: newProgress } });
            }
        }
    } catch (err) {
        console.log('incrementMissionProgress failed:', err);
    }
}

async function resetStreakOnLoss(userId, type) {
    try {
        const missions = await Mission.find({ type });
        for (const mission of missions) {
            await UserMission.updateOne(
                { userId, missionId: mission.id, progress: { $lt: mission.target } },
                { $set: { progress: 0 } }
            );
        }
    } catch (err) {
        console.log('resetStreakOnLoss failed:', err);
    }
}

async function setMissionProgress(userId, type, value) {
    try {
        const missions = await Mission.find({ type });
        for (const mission of missions) {
            const um = await UserMission.findOneAndUpdate(
                { userId, missionId: mission.id },
                { $setOnInsert: { progress: 0, claimed: false } },
                { upsert: true, new: true }
            );
            // never lower progress, never exceed target
            const newProgress = Math.min(Math.max(um.progress, value), mission.target);
            if (newProgress !== um.progress) {
                await UserMission.updateOne({ _id: um._id }, { $set: { progress: newProgress } });
            }
        }
    } catch (err) {
        console.log('setMissionProgress failed:', err);
    }
}

module.exports = { incrementMissionProgress, setMissionProgress, resetStreakOnLoss };