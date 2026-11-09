'use strict';

// Brevo (formerly Sendinblue) HTTP API mailer
// Replaces Nodemailer SMTP — fetch() works natively on Cloudflare Workers.
// Required env vars:
//   BREVO_API_KEY  — from Brevo Dashboard > Settings > API Keys
//   FROM_EMAIL     — a verified sender address on your Brevo account (e.g. no-reply@sciandsoc.in)

const sendMail = async (to, subject, html, attachments = []) => {
  const apiKey = process.env.BREVO_API_KEY;
  const fromEmail = process.env.FROM_EMAIL || 'no-reply@sciandsoc.in';

  if (!apiKey) {
    console.error('[Mailer] BREVO_API_KEY is not set — email not sent.');
    return false;
  }

  const body = {
    sender: { name: 'Science & Society', email: fromEmail },
    to: [{ email: to }],
    subject,
    htmlContent: html,
  };

  // Convert nodemailer-style attachments to Brevo format (base64 content)
  if (attachments && attachments.length > 0) {
    body.attachment = attachments.map(att => ({
      name: att.filename || att.name || 'attachment',
      content: Buffer.isBuffer(att.content)
        ? att.content.toString('base64')
        : Buffer.from(att.content || '').toString('base64'),
    }));
  }

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[Mailer] Brevo API error:', response.status, errText);
      return false;
    }

    const result = await response.json();
    console.log('[Mailer] Message sent. Brevo messageId:', result.messageId);
    return true;

  } catch (error) {
    console.error('[Mailer] fetch() error:', error);
    return false;
  }
};

module.exports = { sendMail };
