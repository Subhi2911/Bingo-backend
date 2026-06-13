const Brevo = require('@getbrevo/brevo');

const client = Brevo.ApiClient.instance;
client.authentications['api-key'].apiKey = process.env.BREVO_API_KEY;

const emailApi = new Brevo.TransactionalEmailsApi();

async function sendEmail(to, subject, html) {
    console.log("Sending email to", to);
    await emailApi.sendTransacEmail({
        sender: { name: 'BingoBing', email: process.env.BREVO_SENDER_EMAIL },
        to: [{ email: to }],
        subject,
        htmlContent: html
    });
}

module.exports = sendEmail;