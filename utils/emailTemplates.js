function buildFeedbackThankYouEmail({ name, user_type, rating, message }) {
  const starHTML = `
    <div style="margin: 10px 0;">
      ${"★".repeat(rating)}${"☆".repeat(5 - rating)}
    </div>
  `;

  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      @media only screen and (max-width: 600px) {
        .container {
          width: 100% !important;
          padding: 15px !important;
        }
      }
    </style>
  </head>
  <body style="background: #f5f7fb; padding: 20px; font-family: Arial, sans-serif;">
    <div class="container" style="
      max-width: 600px; 
      margin: auto; 
      background: white; 
      padding: 25px; 
      border-radius: 10px; 
      box-shadow: 0 4px 14px rgba(0,0,0,0.08);
    ">
      
      <div style="text-align: center;">
        <img src="https://acad.jkthub.com/images/JKT logo bg.png" 
             width="100" style="margin-bottom: 15px;" />
        <h2 style="color: #333; margin-bottom: 5px;">Thank You for Your Feedback! ❤️</h2>
        <p style="color: #666; font-size: 14px; margin-top: 0;">
          We appreciate your time and contribution.
        </p>
      </div>

      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />

      <p style="font-size: 15px; color: #444;">
        Hello <strong>${name}</strong>,<br><br>
        Thank you for taking the time to share your experience as a 
        <strong style="text-transform: capitalize;">${user_type}</strong>.
        Your feedback helps us improve and serve you better.
      </p>

      <h3 style="margin-top: 20px; color: #333;">Your Rating</h3>
      ${starHTML}

      <h3 style="margin-top: 20px; color: #333;">Your Message</h3>
      <p style="background: #fafafa; padding: 15px; border-radius: 8px; color: #555;">
        "${message}"
      </p>

      <br>

      <div style="text-align: center; margin-top: 25px;">
        <a href="https://acad.jkthub.com" 
          style="
            background: #4a76fd; 
            color: white; 
            padding: 12px 25px; 
            border-radius: 6px; 
            text-decoration: none; 
            font-size: 14px;
          ">
          Visit Our Website
        </a>
      </div>

      <br><br>

      <p style="font-size: 12px; color: #999; text-align: center;">
        © ${new Date().getFullYear()} JKT Hub — Empowering the Future with Technology.
      </p>

    </div>
  </body>
  </html>
  `;
}

module.exports = { buildFeedbackThankYouEmail };
