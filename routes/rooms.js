const express = require('express');
const router = express.Router();
const Room = require('../models/Room');
const fetchuser = require('../middleware/fetchuser'); // optional auth middleware

// GET /api/rooms/:roomCode
router.get('/:roomCode', fetchuser, async (req, res) => {
    try {
        const { roomCode } = req.params;
        const room = await Room.findOne({ roomCode });

        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        res.json({
            roomCode: room.roomCode,
            gameType: room.gameType,
            size: room.size,
            password: room.password ? true : false,
            players: room.players,
            gameStarted: room.gameStarted,
        });
    } catch (err) {
        console.error('Error fetching room:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;