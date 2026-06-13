const SibApiV3Sdk = require('sib-api-v3-sdk');

const client = SibApiV3Sdk.ApiClient.instance;
client.authentications['api-key'].apiKey = process.env.BREVO_API_KEY;

const emailApi = new SibApiV3Sdk.TransactionalEmailsApi();

async function sendEmail(to, subject, html) {
    console.log("Sending email to", to);
    try {
        const result = await emailApi.sendTransacEmail({
            sender: { name: 'BingoBing', email: process.env.BREVO_SENDER_EMAIL },
            to: [{ email: to }],
            subject,
            htmlContent: html
        });
        console.log("Email sent successfully:", result); // will show messageId if OK
    } catch (err) {
        console.error("Brevo error:", err?.response?.body || err.message);
    }
}

module.exports = sendEmail;