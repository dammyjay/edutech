const bcrypt = require("bcrypt");
const pool = require("../models/db");
const sendEmail = require("../utils/sendEmail");

exports.showSignup = (req, res) => {
  // res.sendFile(path.join(__dirname, 'signup.html'));
  res.render("signup", { error: null });
};

exports.showLogin = (req, res) => {
  res.render("admin/login", { error: null });
};

exports.signup = async (req, res) => {
  const { email, username, phone, gender, password, dob } = req.body;
  const file = req.file;
  const exists = await pool.query("SELECT * FROM users2 WHERE email = $1", [
    email,
  ]);
  if (exists.rows.length > 0) {
    return res.status(400).send("Email already registered.");
  }

  // Delete previous pending record
  await pool.query("DELETE FROM pending_users WHERE email = $1", [email]);

  //this code below that will store the file in the cloudinary to the database
  // const profile_picture = req.file ? req.file.path : null;
  const defaultImage = "/profile.webp"; // or any image path in your public folder
  const profile_picture = req.file ? req.file.path : defaultImage;
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const role = "user"; // Default role for new users
  const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 mins
  const hashed = await bcrypt.hash(password, 10);
  const created_at = new Date(); // Create timestamp in JS
  console.log("📷 Filename to save in DB:", profile_picture);

  await pool.query(
    "INSERT INTO pending_users (fullname, email, phone, gender, password, otp_code, otp_expires, profile_picture,role,created_at, dob) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    // 'INSERT INTO pending_users (username, email, phone)
    [
      username,
      email,
      phone,
      gender,
      hashed,
      otp,
      expires,
      profile_picture,
      role,
      created_at,
      dob,
    ]
  );
  // await sendEmail(email, "Your OTP Code", `Your code is: ${otp}`);
  await sendEmail("dammykirchhoff@gmail.com", "Your OTP Code", `Your code is: ${otp}`);
  res.status(200).send("OTP sent to your email.");
};

exports.verifyOtp = async (req, res) => {
  const { email, otp } = req.body;
  const created_at = new Date(); // Create timestamp in JS
  const result = await pool.query(
    "SELECT * FROM pending_users WHERE email = $1 AND otp_code = $2",
    [email, otp]
  );

  if (result.rows.length === 0) return res.status(400).send("Invalid OTP");

  const user = result.rows[0];
  if (new Date(user.otp_expires) < new Date())
    return res.status(400).send("OTP expired");

  await pool.query(
    "INSERT INTO users2 (fullname, email, phone, gender, password, profile_picture, role,created_at, dob) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      user.fullname,
      user.email,
      user.phone,
      user.gender,
      user.password,
      user.profile_picture,
      "user",
      created_at,
      user.dob,
    ]
  );

  await pool.query("DELETE FROM pending_users WHERE email = $1", [email]);
  res.status(200).send("Verification success");
};


exports.getUserProfile = async (req, res) => {
  const user = req.session.user;
  if (!user) return res.redirect("/admin/login");

  const result = await pool.query("SELECT * FROM users2 WHERE id = $1", [
    user.id,
  ]);

  if (result.rows.length === 0) return res.status(404).send("User not found");

  const currentUser = result.rows[0];

  if (user.role === "admin") {
    return res.render("admin/adminProfile", {
      user: currentUser,
      title: "Admin Profile",
    });
  } else {
    return res.render("userProfile", {
      user: currentUser,
      title: "User Profile",
    });
  }
};

exports.updateUserProfile = async (req, res) => {
  const user = req.session.user;
  if (!user) return res.redirect("/admin/login");

  const { fullname, phone, dob } = req.body;
  const profile_picture = req.file ? req.file.path : user.profile_picture;

  await pool.query(
    "UPDATE users2 SET fullname = $1, phone = $2, profile_picture = $3, dob = $4 WHERE id = $5",
    [fullname, phone, profile_picture, dob, user.id]
  );
  // Update session with new profile picture
  req.session.user.profile_picture = profile_picture;

  if (user.role === "admin") {
    return res.redirect("/profile"); // can use same route for both
  } else {
    return res.redirect("/profile");
  }
};

exports.showEvent = async (req, res) => {
  const { id } = req.params;
  // Add this line to pass login status to EJS
  const isLoggedIn = !!req.session.user; // or whatever property you use for login
  const profilePic = req.session.user ? req.session.user.profile_picture : null;

   let walletBalance = 0;
   if (req.session.user) {
     const walletResult = await pool.query(
       "SELECT wallet_balance2 FROM users2 WHERE email = $1",
       [req.session.user.email]
     );
     walletBalance = walletResult.rows[0]?.wallet_balance2 || 0;
   }


  try {
    const result = await pool.query("SELECT * FROM events WHERE id = $1", [id]);
    const event = result.rows[0];

    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0] || {};

    if (!event) return res.status(404).send("Event not found");

    

    // ✅ Extract paid status from query
    const paid = req.query.paid;

    res.render("showEvent", {
      event,
      info,
      isLoggedIn,
      users: req.session.user,
      subscribed: req.query.subscribed,
      paid,
      walletBalance
    });
  } catch (err) {
    console.error("Error loading event:", err);
    res.status(500).send("Server error");
  }
};

// exports.registerEvent = async (req, res) => {
//   const { id: eventId } = req.params;
//   const {
//     registrant_name,
//     registrant_email,
//     registrant_phone,
//     is_parent,
//     child_name,
//   } = req.body;

//   try {
//     const eventRes = await pool.query("SELECT * FROM events WHERE id = $1", [
//       eventId,
//     ]);
//     const event = eventRes.rows[0];
//     if (!event) return res.status(404).send("Event not found");

//     if (event.is_paid) {
//       // Save as pending
//       const regRes = await pool.query(
//         `INSERT INTO event_registrations
//           (event_id, registrant_name, registrant_email, registrant_phone, is_parent, child_name, amount_paid, payment_status)
//          VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
//         [
//           eventId,
//           registrant_name,
//           registrant_email,
//           registrant_phone,
//           is_parent === "on",
//           is_parent === "on" ? child_name : null,
//           event.amount,
//           "pending",
//         ]
//       );

//       const regId = regRes.rows[0].id;

//       // Redirect to payment gateway page
//       return res.redirect(`/pay-event/${regId}`);
//     } else {
//       // Free event, mark as complete
//       await pool.query(
//         `INSERT INTO event_registrations
//           (event_id, registrant_name, registrant_email, registrant_phone, is_parent, child_name, payment_status)
//          VALUES ($1,$2,$3,$4,$5,$6,$7)`,
//         [
//           eventId,
//           registrant_name,
//           registrant_email,
//           registrant_phone,
//           is_parent === "on",
//           is_parent === "on" ? child_name : null,
//           "completed",
//         ]
//       );

//       return res.redirect(`/events/${eventId}?registered=success`);
//     }
//   } catch (err) {
//     console.error("Registration failed:", err);
//     res.status(500).send("Server error");
//   }
// };

