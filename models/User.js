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
    wins: {
        classic: { type: Number },
        fast: { type: Number },
        power: { type: Number },
        private: { type: Number }
    },
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
    stars: {
        type: Number,
        min: 0,
        max: 5,
        default: 0
    },
    lastDailyClaim: {
        type: Date,
        default: null
    },
    lastSessionAt: Date,
    dailySessionCount: Number,
    daysLoggedIn: {
        type: Number,
        default: 0
    },
    totalXp: {
        type: Number,
        default: 0
    },
    levelXp: {
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
    lastProcessedGame: {
        type: String,
        default: null
    },
    lastSpin: { type: Date },
    doubleCoinsTill: { type: Date },
    fcmToken: {
        type: String,
        default: ""
    },

    // ── Shop: coin-purchased skins ────────────────────────────────────────────
    ownedBoards: {
        type: [String],
        default: ['classic'],       // everyone starts with classic
    },
    ownedDaubs: {
        type: [String],
        default: ['daub'],          // everyone starts with same
    },

    // ── Shop: real-money consumables ──────────────────────────────────────────
    extraDaubs: { type: Number, default: 0 },
    xpBoosts: { type: Number, default: 0 },
    instantClaims: { type: Number, default: 0 },
    spins: { type: Number, default: 0 },

    // ── Purchase history (real money only) ────────────────────────────────────
    purchaseHistory: [
        {
            itemId: Number,
            itemName: String,
            paymentId: String,
            purchasedAt: { type: Date, default: Date.now },
        }
    ],
    weeklyClaims: {
        type: [Boolean],
        default: [false, false, false, false, false, false, false], // index 0=Mon ... 6=Sun
    },
    weekAnchor: { type: Date, default: null }, // Monday 00:00 of the tracked week
    streak: { type: Number, default: 0 },      // actual consecutive-day streak
    totalGamesPlayed: { type: Number, default: 0 },
    isFrozen: { type: Boolean, default: false },
    freezeReason: { type: String, default: null },      // 'reported' | 'wrongful_report'
    freezeUntil: { type: Date, default: null },        // null = indefinite (admin decides)
    freezeMessage: { type: String, default: null },      // shown to user in app
    frozenCount: {
        type: Number,
        default: 0
    }
});


const User = mongoose.model('User', UserSchema);
module.exports = User;