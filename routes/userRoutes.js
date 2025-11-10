const express = require("express");
const pool = require("../models/db");
const router = express.Router();
const userController = require("../controllers/userController");
// const upload = require("../middlewares/upload");
const { upload, lessonUpload } = require("../middlewares/upload");
const { ensureParent } = require("../middlewares/auth");

// router.post("/signup", upload.single("profile_picture"), userController.signup);
// Route
router.post("/signup", upload.fields([
  { name: "profile_picture", maxCount: 1 },
  { name: "schoolLogo", maxCount: 1 }
]), userController.signup);

router.get("/signup", userController.showSignup);
router.post("/verify-otp", userController.verifyOtp);

router.get("/profile", userController.getUserProfile);
router.post(
  "/profile",
  upload.single("profile_picture"),
  userController.updateUserProfile
);

router.get("/parent/dashboard", userController.getParentDashboard);

// Optionally, add a way for admin to link parent ↔ child
// router.post("/parent/add-child", async (req, res) => {
//   const { parent_id, child_id } = req.body;
//   try {
//     await pool.query(
//       "INSERT INTO parent_children (parent_id, child_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
//       [parent_id, child_id]
//     );
//     res.redirect(`/parent/dashboard`);
//   } catch (err) {
//     console.error("Error linking child:", err.message);
//     res.status(500).send("Failed to link child");
//   }
// });

router.post("/parent/add-child", userController.addChild);


router.get("/vapid-public-key", (req, res) => {
  res.send(process.env.VAPID_PUBLIC_KEY);
});

router.post("/subscribe", async (req, res) => {
  const subscription = req.body;
  await pool.query(
    "INSERT INTO push_subscriptions (endpoint, keys) VALUES ($1, $2)",
    [subscription.endpoint, JSON.stringify(subscription.keys)]
  );
  res.sendStatus(201);
});

router.get("/register/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query("SELECT * FROM events WHERE id = $1", [id]);
    const event = result.rows[0];

    // Add this line to pass login status to EJS
    const isLoggedIn = !!req.session.user; // or whatever property you use for login
    const profilePic = req.session.user
      ? req.session.user.profile_picture
      : null;
    
    let walletBalance = 0;
    if (req.session.user) {
      const walletResult = await pool.query(
        "SELECT wallet_balance2 FROM users2 WHERE email = $1",
        [req.session.user.email]
      );
      walletBalance = walletResult.rows[0]?.wallet_balance2 || 0;
    }

    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0] || {};

    if (!event) return res.status(404).send("Event not found");

    res.render("registerEvent", {
      event,
      info,
      isLoggedIn,
      users: req.session.user,
      subscribed: req.query.subscribed,
      walletBalance,
      activePage: "event",   // 👈 Pass active page
    });
  } catch (err) {
    console.error("Error loading event registration form:", err.message);
    res.status(500).send("Server error");
  }
});

// router.post("/register/:id", async (req, res) => {
//   const { id } = req.params;
//   const {
//     registrant_name,
//     registrant_email,
//     registrant_phone,
//     is_parent,
//     child_name,
//   } = req.body;

//   try {
//     // Get event details
//     const eventRes = await pool.query("SELECT * FROM events WHERE id = $1", [
//       id,
//     ]);
//     const event = eventRes.rows[0];
//     if (!event) return res.status(404).send("Event not found");

//     // Create registration
//     const regRes = await pool.query(
//       `INSERT INTO event_registrations
//        (event_id, registrant_name, registrant_email, registrant_phone, is_parent, child_name, amount_paid)
//        VALUES ($1, $2, $3, $4, $5, $6, $7)
//        RETURNING id`,
//       [
//         id,
//         registrant_name,
//         registrant_email,
//         registrant_phone || null,
//         is_parent === "on",
//         child_name || null,
//         event.amount || 0,
//       ]
//     );

//     const registrationId = regRes.rows[0].id;

//     if (event.is_paid) {
//       // Redirect to event payment page
//       return res.redirect(`/pay-event/${registrationId}`);
//     } else {
//       // Free event
//       await pool.query(
//         `UPDATE event_registrations SET payment_status = 'completed' WHERE id = $1`,
//         [registrationId]
//       );
//       return res.redirect(`/events/${id}?registered=success`);
//     }
//   } catch (err) {
//     console.error("Error registering for event:", err.message);
//     res.status(500).send("Registration failed");
//   }
// });

router.post("/register/:id", async (req, res) => {
  const { id } = req.params;
  const { registrant_name, registrant_email, registrant_phone, num_people } =
    req.body;

  try {
    const eventRes = await pool.query("SELECT * FROM events WHERE id = $1", [
      id,
    ]);
    const event = eventRes.rows[0];
    if (!event) return res.status(404).send("Event not found");

    const peopleCount = parseInt(num_people) || 1;
    const childNames = [];
    for (let i = 1; i <= peopleCount; i++) {
      const key = `child_name_${i}`;
      if (req.body[key]) childNames.push(req.body[key]);
    }

    // let totalAmount = 0;
    // if (event.is_paid) {
    //   if (event.allow_split_payment) {
    //     totalAmount = (event.amount || 0) * peopleCount;
    //   } else {
    //     totalAmount = event.amount || 0;
    //   }

    //   // Apply discount if available
    //   if (
    //     event.discount_amount &&
    //     event.discount_deadline &&
    //     new Date() <= event.discount_deadline
    //   ) {
    //     totalAmount -= event.discount_amount;
    //     if (totalAmount < 0) totalAmount = 0;
    //   }
    // }

    let totalAmount = 0;
    const paymentOption = req.body.payment_option || "full"; // default full

    if (event.is_paid) {
      let basePrice = event.amount || 0;

      // Apply half payment option
      if (paymentOption === "half") {
        basePrice = basePrice / 2;
      }

      if (event.allow_split_payment) {
        totalAmount = basePrice * peopleCount;
      } else {
        totalAmount = basePrice;
      }

      // Apply discount if available
      if (
        event.discount_amount &&
        event.discount_deadline &&
        new Date() <= event.discount_deadline
      ) {
        totalAmount -= event.discount_amount;
        if (totalAmount < 0) totalAmount = 0;
      }
    }


    const regRes = await pool.query(
      `INSERT INTO event_registrations 
        (event_id, registrant_name, registrant_email, registrant_phone, num_people, child_names, amount_paid, total_amount, payment_option)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        id,
        registrant_name,
        registrant_email,
        registrant_phone || null,
        peopleCount,
        JSON.stringify(childNames),
        totalAmount,
        totalAmount,
        paymentOption,
      ]
    );

    const registrationId = regRes.rows[0].id;

    if (event.is_paid) {
      return res.redirect(`/pay-event/${registrationId}`);
    } else {
      await pool.query(
        `UPDATE event_registrations SET payment_status = 'completed' WHERE id = $1`,
        [registrationId]
      );
      return res.redirect(`/events/${id}?registered=success`);
    }
  } catch (err) {
    console.error("Error registering for event:", err.message);
    res.status(500).send("Registration failed");
  }
});

router.get(
  "/student/:studentId/course-summary/:courseId/download",
  ensureParent,
  userController.downloadCourseSummary
);


// router.post("/remove-child", ensureParent, userController.removeChild);




module.exports = router;
