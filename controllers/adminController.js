const pool = require("../models/db");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
// const nodemailer = require("nodemailer");
const sendEmail = require("../utils/sendEmail");
const cloudinary = require("../utils/cloudinary");
const fs = require("fs");
const { Parser } = require("json2csv");

// Show forgot password form
exports.showForgotPasswordForm = (req, res) => {
  res.render("admin/forgotPassword", { message: null });
};

// Handle forgot password form submission
exports.handleForgotPassword = async (req, res) => {
  const { email } = req.body;
  const result = await pool.query("SELECT * FROM users2 WHERE email = $1", [
    email,
  ]);
  if (result.rows.length === 0) {
    // Show a clear message if email does not exist
    return res.render("admin/forgotPassword", {
      message: "Email does not exist.",
    });
  }
  const user = result.rows[0];
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 3600000); // 1 hour

  await pool.query(
    "UPDATE users2 SET reset_token = $1, reset_token_expires = $2 WHERE id = $3",
    [token, expires, user.id]
  );

  const resetUrl = `http://${req.headers.host}/admin/reset-password/${token}`;
  await sendEmail(
    email,
    "Password Reset",
    `Click <a href="${resetUrl}">here</a> to reset your password.`
  );

  res.render("admin/forgotPassword", {
    message: "a reset link has been sent.",
  });
};

// Show reset password form
exports.showResetPasswordForm = async (req, res) => {
  const { token } = req.params;
  const result = await pool.query(
    "SELECT * FROM users2 WHERE reset_token = $1 AND reset_token_expires > NOW()",
    [token]
  );
  if (result.rows.length === 0) {
    return res.send("Invalid or expired token.");
  }
  res.render("admin/resetPassword", { token, message: null });
};

// Handle reset password submission
exports.handleResetPassword = async (req, res) => {
  const { token } = req.params;
  const { password, confirmPassword } = req.body;

  if (password !== confirmPassword) {
    return res.render("admin/resetPassword", {
      token,
      message: "Passwords do not match.",
    });
  }

  hashedPassword = await bcrypt.hash(password, 10); // Hash the new password
  hashedconfirmPassword = await bcrypt.hash(confirmPassword, 10); // Hash the confirm password
  const result = await pool.query(
    "SELECT * FROM users2 WHERE reset_token = $1 AND reset_token_expires > NOW()",
    [token]
  );
  if (result.rows.length === 0) {
    return res.send("Invalid or expired token.");
  }
  // const hashed = await bcrypt.hash(password, 10);
  await pool.query(
    "UPDATE users2 SET password = $1, reset_token = NULL, reset_token_expires = NULL WHERE reset_token = $2",
    [hashedPassword, token]
  );
  res.render("admin/login", {
    error: null,
    title: "Login",
    redirect: "",
    message: "Password reset successful. Please log in.",
  });
};

exports.showLogin = (req, res) => {
  res.render("admin/login", {
    error: null,
    title: "Login",
    redirect: req.query.redirect || "",
  });
};

exports.login = async (req, res) => {
  const { email, password } = req.body;
  const redirectUrl = req.query.redirect;

  try {
    // 1. Get user by email
    const result = await pool.query("SELECT * FROM users2 WHERE email = $1", [
      email,
    ]);

    if (result.rows.length === 0) {
      return res.render("admin/login", {
        error: "Invalid credentials",
        title: "Login",
        redirect: redirectUrl || "",
      });
    }

    const user = result.rows[0];

    // 2. Compare plain password with stored hash
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.render("admin/login", {
        error: "Invalid credentials",
        title: "Login",
        redirect: redirectUrl || "",
      });
    }

    // 3. Store user info in session
    req.session.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      profile_pic: user.profile_picture,
    };

    // 4. Redirect user
    if (redirectUrl) {
      return res.redirect(redirectUrl);
    }

    if (user.role === "admin") {
      console.log("Admin login successful");
      return res.redirect("/admin/dashboard");
    } else {
      console.log("User login successful");
      // return res.redirect("/home2");
      // return res.redirect("/");
      return res.redirect("/student/dashboard");
    }
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).send("Server error");
  }
};

exports.logout = (req, res) => {
  req.session.destroy();
  res.redirect("/admin/login");
};

exports.dashboard = async (req, res) => {
  // if (!req.session.admin) return res.redirect('/admin/login');
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }

  try {
    // Query filters
    const { gender, role, email } = req.query;
    // Step 1: Get Ministry Info
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0];

    // Step 2: Build dynamic user query
    let query = "SELECT * FROM users2 WHERE 1=1";
    const params = [];

    if (gender) {
      params.push(gender);
      query += ` AND gender = $${params.length}`;
    }

    if (role) {
      params.push(role);
      query += ` AND role = $${params.length}`;
    }

    if (email) {
      params.push(`%${email.toLowerCase()}%`);
      query += ` AND LOWER(email) LIKE $${params.length}`;
    }

    query += " ORDER BY created_at DESC";
    const usersResult = await pool.query(query, params);
    const users = usersResult.rows;

    // Step 3: Stats
    const totalResult = await pool.query("SELECT COUNT(*) FROM users2");
    const totalUsers = parseInt(totalResult.rows[0].count);

    const lastWeekResult = await pool.query(
      "SELECT COUNT(*) FROM users2 WHERE created_at >= NOW() - INTERVAL '7 days'"
    );
    const recentUsers = parseInt(lastWeekResult.rows[0].count);

    const percentageNew =
      totalUsers > 0 ? Math.round((recentUsers / totalUsers) * 100) : 0;

    // const pendingFaqResult = await pool.query(
    //   "SELECT COUNT(*) FROM faqs WHERE answer IS NULL OR TRIM(answer) = ''"
    // );
    // const pendingFaqCount = parseInt(pendingFaqResult.rows[0].count);

    const profilePic = req.session.user
      ? req.session.user.profile_picture
      : null;

    res.render("admin/dashboard", {
      info,
      users,
      profilePic,
      // pendingFaqCount,
      totalUsers,
      recentUsers,
      percentageNew,
      gender,
      role,
      email,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Server Error");
  }
};

exports.editUserForm = async (req, res) => {
  const userId = req.params.id;
  const infoResult = await pool.query(
    "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
  );
  const info = infoResult.rows[0];

  try {
    const result = await pool.query("SELECT * FROM users2 WHERE id = $1", [
      userId,
    ]);
    const user = result.rows[0];
    if (!user) {
      return res.status(404).send("User not found");
    }

    res.render("admin/editUser", { info, user });
  } catch (error) {
    console.error("Error loading user edit form:", error);
    res.status(500).send("Server error");
  }
};

exports.updateUser = async (req, res) => {
  const userId = req.params.id;
  const { fullname, email, phone, gender, role, wallet_balance2 } = req.body;

  try {
    // Convert empty string to 0, otherwise keep number
    const balance = wallet_balance2 === "" ? 0 : parseFloat(wallet_balance2);

    await pool.query(
      "UPDATE users2 SET fullname = $1, email = $2, phone = $3, gender = $4, role = $5, wallet_balance2 = $6 WHERE id = $7",
      [fullname, email, phone, gender, role, wallet_balance2, userId]
    );

    res.redirect("/admin/dashboard");
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).send("Server error");
  }
};

exports.deleteUser = async (req, res) => {
  const userId = req.params.id;

  try {
    await pool.query("DELETE FROM users2 WHERE id = $1", [userId]);
    res.redirect("/admin/dashboard");
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).send("Server error");
  }
};

// // Show announcements page
// exports.showAnnouncements = async (req, res) => {
//   const infoResult = await pool.query(
//     "SELECT * FROM ministry_info ORDER BY id DESC LIMIT 1"
//   );
//   const info = infoResult.rows[0] || {};
//   const result = await pool.query(
//     "SELECT * FROM announcements ORDER BY event_date DESC"
//     // "SELECT * FROM announcements WHERE is_visible = true ORDER BY event_date DESC LIMIT 1"
//   );
//   res.render("admin/announcements", { info, announcements: result.rows });
// };

// // Create a new announcement
// exports.createAnnouncement = async (req, res) => {
//   const infoResult = await pool.query(
//     "SELECT * FROM ministry_info ORDER BY id DESC LIMIT 1"
//   );
//   const info = infoResult.rows[0];
//   const { title, message, event_date } = req.body;
//   const is_visible = req.body.is_visible === "on";
//   let flyer_url = req.file ? req.file.path : null; // Use existing URL if provided

//   await pool.query(
//     "INSERT INTO announcements (title, message, event_date, flyer_url, is_visible) VALUES ($1, $2, $3, $4, $5)",
//     [title, message, event_date, flyer_url, is_visible]
//   );
//   res.redirect("/admin/announcements");
// };

// // Show the edit form for an announcement
// exports.showEditAnnouncement = async (req, res) => {
//   const { id } = req.params;
//   const infoResult = await pool.query(
//     "SELECT * FROM ministry_info ORDER BY id DESC LIMIT 1"
//   );
//   const info = infoResult.rows[0] || {};

//   const annResult = await pool.query(
//     "SELECT * FROM announcements WHERE id = $1",
//     [id]
//   );
//   const announcement = annResult.rows[0];
//   if (!announcement) return res.redirect("/admin/announcements");
//   res.render("admin/editAnnouncement", { info, announcement });
// };

// // Handle the edit form submission
// exports.editAnnouncement = async (req, res) => {
//   const { id } = req.params;
//   const { title, message, event_date } = req.body;
//   const is_visible = req.body.is_visible === "on";
//   let flyer_url = req.body.existing_flyer_url || null;

//   // If a new flyer is uploaded, upload to cloudinary and use new URL
//   if (req.file) {
//     const result = await cloudinary.uploader.upload(req.file.path, {
//       folder: "announcements",
//     });
//     flyer_url = result.secure_url;
//     // fs.unlinkSync(req.file.path);
//     if (req.file && req.file.path && fs.existsSync(req.file.path)) {
//       fs.unlinkSync(req.file.path);
//     }
//   }

//   await pool.query(
//     "UPDATE announcements SET title = $1, message = $2, event_date = $3, flyer_url = $4, is_visible = $5 WHERE id = $6",
//     [title, message, event_date, flyer_url, is_visible, id]
//   );
//   res.redirect("/admin/announcements");
// };

// // In adminController.js
// exports.deleteAnnouncement = async (req, res) => {
//   await pool.query("DELETE FROM announcements WHERE id = $1", [req.params.id]);
//   res.redirect("/admin/announcements");
// };

// // Show the newsletter form
// // exports.showNewsletterForm = async (req, res) => {
// //   const infoResult = await pool.query(
// //     "SELECT * FROM ministry_info ORDER BY id DESC LIMIT 1"
// //   );
// //   const info = infoResult.rows[0] || {};
// //   const newslettersResult = await pool.query(
// //     "SELECT * FROM newsletters ORDER BY created_at DESC"
// //   );

// //   res.render("admin/newsletter", {
// //     info,
// //     newsletters: newslettersResult.rows,
// //    });
// // };

// exports.showNewsletterForm = async (req, res) => {
//   const info =
//     (await pool.query("SELECT * FROM ministry_info ORDER BY id DESC LIMIT 1"))
//       .rows[0] || {};
//   const newsletters = (
//     await pool.query("SELECT * FROM newsletters ORDER BY created_at DESC")
//   ).rows;

//   res.render("admin/newsletter", { info, newsletters });
// };

// exports.handleNewsletterForm = async (req, res) => {
//   const { subject, message, scheduled_at, action } = req.body;
//   let imageUrl = null;

//   if (req.file) {
//     const result = await cloudinary.uploader.upload(req.file.path, {
//       folder: "newsletters",
//     });
//     imageUrl = result.secure_url;
//     if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
//   }

//   const sent = action === "send";
//   const createdAt = new Date();

//   if (sent) {
//     // Get all user emails
//     const resultUsers = await pool.query(
//       "SELECT email FROM users2 WHERE email IS NOT NULL"
//     );
//     const testEmails = resultUsers.rows.map((row) => row.email);

//     // const testEmails = [
//     //   "jaykirchtechhub@gmail.com",
//     //   "dammykirchhoff@gmail.com",
//     //   "isaacbayo6@gmail.com",
//     //   "imoledayoimmanuel@gmail.com",
//     // ];

//     let htmlMsg = `<div>${message}</div>`;
//     if (imageUrl) {
//       htmlMsg += `<div><img src="${imageUrl}" style="max-width:100%;border-radius:8px;"></div>`;
//     }

//     for (const email of testEmails) {
//       await sendEmail(email, subject, htmlMsg);
//     }
//   }

//   await pool.query(
//     `INSERT INTO newsletters (subject, message, image_url, scheduled_at, sent, created_at)
//      VALUES ($1, $2, $3, $4, $5, $6)`,
//     [subject, message, imageUrl, scheduled_at || null, sent, createdAt]
//   );

//   const info =
//     (await pool.query("SELECT * FROM ministry_info ORDER BY id DESC LIMIT 1"))
//       .rows[0] || {};
//   const newsletters = (
//     await pool.query("SELECT * FROM newsletters ORDER BY created_at DESC")
//   ).rows;

//   res.render("admin/newsletter", {
//     info,
//     newsletters,
//     success: sent ? "Newsletter sent!" : "Newsletter saved for later!",
//   });
// };

// // Send the newsletter to all users
// exports.sendNewsletter = async (req, res) => {
//   const { subject, message } = req.body;
//   let imageUrl = null;

//   // Upload image to Cloudinary if provided
//   if (req.file) {
//     const result = await cloudinary.uploader.upload(req.file.path, {
//       folder: "newsletters",
//     });
//     imageUrl = result.secure_url;
//     if (req.file && req.file.path && fs.existsSync(req.file.path)) {
//       fs.unlinkSync(req.file.path); // Remove temp file
//     }
//   }
//   const infoResult = await pool.query(
//     "SELECT * FROM ministry_info ORDER BY id DESC LIMIT 1"
//   );
//   const info = infoResult.rows[0] || {};

//   const newslettersResult = await pool.query(
//     "SELECT * FROM newsletters ORDER BY created_at DESC"
//   );

//   // Get all user emails
//   const resultUsers = await pool.query(
//     "SELECT email FROM users2 WHERE email IS NOT NULL"
//   );
//   // const emails = resultUsers.rows.map((row) => row.email);

//   // ✅ Replace with test emails
//   const emails = [
//     "jaykirchtechhub@gmail.com",
//     "dammykirchhoff@gmail.com",
//     "dammykirchhoff2@gmail.com", // Replace with your own
//   ];

//   // Compose HTML message
//   let htmlMsg = `<div>${message}</div>`;
//   if (imageUrl) {
//     htmlMsg += `<div style="margin-top:20px;"><img src="${imageUrl}" alt="Newsletter Image" style="max-width:100%;border-radius:8px;"></div>`;
//   }

//   // Send to all users
//   for (const email of emails) {
//     await sendEmail(email, subject, htmlMsg);
//   }

//   res.render("admin/newsletter", {
//     info,
//     newsletters: newslettersResult.rows,
//     success: "Newsletter sent to all members!",
//   });
// };

// exports.saveNewsletter = async (req, res) => {
//   const { subject, message, scheduled_at } = req.body;
//   let imageUrl = null;

//   if (req.file) {
//     const result = await cloudinary.uploader.upload(req.file.path, {
//       folder: "newsletters",
//     });
//     imageUrl = result.secure_url;
//     if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
//   }

//   await pool.query(
//     `INSERT INTO newsletters (subject, message, image_url, scheduled_at, sent, created_at)
//      VALUES ($1, $2, $3, $4, false, NOW())`,
//     [subject, message, imageUrl, scheduled_at || null]
//   );

//   res.redirect("/admin/newsletter");
// };

// exports.showAllNewsletters = async (req, res) => {
//   const infoResult = await pool.query(
//     "SELECT * FROM ministry_info ORDER BY id DESC LIMIT 1"
//   );
//   const newslettersResult = await pool.query(
//     "SELECT * FROM newsletters ORDER BY created_at DESC"
//   );

//   res.render("admin/newsletter", {
//     info: infoResult.rows[0] || {},
//     newsletters: newslettersResult.rows,
//   });
// };

// // Send Now
// exports.sendNow = async (req, res) => {
//   const id = req.params.id;
//   const newsletter = (
//     await pool.query("SELECT * FROM newsletters WHERE id = $1", [id])
//   ).rows[0];
//   if (!newsletter || newsletter.sent) return res.redirect("/admin/newsletter");

//   const testEmails = [
//     "jaykirchtechhub@gmail.com",
//     "dammykirchhoff@gmail.com",
//     "dammykirchhoff2@gmail.com",
//   ];

//   let htmlMsg = `<div>${newsletter.message}</div>`;
//   if (newsletter.image_url) {
//     htmlMsg += `<div><img src="${newsletter.image_url}" style="max-width:100%;"></div>`;
//   }

//   for (const email of testEmails) {
//     await sendEmail(email, newsletter.subject, htmlMsg);
//   }

//   await pool.query("UPDATE newsletters SET sent = true WHERE id = $1", [id]);
//   res.redirect("/admin/newsletter");
// };

// exports.editNewsletter = async (req, res) => {
//   const { id } = req.params;
//   const { subject, message, scheduled_at } = req.body;

//   let imageUrl = null;
//   if (req.file) {
//     const result = await cloudinary.uploader.upload(req.file.path, {
//       folder: "newsletters",
//     });
//     imageUrl = result.secure_url;
//     if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
//   }

//   const existing = (
//     await pool.query("SELECT * FROM newsletters WHERE id = $1", [id])
//   ).rows[0];
//   if (!existing || existing.sent) return res.redirect("/admin/newsletter");

//   await pool.query(
//     `UPDATE newsletters SET subject = $1, message = $2, scheduled_at = $3, image_url = COALESCE($4, image_url) WHERE id = $5`,
//     [subject, message, scheduled_at || null, imageUrl, id]
//   );

//   res.redirect("/admin/newsletter");
// };

// // Delete
// exports.deleteNewsletter = async (req, res) => {
//   await pool.query("DELETE FROM newsletters WHERE id = $1", [req.params.id]);
//   res.redirect("/admin/newsletter");
// };

exports.getAdminProfile = async (req, res) => {
  const userId = req.session.user?.id;
  if (!userId || req.session.user.role !== "admin")
    return res.redirect("/admin/login");
  const result = await pool.query("SELECT * FROM users2 WHERE id = $1", [
    userId,
  ]);
  res.render("adminProfile", {
    user: result.rows[0],
    title: "Admin Profile",
  });
};

exports.updateAdminProfile = async (req, res) => {
  const { fullname, phone, dob } = req.body;
  const profile_picture = req.file
    ? req.file.path
    : req.session.user.profile_picture;
  await pool.query(
    "UPDATE users2 SET fullname = $1, phone = $2, profile_picture = $3, dob = $4 WHERE id = $5",
    [fullname, phone, profile_picture, dob, req.session.user.id]
  );
  req.session.user.profile_picture = profile_picture; // update session
  res.redirect("/admin/profile");
};

exports.getUserProfile = async (req, res) => {
  const userId = req.session.user?.id;
  if (!userId || req.session.user.role !== "admin")
    return res.redirect("/admin/login");
  const result = await pool.query("SELECT * FROM users2 WHERE id = $1", [
    userId,
  ]);
  res.render("adminProfile", {
    user: result.rows[0],
    title: "User Profile",
  });
};

// --- CAREER PATHWAYS ---
exports.showPathways = async (req, res) => {
  const search = req.query.search || ""; // ✅ define the variable
  const infoResult = await pool.query(
    "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
  );
  const info = infoResult.rows[0] || {};
  const result = await pool.query(
    "SELECT * FROM career_pathways ORDER BY id DESC"
  );
  res.render("admin/pathways", { info, search, pathways: result.rows });
};

// exports.createPathway = async (req, res) => {
//   const { title, description } = req.body;
//   let thumbnail_url = null;

//   if (req.file) {
//     const result = await cloudinary.uploader.upload(req.file.path, {
//       folder: "pathways",
//     });
//     thumbnail_url = result.secure_url;
//     if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
//   }

//   await pool.query(
//     "INSERT INTO career_pathways (title, description, thumbnail_url) VALUES ($1, $2, $3)",
//     [title, description, thumbnail_url]
//   );

//   res.redirect("/admin/pathways");
// };

exports.createPathway = async (req, res) => {
  const {
    title,
    description,
    target_audience,
    expected_outcomes,
    duration_estimate,
    video_intro_url,
    show_on_homepage,
  } = req.body;

  let thumbnail_url = null;

  if (req.file) {
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: "pathways",
    });
    thumbnail_url = result.secure_url;
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }

  await pool.query(
    "INSERT INTO career_pathways (title, description, thumbnail_url, target_audience, expected_outcomes, duration_estimate, video_intro_url, show_on_homepage) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [
      title,
      description,
      thumbnail_url,
      target_audience,
      expected_outcomes,
      duration_estimate,
      video_intro_url,
      show_on_homepage === "true",
    ]
  );

  res.redirect("/admin/pathways");
};


exports.deletePathway = async (req, res) => {
  const { id } = req.params;
  await pool.query("DELETE FROM career_pathways WHERE id = $1", [id]);
  res.redirect("/admin/pathways");
};

exports.editPathway = async (req, res) => {
  const { id } = req.params;
  const {
    title,
    description,
    target_audience,
    expected_outcomes,
    duration_estimate,
    video_intro_url,
    show_on_homepage,
  } = req.body;

  let thumbnail_url = null;

  if (req.file) {
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: "pathways",
    });
    thumbnail_url = result.secure_url;
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }

  const existing = await pool.query(
    "SELECT * FROM career_pathways WHERE id = $1",
    [id]
  );
  const current = existing.rows[0];

  const updatedThumbnail = thumbnail_url || current.thumbnail_url;

  await pool.query(
    `UPDATE career_pathways
     SET title = $1,
         description = $2,
         thumbnail_url = $3,
         target_audience = $4,
         expected_outcomes = $5,
         duration_estimate = $6,
         video_intro_url = $7,
         show_on_homepage = $8
     WHERE id = $9`,
    [
      title,
      description,
      updatedThumbnail,
      target_audience,
      expected_outcomes,
      duration_estimate,
      video_intro_url,
      show_on_homepage === "true",
      id,
    ]
  );

  res.redirect("/admin/pathways");
};


// --- COURSES ---
// exports.showCourses = async (req, res) => {
//   const infoResult = await pool.query(
//     "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
//   );
//   const info = infoResult.rows[0] || {};
//   const coursesResult = await pool.query(
//     `SELECT courses.*, cp.title AS pathway_name
//      FROM courses
//      LEFT JOIN career_pathways cp ON cp.id = courses.career_pathway_id
//      ORDER BY sort_order ASC, title ASC`
//   );
  
//   const pathwaysResult = await pool.query("SELECT * FROM career_pathways");
//   res.render("admin/courses", {
//     courses: coursesResult.rows,
//     info,
//     search: req.query.search || "",
//     careerPathways: pathwaysResult.rows,
//   });
// };

exports.showCourses = async (req, res) => {
  const infoResult = await pool.query(
    "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
  );
  const info = infoResult.rows[0] || {};

  const coursesResult = await pool.query(`
    SELECT courses.*, cp.title AS pathway_name
    FROM courses
    LEFT JOIN career_pathways cp ON cp.id = courses.career_pathway_id
    ORDER BY cp.title ASC, courses.level ASC, sort_order ASC 
  `);

  const pathwaysResult = await pool.query("SELECT * FROM career_pathways");

  // Group courses by pathway and level
  const groupedCourses = {};

  coursesResult.rows.forEach((course) => {
    const pathway = course.pathway_name || "Unassigned";
    const level = course.level || "Unspecified";

    if (!groupedCourses[pathway]) groupedCourses[pathway] = {};
    if (!groupedCourses[pathway][level]) groupedCourses[pathway][level] = [];

    groupedCourses[pathway][level].push(course);
  });

  res.render("admin/courses", {
    info,
    search: req.query.search || "",
    careerPathways: pathwaysResult.rows,
    groupedCourses,
  });
};


exports.createCourse = async (req, res) => {
    console.log("Creating course with:", req.body);
  const { title, description, level, career_pathway_id, sort_order,  } = req.body;
  let thumbnail_url = null;

  if (req.file) {
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: "courses",
    });
    thumbnail_url = result.secure_url;
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }



  await pool.query(
    `INSERT INTO courses (title, description, level, career_pathway_id, thumbnail_url, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [title, description, level, career_pathway_id || null, thumbnail_url, sort_order]
  );

  res.redirect("/admin/courses");
};

exports.editCourse = async (req, res) => {
  const { id } = req.params;
  const { title, description, level, career_pathway_id, sort_order, amount } = req.body;

  try {
    let thumbnail_url = null;

    if (req.file) {
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: "courses",
      });
      thumbnail_url = result.secure_url;
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }

    // Update course
    const existing = await pool.query("SELECT * FROM courses WHERE id = $1", [
      id,
    ]);

    const updatedThumbnail = thumbnail_url || existing.rows[0]?.thumbnail_url;

    await pool.query(
      `UPDATE courses
       SET title = $1,
           description = $2,
           level = $3,
           career_pathway_id = $4,
           thumbnail_url = $5,
           sort_order = $6,
           amount = $7
       WHERE id = $8`,
      [
        title,
        description,
        level,
        career_pathway_id || null,
        updatedThumbnail,
        sort_order || null,
        amount || null,
        id,
      ]
    );

    res.redirect("/admin/courses");
  } catch (err) {
    console.error("❌ Error editing course:", err.message);
    res.status(500).send("Server Error");
  }
};

exports.deleteCourse = async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query("DELETE FROM courses WHERE id = $1", [id]);
    res.redirect("/admin/courses");
  } catch (err) {
    console.error("❌ Error deleting course:", err.message);
    res.status(500).send("Server Error");
  }
};

exports.showCoursesByPathway = async (req, res) => {
  const { id } = req.params;

  const infoResult = await pool.query(
    "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
  );
  const info = infoResult.rows[0] || {};

  const pathwayResult = await pool.query(
    "SELECT * FROM career_pathways WHERE id = $1",
    [id]
  );
  const pathway = pathwayResult.rows[0];

  const careerPathways = await pool.query(
    "SELECT id, title FROM career_pathways"
  );

  const coursesResult = await pool.query(
    `SELECT * FROM courses WHERE career_pathway_id = $1 ORDER BY level ASC, sort_order ASC`,
    [id]
  );

  res.render("admin/pathwayCourses", {
    info,
    pathway,
    careerPathways: careerPathways.rows,
    courses: coursesResult.rows,
  });
};

exports.createCourseUnderPathway = async (req, res) => {
  const { id } = req.params;
  const { title, description, level, sort_order } = req.body;

  let thumbnail_url = null;

  if (req.file) {
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: "courses",
    });
    thumbnail_url = result.secure_url;
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }

  await pool.query(
    `INSERT INTO courses (title, description, level, career_pathway_id, thumbnail_url, sort_order)
      VALUES ($1, $2, $3, $4, $5, $6)`,
    [title, description, level, id, thumbnail_url, sort_order]
  );

  res.redirect(`/admin/pathways/${id}/courses`);
};



exports.showBenefits = async (req, res) => {
  const infoResult = await pool.query(
    "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
  );
  const info = infoResult.rows[0] || {};
  const benefitsResult = await pool.query(
    "SELECT * FROM benefits ORDER BY created_at DESC"
  );
  res.render("admin/benefits", {
    info,
    benefits: benefitsResult.rows,
    search: req.query.search || "",
  });
}

exports.createBenefit = async (req, res) => {
  console.log("Form Data:", req.body);
  console.log("Uploaded File:", req.file);
  const { title, description } = req.body;
  let icon = null;

  if (req.file) {
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: "benefits",
    });
    icon = result.secure_url;
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }

  await pool.query(
    "INSERT INTO benefits (title, description, icon) VALUES ($1, $2, $3)",
    [title, description, icon]
  );

  res.redirect("/admin/benefits");
}

exports.editBenefitForm = async (req, res) => {
  const id = req.params.id;
  const benefitResult = await pool.query(
    "SELECT * FROM benefits WHERE id = $1",
    [id]
  );
  const infoResult = await pool.query(
    "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
  );

  res.render("admin/editBenefit", {
    info: infoResult.rows[0] || {},
    benefit: benefitResult.rows[0],
  });
};


exports.updateBenefit = async (req, res) => {
  const id = req.params.id;
  const { title, description } = req.body;
  let icon;

  if (req.file) {
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: "benefits",
    });
    icon = result.secure_url;
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }

  const benefit = await pool.query("SELECT * FROM benefits WHERE id = $1", [
    id,
  ]);
  const currentIcon = benefit.rows[0]?.icon;

  const query = icon
    ? "UPDATE benefits SET title = $1, description = $2, icon = $3 WHERE id = $4"
    : "UPDATE benefits SET title = $1, description = $2 WHERE id = $3";

  const params = icon
    ? [title, description, icon, id]
    : [title, description, id];

  await pool.query(query, params);
  res.redirect("/admin/benefits");
};

exports.deleteBenefit = async (req, res) => {
  const id = req.params.id;
  await pool.query("DELETE FROM benefits WHERE id = $1", [id]);
  res.redirect("/admin/benefits");
};


// exports.createEvent = async (req, res) => {
//   const show_on_homepage = req.body.show_on_homepage === "on";
//   const { title, description, event_date, time, location, is_paid, amount } =
//     req.body;
//   let image_url = null;

//   if (req.file) {
//     const result = await cloudinary.uploader.upload(req.file.path, {
//       folder: "events",
//     });
//     image_url = result.secure_url;
//     if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
//   }


//   // await pool.query(
//   //   `INSERT INTO events (title, description, event_date, time, location, is_paid, amount, image_url)
//   //    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
//   //   [
//   //     title,
//   //     description,
//   //     event_date,
//   //     time,
//   //     location,
//   //     is_paid === "true",
//   //     amount || 0,
//   //     image_url,
//   //   ]
//   // );

//   const { early_bird_discount, early_bird_deadline } = req.body;

//   await pool.query(
//     `INSERT INTO events (title, description, event_date, time, location, is_paid, amount, image_url, early_bird_discount, early_bird_deadline)
//    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
//     [
//       title,
//       description,
//       event_date,
//       time,
//       location,
//       is_paid === "true",
//       amount || 0,
//       image_url,
//       early_bird_discount || 0,
//       early_bird_deadline || null,
//     ]
//   );


//   res.redirect("/admin/events");
// };

// exports.viewEventRegistrations = async (req, res) => {
//   const eventId = req.params.id;
//   const eventResult = await pool.query("SELECT * FROM events WHERE id = $1", [
//     eventId,
//   ]);
//   const registrations = await pool.query(
//     "SELECT * FROM event_registrations WHERE event_id = $1",
//     [eventId]
//   );

//   const infoResult = await pool.query(
//     "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
//   );
//   const info = infoResult.rows[0] || {};

//   res.render("admin/eventRegistrations", {
//     info,
//     event: eventResult.rows[0],
//     registrations: registrations.rows,
//   });
// };

// CREATE EVENT
exports.createEvent = async (req, res) => {
  try {
    const show_on_homepage = req.body.show_on_homepage === "on";
    const is_paid = req.body.is_paid === "true" || req.body.is_paid === "on";
    const allow_split_payment = req.body.allow_split_payment === "on";

    const {
      title,
      description,
      event_date,
      time,
      location,
      amount,
      discount_amount,
      discount_deadline
    } = req.body;

    let image_url = null;

    if (req.file) {
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: "events",
      });
      image_url = result.secure_url;
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }

    await pool.query(
      `INSERT INTO events 
        (title, description, event_date, time, location, is_paid, amount, discount_amount, discount_deadline, allow_split_payment, image_url, show_on_homepage)
       VALUES 
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        title,
        description,
        event_date,
        time,
        location,
        is_paid,
        amount || 0,
        discount_amount || 0,
        discount_deadline || null,
        allow_split_payment,
        image_url,
        show_on_homepage
      ]
    );

    res.redirect("/admin/events");
  } catch (err) {
    console.error("Error creating event:", err.message);
    res.status(500).send("Server error while creating event");
  }
};


exports.viewEventRegistrations = async (req, res) => {
  const eventId = req.params.id;
  const { search = "", page = 1 } = req.query;
  const limit = 10;
  const offset = (page - 1) * limit;

  try {
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0] || {};

    const eventResult = await pool.query("SELECT * FROM events WHERE id = $1", [
      eventId,
    ]);
    const event = eventResult.rows[0];
    if (!event) return res.status(404).send("Event not found");

    const searchQuery = `%${search}%`;

    // Get total count for pagination
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM event_registrations 
       WHERE event_id = $1 AND 
       (registrant_name ILIKE $2 OR registrant_email ILIKE $2)`,
      [eventId, searchQuery]
    );
    const total = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(total / limit);

    const registrationsResult = await pool.query(
      `SELECT * FROM event_registrations 
       WHERE event_id = $1 AND 
       (registrant_name ILIKE $2 OR registrant_email ILIKE $2)
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [eventId, searchQuery, limit, offset]
    );

    res.render("admin/eventRegistrations", {
      info,
      event,
      registrations: registrationsResult.rows,
      currentPage: parseInt(page),
      totalPages,
      search,
    });
  } catch (err) {
    console.error("Error loading registrations:", err.message);
    res.status(500).send("Server error");
  }
};


// exports.showEvents = async (req, res) => {
//   const infoResult = await pool.query(
//     "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
//   );
//   const eventsResult = await pool.query(
//     "SELECT * FROM events ORDER BY event_date DESC"
//   );

//   res.render("admin/events", {
//     info: infoResult.rows[0] || {},
//     events: eventsResult.rows,
//     event: {}, // empty for create form
//     formAction: "/admin/events/create", // form action for create
//     submitLabel: "Create Event", // 🔹 default submit label
//   });
// };

exports.showEvents = async (req, res) => {
  try {
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const eventsResult = await pool.query(
      "SELECT * FROM events ORDER BY event_date DESC"
    );

    res.render("admin/events", {
      info: infoResult.rows[0] || {},
      events: eventsResult.rows,
      event: {}, // default for create form
      formAction: "/admin/events/create",
      submitLabel: "Create Event",
    });
  } catch (err) {
    console.error("Error loading events:", err);
    res.status(500).send("Server error");
  }
};


exports.exportEventRegistrations = async (req, res) => {
  const eventId = req.params.id;

  try {
    const registrationsResult = await pool.query(
      `SELECT * FROM event_registrations WHERE event_id = $1`,
      [eventId]
    );

    const fields = [
      "registrant_name",
      "registrant_email",
      "registrant_phone",
      "is_parent",
      "child_name",
      "amount_paid",
      "payment_status",
      "created_at",
    ];
    const parser = new Parser({ fields });
    const csv = parser.parse(registrationsResult.rows);

    res.header("Content-Type", "text/csv");
    res.attachment("event_registrations.csv");
    return res.send(csv);
  } catch (err) {
    console.error("CSV Export Error:", err.message);
    res.status(500).send("Failed to export CSV.");
  }
};

// UPDATE EVENT
// exports.updateEvent = async (req, res) => {
//   const { id } = req.params;
//   const { title, description, event_date, time, location, is_paid, amount } =
//     req.body;

//   const show_on_homepage = req.body.show_on_homepage === "on"; // ✅ Checkbox logic
//   let image_url;

//   try {
//     if (req.file) {
//       const result = await cloudinary.uploader.upload(req.file.path, {
//         folder: "events",
//       });
//       image_url = result.secure_url;
//       if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
//     }

//     // Prepare base query and values
//     let query = `
//       UPDATE events
//       SET title=$1, description=$2, event_date=$3, time=$4, location=$5, is_paid=$6, amount=$7, show_on_homepage=$8
//     `;
//     const values = [
//       title,
//       description,
//       event_date,
//       time,
//       location,
//       is_paid === "true" || is_paid === "on",
//       amount || 0,
//       show_on_homepage,
//     ];

//     if (image_url) {
//       query += `, image_url=$9 WHERE id=$10`;
//       values.push(image_url, id);
//     } else {
//       query += ` WHERE id=$9`;
//       values.push(id);
//     }

//     await pool.query(query, values);
//     res.redirect("/admin/events");
//   } catch (err) {
//     console.error("Error updating event:", err.message);
//     res.status(500).send("Error updating event.");
//   }
// };

// UPDATE EVENT
exports.updateEvent = async (req, res) => {
  try {
    const eventId = req.params.id;
    const show_on_homepage = req.body.show_on_homepage === "on";
    const is_paid = req.body.is_paid === "true" || req.body.is_paid === "on";
    const allow_split_payment = req.body.allow_split_payment === "on";

    const {
      title,
      description,
      event_date,
      time,
      location,
      amount,
      discount_amount,
      discount_deadline
    } = req.body;

    let image_url = req.body.current_image || null;

    if (req.file) {
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: "events",
      });
      image_url = result.secure_url;
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }

    await pool.query(
      `UPDATE events 
       SET title = $1, description = $2, event_date = $3, time = $4, location = $5, 
           is_paid = $6, amount = $7, discount_amount = $8, discount_deadline = $9, 
           allow_split_payment = $10, image_url = $11, show_on_homepage = $12
       WHERE id = $13`,
      [
        title,
        description,
        event_date,
        time,
        location,
        is_paid,
        amount || 0,
        discount_amount || 0,
        discount_deadline || null,
        allow_split_payment,
        image_url,
        show_on_homepage,
        eventId
      ]
    );

    res.redirect("/admin/events");
  } catch (err) {
    console.error("Error updating event:", err.message);
    res.status(500).send("Server error while updating event");
  }
};



// DELETE EVENT
exports.deleteEvent = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM events WHERE id = $1", [id]);
    res.redirect("/admin/events");
  } catch (err) {
    console.error("❌ Error deleting event:", err.message);
    res.status(500).send("Server error");
  }
};







