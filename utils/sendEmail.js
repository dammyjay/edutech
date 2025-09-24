// const { text } = require("body-parser");
// const nodemailer = require("nodemailer");

// const transporter = nodemailer.createTransport({
//   service: "gmail", // or use host/port if you use a different provider
//   auth: {
//     user: process.env.EMAIL_USER,
//     pass: process.env.EMAIL_PASS,
//   },
// });

// // const transporter = nodemailer.createTransport({
// //   host: "smtp.gmail.com",
// //   port: 587, // use TLS instead of SSL
// //   secure: false, // false for 587, true for 465
// //   auth: {
// //     user: process.env.EMAIL_USER,
// //     pass: process.env.EMAIL_PASS,
// //   },
// // });

// // const sendFaqAnswerEmail = async (to, question, answer) => {
// //   const mailOptions = {
// //     // from: "Your Ministry" <${process.env.EMAIL_USERNAME}>,
// //     to,
// //     subject: "Your question has been answered",
// //     // html: <p><strong>Q:</strong> ${question}</p> <p><strong>A:</strong> ${answer}</p> <p>Thank you for reaching out to us.</p>
// //     text: `Q: ${question}\nA: ${answer}\n\nThank you for reaching out to us.`,
// //   };

// //   await transporter.sendMail(mailOptions);
// // };

// // async function sendEmail(to, subject, message) {
// //   await transporter.sendMail({
// //     from: `"JKT Hub" <${process.env.EMAIL_USERNAME}>`,
// //     to,
// //     subject,
// //     html: message,
// //   });
// // }

// // Send generic email (used for OTP, newsletters, etc.)
// // async function sendEmail(to, subject, message) {
// //   try {
// //     await transporter.sendMail({
// //       from: `"JKT Hub" <${process.env.EMAIL_USER}>`, // ✅ unified sender
// //       to,
// //       subject,
// //       html: message,
// //     });
// //     console.log(`✅ Email sent to ${to}`);
// //   } catch (err) {
// //     console.error("❌ Email sending failed:", err.message);
// //     throw err; // rethrow if you want signup to fail, or remove if optional
// //   }
// // }

//     async function sendEmail(to, subject, message) {
//     await transporter.sendMail({
//     // from: "Ministry Web App" <${user}>,
//     to,
//     subject,
//     html: message
//     });
//     };

// // module.exports = sendFaqAnswerEmail;
// module.exports = sendEmail;
    

// ------------------------------------------------------------------------------------------------------




// // utils/sendEmail.js
// const { Resend } = require("resend");

// const resend = new Resend(process.env.RESEND_API_KEY); // keep key in .env

// /**
//  * Send email via Resend
//  * @param {string|string[]} to - recipient(s)
//  * @param {string} subject - email subject
//  * @param {string} html - email content
//  */
// async function sendEmail(to, subject, html) {
//   try {
//     const response = await resend.emails.send({
//       from: "JKT Hub <onboarding@resend.dev>", // Or your verified domain
//       to,
//       subject,
//       html,
//     });

//     console.log("✅ Email sent:", response);
//     return response;
//   } catch (err) {
//     console.error("❌ Email sending failed:", err.message);
//     throw err;
//   }
// }

// module.exports = sendEmail;




// ---------------------------------------------------------------------------------------

// const nodemailer = require("nodemailer");

// const transporter = nodemailer.createTransport({
//   host: process.env.BREVO_HOST || "smtp-relay.brevo.com",
//   port: process.env.BREVO_PORT || 587,
//   secure: false, // STARTTLS (Brevo works with port 587)
//   auth: {
//     user: process.env.BREVO_USER,
//     pass: process.env.BREVO_PASS,
//   },
// });

// async function sendEmail(to, subject, message) {
//   try {
//     const info = await transporter.sendMail({
//       from: `"JKT Hub" <${process.env.BREVO_FROM}>`, // must be verified sender
//       to,
//       subject,
//       html: message,
//     });

//     console.log("✅ Email sent:", info.messageId);
//     return info;
//   } catch (err) {
//     console.error("❌ Email sending failed:", err.message);
//     throw err;
//   }
// }

// module.exports = sendEmail;




// ---------------------------------------------------------------------------------------------------


const Brevo = require("@getbrevo/brevo");

const apiInstance = new Brevo.TransactionalEmailsApi();
apiInstance.setApiKey(
  Brevo.TransactionalEmailsApiApiKeys.apiKey,
  process.env.BREVO_API_KEY
);

async function sendEmail(to, subject, htmlContent) {
  try {
    const sendSmtpEmail = {
      to: [{ email: to }],
      sender: { email: process.env.BREVO_FROM, name: "JKT Hub" },
      subject,
      htmlContent,
    };

    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log("✅ Email sent:", data.messageId || data);
    return data;
  } catch (error) {
    console.error("❌ Email sending failed:", error.message);
    throw error;
  }
}

module.exports = sendEmail;
