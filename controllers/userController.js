const bcrypt = require("bcrypt");
const pool = require("../models/db");
const sendEmail = require("../utils/sendEmail");
const PDFDocument = require("pdfkit");
const puppeteer = require("puppeteer");

exports.showSignup = (req, res) => {
  // res.sendFile(path.join(__dirname, 'signup.html'));
  res.render("signup", { error: null , role: req.query.role || 'user'});
};

exports.showLogin = (req, res) => {
  res.render("admin/login", { error: null });
};

exports.signup = async (req, res) => {
  const { email, username, phone, gender, password, dob, role} = req.body;
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
  // const role = "user"; // Default role for new users
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
      user.role,
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

exports.getParentDashboard = async (req, res) => {
  const user = req.session.user;
  if (!user || user.role !== "parent") {
    return res.redirect("/login");
  }

  try {
    // Company Info
        const infoResult = await pool.query(
          "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
        );
        const info = infoResult.rows[0] || {};
    const profilePic = req.session.user?.profile_picture || null;
    
    const children = await pool.query(
      `SELECT u.id, u.fullname, u.email, u.profile_picture
       FROM parent_children pc
       JOIN users2 u ON pc.child_id = u.id
       WHERE pc.parent_id = $1`,
      [user.id]
    );

    res.render("parent/dashboard", {
      parent: user,
      children: children.rows,
      info,
      profilePic,
      title: "Parent Dashboard",
      isLoggedIn: !!req.session.user,
      users: req.session.user,
    });
  } catch (err) {
    console.error("Error loading parent dashboard:", err);
    res.status(500).send("Failed to load dashboard");
  }
};


exports.addChild = async (req, res) => {
  const parent = req.session.user;
  if (!parent || parent.role !== "parent") {
    return res.status(403).send("Only parents can add children");
  }

  const { childEmail } = req.body;

  try {
    const childRes = await pool.query(
      "SELECT id, fullname FROM users2 WHERE email = $1 AND role = 'user'",
      [childEmail]
    );

    if (childRes.rows.length === 0) {
      return res.status(404).send("No student found with that email.");
    }

    const child = childRes.rows[0];

    await pool.query(
      `INSERT INTO parent_child_requests (parent_id, child_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [parent.id, child.id]
    );

    // res.send("✅ Request sent! Waiting for the student’s approval.");
    res.redirect("/parent/dashboard");
  } catch (err) {
    console.error("Error creating request:", err);
    res.status(500).send("Failed to send request");
  }
};


// Remove a child (parent self-service)
// exports.removeChild = async (req, res) => {
//   try {
//     const parentId = req.session.user.id; // logged-in parent
//     const { childId } = req.body;

//     // Check if link exists
//     const link = await pool.query(
//       `SELECT * FROM parent_children WHERE parent_id = $1 AND child_id = $2`,
//       [parentId, childId]
//     );

//     if (link.rowCount === 0) {
//       return res.status(400).send("❌ Child not linked to you");
//     }

//     await pool.query(
//       `DELETE FROM parent_children WHERE parent_id = $1 AND child_id = $2`,
//       [parentId, childId]
//     );

//     res.redirect("/parent/dashboard");
//   } catch (err) {
//     console.error("Remove child error:", err.message);
//     res.status(500).send("Server error removing child");
//   }
// };


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



// exports.downloadCourseSummary = async (req, res) => {
//   const { studentId, courseId } = req.params;

//   try {
//     // --- Student info
//     const studentRes = await pool.query(
//       `SELECT fullname, email, created_at FROM users2 WHERE id = $1`,
//       [studentId]
//     );
//     const student = studentRes.rows[0];

//     // --- Course info
//     const courseRes = await pool.query(
//       `SELECT id, title FROM courses WHERE id = $1`,
//       [courseId]
//     );
//     const course = courseRes.rows[0];

//     // --- Company info
//     const infoRes = await pool.query(
//       `SELECT company_name, logo_url FROM company_info ORDER BY id DESC LIMIT 1`
//     );
//     const info = infoRes.rows[0] || { company_name: "Jaykirch Tech Hub" };

//     // --- Modules
//     const modulesRes = await pool.query(
//       `SELECT id, title FROM modules WHERE course_id = $1`,
//       [courseId]
//     );
//     const modules = modulesRes.rows;

//     // --- Lessons
//     const lessonsRes = await pool.query(
//       `SELECT l.id, l.title, l.module_id, ulp.completed_at
//        FROM lessons l
//        JOIN modules m ON l.module_id = m.id
//        LEFT JOIN user_lesson_progress ulp 
//          ON ulp.lesson_id = l.id AND ulp.user_id = $1
//        WHERE m.course_id = $2
//        ORDER BY l.id`,
//       [studentId, courseId]
//     );
//     const lessons = lessonsRes.rows;

//     // --- Quizzes
//     const quizzesRes = await pool.query(
//       `SELECT q.id, q.title, l.module_id, qs.score, qs.created_at AS taken_at
//        FROM quizzes q
//        LEFT JOIN quiz_submissions qs 
//          ON qs.quiz_id = q.id AND qs.student_id = $1
//        JOIN lessons l ON q.lesson_id = l.id
//        JOIN modules m ON l.module_id = m.id
//        WHERE m.course_id = $2
//        ORDER BY q.id`,
//       [studentId, courseId]
//     );
//     const quizzes = quizzesRes.rows;

//     // --- Assignments
//     const assignmentsRes = await pool.query(
//       `SELECT ma.id, ma.title, ma.module_id, s.total, s.grade, s.ai_feedback, s.created_at AS submitted_at
//        FROM module_assignments ma
//        JOIN modules m ON ma.module_id = m.id
//        LEFT JOIN assignment_submissions s 
//          ON s.assignment_id = ma.id AND s.student_id = $1
//        WHERE m.course_id = $2
//        ORDER BY ma.id`,
//       [studentId, courseId]
//     );
//     const assignments = assignmentsRes.rows;

//     // --- Summary stats
//     const totalLessons = lessons.length;
//     const completedLessons = lessons.filter((l) => l.completed_at).length;
//     const lessonPercent = totalLessons
//       ? Math.round((completedLessons / totalLessons) * 100)
//       : 0;

//     const quizAvg =
//       quizzes.length > 0
//         ? Math.round(
//             quizzes.reduce((a, q) => a + (q.score || 0), 0) / quizzes.length
//           )
//         : "N/A";

//     const assignmentAvg =
//       assignments.length > 0
//         ? Math.round(
//             assignments.reduce((a, x) => a + (x.total || 0), 0) /
//               assignments.length
//           )
//         : "N/A";

//     // --- Build styled HTML template with logo
//     const html = `
//       <html>
//         <head>
//           <style>
//             body { font-family: 'Segoe UI', Arial, sans-serif; padding: 40px; color: #2c3e50; }
//             header { text-align: center; border-bottom: 2px solid #b99a29ff; padding-bottom: 10px; margin-bottom: 20px; }
//             header img { max-height: 60px; margin-bottom: 8px; }
//             header h1 { margin: 0; color: #b9b429ff; font-size: 20px; }
//             header p { font-size: 12px; color: gray; margin: 0; }

//             h2 { margin-top: 30px; color: #b9a329ff; border-bottom: 1px solid #ddd; padding-bottom: 5px; }
//             h3 { margin-top: 20px; color: #000000ff; }

//             .summary { margin: 20px 0; padding: 15px; background: #d9d9d6ff; border-radius: 8px; }
//             .summary ul { list-style: none; padding: 0; }
//             .summary li { margin: 5px 0; }

//             table { width: 100%; border-collapse: collapse; margin: 15px 0; }
//             th, td { border: 1px solid #ddd; padding: 8px; font-size: 12px; }
//             th { background: #000000ff; color: white; text-align: left; }
//             tr:nth-child(even) { background: #f9f9f9; }

//             footer { margin-top: 40px; font-size: 10px; text-align: center; color: gray; }
//           </style>
//         </head>
//         <body>
//           <header>
//             ${
//               info.logo_url
//                 ? `<img src="${info.logo_url}" alt="Company Logo"/>`
//                 : ""
//             }
//             <h1>${info.company_name}</h1>
//             <p>📊 Student Progress Report</p>
//             <p>Generated on: ${new Date().toLocaleString()}</p>
//           </header>

//           <h2>👤 Student Info</h2>
//           <p><strong>Name:</strong> ${student.fullname}</p>
//           <p><strong>Email:</strong> ${student.email}</p>
//           <p><strong>Course:</strong> ${course.title}</p>

//           <div class="summary">
//             <h2>📌 Summary Statistics</h2>
//             <ul>
//               <li>Total Lessons: ${totalLessons}</li>
//               <li>Completed Lessons: ${completedLessons}</li>
//               <li>Progress: ${lessonPercent}%</li>
//               <li>Quiz Average: ${quizAvg}</li>
//               <li>Assignment Average: ${assignmentAvg}</li>
//             </ul>
//           </div>

//           ${modules
//             .map(
//               (m) => `
//             <h2>📦 Module: ${m.title}</h2>
            
//             <h3>📚 Lessons</h3>
//             <table>
//               <tr><th>Lesson</th><th>Status</th></tr>
//               ${lessons
//                 .filter((l) => l.module_id === m.id)
//                 .map(
//                   (l) => `
//                 <tr>
//                   <td>${l.title}</td>
//                   <td>${
//                     l.completed_at ? "✅ Completed" : "❌ Not completed"
//                   }</td>
//                 </tr>`
//                 )
//                 .join("")}
//             </table>

//             <h3>📝 Quizzes</h3>
//             <table>
//               <tr><th>Quiz</th><th>Score</th><th>Date</th></tr>
//               ${quizzes
//                 .filter((q) => q.module_id === m.id)
//                 .map(
//                   (q) => `
//                 <tr>
//                   <td>${q.title}</td>
//                   <td>${q.score ?? "N/A"}</td>
//                   <td>${
//                     q.taken_at
//                       ? new Date(q.taken_at).toLocaleDateString()
//                       : "Not taken"
//                   }</td>
//                 </tr>`
//                 )
//                 .join("")}
//             </table>

//             <h3>📑 Assignments</h3>
//             <table>
//               <tr><th>Assignment</th><th>Score</th><th>Grade</th><th>Feedback</th><th>Submitted</th></tr>
//               ${assignments
//                 .filter((a) => a.module_id === m.id)
//                 .map(
//                   (a) => `
//                 <tr>
//                   <td>${a.title}</td>
//                   <td>${a.total ?? "Pending"}</td>
//                   <td>${a.grade ?? "-"}</td>
//                   <td>${a.ai_feedback ?? "No feedback"}</td>
//                   <td>${
//                     a.submitted_at
//                       ? new Date(a.submitted_at).toLocaleDateString()
//                       : "Not submitted"
//                   }</td>
//                 </tr>`
//                 )
//                 .join("")}
//             </table>
//           `
//             )
//             .join("")}

//           <footer>© ${new Date().getFullYear()} ${info.company_name}</footer>
//         </body>
//       </html>
//     `;

//     // --- Generate PDF with Puppeteer
//     const browser = await browserPromise;
//     const page = await browser.newPage();
//     await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 0 });

//     const pdfBuffer = await page.pdf({
//       format: "A4",
//       printBackground: true,
//       margin: { top: "40px", bottom: "40px", left: "20px", right: "20px" },
//     });

//     await page.close();

//     // --- Send PDF response
//     res.setHeader(
//       "Content-Disposition",
//       `attachment; filename=${course.title.replace(/\s+/g, "_")}_report.pdf`
//     );
//     res.setHeader("Content-Type", "application/pdf");
//     res.send(pdfBuffer);
//   } catch (err) {
//     console.error("PDF Error:", err);
//     res.status(500).send("Error generating summary PDF");
//   }
// };


let browserPromise = puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

exports.downloadCourseSummary = async (req, res) => {
  const { studentId, courseId } = req.params;

  try {
    // --- Student info
    const studentRes = await pool.query(
      `SELECT fullname, email, created_at FROM users2 WHERE id = $1`,
      [studentId]
    );
    const student = studentRes.rows[0];

    // --- Course info
    const courseRes = await pool.query(
      `SELECT id, title FROM courses WHERE id = $1`,
      [courseId]
    );
    const course = courseRes.rows[0];

    // --- Company info
    const infoRes = await pool.query(
      `SELECT company_name, logo_url FROM company_info ORDER BY id DESC LIMIT 1`
    );
    const info = infoRes.rows[0] || { company_name: "Jaykirch Tech Hub" };

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

    // --- Global Summary stats
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

    // --- Build styled HTML template with logo + module summaries
    const html = `
      <html>
        <head>
          <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; padding: 40px; color: #2c3e50; }
            header { text-align: center; border-bottom: 2px solid #b99a29ff; padding-bottom: 10px; margin-bottom: 20px; }
            header img { max-height: 60px; margin-bottom: 8px; }
            header h1 { margin: 0; color: #b9b429ff; font-size: 20px; }
            header p { font-size: 12px; color: gray; margin: 0; }

            h2 { margin-top: 30px; color: #b9a329ff; border-bottom: 1px solid #ddd; padding-bottom: 5px; }
            h3 { margin-top: 20px; color: #000000ff; }

            .summary { margin: 20px 0; padding: 15px; background: #d9d9d6ff; border-radius: 8px; }
            .summary ul { list-style: none; padding: 0; }
            .summary li { margin: 5px 0; }

            table { width: 100%; border-collapse: collapse; margin: 15px 0; }
            th, td { border: 1px solid #ddd; padding: 8px; font-size: 12px; }
            th { background: #000000ff; color: white; text-align: left; }
            tr:nth-child(even) { background: #f9f9f9; }

            .module-summary { margin: 10px 0; padding: 10px; background: #f5f5f5; border-left: 4px solid #b99a29ff; }
            .module-summary p { margin: 4px 0; }

            footer { margin-top: 40px; font-size: 10px; text-align: center; color: gray; }
            .watermark {
              position: fixed;
              top: 40%;
              left: 20%;
              font-size: 80px;
              color: rgba(180, 180, 180, 0.15);
              transform: rotate(-30deg);
              z-index: -1;
              width: 100%;
              text-align: center;
              pointer-events: none;
            }

          </style>
        </head>
        <body>
          <div class="watermark">${info.company_name} Report</div>
          <header>
            ${
              info.logo_url
                ? `<img src="${info.logo_url}" alt="Company Logo"/>`
                : ""
            }
            <h1>${info.company_name}</h1>
            <p>📊 Student Progress Report</p>
            <p>Generated on: ${new Date().toLocaleString()}</p>
          </header>

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
            .map((m) => {
              const moduleLessons = lessons.filter((l) => l.module_id === m.id);
              const moduleAssignments = assignments.filter(
                (a) => a.module_id === m.id
              );
              const moduleQuizzes = quizzes.filter((q) => q.module_id === m.id);

              const moduleCompletedLessons = moduleLessons.filter(
                (l) => l.completed_at
              ).length;

              const moduleQuizAvg =
                moduleQuizzes.length > 0
                  ? Math.round(
                      moduleQuizzes.reduce((a, q) => a + (q.score || 0), 0) /
                        moduleQuizzes.length
                    )
                  : "N/A";

              const moduleAssignmentAvg =
                moduleAssignments.length > 0
                  ? Math.round(
                      moduleAssignments.reduce(
                        (a, x) => a + (x.total || 0),
                        0
                      ) / moduleAssignments.length
                    )
                  : "N/A";

              return `
                <h2>📦 Module: ${m.title}</h2>
                <div class="module-summary">
                  <p><strong>Total Lessons:</strong> ${moduleLessons.length}</p>
                  <p><strong>Completed Lessons:</strong> ${moduleCompletedLessons}</p>
                  <p><strong>Total Assignments:</strong> ${
                    moduleAssignments.length
                  }</p>
                  <p><strong>Quiz Average:</strong> ${moduleQuizAvg}</p>
                  <p><strong>Assignment Average:</strong> ${moduleAssignmentAvg}</p>
                </div>

                <h3>📚 Lessons</h3>
                <table>
                  <tr><th>Lesson</th><th>Status</th></tr>
                  ${moduleLessons
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
                  ${moduleQuizzes
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
                  ${moduleAssignments
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
              `;
            })
            .join("")}

          <footer>© ${new Date().getFullYear()} ${info.company_name}</footer>
        </body>
      </html>
    `;

    // --- Generate PDF
    const browser = await browserPromise;
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 0 });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "40px", bottom: "40px", left: "20px", right: "20px" },
    });

    await page.close();

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












