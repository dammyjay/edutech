const pool = require("../models/db");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
// const nodemailer = require("nodemailer");
const sendEmail = require("../utils/sendEmail");
const cloudinary = require("../utils/cloudinary");
const buildFeedbackPDF = require("../utils/feedbackPdfTemplate");
const buildAnalyticsPDF = require("../utils/buildAnalyticsPDF");
const fs = require("fs");
const { Parser } = require("json2csv");
const PDFDocument = require("pdfkit");
const puppeteer = require("puppeteer");
const { logActivityForUser } = require("../utils/activityLogger");
const path = require("path");

// require at top of file
const Sentiment = require('sentiment');
const sw = require('stopword');
const ExcelJS = require('exceljs');

const sentiment = new Sentiment();


// helper: extract keywords (very simple)
function extractKeywords(text, topN = 25) {
  if (!text) return [];
  // normalize & split
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  // remove stopwords
  const filtered = sw.removeStopwords(words);

  // freq map
  const freq = {};
  filtered.forEach(w => {
    if (w.length <= 2) return;
    freq[w] = (freq[w] || 0) + 1;
  });

  // sort and return topN
  return Object.entries(freq)
    .sort((a,b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }));
}

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

// Admin reset for student or teacher password
exports.resetPassword = async (req, res) => {
  try {
    const { userId } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).send("Password must be at least 6 characters");
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await pool.query("UPDATE users2 SET password = $1 WHERE id = $2", [
      hashedPassword,
      userId,
    ]);

    res.status(200).send("Password reset successfully");
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).send("Server error");
  }
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
      return res.redirect("/admin/dashboard");
    } else if (user.role === "school_admin") {
      // 🔍 find the school linked to this admin
      const schoolRow = await pool.query(
        "SELECT id, school_id, name FROM schools WHERE created_by = $1",
        [user.id]
      );

      let school_id = null;
      let school_name = null;

      if (schoolRow.rows.length) {
        school_id = schoolRow.rows[0].id; // numeric PK
        school_name = schoolRow.rows[0].name; // display name
      }

      // overwrite session with school info
      req.session.user = {
        id: user.id,
        email: user.email,
        role: user.role,
        profile_pic: user.profile_picture,
        school_id,
        school_name,
      };
      await logActivityForUser(
        req,
        "School Admin logged in",
        `School Name: ${school_name}`
      );
      return res.redirect("/school-admin/dashboard");
    } else if (user.role === "teacher") {
      // 🔍 Get classrooms assigned to this teacher
      const classroomsRes = await pool.query(
        `SELECT c.id, c.name
     FROM classrooms c
     JOIN classroom_teachers ct ON ct.classroom_id = c.id
     WHERE ct.teacher_id = $1`,
        [user.id]
      );

      const classrooms = classroomsRes.rows || [];

      // Add teacher + classrooms to session
      req.session.user = {
        id: user.id,
        email: user.email,
        role: user.role,
        profile_pic: user.profile_picture,
        classrooms, // 👈 keep assigned classes in session
      };
      await logActivityForUser(
        req,
        "teacher Logged in",
        `Classroom: ${user.fullname}`
      );
      return res.redirect("/teacher/dashboard");
    } else if (user.role === "parent") {
      await logActivityForUser(
        req,
        "parent logged in",
        `Classroom: ${user.fullname}`
      );
      return res.redirect("/parent/dashboard");
    } else if (user.role === "user" || user.role === "student") {
      return res.redirect("/student/dashboard");
    } else if (user.role === "instructor") {
      return res.redirect("/instructor/dashboard");
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

// inside controllers/adminController.js
exports.analyticsPage = async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/admin/login');
  }
  try {
    const infoResult = await pool.query("SELECT * FROM company_info ORDER BY id DESC LIMIT 1");
    const info = infoResult.rows[0] || {};
    res.render('admin/analytics', { info, user: req.session.user ,role: 'admin' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
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
      role: "admin", // ✅ important
      user: req.session.user,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Server Error");
  }
};

// exports.exportAnalyticsPDF = async (req, res) => {
//   try {
//     const browser = await puppeteer.launch({
//       headless: true,
//       args: ["--no-sandbox", "--disable-setuid-sandbox"],
//     });

//     const page = await browser.newPage();

//     const url = `${req.protocol}://${req.get("host")}/admin/analytics`;
//     console.log("Loading URL:", url);

//     if (req.cookies && req.cookies["connect.sid"]) {
//       await page.setCookie({
//         name: "connect.sid",
//         value: req.cookies["connect.sid"],
//         domain: new URL(url).hostname,
//         path: "/",
//         httpOnly: true,
//         secure: req.secure,
//       });
//     }

//     await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });

//     const pdf = await page.pdf({
//       format: "A4",
//       printBackground: true,
//       margin: { top: "20px", bottom: "20px" },
//     });

//     await browser.close();

//     res.set({
//       "Content-Type": "application/pdf",
//       "Content-Disposition": "attachment; filename=analytics-report.pdf",
//       "Content-Length": pdf.length,
//     });
//     res.send(pdf);
//   } catch (err) {
//     console.error("PDF generation error:", err);
//     res.status(500).send("Could not generate PDF");
//   }
// };

// exports.exportAnalyticsPDF = async (req, res) => {
//   try {
//     // const [
//     //   overview,
//     //   users,
//     //   courses,
//     //   quizzes,
//     //   activity,
//     //   finance,
//     //   eventPaymentDetails,
//     // ] = await Promise.all([
//     //   pool.query(`SELECT * FROM admin_overview()`),
//     //   pool.query(`SELECT * FROM admin_users_by_role()`),
//     //   pool.query(`SELECT * FROM admin_courses()`),
//     //   pool.query(`SELECT * FROM admin_quiz_stats()`),
//     //   pool.query(`SELECT * FROM admin_activity()`),
//     //   pool.query(`SELECT * FROM admin_finance()`),
//     //   pool.query(`SELECT * FROM admin_event_payment_details()`),
//     // ]);

//     const [
//       overview,
//       users,
//       courses,
//       quizzes,
//       activity,
//       finance,
//       eventPaymentDetails,
//     ] = await Promise.all([
//       // overview
//       (async () => {
//         const total = await pool.query(
//           "SELECT COUNT(*)::int AS total_users FROM users2"
//         );
//         const roles = await pool.query(
//           "SELECT role, COUNT(*)::int AS count FROM users2 GROUP BY role"
//         );
//         const newbies = await pool.query(`
//       SELECT
//         COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day')::int AS new_24h,
//         COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS new_7d,
//         COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS new_30d
//       FROM users2;
//     `);
//         const dau = await pool.query(
//           "SELECT COUNT(DISTINCT user_id)::int AS dau FROM activities WHERE created_at >= NOW() - INTERVAL '1 day'"
//         );

//         return {
//           total_users: total.rows[0].total_users,
//           roles: roles.rows,
//           new_users: newbies.rows[0],
//           dau: dau.rows[0].dau,
//         };
//       })(),

//       // users
//       (async () => {
//         const byRole = await pool.query(
//           "SELECT role, COUNT(*)::int AS count FROM users2 GROUP BY role"
//         );
//         const active = await pool.query(
//           "SELECT COUNT(*)::int AS active_48h FROM activities WHERE created_at >= NOW() - INTERVAL '48 hours'"
//         );
//         const inactive = await pool.query(
//           "SELECT COUNT(*)::int AS inactive_30d FROM users2 WHERE id NOT IN (SELECT DISTINCT user_id FROM activities WHERE created_at >= NOW() - INTERVAL '30 days')"
//         );
//         return {
//           byRole: byRole.rows,
//           active: active.rows[0].active_48h,
//           inactive: inactive.rows[0].inactive_30d,
//         };
//       })(),

//       // courses
//       (async () => {
//         const counts = await pool.query(`
//       SELECT
//         (SELECT COUNT(*) FROM courses) AS total_courses,
//         (SELECT COUNT(*) FROM modules) AS total_modules,
//         (SELECT COUNT(*) FROM lessons) AS total_lessons;
//     `);

//         const topCourses =
//           await pool.query(/* same long query you already have */);

//         return {
//           counts: counts.rows[0],
//           topCourses: topCourses.rows,
//         };
//       })(),

//       // quizzes
//       (async () => {
//         const q = await pool.query(`
//       SELECT
//         (SELECT COUNT(*) FROM quizzes)::int AS total_quizzes,
//         (SELECT COUNT(*) FROM quiz_submissions)::int AS total_quiz_submissions,
//         (SELECT COALESCE(AVG(score),0) FROM quiz_submissions)::numeric(6,2) AS avg_score;
//     `);
//         const passFail = await pool.query(
//           "SELECT passed, COUNT(*)::int AS count FROM quiz_submissions GROUP BY passed"
//         );
//         return { summary: q.rows[0], passFail: passFail.rows };
//       })(),

//       // activity
//       (async () => {
//         const feed = await pool.query(`
//       SELECT id, user_id, role, action, details, created_at
//       FROM activities
//       ORDER BY created_at DESC
//       LIMIT 50
//     `);
//         return feed.rows;
//       })(),

//       // finance
//       (async () => {
//         const revenue = await pool.query(`
//       SELECT
//         COALESCE(SUM(amount),0)::numeric(12,2) AS total_revenue,
//         COALESCE(SUM(amount) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'),0)::numeric(12,2) AS revenue_30d
//       FROM transactions;
//     `);
//         const schoolPayments = await pool.query(
//           `SELECT status, COUNT(*)::int AS count FROM school_payments GROUP BY status`
//         );
//         const eventPayments = await pool.query(`
//       SELECT payment_status, COUNT(*)::int AS count,
//              COALESCE(SUM(amount_paid),0)::numeric(12,2) AS total_collected
//       FROM event_registrations
//       GROUP BY payment_status
//     `);
//         return {
//           revenue: revenue.rows[0],
//           schoolPayments: schoolPayments.rows,
//           eventPayments: eventPayments.rows,
//         };
//       })(),

//       // event Payment Details
//       (async () => {
//         const q = await pool.query(`
//       SELECT ep.id, ep.payment_status, ep.amount,
//              ep.created_at,
//              u.fullname, u.email,
//              ev.title AS event_title
//       FROM event_payments ep
//       JOIN users2 u ON u.id = ep.user_id
//       JOIN events ev ON ev.id = ep.event_id
//       ORDER BY ep.created_at DESC
//     `);
//         return q.rows;
//       })(),
//     ]);

//     const html = buildAnalyticsPDF({
//       overview: overview.rows[0],
//       users: { byRole: users.rows },
//       courses: courses.rows[0],
//       quizzes: quizzes.rows[0],
//       activity: { feed: activity.rows },
//       finance: finance.rows[0],
//       eventPaymentDetails: eventPaymentDetails.rows,
//     });

//     pdf.create(html, { format: "A4" }).toStream((err, stream) => {
//       if (err) return res.status(500).send("PDF Generation Failed");
//       res.setHeader("Content-Type", "application/pdf");
//       res.setHeader("Content-Disposition", "inline; filename=analytics.pdf");
//       stream.pipe(res);
//     });
//   } catch (err) {
//     console.error(err);
//     res.status(500).send("Server Error");
//   }
// };

exports.exportAnalyticsPDF = async (req, res) => {
  try {
    const [
      overview,
      users,
      courses,
      quizzes,
      activity,
      finance,
      eventPaymentDetails,
    ] = await Promise.all([
      // OVERVIEW
      (async () => {
        const total = await pool.query(
          "SELECT COUNT(*)::int AS total_users FROM users2"
        );

        const roles = await pool.query(
          "SELECT role, COUNT(*)::int AS count FROM users2 GROUP BY role"
        );

        const newbies = await pool.query(`
          SELECT
            COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day')::int AS new_24h,
            COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS new_7d,
            COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS new_30d
          FROM users2;
        `);

        const dau = await pool.query(
          "SELECT COUNT(DISTINCT user_id)::int AS dau FROM activities WHERE created_at >= NOW() - INTERVAL '1 day'"
        );

        return {
          total_users: total.rows[0].total_users,
          roles: roles.rows,
          new_users: newbies.rows[0],
          dau: dau.rows[0].dau,
        };
      })(),

      // USERS
      (async () => {
        const byRole = await pool.query(
          "SELECT role, COUNT(*)::int AS count FROM users2 GROUP BY role"
        );

        const active = await pool.query(
          "SELECT COUNT(*)::int AS active_48h FROM activities WHERE created_at >= NOW() - INTERVAL '48 hours'"
        );

        const inactive = await pool.query(`
          SELECT COUNT(*)::int AS inactive_30d 
          FROM users2 
          WHERE id NOT IN (
            SELECT DISTINCT user_id FROM activities 
            WHERE created_at >= NOW() - INTERVAL '30 days'
          )
        `);

        return {
          byRole: byRole.rows,
          active: active.rows[0].active_48h,
          inactive: inactive.rows[0].inactive_30d,
        };
      })(),

      // COURSES
      (async () => {
        const counts = await pool.query(`
          SELECT
            (SELECT COUNT(*) FROM courses) AS total_courses,
            (SELECT COUNT(*) FROM modules) AS total_modules,
            (SELECT COUNT(*) FROM lessons) AS total_lessons;
        `);

        const topCourses = await pool.query(`
          WITH lesson_count AS (
            SELECT 
              c.id AS course_id,
              COUNT(l.id)::int AS total_lessons
            FROM courses c
            LEFT JOIN modules m ON m.course_id = c.id
            LEFT JOIN lessons l ON l.module_id = m.id
            GROUP BY c.id
          ),

          completed_lessons AS (
            SELECT 
              m.course_id,
              ulp.user_id,
              COUNT(ulp.lesson_id)::int AS completed_lessons
            FROM user_lesson_progress ulp
            JOIN lessons l ON l.id = ulp.lesson_id
            JOIN modules m ON m.id = l.module_id
            GROUP BY m.course_id, ulp.user_id
          ),

          avg_completion AS (
            SELECT 
              course_id,
              AVG(completed_lessons)::numeric(6,2) AS avg_completed_lessons
            FROM completed_lessons
            GROUP BY course_id
          )

          SELECT
            c.id,
            c.title,
            lc.total_lessons,
            COALESCE(indiv.count, 0) AS individual_enrollments,
            COALESCE(school.count, 0) AS school_enrollments,
            COALESCE(indiv.count,0) + COALESCE(school.count,0) AS total_enrollments,
            COALESCE(ac.avg_completed_lessons, 0)::numeric(6,2) AS avg_completed_lessons,
            CASE 
              WHEN lc.total_lessons > 0 THEN
                ROUND((COALESCE(ac.avg_completed_lessons, 0) / lc.total_lessons) * 100, 2)
              ELSE 0
            END AS avg_progress
          FROM courses c
          LEFT JOIN lesson_count lc ON lc.course_id = c.id
          LEFT JOIN avg_completion ac ON ac.course_id = c.id

          LEFT JOIN (
            SELECT course_id, COUNT(*)::int AS count
            FROM course_enrollments
            GROUP BY course_id
          ) indiv ON indiv.course_id = c.id

          LEFT JOIN (
            SELECT 
              sc.course_id,
              COUNT(us.user_id)::int AS count
            FROM school_courses sc
            JOIN user_school us 
                ON us.school_id = sc.school_id
               AND us.role_in_school = 'student'
               AND us.approved = true
            GROUP BY sc.course_id
          ) school ON school.course_id = c.id

          ORDER BY total_enrollments DESC
          LIMIT 10;
        `);

        return {
          counts: counts.rows[0],
          topCourses: topCourses.rows,
        };
      })(),

      // QUIZZES
      (async () => {
        const summary = await pool.query(`
          SELECT
            (SELECT COUNT(*) FROM quizzes)::int AS total_quizzes,
            (SELECT COUNT(*) FROM quiz_submissions)::int AS total_quiz_submissions,
            (SELECT COALESCE(AVG(score),0) FROM quiz_submissions)::numeric(6,2) AS avg_score;
        `);

        const passFail = await pool.query(
          "SELECT passed, COUNT(*)::int AS count FROM quiz_submissions GROUP BY passed"
        );

        return { summary: summary.rows[0], passFail: passFail.rows };
      })(),

      // ACTIVITY
      (async () => {
        const feed = await pool.query(`
          SELECT id, user_id, role, action, details, created_at
          FROM activities
          ORDER BY created_at DESC
          LIMIT 50
        `);
        return feed.rows;
      })(),

      // FINANCE
      (async () => {
        const revenue = await pool.query(`
          SELECT 
            COALESCE(SUM(amount),0)::numeric(12,2) AS total_revenue,
            COALESCE(SUM(amount) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'),0)::numeric(12,2) AS revenue_30d
          FROM transactions;
        `);

        const schoolPayments = await pool.query(`
          SELECT status, COUNT(*)::int AS count FROM school_payments GROUP BY status
        `);

        const eventPayments = await pool.query(`
          SELECT payment_status, COUNT(*)::int AS count,
                 COALESCE(SUM(amount_paid),0)::numeric(12,2) AS total_collected
          FROM event_registrations
          GROUP BY payment_status
        `);

        return {
          revenue: revenue.rows[0],
          schoolPayments: schoolPayments.rows,
          eventPayments: eventPayments.rows,
        };
      })(),

      // eventPaymentDetails
      (async () => {
        const q = await pool.query(`
    SELECT 
      er.id,
      er.registrant_name,
      er.registrant_email,
      er.registrant_phone,
      er.payment_status,
      er.amount_paid,
      er.balance_due,
      er.total_amount,
      er.num_people,
      er.child_names,
      er.payment_option,
      er.created_at,
      ev.title AS event_title
    FROM event_registrations er
    JOIN events ev ON ev.id = er.event_id
    ORDER BY er.created_at DESC
  `);
        return q.rows;
      })(),
    ]);

    // Build the HTML
    const html = buildAnalyticsPDF({
      overview, // { total_users, roles, new_users, dau }
      users: {
        byRole: users.byRole,
        active: users.active,
        inactive: users.inactive,
      },
      courses: { counts: courses.counts, topCourses: courses.topCourses },
      quizzes: { summary: quizzes.summary, passFail: quizzes.passFail },
      activity: { feed: activity },
      finance,
      eventPaymentDetails,
    });

    // Launch Puppeteer
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    // Set HTML content
    await page.setContent(html, { waitUntil: "networkidle0" });

    // Generate PDF
    const pdfBuffer = await page.pdf({ format: "A4", printBackground: true });

    await browser.close();

    // Send PDF to client
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=analytics.pdf");
    res.send(pdfBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  }
};


exports.overview = async (req, res) => {
  try {
    const total = await pool.query('SELECT COUNT(*)::int AS total_users FROM users2');
    const roles = await pool.query('SELECT role, COUNT(*)::int AS count FROM users2 GROUP BY role');
    const newbies = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day')::int AS new_24h,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS new_7d,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS new_30d
      FROM users2;
    `);
    const dau = await pool.query("SELECT COUNT(DISTINCT user_id)::int AS dau FROM activities WHERE created_at >= NOW() - INTERVAL '1 day'");

    res.json({
      totalUsers: total.rows[0].total_users,
      roles: roles.rows,
      newUsers: newbies.rows[0],
      dau: dau.rows[0].dau
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.users = async (req, res) => {
  try {
    const byRole = await pool.query("SELECT role, COUNT(*)::int AS count FROM users2 GROUP BY role");
    const active = await pool.query("SELECT COUNT(*)::int AS active_48h FROM activities WHERE created_at >= NOW() - INTERVAL '48 hours'");
    const inactive = await pool.query("SELECT COUNT(*)::int AS inactive_30d FROM users2 WHERE id NOT IN (SELECT DISTINCT user_id FROM activities WHERE created_at >= NOW() - INTERVAL '30 days')");

    res.json({ byRole: byRole.rows, active: active.rows[0].active_48h, inactive: inactive.rows[0].inactive_30d });
  } catch (err) { console.error(err); res.status(500).json({error:'Server error'}); }
};

exports.courses = async (req, res) => {
  try {
    const counts = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM courses) AS total_courses,
        (SELECT COUNT(*) FROM modules) AS total_modules,
        (SELECT COUNT(*) FROM lessons) AS total_lessons;
    `);

    const topCourses = await pool.query(`
      WITH lesson_count AS (
        SELECT 
          c.id AS course_id,
          COUNT(l.id)::int AS total_lessons
        FROM courses c
        LEFT JOIN modules m ON m.course_id = c.id
        LEFT JOIN lessons l ON l.module_id = m.id
        GROUP BY c.id
      ),

      completed_lessons AS (
        SELECT 
          m.course_id,
          ulp.user_id,
          COUNT(ulp.lesson_id)::int AS completed_lessons
        FROM user_lesson_progress ulp
        JOIN lessons l ON l.id = ulp.lesson_id
        JOIN modules m ON m.id = l.module_id
        GROUP BY m.course_id, ulp.user_id
      ),

      avg_completion AS (
        SELECT 
          course_id,
          AVG(completed_lessons)::numeric(6,2) AS avg_completed_lessons
        FROM completed_lessons
        GROUP BY course_id
      )

      SELECT
        c.id,
        c.title,

        lc.total_lessons,

        -- INDIVIDUAL ENROLLMENTS
        COALESCE(indiv.count, 0) AS individual_enrollments,

        -- SCHOOL ENROLLMENTS
        COALESCE(school.count, 0) AS school_enrollments,

        -- TOTAL ENROLLMENTS
        COALESCE(indiv.count,0) + COALESCE(school.count,0) AS total_enrollments,

        -- AVERAGE COMPLETED LESSONS (REAL DATA)
        COALESCE(ac.avg_completed_lessons, 0)::numeric(6,2) AS avg_completed_lessons,

        -- AVG PROGRESS (%) = completed / total lessons × 100
        CASE 
          WHEN lc.total_lessons > 0 THEN
            ROUND((COALESCE(ac.avg_completed_lessons, 0) / lc.total_lessons) * 100, 2)
          ELSE 0
        END AS avg_progress

      FROM courses c

      LEFT JOIN lesson_count lc ON lc.course_id = c.id
      LEFT JOIN avg_completion ac ON ac.course_id = c.id

      -- INDIVIDUAL ENROLLMENTS
      LEFT JOIN (
        SELECT course_id, COUNT(*)::int AS count
        FROM course_enrollments
        GROUP BY course_id
      ) indiv ON indiv.course_id = c.id

      -- SCHOOL ENROLLMENTS
      LEFT JOIN (
        SELECT 
          sc.course_id,
          COUNT(us.user_id)::int AS count
        FROM school_courses sc
        JOIN user_school us 
              ON us.school_id = sc.school_id
             AND us.role_in_school = 'student'
             AND us.approved = true
        GROUP BY sc.course_id
      ) school ON school.course_id = c.id

      ORDER BY total_enrollments DESC
      LIMIT 10;
    `);

    res.json({
      counts: counts.rows[0],
      topCourses: topCourses.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
};

exports.progress = async (req, res) => {
  try {
    const lessonsToday = await pool.query("SELECT COUNT(*)::int AS lessons_completed_today FROM user_lesson_progress WHERE completed_at >= CURRENT_DATE");
    const moduleComps = await pool.query("SELECT COUNT(*)::int AS module_completions FROM unlocked_modules");
    const courseProgress = await pool.query(`
      SELECT COUNT(*) FILTER (WHERE progress >= 100)::int AS courses_completed,
             COUNT(*)::int AS total_enrollments
      FROM course_enrollments;
    `);

    res.json({
      lessonsCompletedToday: lessonsToday.rows[0].lessons_completed_today,
      moduleCompletions: moduleComps.rows[0].module_completions,
      courseProgress: courseProgress.rows[0]
    });
  } catch (err) { console.error(err); res.status(500).json({error:'Server error'}); }
};

exports.quizzes = async (req, res) => {
  try {
    const q = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM quizzes)::int AS total_quizzes,
        (SELECT COUNT(*) FROM quiz_submissions)::int AS total_quiz_submissions,
        (SELECT COALESCE(AVG(score),0) FROM quiz_submissions)::numeric(6,2) AS avg_score;
    `);
    const passFail = await pool.query("SELECT passed, COUNT(*)::int AS count FROM quiz_submissions GROUP BY passed");

    res.json({ summary: q.rows[0], passFail: passFail.rows });
  } catch (err) { console.error(err); res.status(500).json({error:'Server error'}); }
};

exports.finance = async (req, res) => {
  try {
    // Total revenue
    const revenue = await pool.query(`
      SELECT 
        COALESCE(SUM(amount),0)::numeric(12,2) AS total_revenue,
        COALESCE(SUM(amount) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'),0)::numeric(12,2) AS revenue_30d
      FROM transactions;
    `);

    // School payments by status
    const schoolPayments = await pool.query(`
      SELECT status, COUNT(*)::int AS count
      FROM school_payments
      GROUP BY status
    `);

    // Event payments by status
    const eventPayments = await pool.query(`
      SELECT payment_status, COUNT(*)::int AS count, 
             COALESCE(SUM(amount_paid),0)::numeric(12,2) AS total_collected
      FROM event_registrations
      GROUP BY payment_status
    `);

    res.json({
      revenue: revenue.rows[0],
      schoolPayments: schoolPayments.rows,
      eventPayments: eventPayments.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
};

exports.eventPaymentDetails = async (req, res) => {
  const q = await pool.query(`
     SELECT ep.id, ep.payment_status, ep.amount,
            ep.created_at,
            u.fullname, u.email,
            ev.title AS event_title
     FROM event_payments ep
     JOIN users2 u ON u.id = ep.user_id
     JOIN events ev ON ev.id = ep.event_id
     ORDER BY ep.created_at DESC
  `);

  res.json(q.rows);
};

// exports.showFeedbackForm = (req, res) => {
//   res.render('feedback'); // feedback.ejs
// };

exports.feedback = async (req, res) => {
  try {
    const feedbackSummary = await pool.query("SELECT COUNT(*)::int AS total_feedback, AVG(rating)::numeric(4,2) AS avg_rating FROM feedback");
    const byType = await pool.query("SELECT user_type, COUNT(*)::int AS count FROM feedback GROUP BY user_type");
    res.json({ summary: feedbackSummary.rows[0], byType: byType.rows });
  } catch (err) { console.error(err); res.status(500).json({error:'Server error'}); }
};

exports.activity = async (req, res) => {
  try {
    const feed = await pool.query(`
      SELECT id, user_id, role, action, details, created_at
      FROM activities
      ORDER BY created_at DESC
      LIMIT 50
    `);
    res.json({ feed: feed.rows });
  } catch (err) { console.error(err); res.status(500).json({error:'Server error'}); }
};

exports.submitFeedbackAPI = async (req, res) => {
  try {
    const {
      user_type,
      name,
      email,
      message,
      rating,
      student_class,
      school_name,
      organization_name,
    } = req.body;

    await pool.query(
      `INSERT INTO feedback(user_type, fullname, email, message, rating, student_class, school_name, organization_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        user_type,
        name,
        email,
        message,
        rating,
        student_class || null,
        school_name || null,
        organization_name || null,
      ]
    );

    return res.json({
      success: true,
      message: "Thank you! Your feedback has been submitted successfully.",
    });
  } catch (err) {
    console.error("❌ FEEDBACK ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Could not submit feedback",
    });
  }
};

exports.showFeedbackForm = (req, res) => {
  res.render("feedback"); // feedback.ejs
};

// Submit feedback via AJAX
// exports.submitFeedbackAPI = async (req, res) => {
//   try {
//     const {
//       user_type,
//       name,
//       email,
//       message,
//       rating,
//       student_class,
//       school_name,
//       organization_name,
//     } = req.body;

//     await pool.query(
//       `INSERT INTO feedback(user_type, fullname, email, message, rating, student_class, school_name, organization_name)
//        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
//       [
//         user_type,
//         name,
//         email,
//         message,
//         rating,
//         student_class || null,
//         school_name || null,
//         organization_name || null,
//       ]
//     );

//     // Return JSON so frontend can show thank-you
//     res.json({ success: true, message: "Thank you for your feedback!" });

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ success: false, message: "Could not submit feedback" });
//   }
// };

exports.submitFeedbackAPI = async (req, res) => {
  try {
    const {
      user_type,
      name,
      email,
      message,
      rating,
      student_class,
      school_name,
      organization_name,
      category,
      extra,
    } = req.body;

    // sentiment analysis
    const s = sentiment.analyze((message || "") + " " + (category || ""));
    const sentiment_score = s.score;
    let sentiment_label = "neutral";
    if (sentiment_score > 1) sentiment_label = "positive";
    if (sentiment_score < -1) sentiment_label = "negative";

    // keywords
    const keywords = extractKeywords(message || "");

    // insert (include optional sentiment & keywords if the columns exist)
    await pool.query(
      `INSERT INTO feedback(user_type, name, email, message, rating, student_class, school_name, organization_name, category, extra, sentiment_label, sentiment_score, keywords, is_published)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        user_type,
        name,
        email || null,
        message,
        rating || null,
        student_class || null,
        school_name || null,
        organization_name || null,
        category || null,
        extra || null,
        sentiment_label,
        sentiment_score,
        JSON.stringify(keywords),
        false, // default unpublished until admin approves
      ]
    );

    return res.json({
      success: true,
      message: "Thank you! Your feedback has been submitted successfully.",
    });
  } catch (err) {
    console.error("❌ FEEDBACK ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Could not submit feedback",
    });
  }
};


// Admin HTML view
exports.viewFeedback = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }

  try {
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );

    const feedbackResult = await pool.query(
      "SELECT * FROM feedback ORDER BY created_at DESC"
    );

    res.render("admin/feedback", {
      info: infoResult.rows[0],
      feedback: feedbackResult.rows,
      user: req.session.user,
      role: "admin",
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading feedback");
  }
};

// Admin JSON API
// exports.getFeedbackAPI = async (req, res) => {
//   try {
//     const feedbackResult = await pool.query(
//       "SELECT * FROM feedback ORDER BY created_at DESC"
//     );

//     const infoResult = await pool.query(
//       "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
//     );
//     res.json({ feedback: feedbackResult.rows, info: infoResult.rows[0] });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Server error" });
//   }
// };

// GET /admin/feedback/api
exports.getFeedbackAPI = async (req, res) => {
  try {
    // query params: page, perPage, user_type, rating, dateFrom, dateTo, school, search, published
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const perPage = Math.min(200, parseInt(req.query.perPage) || 20);
    const offset = (page - 1) * perPage;

    const filters = [];
    const params = [];

    if (req.query.user_type) {
      params.push(req.query.user_type);
      filters.push(`user_type = $${params.length}`);
    }
    if (req.query.rating) {
      params.push(parseInt(req.query.rating));
      filters.push(`rating = $${params.length}`);
    }
    if (req.query.published) {
      params.push(req.query.published === 'true');
      filters.push(`is_published = $${params.length}`);
    }
    if (req.query.school_name) {
      params.push(`%${req.query.school_name}%`);
      filters.push(`school_name ILIKE $${params.length}`);
    }
    if (req.query.dateFrom) {
      params.push(req.query.dateFrom);
      filters.push(`created_at >= $${params.length}`);
    }
    if (req.query.dateTo) {
      params.push(req.query.dateTo);
      filters.push(`created_at <= $${params.length}`);
    }
    if (req.query.search) {
      params.push(`%${req.query.search}%`);
      filters.push(`(name ILIKE $${params.length} OR message ILIKE $${params.length} OR email ILIKE $${params.length})`);
    }

    const where = filters.length ? 'WHERE ' + filters.join(' AND ') : '';

    // total count
    const totalQ = await pool.query(`SELECT COUNT(*)::int AS total FROM feedback ${where}`, params);
    const total = totalQ.rows[0].total;

    // fetch page
    params.push(perPage, offset);
    const q = await pool.query(
      `SELECT id, user_type, name, email, message, rating, school_name, student_class, organization_name, category, created_at, sentiment_label, sentiment_score, keywords, is_published
       FROM feedback
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length-1} OFFSET $${params.length}`,
      params
    );

    res.json({ total, page, perPage, rows: q.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.exportFeedbackPDF = async (req, res) => {
  try {
    const { rows: feedback } = await pool.query(`
      SELECT *
      FROM feedback
      ORDER BY created_at DESC
    `);

    const html = buildFeedbackPDF(feedback);

    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20px", bottom: "20px" },
    });

    await browser.close();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=feedback_report.pdf`
    );

    res.send(pdf);
  } catch (err) {
    console.error("PDF Export Error:", err);
    res.status(500).send("Failed to generate PDF");
  }
};

// CSV export
exports.exportFeedbackCSV = async (req, res) => {
  try {
    // reuse getFeedbackAPI style filter building or simpler: export all / with same filters
    // For brevity, keep same query as getFeedbackAPI but without pagination
    const filters = [];
    const params = [];
    if (req.query.user_type) { params.push(req.query.user_type); filters.push(`user_type = $${params.length}`); }
    if (req.query.published) { params.push(req.query.published === 'true'); filters.push(`is_published = $${params.length}`); }
    if (req.query.search) { params.push(`%${req.query.search}%`); filters.push(`(name ILIKE $${params.length} OR message ILIKE $${params.length})`); }
    const where = filters.length ? 'WHERE ' + filters.join(' AND ') : '';

    const q = await pool.query(
      `SELECT id, user_type, name, email, message, rating, school_name, category, student_class, organization_name, created_at FROM feedback ${where} ORDER BY created_at DESC`,
      params
    );
 
    const fields = ['id','user_type','name','email','rating', 'message', 'category','school_name', 'student_class', 'organization_name','created_at'];
    const parser = new Parser({ fields });
    const csv = parser.parse(q.rows);

    res.setHeader('Content-disposition', 'attachment; filename=feedback.csv');
    res.set('Content-Type', 'text/csv');
    res.status(200).send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).send('Export failed');
  }
};

// Excel export
exports.exportFeedbackExcel = async (req, res) => {
  try {
    const q = await pool.query('SELECT id, user_type, name, email, message, rating, school_name, category, student_class, organization_name, created_at FROM feedback ORDER BY created_at DESC');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Feedback');

    sheet.columns = [
      { header: 'ID', key: 'id', width: 8 },
      { header: 'Type', key: 'user_type', width: 15 },
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Email', key: 'email', width: 25 },
      { header: 'Rating', key: 'rating', width: 10 },
      { header: 'Category', key: 'category', width: 25 },
      { header: 'School', key: 'school_name', width: 20 },
      { header: 'Student class', key: 'student_class', width: 20 },
      { header: 'Organization', key: 'organization_name', width: 20 },
      { header: 'Message', key: 'message', width: 60 },
      { header: 'Date', key: 'created_at', width: 20 }
    ];

    q.rows.forEach(r => sheet.addRow(r));

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=feedback.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).send('Excel export failed');
  }
};

// GET /admin/feedback/detail/:id
exports.getFeedbackDetail = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const q = await pool.query('SELECT * FROM feedback WHERE id = $1', [id]);
    if(q.rowCount === 0) return res.status(404).json({ error: 'not found' });
    return res.json(q.rows[0]);
  } catch(err) {
    console.error(err); res.status(500).json({error:'server'});
  }
};

// POST /admin/feedback/publish/:id
// exports.togglePublish = async (req,res) => {
//   try {
//     const id = parseInt(req.params.id);
//     const publish = !!req.body.publish;
//     await pool.query('UPDATE feedback SET is_published = $1 WHERE id = $2', [publish, id]);
//     res.json({ success: true });
//   } catch(err) {
//     console.error(err); res.status(500).json({ success:false });
//   }
// };

exports.togglePublish = async (req, res) => {
  try {
    const id = req.params.id;
    const { status } = req.body;

    await pool.query("UPDATE feedback SET is_published=$1 WHERE id=$2", [
      status,
      id,
    ]);

    res.json({ success: true });
  } catch (err) {
    console.error("Publish toggle error:", err);
    res.status(500).json({ success: false });
  }
};

exports.deleteFeedback = async (req, res) => {
  try {
    const id = req.params.id;

    await pool.query("DELETE FROM feedback WHERE id=$1", [id]);

    res.json({ success: true });
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({ success: false });
  }
};


exports.instructorDashboard = async (req, res) => {
  try {
    const instructorId = req.user.id;

    // ✅ Company Info
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0];

    // ✅ Teaching Stats
    const coursesCount = await pool.query(
      `SELECT COUNT(*) FROM courses WHERE instructor_id = $1`,
      [instructorId]
    );

    const modulesCount = await pool.query(
      `SELECT COUNT(*) 
       FROM modules m
       JOIN courses c ON m.course_id = c.id
       WHERE c.instructor_id = $1`,
      [instructorId]
    );

    const lessonsCount = await pool.query(
      `SELECT COUNT(*) 
       FROM lessons l
       JOIN modules m ON l.module_id = m.id
       JOIN courses c ON m.course_id = c.id
       WHERE c.instructor_id = $1`,
      [instructorId]
    );

    const studentsCount = await pool.query(
      `SELECT COUNT(DISTINCT e.user_id) 
       FROM course_enrollments e
       JOIN courses c ON e.course_id = c.id
       WHERE c.instructor_id = $1`,
      [instructorId]
    );

    const submissionsCount = await pool.query(
      `SELECT COUNT(*) 
       FROM assignment_submissions s
       JOIN lessons l ON s.assignment_id = l.id
       JOIN modules m ON l.module_id = m.id
       JOIN courses c ON m.course_id = c.id
       WHERE c.instructor_id = $1`,
      [instructorId]
    );

    const coursesList = await pool.query(
      `SELECT c.id, c.title, COUNT(e.id) AS student_count
       FROM courses c
       LEFT JOIN course_enrollments e ON e.course_id = c.id
       WHERE c.instructor_id = $1
       GROUP BY c.id
       ORDER BY c.created_at DESC`,
      [instructorId]
    );

    // ✅ Students list (for dropdown)
    const studentsResult = await pool.query(
      `
      SELECT u.id, u.fullname AS full_name, u.email
      FROM users2 u
      JOIN user_school us ON us.user_id = u.id
      WHERE us.school_id = (
        SELECT school_id FROM user_school WHERE user_id = $1 LIMIT 1
      )
      AND us.role_in_school = 'student'
      ORDER BY u.fullname
      `,
      [instructorId]
    );

    // ✅ Recent messages sent *to* this instructor
    const receivedMessagesResult = await pool.query(
      `
      SELECT 
        m.id,
        m.sender_id,
        m.message,
        m.created_at,
        u.fullname AS sender_name,
        u.email AS sender_email
      FROM messages m
      JOIN users2 u ON u.id = m.sender_id
      WHERE m.receiver_id = $1
      ORDER BY m.created_at DESC
      LIMIT 10
      `,
      [instructorId]
    );

    const profilePic = req.session.user
      ? req.session.user.profile_picture
      : null;

    res.render("instructor/dashboard", {
      total_courses: parseInt(coursesCount.rows[0].count, 10),
      total_modules: parseInt(modulesCount.rows[0].count, 10),
      total_lessons: parseInt(lessonsCount.rows[0].count, 10),
      total_students: parseInt(studentsCount.rows[0].count, 10),
      total_submissions: parseInt(submissionsCount.rows[0].count, 10),
      courses: coursesList.rows,
      students: studentsResult.rows,
      receivedMessages: receivedMessagesResult.rows, // ✅ new
      info,
      profilePic,
      role: "instructor",
      user: req.session.user,
    });
  } catch (err) {
    console.error("Instructor Dashboard Error:", err);
    res.status(500).send("Error loading dashboard");
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
    await logActivityForUser(req, "User updated", `user name: ${fullname}`);
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
    await logActivityForUser(req, "User Deleted");
    res.redirect("/admin/dashboard");
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).send("Server error");
  }
};

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
  await logActivityForUser(
    req,
    "Admin Profile Updated ",
    `Admin name: ${fullname}`
  );
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
  res.render("admin/pathways", {
    info,
    search,
    pathways: result.rows,
    role: req.session.user?.role || "admin",
  });
};

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
  await logActivityForUser(req, "Pathway Created", `Pathway name: ${title}`);
  res.redirect("/admin/pathways");
};

exports.deletePathway = async (req, res) => {
  const { id } = req.params;
  await pool.query("DELETE FROM career_pathways WHERE id = $1", [id]);
  await logActivityForUser(req, "Pathway deleted", `Pathway ID: ${id}`);
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
  await logActivityForUser(req, "Pathway edited", `Pathway title: ${title}`);
  res.redirect("/admin/pathways");
};

// --- COURSES ---

exports.showCourses = async (req, res) => {
  const infoResult = await pool.query(
    "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
  );
  const info = infoResult.rows[0] || {};

  let coursesQuery = `
    SELECT courses.*, cp.title AS pathway_name
    FROM courses
    LEFT JOIN career_pathways cp ON cp.id = courses.career_pathway_id
  `;
  let params = [];

  // ✅ If instructor → only fetch their courses
  if (req.user.role === "instructor") {
    coursesQuery += ` WHERE courses.instructor_id = $1 `;
    params.push(req.user.id);
  }

  coursesQuery += ` ORDER BY cp.title ASC, courses.level ASC, sort_order ASC`;

  const coursesResult = await pool.query(coursesQuery, params);

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
    role: req.session.user?.role || "admin",
  });
};

exports.createCourse = async (req, res) => {
  console.log("📘 Creating course with:", req.body);
  const { title, description, level, career_pathway_id, sort_order, amount } =
    req.body;

  let thumbnail_url = null;
  let curriculum_url = null;
  let curriculum_mime = null;
  let curriculum_name = null;
  let certificate_url = null;
  let certificate_mime = null;
  let certificate_name = null;

  try {
    // ✅ Upload thumbnail (image)
    if (req.files?.thumbnail?.[0]) {
      const thumbPath = req.files.thumbnail[0].path;
      const thumbResult = await cloudinary.uploader.upload(thumbPath, {
        folder: "courses/thumbnails",
        resource_type: "image",
        use_filename: true,
        unique_filename: false,
      });
      thumbnail_url = thumbResult.secure_url;
      if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
    }

    // ✅ Upload curriculum (PDF/DOC/DOCX)
    if (req.files?.curriculum?.[0]) {
      const file = req.files.curriculum[0];
      const filePath = file.path;
      const fileResult = await cloudinary.uploader.upload(filePath, {
        folder: "courses/curriculums",
        resource_type: "raw",
        use_filename: true,
        unique_filename: false,
      });
      curriculum_url = fileResult.secure_url;
      curriculum_mime = file.mimetype;
      curriculum_name = file.originalname;
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    // ✅ Upload certificate (PDF or Image)
    if (req.files?.certificate?.[0]) {
      const cert = req.files.certificate[0];
      const certPath = cert.path;
      const certResult = await cloudinary.uploader.upload(certPath, {
        folder: "courses/certificates",
        resource_type: "auto",
        use_filename: true,
        unique_filename: false,
      });
      certificate_url = certResult.secure_url;
      certificate_mime = cert.mimetype;
      certificate_name = cert.originalname;
      if (fs.existsSync(certPath)) fs.unlinkSync(certPath);
    }

    // ✅ Insert into DB
    await pool.query(
      `INSERT INTO courses (
        title, description, level, career_pathway_id,
        thumbnail_url, curriculum_url, sort_order,
        amount, created_by, instructor_id,
        curriculum_mime, curriculum_name,
        certificate_url, certificate_mime, certificate_name
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        title,
        description,
        level,
        career_pathway_id || null,
        thumbnail_url,
        curriculum_url,
        sort_order || 0,
        amount || 0,
        req.user.role === "instructor" ? "instructor" : "admin",
        req.user.role === "instructor" ? req.user.id : null,
        curriculum_mime,
        curriculum_name,
        certificate_url,
        certificate_mime,
        certificate_name,
      ]
    );

    await logActivityForUser(req, "Course Created", `Course title: ${title}`);
    console.log("✅ Course created successfully.");

    res.redirect(`/admin/pathways/${career_pathway_id}/courses`);
  } catch (err) {
    console.error("❌ Error creating course:", err);
    res
      .status(500)
      .send("Error creating course: " + (err.message || "unknown"));
  }
};

// ✅ EDIT COURSE

exports.editCourse = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, level, amount } = req.body;

    let thumbnailUrl = null;
    let curriculumUrl = null;
    let certificateUrl = null;

    // Get existing course data
    const existingCourse = await pool.query(
      "SELECT * FROM courses WHERE id = $1",
      [id]
    );

    if (existingCourse.rows.length === 0) {
      return res.status(404).send("Course not found");
    }

    const course = existingCourse.rows[0];

    // Upload new files if provided
    if (req.files?.thumbnail) {
      const uploadedThumb = await cloudinary.uploader.upload(
        req.files.thumbnail[0].path
      );
      thumbnailUrl = uploadedThumb.secure_url;
    } else {
      thumbnailUrl = course.thumbnail_url;
    }

    if (req.files?.curriculum) {
      const uploadedCurr = await cloudinary.uploader.upload(
        req.files.curriculum[0].path,
        { resource_type: "auto" }
      );
      curriculumUrl = uploadedCurr.secure_url;
    } else {
      curriculumUrl = course.curriculum_url;
    }

    if (req.files?.certificate) {
      const uploadedCert = await cloudinary.uploader.upload(
        req.files.certificate[0].path,
        { resource_type: "auto" }
      );
      certificateUrl = uploadedCert.secure_url;
    } else {
      certificateUrl = course.certificate_url;
    }

    // Update the course
    await pool.query(
      `UPDATE courses
       SET title=$1, description=$2, level=$3, amount=$4,
           thumbnail_url=$5, curriculum_url=$6, certificate_url=$7
       WHERE id=$8`,
      [
        title,
        description,
        level,
        amount,
        thumbnailUrl,
        curriculumUrl,
        certificateUrl,
        id,
      ]
    );

    res.redirect("back");
  } catch (error) {
    console.error("❌ Error editing course:", error);
    res.status(500).send("Server error while editing course");
  }
};


exports.deleteCourse = async (req, res) => {
  const { id } = req.params;

  try {
    // 🔒 Check ownership
    let checkQuery = `SELECT * FROM courses WHERE id = $1`;
    let checkParams = [id];

    const courseResult = await pool.query(checkQuery, checkParams);
    const course = courseResult.rows[0];

    if (!course) {
      return res.status(404).send("Course not found.");
    }

    if (
      req.user.role === "instructor" &&
      course.instructor_id !== req.user.id
    ) {
      return res.status(403).send("You are not allowed to delete this course.");
    }

    // ✅ Delete course
    await pool.query("DELETE FROM courses WHERE id = $1", [id]);

    res.redirect("/admin/courses");
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error.");
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

  let coursesQuery = `
    SELECT * FROM courses 
    WHERE career_pathway_id = $1
  `;
  let params = [id];

  // ✅ Restrict instructors to their own courses
  if (req.user.role === "instructor") {
    coursesQuery += " AND instructor_id = $2";
    params.push(req.user.id);
  }

  coursesQuery += " ORDER BY level ASC, sort_order ASC";

  const coursesResult = await pool.query(coursesQuery, params);

  res.render("admin/pathwayCourses", {
    info,
    pathway,
    careerPathways: careerPathways.rows,
    courses: coursesResult.rows,
    role: req.session.user?.role || "admin",
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
    `INSERT INTO courses (
      title, description, level, career_pathway_id, thumbnail_url, sort_order, amount, created_by, instructor_id
   )
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      title,
      description,
      level,
      career_pathway_id || null,
      thumbnail_url,
      sort_order || 0,
      amount || 0,
      req.user.role === "instructor" ? "instructor" : "admin",
      req.user.role === "instructor" ? req.user.id : null,
    ]
  );

  res.redirect(`/admin/pathways/${id}/courses`);
};

exports.showBenefits = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }
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
    role: "admin",
    users: req.session.user,
  });
};

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
  await logActivityForUser(req, "Benefit created", `Benefit title: ${title}`);
  res.redirect("/admin/benefits");
};

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
      discount_deadline,
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
        show_on_homepage,
      ]
    );
    await logActivityForUser(req, "Event created", `Event title: ${title}`);
    res.redirect("/admin/events");
  } catch (err) {
    console.error("Error creating event:", err.message);
    res.status(500).send("Server error while creating event");
  }
};

exports.viewEventRegistrations = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }
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
      role: req.session.user?.role || "admin",
    });
  } catch (err) {
    console.error("Error loading registrations:", err.message);
    res.status(500).send("Server error");
  }
};

exports.showEvents = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }
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
      role: "admin",
      users: req.session.user,
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
      discount_deadline,
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
        eventId,
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

exports.listStudents = async (req, res) => {
  try {
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0];
    const users = await pool.query(
      `SELECT id, fullname, email, phone, gender, role, created_at, profile_picture
       FROM users2 WHERE role='user'
       ORDER BY created_at DESC`
    );
    res.render("admin/students", { users: users.rows, info });
  } catch (err) {
    console.error("List students error:", err.message);
    res.status(500).send("Failed to fetch students");
  }
};

exports.viewStudentDetails = async (req, res) => {
  try {
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0];
    const { id } = req.params;
    const studentRes = await pool.query(
      `SELECT id, fullname, email, phone, gender, dob, wallet_balance2, profile_picture, created_at
       FROM users2 WHERE id=$1`,
      [id]
    );
    if (studentRes.rows.length === 0)
      return res.status(404).send("Student not found");

    res.render("admin/studentDetails", { student: studentRes.rows[0], info });
  } catch (err) {
    console.error("View student details error:", err.message);
    res.status(500).send("Failed to fetch student");
  }
};

// exports.viewStudentProgress = async (req, res) => {
//   try {
//     const infoResult = await pool.query(
//       "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
//     );
//     const info = infoResult.rows[0];
//     const { id } = req.params;

//     // detect where user came from (default admin)
//     const from =
//       req.query.from ||
//       (req.get("referer")?.includes("/parent") ? "parent" : "admin");

//     // ✅ Get student info
//     const studentRes = await pool.query(
//       `SELECT id, fullname, email, created_at
//        FROM users2 WHERE id = $1`,
//       [id]
//     );
//     if (!studentRes.rows.length)
//       return res.status(404).send("Student not found");
//     const student = studentRes.rows[0];

//     // ✅ Courses
//     const coursesRes = await pool.query(
//       `
//       SELECT c.id, c.title AS course_title, e.enrolled_at
//       FROM courses c
//       JOIN course_enrollments e ON e.course_id = c.id
//       WHERE e.user_id = $1
//       ORDER BY c.title;
//       `,
//       [id]
//     );

//     // ✅ Modules per course
//     const modulesRes = await pool.query(
//       `
//       SELECT m.id, m.title AS module_title, m.course_id
//       FROM modules m
//       LEFT JOIN unlocked_modules um ON um.module_id = m.id AND um.student_id = $1
//       ORDER BY m.id;
//       `,
//       [id]
//     );

//     // ✅ Lessons per module
//     const lessonsRes = await pool.query(
//       `
//       SELECT l.id, l.title AS lesson_title, l.module_id, ulp.completed_at
//       FROM lessons l
//       LEFT JOIN user_lesson_progress ulp
//         ON ulp.lesson_id = l.id AND ulp.user_id = $1
//       ORDER BY l.order_number;
//       `,
//       [id]
//     );

//     // ✅ Quizzes
//     const quizzesRes = await pool.query(
//       `
//       SELECT q.id, q.title, l.module_id, qs.score, qs.created_at AS taken_at, l.title AS lesson_title
//       FROM quiz_submissions qs
//       JOIN quizzes q ON qs.quiz_id = q.id
//       JOIN lessons l ON q.lesson_id = l.id
//       WHERE qs.student_id = $1
//       ORDER BY qs.created_at DESC;
//       `,
//       [id]
//     );

//     // ✅ Assignments
//     const assignmentsRes = await pool.query(
//       `
//       SELECT ma.id, ma.title, ma.module_id, s.total, s.grade, s.ai_feedback, s.created_at AS submitted_at
//       FROM assignment_submissions s
//       JOIN module_assignments ma ON s.assignment_id = ma.id
//       WHERE s.student_id = $1
//       ORDER BY s.created_at DESC;
//       `,
//       [id]
//     );

//     // --- Build Nested Structure ---
//     const courses = coursesRes.rows.map((course) => {
//       const courseModules = modulesRes.rows.filter(
//         (m) => m.course_id === course.id
//       );

//       const modules = courseModules.map((module) => {
//         const moduleLessons = lessonsRes.rows.filter(
//           (l) => l.module_id === module.id
//         );

//         // Progress calculation
//         const totalLessons = moduleLessons.length;
//         const completedLessons = moduleLessons.filter(
//           (l) => l.completed_at
//         ).length;
//         const modulePercent = totalLessons
//           ? Math.round((completedLessons / totalLessons) * 100)
//           : 0;

//         // Quizzes & Assignments under this module
//         const moduleQuizzes = quizzesRes.rows.filter(
//           (q) => q.module_id === module.id
//         );
//         const moduleAssignments = assignmentsRes.rows.filter(
//           (a) => a.module_id === module.id
//         );

//         const quizAvg = moduleQuizzes.length
//           ? Math.round(
//               moduleQuizzes.reduce((a, q) => a + q.score, 0) /
//                 moduleQuizzes.length
//             )
//           : null;

//         const assignmentAvg = moduleAssignments.length
//           ? Math.round(
//               moduleAssignments.reduce((a, x) => a + (x.total || 0), 0) /
//                 moduleAssignments.length
//             )
//           : null;

//         return {
//           ...module,
//           lessons: moduleLessons,
//           totalLessons,
//           completedLessons,
//           percent: modulePercent,
//           quizAvg,
//           assignmentAvg,
//           assignments: moduleAssignments,
//           role: "admin", // ✅ important
//         };
//       });

//       // Course progress (aggregate of module lessons)
//       const totalLessons = modules.reduce((sum, m) => sum + m.totalLessons, 0);
//       const completedLessons = modules.reduce(
//         (sum, m) => sum + m.completedLessons,
//         0
//       );
//       const coursePercent = totalLessons
//         ? Math.round((completedLessons / totalLessons) * 100)
//         : 0;

//       return {
//         ...course,
//         modules,
//         totalLessons,
//         completedLessons,
//         percent: coursePercent,
//       };
//     });

//     // --- Compute overall averages ---
//     const allQuizzes = quizzesRes.rows;
//     const allAssignments = assignmentsRes.rows;

//     const quizAvg =
//       allQuizzes.length > 0
//         ? Math.round(
//             allQuizzes.reduce((a, q) => a + q.score, 0) / allQuizzes.length
//           )
//         : null;

//     const assignmentAvg =
//       allAssignments.length > 0
//         ? Math.round(
//             allAssignments.reduce((a, x) => a + (x.total || 0), 0) /
//               allAssignments.length
//           )
//         : null;

//     // ✅ Pass everything to EJS
//     res.render("admin/studentProgress", {
//       student,
//       courses,
//       quizzes: allQuizzes,
//       assignments: allAssignments,
//       quizAvg,
//       assignmentAvg,
//       info,
//       from,
//     });
//   } catch (err) {
//     console.error("View student progress error:", err.message);
//     res.status(500).send("Failed to fetch progress");
//   }
// };

exports.viewStudentProgress = async (req, res) => {
  try {
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0];
    const { id } = req.params;

    // detect where user came from (default admin)
    const from =
      req.query.from ||
      (req.get("referer")?.includes("/parent") ? "parent" : "admin");

    // ✅ Get student info
    const studentRes = await pool.query(
      `SELECT id, fullname, email, created_at 
       FROM users2 WHERE id = $1`,
      [id]
    );
    if (!studentRes.rows.length)
      return res.status(404).send("Student not found");
    const student = studentRes.rows[0];

    // ✅ Courses (includes both direct enrollment and classroom-assigned)
    const coursesRes = await pool.query(
      `
  SELECT DISTINCT
    c.id,
    c.title AS course_title,
    COALESCE(e.enrolled_at, cc.assigned_at) AS enrolled_at
  FROM courses c
  LEFT JOIN course_enrollments e 
    ON e.course_id = c.id AND e.user_id = $1
  LEFT JOIN classroom_courses cc 
    ON cc.course_id = c.id
  LEFT JOIN user_school us 
    ON us.classroom_id = cc.classroom_id AND us.user_id = $1
  WHERE e.user_id IS NOT NULL OR us.user_id IS NOT NULL
  ORDER BY c.title;
  `,
      [id]
    );

    // ✅ Modules per course
    const modulesRes = await pool.query(
      `
      SELECT m.id, m.title AS module_title, m.course_id
      FROM modules m
      LEFT JOIN unlocked_modules um ON um.module_id = m.id AND um.student_id = $1
      ORDER BY m.id;
      `,
      [id]
    );

    // ✅ Lessons per module
    const lessonsRes = await pool.query(
      `
      SELECT l.id, l.title AS lesson_title, l.module_id, ulp.completed_at
      FROM lessons l
      LEFT JOIN user_lesson_progress ulp 
        ON ulp.lesson_id = l.id AND ulp.user_id = $1
      ORDER BY l.order_number;
      `,
      [id]
    );

    // ✅ Quizzes
    const quizzesRes = await pool.query(
      `
      SELECT q.id, q.title, l.module_id, qs.score, qs.created_at AS taken_at, l.title AS lesson_title
      FROM quiz_submissions qs
      JOIN quizzes q ON qs.quiz_id = q.id
      JOIN lessons l ON q.lesson_id = l.id
      WHERE qs.student_id = $1
      ORDER BY qs.created_at DESC;
      `,
      [id]
    );

    // ✅ Assignments
    const assignmentsRes = await pool.query(
      `
      SELECT ma.id, ma.title, ma.module_id, s.total, s.grade, s.ai_feedback, s.created_at AS submitted_at
      FROM assignment_submissions s
      JOIN module_assignments ma ON s.assignment_id = ma.id
      WHERE s.student_id = $1
      ORDER BY s.created_at DESC;
      `,
      [id]
    );

    // --- Build Nested Structure ---
    const courses = coursesRes.rows.map((course) => {
      const courseModules = modulesRes.rows.filter(
        (m) => m.course_id === course.id
      );

      const modules = courseModules.map((module) => {
        const moduleLessons = lessonsRes.rows.filter(
          (l) => l.module_id === module.id
        );

        // Progress calculation
        const totalLessons = moduleLessons.length;
        const completedLessons = moduleLessons.filter(
          (l) => l.completed_at
        ).length;
        const modulePercent = totalLessons
          ? Math.round((completedLessons / totalLessons) * 100)
          : 0;

        // Quizzes & Assignments under this module
        const moduleQuizzes = quizzesRes.rows.filter(
          (q) => q.module_id === module.id
        );
        const moduleAssignments = assignmentsRes.rows.filter(
          (a) => a.module_id === module.id
        );

        const quizAvg = moduleQuizzes.length
          ? Math.round(
              moduleQuizzes.reduce((a, q) => a + q.score, 0) /
                moduleQuizzes.length
            )
          : null;

        const assignmentAvg = moduleAssignments.length
          ? Math.round(
              moduleAssignments.reduce((a, x) => a + (x.total || 0), 0) /
                moduleAssignments.length
            )
          : null;

        return {
          ...module,
          lessons: moduleLessons,
          totalLessons,
          completedLessons,
          percent: modulePercent,
          quizAvg,
          assignmentAvg,
          assignments: moduleAssignments,
          role: "admin", // ✅ important
        };
      });

      // Course progress (aggregate of module lessons)
      const totalLessons = modules.reduce((sum, m) => sum + m.totalLessons, 0);
      const completedLessons = modules.reduce(
        (sum, m) => sum + m.completedLessons,
        0
      );
      const coursePercent = totalLessons
        ? Math.round((completedLessons / totalLessons) * 100)
        : 0;

      return {
        ...course,
        modules,
        totalLessons,
        completedLessons,
        percent: coursePercent,
      };
    });

    // --- Compute overall averages ---
    const allQuizzes = quizzesRes.rows;
    const allAssignments = assignmentsRes.rows;

    const quizAvg =
      allQuizzes.length > 0
        ? Math.round(
            allQuizzes.reduce((a, q) => a + q.score, 0) / allQuizzes.length
          )
        : null;

    const assignmentAvg =
      allAssignments.length > 0
        ? Math.round(
            allAssignments.reduce((a, x) => a + (x.total || 0), 0) /
              allAssignments.length
          )
        : null;

    // ✅ Pass everything to EJS
    res.render("admin/studentProgress", {
      student,
      courses,
      quizzes: allQuizzes,
      assignments: allAssignments,
      quizAvg,
      assignmentAvg,
      info,
      from,
    });
  } catch (err) {
    console.error("View student progress error:", err.message);
    res.status(500).send("Failed to fetch progress");
  }
};

exports.viewStudentEnrollments = async (req, res) => {
  try {
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0];
    const { id } = req.params;
    const courses = await pool.query(
      `SELECT c.title, e.enrolled_at
       FROM course_enrollments e
       JOIN courses c ON e.course_id = c.id
       WHERE e.user_id = $1
       ORDER BY e.enrolled_at DESC`,
      [id]
    );

    res.render("admin/studentEnrollments", {
      courses: courses.rows,
      info,
      role: "admin",
    });
  } catch (err) {
    console.error("View student enrollments error:", err.message);
    res.status(500).send("Failed to fetch enrollments");
  }
};

exports.assignChildToParent = async (req, res) => {
  const { parentEmail, childEmail } = req.body;

  try {
    // Verify parent exists
    const parentRes = await pool.query(
      "SELECT email FROM users2 WHERE id = $1 AND role = 'parent'",
      [parentEmail]
    );
    if (parentRes.rows.length === 0) {
      return res.status(404).send("Parent not found");
    }

    // Verify child exists
    const childRes = await pool.query(
      "SELECT id FROM users2 WHERE email = $1 AND role = 'user'",
      [childEmail]
    );
    if (childRes.rows.length === 0) {
      return res.status(404).send("Child not found");
    }

    const child = childRes.rows[0];
    const parentId = parentRes.rows[0].id;

    // Create link
    await pool.query(
      `INSERT INTO parent_children (parent_id, child_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [parentId, child.id]
    );

    res.redirect(`/admin/parents/${parentId}/children`);
  } catch (err) {
    console.error("Error assigning child:", err);
    res.status(500).send("Failed to assign child");
  }
};

// Remove child from parent (admin override)
// exports.removeChildFromParent = async (req, res) => {
//   try {
//     const { parentId, childId } = req.body;

//     const link = await pool.query(
//       `SELECT * FROM parent_children WHERE parent_id = $1 AND child_id = $2`,
//       [parentId, childId]
//     );

//     if (link.rowCount === 0) {
//       return res.status(400).send("❌ No such parent-child link exists");
//     }

//     await pool.query(
//       `DELETE FROM parent_children WHERE parent_id = $1 AND child_id = $2`,
//       [parentId, childId]
//     );

//     res.redirect("/admin/students");
//   } catch (err) {
//     console.error("Admin remove child error:", err.message);
//     res.status(500).send("Server error removing child");
//   }
// };

exports.downloadCourseSummary = async (req, res) => {
  const { studentId, courseId } = req.params;

  try {
    // --- Student info
    const studentRes = await pool.query(
      `SELECT fullname, email FROM users2 WHERE id = $1`,
      [studentId]
    );
    const student = studentRes.rows[0];

    // --- Course info
    const courseRes = await pool.query(
      `SELECT id, title FROM courses WHERE id = $1`,
      [courseId]
    );
    const course = courseRes.rows[0];

    // --- Modules
    const modulesRes = await pool.query(
      `SELECT id, title FROM modules WHERE course_id = $1`,
      [courseId]
    );
    const modules = modulesRes.rows;

    // --- Lessons
    const lessonsRes = await pool.query(
      `SELECT l.id, l.title, l.module_id, ulp.completed_at
       FROM lessons l
       JOIN modules m ON l.module_id = m.id
       LEFT JOIN user_lesson_progress ulp 
         ON ulp.lesson_id = l.id AND ulp.user_id = $1
       WHERE m.course_id = $2
       ORDER BY l.id`,
      [studentId, courseId]
    );
    const lessons = lessonsRes.rows;

    // --- Quizzes
    const quizzesRes = await pool.query(
      `SELECT q.id, q.title, l.module_id, qs.score, qs.created_at AS taken_at
       FROM quizzes q
       LEFT JOIN quiz_submissions qs 
         ON qs.quiz_id = q.id AND qs.student_id = $1
       JOIN lessons l ON q.lesson_id = l.id
       JOIN modules m ON l.module_id = m.id
       WHERE m.course_id = $2
       ORDER BY q.id`,
      [studentId, courseId]
    );
    const quizzes = quizzesRes.rows;

    // --- Assignments
    const assignmentsRes = await pool.query(
      `SELECT ma.id, ma.title, ma.module_id, s.total, s.grade, s.ai_feedback, s.created_at AS submitted_at
       FROM module_assignments ma
       JOIN modules m ON ma.module_id = m.id
       LEFT JOIN assignment_submissions s 
         ON s.assignment_id = ma.id AND s.student_id = $1
       WHERE m.course_id = $2
       ORDER BY ma.id`,
      [studentId, courseId]
    );
    const assignments = assignmentsRes.rows;

    // --- Summary stats
    const totalLessons = lessons.length;
    const completedLessons = lessons.filter((l) => l.completed_at).length;
    const lessonPercent = totalLessons
      ? Math.round((completedLessons / totalLessons) * 100)
      : 0;

    const quizAvg =
      quizzes.length > 0
        ? Math.round(
            quizzes.reduce((a, q) => a + (q.score || 0), 0) / quizzes.length
          )
        : "N/A";

    const assignmentAvg =
      assignments.length > 0
        ? Math.round(
            assignments.reduce((a, x) => a + (x.total || 0), 0) /
              assignments.length
          )
        : "N/A";

    // --- Build HTML template
    const html = `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; padding: 30px; color: #2c3e50; }
            h1 { text-align: center; color: #34495e; }
            h2 { margin-top: 30px; color: #2980b9; border-bottom: 2px solid #ddd; padding-bottom: 5px; }
            h3 { margin-top: 20px; color: #8e44ad; }
            .summary { margin: 20px 0; padding: 10px; background: #ecf0f1; border-radius: 8px; }
            table { width: 100%; border-collapse: collapse; margin: 15px 0; }
            th, td { border: 1px solid #ddd; padding: 8px; font-size: 12px; }
            th { background: #2c3e50; color: white; text-align: left; }
            tr:nth-child(even) { background: #f9f9f9; }
            .footer { margin-top: 30px; font-size: 10px; text-align: center; color: gray; }
          </style>
        </head>
        <body>
          <h1>📊 Student Progress Report</h1>
          <p style="text-align:center; color: gray;">Generated on: ${new Date().toLocaleString()}</p>

          <h2>👤 Student Info</h2>
          <p><strong>Name:</strong> ${student.fullname}</p>
          <p><strong>Email:</strong> ${student.email}</p>
          <p><strong>Course:</strong> ${course.title}</p>

          <div class="summary">
            <h2>📌 Summary Statistics</h2>
            <ul>
              <li>Total Lessons: ${totalLessons}</li>
              <li>Completed Lessons: ${completedLessons}</li>
              <li>Progress: ${lessonPercent}%</li>
              <li>Quiz Average: ${quizAvg}</li>
              <li>Assignment Average: ${assignmentAvg}</li>
            </ul>
          </div>

          ${modules
            .map(
              (m) => `
            <h2>📦 Module: ${m.title}</h2>
            
            <h3>📚 Lessons</h3>
            <table>
              <tr><th>Lesson</th><th>Status</th></tr>
              ${lessons
                .filter((l) => l.module_id === m.id)
                .map(
                  (l) => `
                <tr>
                  <td>${l.title}</td>
                  <td>${
                    l.completed_at ? "✅ Completed" : "❌ Not completed"
                  }</td>
                </tr>`
                )
                .join("")}
            </table>

            <h3>📝 Quizzes</h3>
            <table>
              <tr><th>Quiz</th><th>Score</th><th>Date</th></tr>
              ${quizzes
                .filter((q) => q.module_id === m.id)
                .map(
                  (q) => `
                <tr>
                  <td>${q.title}</td>
                  <td>${q.score ?? "N/A"}</td>
                  <td>${
                    q.taken_at
                      ? new Date(q.taken_at).toLocaleDateString()
                      : "Not taken"
                  }</td>
                </tr>`
                )
                .join("")}
            </table>

            <h3>📑 Assignments</h3>
            <table>
              <tr><th>Assignment</th><th>Score</th><th>Grade</th><th>Feedback</th><th>Submitted</th></tr>
              ${assignments
                .filter((a) => a.module_id === m.id)
                .map(
                  (a) => `
                <tr>
                  <td>${a.title}</td>
                  <td>${a.total ?? "Pending"}</td>
                  <td>${a.grade ?? "-"}</td>
                  <td>${a.ai_feedback ?? "No feedback"}</td>
                  <td>${
                    a.submitted_at
                      ? new Date(a.submitted_at).toLocaleDateString()
                      : "Not submitted"
                  }</td>
                </tr>`
                )
                .join("")}
            </table>
          `
            )
            .join("")}

          <div class="footer">© ${new Date().getFullYear()} Student Progress Report</div>
        </body>
      </html>
    `;

    // --- Generate PDF with Puppeteer
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({ format: "A4", printBackground: true });
    await browser.close();

    // --- Send PDF response
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${course.title.replace(/\s+/g, "_")}_report.pdf`
    );
    res.setHeader("Content-Type", "application/pdf");
    res.send(pdfBuffer);
  } catch (err) {
    console.error("PDF Error:", err);
    res.status(500).send("Error generating summary PDF");
  }
};

exports.getSchools = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        s.id,
        s.name,
        s.email,
        s.phone,
        s.address,
        s.logo_url,
        s.created_at,
        COUNT(DISTINCT CASE WHEN us.role_in_school = 'student' THEN u.id END) AS student_count,
        COUNT(DISTINCT CASE WHEN us.role_in_school = 'teacher' THEN u.id END) AS teacher_count,
        COUNT(DISTINCT c.id) AS classroom_count
      FROM schools s
      LEFT JOIN user_school us ON s.id = us.school_id
      LEFT JOIN users2 u ON us.user_id = u.id   -- ✅ ensure actual users exist
      LEFT JOIN classrooms c ON c.school_id = s.id
      GROUP BY s.id
      ORDER BY s.created_at DESC
    `);

    res.render("admin/schools", {
      info: req.companyInfo || {},
      schools: result.rows,
      currentPage: "schools",
      role: "admin", // ✅ important
    });
  } catch (err) {
    console.error("Error fetching schools:", err);
    res.status(500).send("Error loading schools");
  }
};

exports.updateSchoolInfo = async (req, res) => {
  try {
    const { id, email, phone, address } = req.body;
    let logo_url = null;

    // ✅ Upload new logo to Cloudinary if provided
    if (req.file) {
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: "school_logos",
      });
      logo_url = result.secure_url;

      // delete local file after upload
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }

    // ✅ Build dynamic SQL update
    const fields = [];
    const values = [];
    let index = 1;

    if (email) {
      fields.push(`email = $${index++}`);
      values.push(email);
    }
    if (phone) {
      fields.push(`phone = $${index++}`);
      values.push(phone);
    }
    if (address) {
      fields.push(`address = $${index++}`);
      values.push(address);
    }
    if (logo_url) {
      fields.push(`logo_url = $${index++}`);
      values.push(logo_url);
    }

    if (fields.length === 0)
      return res.json({ ok: false, error: "No information to update." });

    values.push(id);

    await pool.query(
      `UPDATE schools SET ${fields.join(", ")} WHERE id = $${index}`,
      values
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Error updating school info:", err);
    res.json({ ok: false, error: "Failed to update school info." });
  }
};


// 📌 GET: Single School Details
exports.getSchoolDetails = async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch school
    const schoolResult = await pool.query(
      "SELECT * FROM schools WHERE id = $1",
      [id]
    );
    const school = schoolResult.rows[0];
    if (!school) return res.status(404).send("School not found");

    // Fetch students
    const studentsResult = await pool.query(
      `
      SELECT u.id, u.fullname AS full_name, u.email, u.phone, u.dob, u.gender,
             u.role, u.wallet_balance, u.created_at,
             c.name AS classroom_name
      FROM user_school us
      JOIN users2 u ON us.user_id = u.id
      LEFT JOIN classrooms c ON us.classroom_id = c.id
      WHERE us.school_id = $1 AND us.role_in_school = 'student'
      `,
      [id]
    );

    // fetch courses offered by the school
    const schoolCoursesResult = await pool.query(
      `
      SELECT c.id, c.title, c.level
      FROM school_courses sc
      JOIN courses c ON sc.course_id = c.id
      WHERE sc.school_id = $1
      ORDER BY c.title ASC
      `,
      [id]
    );

    school.courses = schoolCoursesResult.rows; // attach school courses

    // Fetch teachers
    const teachersResult = await pool.query(
      `
      SELECT u.id, u.fullname AS full_name, u.email, u.phone, u.dob, u.gender,
             u.role, u.wallet_balance, u.created_at,
             c.name AS classroom_name
      FROM user_school us
      JOIN users2 u ON us.user_id = u.id
      LEFT JOIN classrooms c ON us.classroom_id = c.id
      WHERE us.school_id = $1 AND us.role_in_school = 'teacher'
      `,
      [id]
    );

    // Fetch instructors (restricted to this school’s classrooms)
    const instructorsResult = await pool.query(
      `
      SELECT 
        u.id,
        u.fullname AS full_name,
        u.email,
        COALESCE(
          string_agg(DISTINCT c.name, ', ' ORDER BY c.name), 
          'Not yet assigned'
        ) AS classrooms
      FROM users2 u
      LEFT JOIN classroom_instructors ci 
        ON ci.instructor_id = u.id
      LEFT JOIN classrooms c 
        ON ci.classroom_id = c.id AND c.school_id = $1   -- ✅ only restrict classrooms, not instructors
      WHERE u.role = 'instructor'
      GROUP BY u.id, u.fullname, u.email
      ORDER BY u.fullname;

      `,
      [id]
    );

    // Fetch classrooms + counts
    const classroomsResult = await pool.query(
      `
  SELECT 
    c.id,
    c.name,
    COUNT(DISTINCT CASE WHEN us.role_in_school = 'student' THEN u.id END) AS student_count,
    COUNT(DISTINCT CASE WHEN us.role_in_school = 'teacher' THEN u.id END) AS teacher_count,
    COUNT(DISTINCT ci.instructor_id) AS instructor_count
  FROM classrooms c
  LEFT JOIN user_school us ON c.id = us.classroom_id
  LEFT JOIN users2 u ON us.user_id = u.id
  LEFT JOIN classroom_instructors ci ON ci.classroom_id = c.id
  WHERE c.school_id = $1
  GROUP BY c.id, c.name
  ORDER BY c.created_at DESC
  `,
      [id]
    );

    // Fetch quotes
    const quotesResult = await pool.query(
      `SELECT * FROM quotes WHERE school_id = $1 ORDER BY created_at DESC`,
      [id]
    );

    const totalsResult = await pool.query(
      `
  SELECT
    COUNT(DISTINCT CASE WHEN us.role_in_school = 'student' THEN u.id END) AS total_students,
    COUNT(DISTINCT CASE WHEN us.role_in_school = 'teacher' THEN u.id END) AS total_teachers,
    (
      SELECT COUNT(*) 
      FROM users2 u2
      WHERE u2.role = 'instructor'
    ) AS total_instructors
  FROM user_school us
  JOIN users2 u ON us.user_id = u.id
  WHERE us.school_id = $1
  `,
      [id]
    );

    // Attach
    school.students = studentsResult.rows;
    school.teachers = teachersResult.rows;
    school.instructors = instructorsResult.rows;
    school.classrooms = classroomsResult.rows;
    school.totals = totalsResult.rows[0];

    res.render("admin/school-details", {
      info: req.companyInfo || {},
      school,
      quotes: quotesResult.rows,
      currentPage: "schools",
      role: "admin",
    });
  } catch (err) {
    console.error("Error fetching school details:", err);
    res.status(500).send("Error loading school details");
  }
};

exports.downloadSchoolProgressReport = async (req, res) => {
  const { schoolId } = req.params;

  try {
    // --- 1. Get school info
    const schoolRes = await pool.query(
      `SELECT id, name, address, email, phone, created_at 
       FROM schools WHERE id = $1`,
      [schoolId]
    );
    const school = schoolRes.rows[0];
    if (!school) return res.status(404).send("School not found");

    // --- 2. Get classrooms
    const classRes = await pool.query(
      `SELECT id, name FROM classrooms WHERE school_id = $1 ORDER BY name`,
      [schoolId]
    );
    const classrooms = classRes.rows;

    // --- 3. Get students
    const studentRes = await pool.query(
      `SELECT 
          u.id, 
          u.fullname AS full_name, 
          u.email, 
          c.name AS classroom_name
       FROM user_school us
       JOIN users2 u ON us.user_id = u.id
       LEFT JOIN classrooms c ON us.classroom_id = c.id
       WHERE us.role_in_school = 'student' 
         AND us.school_id = $1
       ORDER BY c.name, u.fullname`,
      [schoolId]
    );
    const students = studentRes.rows;

    // --- 4. Get teachers
    const teacherRes = await pool.query(
      `SELECT 
          u.id, 
          u.fullname AS full_name, 
          u.email
       FROM user_school us
       JOIN users2 u ON us.user_id = u.id
       WHERE us.role_in_school = 'teacher'
         AND us.school_id = $1
       ORDER BY u.fullname`,
      [schoolId]
    );
    const teachers = teacherRes.rows;

    // --- 5. Get progress data
const progressRes = await pool.query(`
  SELECT 
    us.user_id,
    COUNT(DISTINCT l.id) AS total_lessons,
    COUNT(DISTINCT ulp.lesson_id) AS completed_lessons
  FROM user_school us
  LEFT JOIN classrooms cls ON us.classroom_id = cls.id
  LEFT JOIN classroom_courses cc ON cc.classroom_id = cls.id
  LEFT JOIN courses c ON c.id = cc.course_id
  LEFT JOIN modules m ON m.course_id = c.id
  LEFT JOIN lessons l ON l.module_id = m.id
  LEFT JOIN user_lesson_progress ulp
    ON ulp.user_id = us.user_id 
    AND ulp.lesson_id = l.id 
    AND ulp.completed_at IS NOT NULL
  WHERE us.role_in_school = 'student'
  GROUP BY us.user_id
`);



    const progressMap = Object.fromEntries(
      progressRes.rows.map((p) => [p.user_id, p])
    );

    const quizRes = await pool.query(
      `SELECT student_id, AVG(score) AS avg_quiz
       FROM quiz_submissions
       GROUP BY student_id`
    );
    const quizMap = Object.fromEntries(
      quizRes.rows.map((q) => [q.student_id, Math.round(q.avg_quiz)])
    );

    const assignmentRes = await pool.query(
      `SELECT student_id, AVG(total) AS avg_assignment
       FROM assignment_submissions
       GROUP BY student_id`
    );
    const assignmentMap = Object.fromEntries(
      assignmentRes.rows.map((a) => [
        a.student_id,
        Math.round(a.avg_assignment),
      ])
    );

    // --- 6. Build School Summary
    const summaryHTML = `
      <div class="summary">
        <h2>🏫 School Summary</h2>
        <table>
          <tr><th>School Name</th><td>${school.name}</td></tr>
          <tr><th>Email</th><td>${school.email || "N/A"}</td></tr>
          <tr><th>Phone</th><td>${school.phone || "N/A"}</td></tr>
          <tr><th>Address</th><td>${school.address || "N/A"}</td></tr>
          <tr><th>Total Classrooms</th><td>${classrooms.length}</td></tr>
          <tr><th>Total Teachers</th><td>${teachers.length}</td></tr>
          <tr><th>Total Students</th><td>${students.length}</td></tr>
          <tr><th>Date Created</th><td>${new Date(
            school.created_at
          ).toLocaleDateString()}</td></tr>
        </table>
      </div>
    `;

    // --- 7. Teacher List
    const teachersHTML = `
      <div class="teachers">
        <h2>👨‍🏫 Teachers</h2>
        ${
          teachers.length
            ? `
          <table>
            <thead><tr><th>Name</th><th>Email</th></tr></thead>
            <tbody>
              ${teachers
                .map(
                  (t) => `<tr><td>${t.full_name}</td><td>${t.email}</td></tr>`
                )
                .join("")}
            </tbody>
          </table>`
            : "<p><em>No teachers registered.</em></p>"
        }
      </div>
    `;

    // --- 8. Class & Student Progress Section
    const classesHTML = classrooms
      .map((cls) => {
        const classStudents = students.filter(
          (s) => s.classroom_name === cls.name
        );

        if (classStudents.length === 0)
          return `<div class="class-block"><h2>${cls.name}</h2><p><em>No students enrolled.</em></p></div>`;

        return `
          <div class="class-block">
            <h2>📘 ${cls.name}</h2>
            <table>
              <thead>
                <tr>
                  <th>Student Name</th>
                  <th>Email</th>
                  <th>Lessons Completed</th>
                  <th>Quiz Avg</th>
                  <th>Assignment Avg</th>
                  <th>Progress %</th>
                </tr>
              </thead>
              <tbody>
                ${classStudents
                  .map((stu) => {
                    const prog = progressMap[stu.id] || {
                      total_lessons: 0,
                      completed_lessons: 0,
                    };
                    const percent =
                      prog.total_lessons > 0
                        ? Math.round(
                            (prog.completed_lessons / prog.total_lessons) * 100
                          )
                        : 0;
                    return `
                      <tr>
                        <td>${stu.full_name}</td>
                        <td>${stu.email}</td>
                        <td>${prog.completed_lessons}/${prog.total_lessons}</td>
                        <td>${quizMap[stu.id] ?? "N/A"}</td>
                        <td>${assignmentMap[stu.id] ?? "N/A"}</td>
                        <td>${percent}%</td>
                      </tr>`;
                  })
                  .join("")}
              </tbody>
            </table>
          </div>
        `;
      })
      .join("");

    // --- 9. Combine all HTML
    const html = `
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; color: #2c3e50; }
          h1, h2 { color: #2c3e50; }
          h1 { text-align: center; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          th, td { border: 1px solid #ccc; padding: 6px; font-size: 12px; }
          th { background-color: #34495e; color: white; }
          tr:nth-child(even) { background-color: #f9f9f9; }
          .class-block, .teachers, .summary { margin-top: 30px; }
          .footer { margin-top: 30px; text-align: center; font-size: 10px; color: gray; }
        </style>
      </head>
      <body>
        <h1>${school.name} — School Progress Report</h1>
        <p style="text-align:center; color:gray;">Generated on ${new Date().toLocaleString()}</p>
        ${summaryHTML}
        ${teachersHTML}
        ${classesHTML}
        <div class="footer">© ${new Date().getFullYear()} School Progress Report</div>
      </body>
      </html>
    `;

    // --- 10. Puppeteer PDF generation
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "1cm", bottom: "1cm", left: "1cm", right: "1cm" },
    });
    await browser.close();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${school.name.replace(
        /\s+/g,
        "_"
      )}_Summary_Report.pdf`
    );
    res.send(pdfBuffer);
  } catch (err) {
    console.error("Error generating report:", err);
    res.status(500).send("Error generating report PDF");
  }
};

// 📄 Download Student Login Cards (PDF with Logo)
exports.downloadStudentLoginCards = async (req, res) => {
  const { schoolId } = req.params;
  try {
    // 1️⃣ Fetch school info
    const schoolRes = await pool.query(
      `SELECT id, name, logo_url, email FROM schools WHERE id = $1`,
      [schoolId]
    );
    const school = schoolRes.rows[0];
    if (!school) return res.status(404).send("School not found");

    // 2️⃣ Fetch students
    const studentRes = await pool.query(
      `SELECT 
        u.fullname AS full_name, 
        u.email, 
        c.name AS classroom_name
      FROM user_school us
      JOIN users2 u ON us.user_id = u.id
      LEFT JOIN classrooms c ON us.classroom_id = c.id
      WHERE us.school_id = $1 AND us.role_in_school = 'student'
      ORDER BY c.name, u.fullname`,
      [schoolId]
    );
    const students = studentRes.rows;

    // 3️⃣ Build the HTML
    const html = `
      <html>
      <head>
        <style>
          body {
            font-family: 'Arial', sans-serif;
            padding: 30px;
            color: #2c3e50;
          }
          h1 {
            text-align: center;
            color: #2c3e50;
            margin-bottom: 25px;
          }
          .cards-container {
            display: flex;
            flex-wrap: wrap;
            gap: 18px;
            justify-content: center;
          }
          .card {
            border: 2px solid #c8b209ff;
            border-radius: 12px;
            padding: 14px;
            width: 260px;
            height: 200px;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            background: #f9f9f9;
            box-shadow: 0 3px 8px rgba(0,0,0,0.1);
            text-align: center;
            page-break-inside: avoid;
          }
          .card img {
            width: 50px;
            height: 50px;
            border-radius: 50%;
            object-fit: cover;
            margin-bottom: 6px;
          }
          .card h2 {
            font-size: 1.05em;
            color: #007bff;
            margin: 4px 0;
          }
          .card p {
            margin: 3px 0;
            font-size: 0.88em;
            color: #333;
          }
          .card .footer {
            font-size: 0.78em;
            color: #555;
            text-align: center;
            margin-top: 6px;
            border-top: 1px solid #ccc;
            padding-top: 4px;
          }
          .login-link {
            display: inline-block;
            margin-top: 3px;
            color: #007bff;
            font-weight: bold;
            text-decoration: none;
          }
          @media print {
            body { padding: 0; }
            .card { page-break-inside: avoid; }
          }
        </style>
      </head>
      <body>
        <h1>🎓 ${school.name} — Student Login Cards</h1>
        <div class="cards-container">
          ${students.map(s => `
            <div class="card">
              <div>
                ${
                  school.logo_url
                    ? `<img src="${school.logo_url}" alt="Logo" />`
                    : `<img src="https://via.placeholder.com/50x50.png?text=Logo" alt="Logo" />`
                }
                <h2>${s.full_name}</h2>
                <p><strong>Class:</strong> ${s.classroom_name || "—"}</p>
                <p><strong>Email:</strong> ${s.email}</p>
                <p><strong>Password:</strong> 12345678</p>
                <p><a class="login-link" href="https://acad.jkthub.com/admin/login">acad.jkthub.com/admin/login</a></p>
              </div>
              <div class="footer">
                <em>Keep this card safe ✨</em>
              </div>
            </div>
          `).join("")}
        </div>
      </body>
      </html>
    `;

    // 4️⃣ Generate PDF using Puppeteer
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "1cm", bottom: "1cm", left: "1cm", right: "1cm" },
    });
    await browser.close();

    // 5️⃣ Send file
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${school.name.replace(/\s+/g, "_")}_Login_Cards.pdf`
    );
    res.send(pdfBuffer);
  } catch (err) {
    console.error("Error generating login cards PDF:", err);
    res.status(500).send("Error generating student login cards PDF");
  }
};


exports.createClassroom = async (req, res) => {
  try {
    const { school_id, name, teacher_id } = req.body; // destructure first

    let schoolId;
    if (req.session.user.role === "admin") {
      schoolId = school_id; // from hidden input
    } else {
      schoolId = req.session.user.school_id; // from session
    }

    if (!schoolId || !name) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: school_id or name",
      });
    }

    // Insert classroom
    const result = await pool.query(
      `INSERT INTO classrooms (school_id, name) 
       VALUES ($1, $2) 
       RETURNING id, school_id`,
      [schoolId, name]
    );

    const classroomId = result.rows[0].id;

    // Assign teachers if provided
    let teacherCount = 0;
    if (teacher_id) {
      const teacherIds = Array.isArray(teacher_id) ? teacher_id : [teacher_id];
      teacherCount = teacherIds.length;

      for (const tid of teacherIds) {
        await pool.query(
          `INSERT INTO classroom_teachers (classroom_id, teacher_id)
           VALUES ($1, $2)
           ON CONFLICT (classroom_id, teacher_id) DO NOTHING`,
          [classroomId, tid]
        );
      }
    }

    // ✅ Return JSON
    return res.json({
      success: true,
      classroom: {
        id: classroomId,
        name,
        school_id: schoolId,
        teacher_count: teacherCount,
        student_count: 0,
        instructor_count: 0,
      },
    });
  } catch (err) {
    console.error("Error creating classroom:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while creating classroom",
    });
  }
};

// ✅ UPDATE CLASSROOM
exports.updateClassroom = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, teacher_ids } = req.body;

    if (!id || !name) {
      return res
        .status(400)
        .json({ success: false, message: "Missing classroom ID or name" });
    }

    // Update classroom name
    await pool.query(`UPDATE classrooms SET name = $1 WHERE id = $2`, [
      name,
      id,
    ]);

    // Reassign teachers if provided
    if (teacher_ids) {
      const teacherIds = Array.isArray(teacher_ids)
        ? teacher_ids
        : [teacher_ids];

      // Remove old assignments
      await pool.query(
        `DELETE FROM classroom_teachers WHERE classroom_id = $1`,
        [id]
      );

      // Add new ones
      for (const tid of teacherIds) {
        await pool.query(
          `INSERT INTO classroom_teachers (classroom_id, teacher_id) VALUES ($1, $2)`,
          [id, parseInt(tid)]
        );
      }
    }

    return res.json({
      success: true,
      message: "Classroom updated successfully",
    });
  } catch (err) {
    console.error("Error updating classroom:", err);
    return res
      .status(500)
      .json({
        success: false,
        message: "Server error while updating classroom",
      });
  }
};

// 🗑️ DELETE CLASSROOM
exports.deleteClassroom = async (req, res) => {
  try {
    const { id } = req.params;

    // Clear related records
    await pool.query(`DELETE FROM classroom_teachers WHERE classroom_id = $1`, [
      id,
    ]);
    await pool.query(
      `DELETE FROM classroom_instructors WHERE classroom_id = $1`,
      [id]
    );
    // await pool.query(`DELETE FROM classroom_students WHERE classroom_id = $1`, [id]);

    // Delete classroom
    await pool.query(`DELETE FROM classrooms WHERE id = $1`, [id]);

    return res.json({
      success: true,
      message: "Classroom deleted successfully",
    });
  } catch (err) {
    console.error("Error deleting classroom:", err);
    return res
      .status(500)
      .json({
        success: false,
        message: "Server error while deleting classroom",
      });
  }
};

// 📌 GET: Students in a classroom (AJAX)
exports.getClassroomStudents = async (req, res) => {
  try {
    const { id } = req.params; // classroom_id

    const studentsResult = await pool.query(
      `SELECT u.id, u.fullname, u.email, u.phone, u.gender, u.dob, u.created_at
       FROM user_school us
       JOIN users2 u ON us.user_id = u.id
       WHERE us.classroom_id = $1 AND us.role_in_school = 'student'
       ORDER BY u.fullname ASC`,
      [id]
    );

    res.json(studentsResult.rows);
  } catch (err) {
    console.error("Error fetching classroom students:", err);
    res.status(500).json({ error: "Error loading classroom students" });
  }
};

exports.assignCoursesToClassroom = async (req, res) => {
  try {
    const { id } = req.params; // classroom_id
    const { course_ids } = req.body; // array of selected course IDs

    if (!course_ids || course_ids.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No courses selected" });
    }

    // Clear old assignments
    await pool.query("DELETE FROM classroom_courses WHERE classroom_id = $1", [
      id,
    ]);

    // Insert new ones
    const values = course_ids.map((cid) => `(${id}, ${cid})`).join(",");
    await pool.query(
      `INSERT INTO classroom_courses (classroom_id, course_id) VALUES ${values}`
    );

    res.json({
      success: true,
      message: "Courses assigned to classroom successfully",
    });
  } catch (err) {
    console.error("Error assigning courses to classroom:", err);
    res.status(500).json({
      success: false,
      message: "Server error while assigning courses",
    });
  }
};

exports.getClassroomCourses = async (req, res) => {
  try {
    const { id } = req.params; // classroom_id

    const result = await pool.query(
      `
      SELECT c.id, c.title, c.level
      FROM classroom_courses cc
      JOIN courses c ON cc.course_id = c.id
      WHERE cc.classroom_id = $1
      ORDER BY c.title ASC
      `,
      [id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching classroom courses:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// 📌 GET: Quotes
exports.getQuotes = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT q.*, s.name AS school_name 
       FROM quotes q 
       JOIN schools s ON q.school_id = s.id`
    );
    const quotes = result.rows;

    res.render("admin/quotes", {
      info: req.companyInfo || {},
      quotes,
      currentPage: "quotes",
      role: "admin", // ✅ important
    });
  } catch (err) {
    console.error("Error fetching quotes:", err);
    res.status(500).send("Error loading quotes");
  }
};

// 📌 GET: School Courses (assignments)
exports.getSchoolCourses = async (req, res) => {
  try {
    // Fetch all schools
    const schoolsResult = await pool.query(
      `SELECT * FROM schools ORDER BY name`
    );
    const schools = schoolsResult.rows;

    // Fetch all courses
    const coursesResult = await pool.query(
      `SELECT * FROM courses ORDER BY title`
    );
    const courses = coursesResult.rows;

    // Fetch currently assigned courses
    const assignmentsResult = await pool.query(`SELECT * FROM school_courses`);
    const schoolCoursesMap = {};
    assignmentsResult.rows.forEach((row) => {
      if (!schoolCoursesMap[row.school_id])
        schoolCoursesMap[row.school_id] = [];
      schoolCoursesMap[row.school_id].push(row.course_id);
    });

    res.render("admin/schoolCourses", {
      info: req.companyInfo || {},
      schools,
      courses,
      schoolCoursesMap,
      currentPage: "school-courses",
      role: "admin", // ✅ important
    });
  } catch (err) {
    console.error("Error fetching school courses:", err);
    res.status(500).send("Error loading school courses");
  }
};

exports.approveQuote = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("UPDATE quotes SET status = 'approved' WHERE id = $1", [
      id,
    ]);
    await logActivityForUser(req, "Quote approved", `Quote ID: ${id}`);
    res.redirect("/admin/quotes");
  } catch (err) {
    console.error("Error approving quote:", err);
    res.status(500).send("Error approving quote");
  }
};

exports.rejectQuote = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("UPDATE quotes SET status = 'rejected' WHERE id = $1", [
      id,
    ]);
    res.redirect("/admin/quotes");
  } catch (err) {
    console.error("Error rejecting quote:", err);
    res.status(500).send("Error rejecting quote");
  }
};

// 📌 POST: Assign Courses to School
exports.assignSchoolCourses = async (req, res) => {
  try {
    const { school_id } = req.body;

    if (!school_id) return res.status(400).send("School ID is required");

    // Remove old assignments for this school
    await pool.query("DELETE FROM school_courses WHERE school_id = $1", [
      school_id,
    ]);

    // Get selected courses
    const courseIds = req.body[`school_${school_id}`] || [];

    if (courseIds.length > 0) {
      const insertValues = courseIds
        .map((id) => `(${school_id}, ${id})`)
        .join(",");
      await pool.query(
        `INSERT INTO school_courses (school_id, course_id) VALUES ${insertValues}`
      );
    }

    res.redirect("/admin/school-courses");
  } catch (err) {
    console.error("Error assigning courses:", err);
    res.status(500).send("Error assigning courses");
  }
};

exports.addUserToSchool = async (req, res) => {
  const { schoolId } = req.params;
  const { username, email, phone, gender, dob, role, password } = req.body;
  const file = req.file;

  try {
    // check school exists
    const schoolCheck = await pool.query(
      "SELECT * FROM schools WHERE id = $1",
      [schoolId]
    );
    if (schoolCheck.rowCount === 0) {
      return res.status(400).json({ message: "Invalid School ID" });
    }
    const school = schoolCheck.rows[0];

    // Handle profile picture
    const profile_picture = file ? file.path : "/profile.webp";
    const hashed = await bcrypt.hash(password || "12345678", 10); // default pw if missing
    const created_at = new Date();
    let finalEmail = email;

    // auto-generate email if student & none provided
    if (role === "student" && (!email || email.trim() === "")) {
      const fullNameClean = username.replace(/\s+/g, "");
      const schoolFirstWord = school.name.split(" ")[0].toLowerCase();
      finalEmail = `${fullNameClean.toLowerCase()}@${schoolFirstWord}school.com`;
    }

    // Insert into users2
    const newUser = await pool.query(
      `INSERT INTO users2 (fullname, email, phone, gender, password, profile_picture, role, created_at, dob) 
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        username,
        finalEmail,
        phone,
        gender,
        hashed,
        profile_picture,
        role,
        created_at,
        dob,
      ]
    );

    // Link to school
    await pool.query(
      `INSERT INTO user_school (user_id, school_id, role_in_school, approved) VALUES ($1,$2,$3,$4)`,
      [newUser.rows[0].id, school.id, role, true] // ✅ auto-approved since admin adds directly
    );

    return res
      .status(200)
      .json({ message: `${role} added successfully`, user: newUser.rows[0] });
  } catch (err) {
    console.error("❌ addUserToSchool error:", err.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

exports.updateUserInSchool = async (req, res) => {
  const { userId } = req.params;
  const { username, phone, gender, dob, password } = req.body;
  const file = req.file;

  try {
    const updates = [];
    const values = [];
    let idx = 1;

    if (username) {
      updates.push(`fullname = $${idx++}`);
      values.push(username);
    }
    if (phone) {
      updates.push(`phone = $${idx++}`);
      values.push(phone);
    }
    if (gender) {
      updates.push(`gender = $${idx++}`);
      values.push(gender);
    }
    if (dob) {
      updates.push(`dob = $${idx++}`);
      values.push(dob);
    }
    if (password) {
      const hashed = await bcrypt.hash(password, 10);
      updates.push(`password = $${idx++}`);
      values.push(hashed);
    }
    if (file) {
      updates.push(`profile_picture = $${idx++}`);
      values.push(file.path);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }

    values.push(userId);

    const result = await pool.query(
      `UPDATE users2 SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    return res
      .status(200)
      .json({ message: "User updated successfully", user: result.rows[0] });
  } catch (err) {
    console.error("❌ updateUserInSchool error:", err.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

exports.deleteUserFromSchool = async (req, res) => {
  const { userId } = req.params;

  try {
    // delete from user_school first
    await pool.query("DELETE FROM user_school WHERE user_id = $1", [userId]);
    // delete from users2
    const result = await pool.query(
      "DELETE FROM users2 WHERE id = $1 RETURNING *",
      [userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({ message: "User deleted successfully" });
  } catch (err) {
    console.error("❌ deleteUserFromSchool error:", err.message);
    res.status(500).json({ message: "Internal server error" });
  }
};

// exports.addStudentsToClassroom = async (req, res) => {
//   const classroomId = parseInt(req.params.id, 10);
//   console.log("DEBUG classroomId:", classroomId);
//   let { student_ids } = req.body;
//    console.log("DEBUG raw student_ids:", student_ids);
//   try {
//     if (!student_ids) {
//       return res
//         .status(400)
//         .json({ success: false, message: "No students selected." });
//     }

//     if (!Array.isArray(student_ids)) {
//       student_ids = [student_ids];
//     }

//     // Convert to integers properly
//     student_ids = student_ids
//       .map((id) => parseInt(id, 10))
//       .filter((id) => !isNaN(id));

//     if (student_ids.length === 0) {
//       return res
//         .status(400)
//         .json({ success: false, message: "No valid students selected." });
//     }

//     // ✅ Always fetch schoolId from classroom (not session)
//     const schoolResult = await pool.query(
//       `SELECT school_id FROM classrooms WHERE id = $1`,
//       [classroomId]
//     );
//     const schoolId = schoolResult.rows[0]?.school_id; // 👈 not whole row

//     console.log("DEBUG schoolId:", schoolId);

//     if (!schoolId) {
//       return res.status(404).json({
//         success: false,
//         message: "Classroom not found in any school.",
//       });
//     }

//     // ✅ Only query students AFTER validation
//     const studentResult = await pool.query(
//       `SELECT u.id, u.fullname, u.email
//        FROM users2 u
//        JOIN user_school us ON u.id = us.user_id
//        WHERE u.id = ANY($1::int[])
//          AND us.school_id = $2
//          AND us.role_in_school = 'student'`,
//       [student_ids, schoolId]
//     );

//     console.log("DEBUG student_ids:", student_ids);

//     console.log("DEBUG found students:", studentResult.rows);

//     if (studentResult.rows.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: "No valid students found in this school.",
//       });
//     }

//     // ✅ Assign students
//     await pool.query(
//       `UPDATE user_school
//        SET classroom_id = $1
//        WHERE user_id = ANY($2::int[])
//          AND school_id = $3
//          AND role_in_school = 'student'`,
//       [classroomId, student_ids, schoolId]
//     );

//     return res.json({
//       success: true,
//       message: "Students assigned successfully",
//       students: studentResult.rows,
//     });
//   } catch (err) {
//     console.error("Error assigning students to classroom:", err);
//     return res.status(500).json({
//       success: false,
//       message: "Server error while assigning students",
//     });
//   }
// };

exports.addStudentsToClassroom = async (req, res) => {
  const classroomId = parseInt(req.params.id, 10);
  let { student_ids } = req.body;

  if (!student_ids) {
    return res
      .status(400)
      .json({ success: false, message: "No students selected." });
  }

  if (!Array.isArray(student_ids)) {
    student_ids = [student_ids];
  }

  student_ids = student_ids
    .map((id) => parseInt(id, 10))
    .filter((id) => !isNaN(id));

  if (student_ids.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "No valid students selected." });
  }

  try {
    // get school id from classroom
    const schoolResult = await pool.query(
      `SELECT school_id FROM classrooms WHERE id = $1`,
      [classroomId]
    );
    const schoolId = schoolResult.rows[0]?.school_id;

    if (!schoolId) {
      return res
        .status(404)
        .json({ success: false, message: "Classroom not found" });
    }

    // verify students belong to this school
    const studentResult = await pool.query(
      `SELECT u.id, u.fullname, u.email
       FROM users2 u
       JOIN user_school us ON u.id = us.user_id
       WHERE u.id = ANY($1::int[])
         AND us.school_id = $2
         AND us.role_in_school = 'student'`,
      [student_ids, schoolId]
    );

    if (studentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No valid students found in this school.",
      });
    }

    // assign
    await pool.query(
      `UPDATE user_school
       SET classroom_id = $1
       WHERE user_id = ANY($2::int[])
         AND school_id = $3
         AND role_in_school = 'student'`,
      [classroomId, student_ids, schoolId]
    );

    // ✅ fetch unassigned students after update
    const unassignedResult = await pool.query(
      `SELECT u.id, u.fullname, u.email
       FROM users2 u
       JOIN user_school us ON u.id = us.user_id
       WHERE us.school_id = $1
         AND us.role_in_school = 'student'
         AND us.classroom_id IS NULL
       ORDER BY u.fullname`,
      [schoolId]
    );

    return res.json({
      success: true,
      message: "Students assigned successfully",
      assigned: studentResult.rows,
      unassigned: unassignedResult.rows, // 👈 send back fresh dropdown list
    });
  } catch (err) {
    console.error("Error assigning students to classroom:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// exports.assignUsersToClassroom = async (req, res) => {
//   const classroomId = parseInt(req.params.id, 10);
//   let { user_ids, role } = req.body;

//   if (!user_ids) {
//     return res
//       .status(400)
//       .json({ success: false, message: "No users selected." });
//   }

//   if (!Array.isArray(user_ids)) user_ids = [user_ids];
//   user_ids = user_ids.map((id) => parseInt(id, 10)).filter((id) => !isNaN(id));

//   if (user_ids.length === 0) {
//     return res
//       .status(400)
//       .json({ success: false, message: "No valid users selected." });
//   }

//   try {
//     // Get school id
//     const schoolResult = await pool.query(
//       `SELECT school_id FROM classrooms WHERE id = $1`,
//       [classroomId]
//     );
//     const schoolId = schoolResult.rows[0]?.school_id;
//     if (!schoolId) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Classroom not found" });
//     }

//     // Verify users belong to school & role
//     const userResult = await pool.query(
//       `SELECT u.id, u.fullname, u.email
//        FROM users2 u
//        JOIN user_school us ON u.id = us.user_id
//        WHERE u.id = ANY($1::int[])
//          AND us.school_id = $2
//          AND us.role_in_school = $3`,
//       [user_ids, schoolId, role]
//     );

//     if (userResult.rows.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: `No valid ${role}s found in this school.`,
//       });
//     }

//     // Assign to classroom
//     await pool.query(
//       `UPDATE user_school
//        SET classroom_id = $1
//        WHERE user_id = ANY($2::int[])
//          AND school_id = $3
//          AND role_in_school = $4`,
//       [classroomId, user_ids, schoolId, role]
//     );

//     // Return updated classroom counts
//     const classCounts = await pool.query(
//       `SELECT
//          COUNT(DISTINCT CASE WHEN us.role_in_school = 'student' THEN us.user_id END) AS student_count,
//          COUNT(DISTINCT CASE WHEN us.role_in_school = 'teacher' THEN us.user_id END) AS teacher_count
//        FROM user_school us
//        WHERE us.classroom_id = $1 AND us.school_id = $2`,
//       [classroomId, schoolId]
//     );

//     // Fetch unassigned users of this role
//     const unassignedResult = await pool.query(
//       `SELECT u.id, u.fullname, u.email
//        FROM users2 u
//        JOIN user_school us ON u.id = us.user_id
//        WHERE us.school_id = $1
//          AND us.role_in_school = $2
//          AND us.classroom_id IS NULL
//        ORDER BY u.fullname`,
//       [schoolId, role]
//     );

//     return res.json({
//       success: true,
//       message: `${role}s assigned successfully`,
//       assigned: userResult.rows.map((r) => ({
//         ...r,
//         classroom_id: classroomId,
//       })),
//       unassigned: unassignedResult.rows,
//       counts: classCounts.rows[0], // ✅ student_count + teacher_count
//     });
//   } catch (err) {
//     console.error(`Error assigning ${role}s to classroom:`, err);
//     return res.status(500).json({ success: false, message: "Server error" });
//   }
// };

exports.assignUsersToClassroom = async (req, res) => {
  const classroomId = parseInt(req.params.id, 10);
  let { user_ids, role } = req.body;

  if (!user_ids) {
    return res
      .status(400)
      .json({ success: false, message: "No users selected." });
  }

  if (!Array.isArray(user_ids)) user_ids = [user_ids];
  user_ids = user_ids.map((id) => parseInt(id, 10)).filter((id) => !isNaN(id));

  if (user_ids.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "No valid users selected." });
  }

  try {
    // ✅ 1. Get school id from classroom
    const schoolResult = await pool.query(
      `SELECT school_id FROM classrooms WHERE id = $1`,
      [classroomId]
    );
    const schoolId = schoolResult.rows[0]?.school_id;
    if (!schoolId) {
      return res
        .status(404)
        .json({ success: false, message: "Classroom not found" });
    }

    if (role === "instructor") {
      // Only assign instructors to classroom_instructors (no user_school insert)
      await pool.query(
        `
    INSERT INTO classroom_instructors (classroom_id, instructor_id)
    SELECT $1, u.id
    FROM users2 u
    WHERE u.id = ANY($2::int[])
    ON CONFLICT (classroom_id, instructor_id) DO NOTHING
    `,
        [classroomId, user_ids]
      );

      // Fetch all instructor users & their assigned classrooms (if any)
      const instructorsResult = await pool.query(
        `
    SELECT 
      u.id,
      u.fullname AS full_name,
      u.email,
      COALESCE(string_agg(DISTINCT c.name, ', '), 'Not yet assigned') AS classrooms
    FROM users2 u
    LEFT JOIN classroom_instructors ci ON ci.instructor_id = u.id
    LEFT JOIN classrooms c ON ci.classroom_id = c.id
    WHERE u.role = 'instructor'
    GROUP BY u.id, u.fullname, u.email
    ORDER BY u.fullname
    `
      );

      return res.json({
        success: true,
        message: "Instructors assigned successfully",
        instructors: instructorsResult.rows,
      });
    } else {
      // ✅ Students / Teachers (single classroom only)
      const userResult = await pool.query(
        `SELECT u.id, u.fullname, u.email
         FROM users2 u
         JOIN user_school us ON u.id = us.user_id
         WHERE u.id = ANY($1::int[])
           AND us.school_id = $2
           AND us.role_in_school = $3`,
        [user_ids, schoolId, role]
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: `No valid ${role}s found in this school.`,
        });
      }

      // Update their classroom_id (one per user)
      await pool.query(
        `UPDATE user_school
         SET classroom_id = $1
         WHERE user_id = ANY($2::int[])
           AND school_id = $3
           AND role_in_school = $4`,
        [classroomId, user_ids, schoolId, role]
      );

      // Fetch unassigned users of this role
      const unassignedResult = await pool.query(
        `SELECT u.id, u.fullname, u.email
         FROM users2 u
         JOIN user_school us ON u.id = us.user_id
         WHERE us.school_id = $1
           AND us.role_in_school = $2
           AND us.classroom_id IS NULL
         ORDER BY u.fullname`,
        [schoolId, role]
      );

      return res.json({
        success: true,
        message: `${role}s assigned successfully`,
        assigned: userResult.rows.map((r) => ({
          ...r,
          classroom_id: classroomId,
        })),
        unassigned: unassignedResult.rows,
      });
    }
  } catch (err) {
    console.error(`Error assigning ${role}s to classroom:`, err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.sendChatMessage = async (req, res) => {
  try {
    const { receiverId, message } = req.body;
    const senderId = req.session.user?.id; // Use logged-in user's ID

    if (!senderId) {
      return res.status(401).json({ success: false, message: "Not logged in" });
    }

    if (!receiverId || !message.trim()) {
      return res.status(400).json({ success: false, message: "Invalid input" });
    }

    await pool.query(
      `INSERT INTO messages (sender_id, receiver_id, message)
       VALUES ($1, $2, $3)`,
      [senderId, receiverId, message]
    );

    res.json({ success: true, message: "Message sent successfully" });
  } catch (err) {
    console.error("Send chat message error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ✅ Get chat messages (conversation)
exports.getChatMessages = async (req, res) => {
  try {
    const receiverId = req.params.receiverId;
    const senderId = req.session.user?.id;

    if (!senderId) {
      return res.status(401).json({ success: false, message: "Not logged in" });
    }

    const { rows } = await pool.query(
      `
      SELECT 
        id, sender_id, receiver_id, message, created_at,
        CASE WHEN sender_id = $1 THEN 'self' ELSE 'other' END AS sender
      FROM messages
      WHERE (sender_id = $1 AND receiver_id = $2)
         OR (sender_id = $2 AND receiver_id = $1)
      ORDER BY created_at ASC
      `,
      [senderId, receiverId]
    );

    // Optionally mark messages as read
    await pool.query(
      `UPDATE messages SET is_read = TRUE WHERE receiver_id = $1 AND sender_id = $2`,
      [senderId, receiverId]
    );

    res.json(rows);
  } catch (err) {
    console.error("Get chat messages error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ✅ Get all chat conversations (students who have messaged instructor)
exports.getInstructorChats = async (req, res) => {
  try {
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0] || {};
    const instructorId = req.user.id;

    const { rows } = await pool.query(
      `
      SELECT DISTINCT 
        u.id AS student_id,
        u.fullname AS student_name,
        u.email,
        MAX(m.created_at) AS last_message_time
      FROM messages m
      JOIN users2 u ON 
        (u.id = m.sender_id AND m.receiver_id = $1)
        OR (u.id = m.receiver_id AND m.sender_id = $1)
      WHERE u.role = 'student'
      GROUP BY u.id, u.fullname, u.email
      ORDER BY last_message_time DESC
      `,
      [instructorId]
    );

    const profilePic = req.session.user
      ? req.session.user.profile_picture
      : null;

    res.render("instructor/chatList", {
      chats: rows,
      info,
      profilePic,
      role: "instructor",
      user: req.session.user,
    });
  } catch (err) {
    console.error("Get instructor chats error:", err);
    res.status(500).send("Error loading chats");
  }
};

// ✅ Full chat conversation with one student
exports.getChatWithStudent = async (req, res) => {
  try {
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0] || {};
    const instructorId = req.user.id;
    const studentId = req.params.studentId;

    const { rows } = await pool.query(
      `
      SELECT 
        m.id, m.sender_id, m.receiver_id, m.message, m.created_at,
        CASE WHEN m.sender_id = $1 THEN 'self' ELSE 'other' END AS sender
      FROM messages m
      WHERE (m.sender_id = $1 AND m.receiver_id = $2)
         OR (m.sender_id = $2 AND m.receiver_id = $1)
      ORDER BY m.created_at ASC
      `,
      [instructorId, studentId]
    );

    const studentResult = await pool.query(
      `SELECT fullname, email FROM users2 WHERE id = $1`,
      [studentId]
    );

    const profilePic = req.session.user
      ? req.session.user.profile_picture
      : null;

    res.render("instructor/chatView", {
      student: studentResult.rows[0],
      messages: rows,
      info,
      profilePic,
      role: "instructor",
      user: req.session.user,
    });
  } catch (err) {
    console.error("Get chat with student error:", err);
    res.status(500).send("Error loading chat conversation");
  }
};
