const mongoose = require('mongoose');

const missionSchema = new mongoose.Schema({
    id: {
        type: Number,
        required: true,
        unique: true
    },
    title: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    reward: {
        type: String,
        required: true
    },
    rewardType: {
        type: String,
        enum: ['XP', 'coins'],
        required: true
    },
    rewardAmount: {
        type: Number,
        required: true
    },
    type: { type: String, required: true },        // e.g. 'play_games', 'win_games', 'send_messages'
    target: { type: Number, required: true, default: 1 }, // how many times `type` must fire to complete
    repeatable: { type: Boolean, default: true },
});

module.exports = mongoose.model('Mission', missionSchema);