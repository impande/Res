'use strict';
/* Sends the report over SMTP. Defaults are for Gmail: set SMTP_USER to the
 * Gmail address and SMTP_PASS to a 16-character Google *App Password*
 * (Google Account → Security → 2-Step Verification → App passwords). */
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

async function sendReport(report, { to }) {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) throw new Error('SMTP_USER / SMTP_PASS not set — report saved locally but not emailed');
  const port = +(process.env.SMTP_PORT || 465);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port, secure: port === 465,
    auth: { user, pass: pass.replace(/\s+/g, '') },   // Google shows app passwords with spaces
  });

  // Attach the full report + JSON, and up to 8 failure screenshots.
  const attachments = [
    { filename: 'report.html', path: report.htmlPath },
    { filename: 'report.json', path: report.jsonPath },
    ...report.screenshots.slice(0, 8).map(f => ({ filename: path.basename(f), path: f })),
  ].filter(a => fs.existsSync(a.path));

  await transport.sendMail({
    from: `"resume4u Audit Agent" <${process.env.SMTP_FROM || user}>`,
    to,
    subject: report.subject,
    text: report.summaryLine + '\n\nOpen the HTML version of this email (or the attached report.html) for the full breakdown.',
    html: report.html,
    attachments,
  });
}

module.exports = { sendReport };
