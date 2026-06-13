const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendEmail(to, subject, html) {
    await resend.emails.send({
        from: 'BingoBing <onboarding@resend.dev>', // use this until you verify a domain
        to,
        subject,
        html
    });
}

module.exports = sendEmail;