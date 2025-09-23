// routes/testRoutes.js
const express = require("express");
const router = express.Router();
const sendEmail = require("../utils/sendEmail"); // adjust if your util file is in utils/sendEmail.js

router.get("/test-email", async (req, res) => {
  try {
    await sendEmail(
      "dammykirchhoff@gmail.com", // use your real inbox
      "Railway Brevo Test",
      "<h2>✅ Railway + Brevo test email</h2><p>If you see this, SMTP works!</p>"
    );
    res.send("✅ Test email sent! Check your inbox.");
  } catch (err) {
    console.error("❌ Email test failed:", err);
    res.status(500).send("❌ Error: " + err.message);
  }
});

module.exports = router;
