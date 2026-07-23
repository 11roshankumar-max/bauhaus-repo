const nodemailer = require('nodemailer');

let transporter = null;
if (process.env.SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
}

async function sendOrderConfirmation(order, items) {
  const itemLines = items
    .map((i) => `  ${i.quantity} x ${i.title} — $${(i.unit_price_cents / 100).toFixed(2)}`)
    .join('\n');
  const subject = `Taana Baana — Order #${order.id} confirmed`;
  const text = `Thank you for your order!\n\nOrder #${order.id}\n${itemLines}\n\nTotal: $${(order.total_cents / 100).toFixed(2)}\n\nWe'll email you again once it ships.`;

  if (!transporter) {
    console.log('\n--- [DEMO MODE: no SMTP configured, email not actually sent] ---');
    console.log('To:', order.customer_email);
    console.log('Subject:', subject);
    console.log(text);
    console.log('--- end email ---\n');
    return { sent: false, demo: true };
  }

  await transporter.sendMail({
    from: process.env.SMTP_FROM || 'orders@taanabaana.example',
    to: order.customer_email,
    subject,
    text,
  });
  return { sent: true, demo: false };
}

module.exports = { sendOrderConfirmation };
