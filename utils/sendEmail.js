const nodemailer = require('nodemailer');

async function sendEmail(to, subject, html) {
    const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,          
        secure: false,      
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });

    await transporter.sendMail({
        from: `"BingoBing" <${process.env.EMAIL_USER}>`, 
        subject,
        html
    });
}

module.exports = sendEmail;