const express = require("express");
const router = express.Router();
const sendEmail = require("../utils/sendEmail");
const Emailverification = require("../models/Emailverification");
const User = require("../models/User");

// Step 1: Send OTP
router.post('/sendemailotp', async (req, res) => {
  try {

    const { email } = req.body;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes

    //const otp = Math.floor(100000 + Math.random() * 900000).toString();
    //const otpExpiry = Date.now() + 10 * 60 * 1000;
    const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: Arial, sans-serif;
      background-color: #f4f4f4;
      padding: 20px;
    }

    .container {
      max-width: 600px;
      margin: auto;
      background: white;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }

    .header {
      background: #52357B;
      color: white;
      text-align: center;
      padding: 25px;
    }

    .content {
      padding: 30px;
      color: #333;
      line-height: 1.6;
    }

    .otp {
      font-size: 32px;
      font-weight: bold;
      text-align: center;
      letter-spacing: 8px;
      color: #52357B;
      background: #f5f2ff;
      padding: 15px;
      border-radius: 8px;
      margin: 20px 0;
    }

    .footer {
      text-align: center;
      color: #888;
      font-size: 12px;
      padding: 20px;
      border-top: 1px solid #eee;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>BingoBing</h1>
      <p>Email Verification</p>
    </div>

    <div class="content">
      <h2>Hello 👋</h2>

      <p>
        Thank you for joining <strong>BingoBing</strong>.
        To complete your registration, please verify your email address using the OTP below:
      </p>

      <div class="otp">${otp}</div>

      <p>
        This OTP is valid for <strong>10 minutes</strong>.
        Please do not share this code with anyone.
      </p>

      <p>
        If you did not request this verification, you can safely ignore this email.
      </p>
    </div>

    <div class="footer">
      © ${new Date().getFullYear()} BingoBing. All rights reserved.
    </div>
  </div>
</body>
</html>
`;
    await Emailverification.findOneAndUpdate(
      { email },
      { otp, otpExpiry },
      { upsert: true, new: true }
    );

    await sendEmail(email, "Verify your BingoBing account", html);

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "Email already registered" });
    }

    // Create or update OTP record
    await Emailverification.findOneAndUpdate(
      { email },
      { otp, otpExpiry },
      { upsert: true, new: true }
    );

    // Send email

    await sendEmail(email, "Verify your BingoBing account", html);

    res.json({ success: true, message: "OTP sent to email" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to send OTP" ,error_msg:err});
  }
});

// Step 2: Verify OTP
router.post('/verifyemailotp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const record = await Emailverification.findOne({ email });

    if (!record) {
      return res.status(400).json({ success: false, error: "No OTP found" });
    }
    if (record.otp !== otp || record.otpExpiry < Date.now()) {
      return res.status(400).json({ success: false, error: "Invalid or expired OTP" });
    }

    // Mark verified (delete record)
    await Emailverification.deleteOne({ email });

    res.json({ success: true, message: "OTP verified" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to verify OTP" });
  }
});

module.exports = router;
