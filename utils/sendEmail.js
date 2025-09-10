const { text } = require("body-parser");
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail", // or use host/port if you use a different provider
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// const transporter = nodemailer.createTransport({
//   host: "smtp.gmail.com",
//   port: 587, // use TLS instead of SSL
//   secure: false, // false for 587, true for 465
//   auth: {
//     user: process.env.EMAIL_USER,
//     pass: process.env.EMAIL_PASS,
//   },
// });

const sendFaqAnswerEmail = async (to, question, answer) => {
  const mailOptions = {
    // from: "Your Ministry" <${process.env.EMAIL_USERNAME}>,
    to,
    subject: "Your question has been answered",
    // html: <p><strong>Q:</strong> ${question}</p> <p><strong>A:</strong> ${answer}</p> <p>Thank you for reaching out to us.</p>
    text: `Q: ${question}\nA: ${answer}\n\nThank you for reaching out to us.`,
  };

  await transporter.sendMail(mailOptions);
};

// async function sendEmail(to, subject, message) {
//   await transporter.sendMail({
//     from: `"JKT Hub" <${process.env.EMAIL_USERNAME}>`,
//     to,
//     subject,
//     html: message,
//   });
// }

// Send generic email (used for OTP, newsletters, etc.)
// async function sendEmail(to, subject, message) {
//   try {
//     await transporter.sendMail({
//       from: `"JKT Hub" <${process.env.EMAIL_USER}>`, // ✅ unified sender
//       to,
//       subject,
//       html: message,
//     });
//     console.log(`✅ Email sent to ${to}`);
//   } catch (err) {
//     console.error("❌ Email sending failed:", err.message);
//     throw err; // rethrow if you want signup to fail, or remove if optional
//   }
// }

    async function sendEmail(to, subject, message) {
    await transporter.sendMail({
    // from: "Ministry Web App" <${user}>,
    to,
    subject,
    html: message
    });
    };

module.exports = sendFaqAnswerEmail;
module.exports = sendEmail;
    