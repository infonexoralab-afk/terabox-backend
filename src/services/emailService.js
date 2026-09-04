const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = null;
    this._initTransporter();
  }

  _initTransporter() {
    const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
    const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
    const smtpUser = process.env.SMTP_USER || '';
    const smtpPass = process.env.SMTP_PASS || '';

    if (smtpUser && smtpPass) {
      this.transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });
      console.log(`[EmailService] Configured SMTP via ${smtpHost}:${smtpPort} (${smtpUser})`);
    } else {
      // In dev mode without SMTP creds, log OTP directly to console & mock delivery gracefully
      console.log('[EmailService] SMTP credentials not set. Email service running in Console & Mock Mode.');
    }
  }

  /**
   * Render Ultra-Professional HTML Email Template for OTP Verification
   */
  _renderOtpTemplate({ title, subtitle, otpCode, recipientEmail }) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #F8FAFC;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #0F172A;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      table-layout: fixed;
      background-color: #F8FAFC;
      padding: 40px 0;
    }
    .main-card {
      max-width: 520px;
      margin: 0 auto;
      background: #FFFFFF;
      border-radius: 24px;
      border: 1px solid #E2E8F0;
      box-shadow: 0 20px 40px -15px rgba(0, 102, 255, 0.08);
      overflow: hidden;
    }
    .header-banner {
      background: linear-gradient(135deg, #0066FF 0%, #0044B3 100%);
      padding: 36px 32px;
      text-align: center;
      color: #FFFFFF;
    }
    .brand-logo {
      font-size: 26px;
      font-weight: 900;
      letter-spacing: -0.5px;
      margin-bottom: 8px;
    }
    .badge-sub {
      display: inline-block;
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(8px);
      padding: 4px 14px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.5px;
    }
    .content-body {
      padding: 36px 32px;
    }
    .headline {
      font-size: 20px;
      font-weight: 800;
      color: #0F172A;
      margin: 0 0 12px 0;
      line-height: 1.3;
    }
    .subtext {
      font-size: 14px;
      color: #64748B;
      line-height: 1.6;
      margin: 0 0 28px 0;
    }
    .otp-container {
      background: #F1F5F9;
      border: 2px dashed #CBD5E1;
      border-radius: 18px;
      padding: 24px;
      text-align: center;
      margin-bottom: 28px;
    }
    .otp-label {
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #64748B;
      margin-bottom: 8px;
    }
    .otp-code {
      font-family: 'Courier New', Courier, monospace;
      font-size: 38px;
      font-weight: 900;
      letter-spacing: 10px;
      color: #0066FF;
      margin: 0;
      text-indent: 10px;
    }
    .expiry-note {
      font-size: 12px;
      color: #EF4444;
      font-weight: 700;
      margin-top: 10px;
    }
    .security-box {
      background: #EFF6FF;
      border-radius: 14px;
      padding: 16px 20px;
      border-left: 4px solid #0066FF;
      font-size: 12px;
      color: #1E40AF;
      line-height: 1.5;
      margin-bottom: 24px;
    }
    .footer-area {
      background: #F8FAFC;
      padding: 24px 32px;
      text-align: center;
      border-top: 1px solid #E2E8F0;
      font-size: 12px;
      color: #94A3B8;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="main-card">
      <div class="header-banner">
        <div class="brand-logo">TeraBox Cloud</div>
        <div class="badge-sub">1024 GB SECURE CLOUD</div>
      </div>
      <div class="content-body">
        <h1 class="headline">${title}</h1>
        <p class="subtext">${subtitle} for account <strong>${recipientEmail}</strong>.</p>
        
        <div class="otp-container">
          <div class="otp-label">YOUR 6-DIGIT VERIFICATION CODE</div>
          <div class="otp-code">${otpCode}</div>
          <div class="expiry-note">⏰ Valid for 5 minutes only</div>
        </div>

        <div class="security-box">
          🔒 <strong>Security Warning:</strong> Never share this 6-digit OTP code with anyone. TeraBox support will never ask for your verification code.
        </div>
      </div>
      <div class="footer-area">
        Need assistance? Contact <a href="mailto:support@terabox.cloud" style="color: #0066FF; text-decoration: none;">support@terabox.cloud</a><br>
        © ${new Date().getFullYear()} TeraBox Inc. All rights reserved.
      </div>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Send Email OTP for Registration
   */
  async sendSignupOtp(email, otpCode) {
    const html = this._renderOtpTemplate({
      title: 'Verify Your Email Address',
      subtitle: 'Use the 6-digit verification code below to complete your TeraBox 1024 GB Cloud Account signup',
      otpCode,
      recipientEmail: email,
    });

    console.log(`\n==========================================`);
    console.log(`[EMAIL OTP SIGNUP] Recipient: ${email}`);
    console.log(`[EMAIL OTP CODE]   🔑 ${otpCode}`);
    console.log(`==========================================\n`);

    if (this.transporter) {
      try {
        await this.transporter.sendMail({
          from: '"TeraBox Security" <no-reply@terabox.cloud>',
          to: email,
          subject: `${otpCode} is your TeraBox verification code`,
          html,
        });
        console.log(`[EmailService] ✅ Email OTP sent to ${email} via SMTP`);
      } catch (err) {
        console.error(`[EmailService] Failed to send email via SMTP: ${err.message}`);
      }
    }
    return { success: true, email, otpCode };
  }

  /**
   * Send Email OTP for Password Reset
   */
  async sendForgotPasswordOtp(email, otpCode) {
    const html = this._renderOtpTemplate({
      title: 'Reset Your Account Password',
      subtitle: 'Use the 6-digit verification code below to reset your TeraBox password',
      otpCode,
      recipientEmail: email,
    });

    console.log(`\n==========================================`);
    console.log(`[FORGOT PASSWORD OTP] Recipient: ${email}`);
    console.log(`[FORGOT PASSWORD CODE] 🔑 ${otpCode}`);
    console.log(`==========================================\n`);

    if (this.transporter) {
      try {
        await this.transporter.sendMail({
          from: '"TeraBox Security" <security@terabox.cloud>',
          to: email,
          subject: `${otpCode} is your TeraBox password reset code`,
          html,
        });
        console.log(`[EmailService] ✅ Forgot password OTP sent to ${email}`);
      } catch (err) {
        console.error(`[EmailService] Failed to send email: ${err.message}`);
      }
    }
    return { success: true, email, otpCode };
  }
}

module.exports = new EmailService();
