const mongoose = require('mongoose');
const ReportsSchema = mongoose.Schema({
    reportedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    reportedUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    reason: {
        type: String,
        required: true,
        maxlength: 500,
    },
    date: {
        type: Date,
        default: Date.now,
    },
});

const Report = mongoose.model('Report', ReportsSchema);
module.exports = Report;