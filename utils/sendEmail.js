const nodemailer = require('nodemailer');

async function sendEmail(to, subject, html) {
    const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
    });

    await transporter.verify();
    console.log("SMTP connected");

    await transporter.sendMail({
        from: `"BingoBing" <${process.env.EMAIL_USER}>`,
        to,
        subject,
        html
    });
}

module.exports = sendEmail;