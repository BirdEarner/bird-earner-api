import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

export async function sendResetEmail(to: string, resetUrl: string) {
    const mailOptions = {
        from: process.env.SMTP_FROM || 'no-reply@birdearner.com',
        to,
        subject: 'Reset your BirdEarner password',
        html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
        <h2 style="color: #333;">Reset Your Password</h2>
        <p>You requested a password reset for your BirdEarner account.</p>
        <p>Click the button below to reset your password. This link is valid for 30 minutes.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Reset Password</a>
        </div>
        <p style="color: #666; font-size: 14px;">If you did not request this, please ignore this email.</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="color: #999; font-size: 12px;">BirdEarner Team</p>
      </div>
    `
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log('Reset email sent:', info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('Error sending reset email:', error);
        throw error;
    }
}
