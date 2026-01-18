const mongoose = require('mongoose');
const UserSchema = mongoose.Schema({
    avatar: {
        type: String,
        default: ''
    },
    avatarLocked: {
        type: Boolean,
        default: false,
    },
    username: {
        type: String,
        required: true,
        unique: true,
        minlength: 3
    },
    email: {
        type: String,
        required: true,
        unique: true,
        match: [/\S+@\S+\.\S+/, 'Invalid email format']
    },
    password: {
        type: String,
        required: true
    },
    date: {
        type: Date,
        default: Date.now
    },
    bio: {
        type: String,
        default: 'Hey there!! I enjoy writing blogs.What about you?'
    },
    pendingRequests: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    sentRequests: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    friends: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    }],
    wins: [{
        classic: {
            type: Number,
        },
        fast: {
            type: Number,
        },
        power: {
            type: Number,
        },
        private: {
            type: Number,
        }
    }],
    otp: String,
    otpExpiry: Date,
    otpVerified: { type: Boolean, default: false },
    money: {
        type: Number,
        default: 0
    },
    level: {
        type: Number,
        default: 1
    },
    lastDailyClaim: {
        type: Date,
        default: null
    },

    lastSessionAt: Date,      // last time counted
    dailySessionCount: Number,

    daysLoggedIn: {
        type: Number,
        default: 0
    },
    xp: {
        type: Number,
        default: 0
    },
    rank: {
        type: Number,
        default: 0
    },
    playerId: {
        type: String,
        unique: true,
        index: true,
    },

})

const User = mongoose.model('User', UserSchema);
module.exports = User;