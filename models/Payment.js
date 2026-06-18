// ──────────────────────────────────────────────────────────────────────────────
// models/Payment.js - Payment transaction tracking
// ──────────────────────────────────────────────────────────────────────────────

const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        itemId: {
            type: Number,
            required: true,
            enum: [3, 4, 6, 9], // Item IDs with Razorpay enabled
        },
        itemName: {
            type: String,
            required: true,
        },
        amount: {
            type: Number,
            required: true,
        },
        currency: {
            type: String,
            default: 'INR',
        },
        razorpayOrderId: {
            type: String,
            required: true,
            unique: true,
        },
        paymentId: {
            type: String,
            unique: true,
            sparse: true,
        },
        signature: {
            type: String,
        },
        status: {
            type: String,
            enum: ['pending', 'authorized', 'completed', 'failed', 'refunded'],
            default: 'pending',
        },
        reason: {
            type: String, // Failure reason if status is 'failed'
        },
        completedAt: {
            type: Date,
        },
    },
    { timestamps: true }
);

// Index for quick lookups
paymentSchema.index({ userId: 1, createdAt: -1 });
paymentSchema.index({ status: 1 });
paymentSchema.index({ razorpayOrderId: 1 });

module.exports = mongoose.model('Payment', paymentSchema);