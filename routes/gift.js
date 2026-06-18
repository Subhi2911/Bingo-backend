const express  = require('express');
const router   = express.Router();
const fetchuser = require('../middleware/fetchuser');
const User     = require('../models/User');
const Gift     = require('../models/Gifts');
const Message  = require('../models/Messages'); 

// Minimum / maximum gift amounts
const MIN_GIFT = 10;
const MAX_GIFT = 5000;

// POST /api/gifts/send
router.post('/send', fetchuser, async (req, res) => {
    const { receiverId, chatId, amount, message } = req.body;
    const senderId = req.user.id;

    // ── Basic validation ──────────────────────────────────────────────────────
    if (!receiverId || !chatId || !amount)
        return res.status(400).json({ message: 'receiverId, chatId and amount are required' });

    if (senderId === receiverId)
        return res.status(400).json({ message: 'Cannot gift yourself' });

    const coins = parseInt(amount, 10);
    if (isNaN(coins) || coins < MIN_GIFT || coins > MAX_GIFT)
        return res.status(400).json({ message: `Amount must be between ${MIN_GIFT} and ${MAX_GIFT}` });

    try {
        // ── Verify sender has enough coins (atomic) ───────────────────────────
        const sender = await User.findOneAndUpdate(
            { _id: senderId, money: { $gte: coins } },
            { $inc: { money: -coins } },
            { new: true }
        );
        if (!sender)
            return res.status(400).json({ message: 'Not enough coins' });

        // ── Credit receiver ───────────────────────────────────────────────────
        const receiver = await User.findByIdAndUpdate(
            receiverId,
            { $inc: { money: coins } },
            { new: true }
        );
        if (!receiver) {
            // Roll back sender deduction if receiver missing
            await User.findByIdAndUpdate(senderId, { $inc: { money: coins } });
            return res.status(404).json({ message: 'Receiver not found' });
        }

        // ── Save gift record ──────────────────────────────────────────────────
        const gift = await Gift.create({
            sender: senderId, receiver: receiverId,
            chatId, type: 'coins', amount: coins,
            message: message?.slice(0, 100) || '',
        });

        // ── Also save a visible chat message ─────────────────────────────────
        const giftText = `🎁 Gift: ${coins} coins${message ? ` — "${message}"` : ''}`;
        const chatMessage = await Message.create({
            chatId, sender: senderId,
            text: giftText, type: 'gift',
        });

        // ── Emit socket events ────────────────────────────────────────────────
        // (attach `io` to req via middleware, or import it from your socket module)
        const io = req.app.get('io');
        if (io) {
            // Notify recipient
            io.to(`user_${receiverId}`).emit('gift_received', {
                giftId:     gift._id,
                senderId,
                senderName: sender.username,
                senderAvatar: sender.avatar,
                coins,
                message:    gift.message,
                chatId,
            });
            // Broadcast the chat message to both users in the room
            io.to(chatId.toString()).emit('receiveMessage', chatMessage);
        }

        res.status(200).json({
            success: true,
            newBalance: sender.money,
            gift: { _id: gift._id, amount: coins, message: gift.message },
        });
    } catch (err) {
        console.error('Gift send error:', err);
        res.status(500).json({ message: 'Failed to send gift' });
    }
});

// GET /api/gifts/history/:chatId  — list gifts in a chat
router.get('/history/:chatId', fetchuser, async (req, res) => {
    try {
        const gifts = await Gift.find({ chatId: req.params.chatId })
            .sort({ createdAt: -1 })
            .limit(50)
            .populate('sender', 'username avatar')
            .populate('receiver', 'username avatar');
        res.json(gifts);
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch gifts' });
    }
});

module.exports = router;