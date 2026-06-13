const mongoose = require("mongoose");

const EmailverificationSchema = new mongoose.Schema({
  email:     { type: String, required: true, unique: true },
  otp:       { type: String, required: true },
  otpExpiry: { type: Date,   required: true },
  createdAt: { 
    type: Date, 
    default: Date.now, 
    expires: 600  
  },
});

module.exports = mongoose.model("Emailverification", EmailverificationSchema);