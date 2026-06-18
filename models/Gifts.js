const mongoose = require('mongoose');

const GiftSchema = new mongoose.Schema({
    sender:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    receiver:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    chatId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true },
    type:      { type: String, enum: ['coins'], default: 'coins' },
    amount:    { type: Number, required: true, min: 1 },
    message:   { type: String, default: '', maxlength: 100 },
    createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Gift', GiftSchema);