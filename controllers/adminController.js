const pool = require("../models/db");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
// const nodemailer = require("nodemailer");
const sendEmail = require("../utils/sendEmail");
const cloudinary = require("../utils/cloudinary");
const fs = require("fs");
const { Parser } = require("json2csv");
const PDFDocument = require("pdfkit");
const puppeteer = require("puppeteer");
const { logActivityForUser } = require("../utils/activityLogger");

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
      await logActivityForUser(req, "School Admin logged in", `School Name: ${school_name}`);
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
      await logActivityForUser(req, "teacher Logged in", `Classroom: ${user.fullname}`);
      return res.redirect("/teacher/dashboard");

    } else if (user.role === "parent") {
      await logActivityForUser(req, "parent logged in", `Classroom: ${user.fullname}`);
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

exports.instructorDashboard = async (req, res) => {
  try {
    const instructorId = req.user.id; // assuming you're using passport/session middleware
    // Step 1: Get Ministry Info
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0];

    // 1. Total courses
    const coursesCount = await pool.query(
      `SELECT COUNT(*) FROM courses WHERE instructor_id = $1`,
      [instructorId]
    );

    // 2. Total modules
    const modulesCount = await pool.query(
      `SELECT COUNT(*) 
       FROM modules m
       JOIN courses c ON m.course_id = c.id
       WHERE c.instructor_id = $1`,
      [instructorId]
    );

    // 3. Total lessons
    const lessonsCount = await pool.query(
      `SELECT COUNT(*) 
       FROM lessons l
       JOIN modules m ON l.module_id = m.id
       JOIN courses c ON m.course_id = c.id
       WHERE c.instructor_id = $1`,
      [instructorId]
    );

    // 4. Total students enrolled
    const studentsCount = await pool.query(
      `SELECT COUNT(DISTINCT e.user_id) 
       FROM course_enrollments e
       JOIN courses c ON e.course_id = c.id
       WHERE c.instructor_id = $1`,
      [instructorId]
    );

    // 5. Assignment submissions across instructor’s courses
    const submissionsCount = await pool.query(
      `SELECT COUNT(*) 
       FROM assignment_submissions s
       JOIN lessons l ON s.assignment_id = l.id
       JOIN modules m ON l.module_id = m.id
       JOIN courses c ON m.course_id = c.id
       WHERE c.instructor_id = $1`,
      [instructorId]
    );

    // Optionally, fetch instructor’s courses list with enrollments
    const coursesList = await pool.query(
      `SELECT c.id, c.title, COUNT(e.id) AS student_count
       FROM courses c
       LEFT JOIN course_enrollments e ON e.course_id = c.id
       WHERE c.instructor_id = $1
       GROUP BY c.id
       ORDER BY c.created_at DESC`,
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
      info,
      profilePic,
      role: "instructor", // ✅ pass role
      user: req.session.user,
    });
  } catch (err) {
    console.error("Instructor Dashboard Error:", err.message);
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
    await logActivityForUser(
      req,
      "User updated",
      `user name: ${fullname}`
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
    await logActivityForUser(
      req,
      "User Deleted"
    );
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
  res.render("admin/pathways", { info, search, pathways: result.rows, role: req.session.user?.role || "admin", });
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
  await logActivityForUser(
    req,
    "Pathway Created",
    `Pathway name: ${title}`
  );
  res.redirect("/admin/pathways");
};


exports.deletePathway = async (req, res) => {
  const { id } = req.params;
  await pool.query("DELETE FROM career_pathways WHERE id = $1", [id]);
  await logActivityForUser(
    req,
    "Pathway deleted",
    `Pathway ID: ${id}`
  );
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
await logActivityForUser(
  req,
  "Pathway edited",
  `Pathway title: ${title}`
);
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


  await logActivityForUser(
    req,
    "Course Create",
    `Course title: ${title}`
  );
  res.redirect("/admin/courses");
};

// exports.editCourse = async (req, res) => {
//   const { id } = req.params;
//   const { title, description, level, career_pathway_id, sort_order, amount } = req.body;

//   try {
//     let thumbnail_url = null;

//     if (req.file) {
//       const result = await cloudinary.uploader.upload(req.file.path, {
//         folder: "courses",
//       });
//       thumbnail_url = result.secure_url;
//       if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
//     }

//     // Update course
//     const existing = await pool.query("SELECT * FROM courses WHERE id = $1", [
//       id,
//     ]);

//     const updatedThumbnail = thumbnail_url || existing.rows[0]?.thumbnail_url;

//     await pool.query(
//       `UPDATE courses
//        SET title = $1,
//            description = $2,
//            level = $3,
//            career_pathway_id = $4,
//            thumbnail_url = $5,
//            sort_order = $6,
//            amount = $7
//        WHERE id = $8`,
//       [
//         title,
//         description,
//         level,
//         career_pathway_id || null,
//         updatedThumbnail,
//         sort_order || null,
//         amount || null,
//         id,
//       ]
//     );

//     await logActivityForUser(
//       req,
//       "Course edited",
//       `Course title: ${title}`
//     );
//     res.redirect("/admin/courses");
//   } catch (err) {
//     console.error("❌ Error editing course:", err.message);
//     res.status(500).send("Server Error");
//   }
// };
exports.editCourse = async (req, res) => {
  const { id } = req.params;
  const {
    title,
    description,
    level,
    career_pathway_id,
    sort_order,
    amount,
  } = req.body;

  let thumbnail_url = null;

  if (req.file) {
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: "courses",
    });
    thumbnail_url = result.secure_url;
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }

  try {
    // 🔒 Check if instructor owns the course
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
      return res.status(403).send("You are not allowed to edit this course.");
    }

    // ✅ Update course
    await pool.query(
      `UPDATE courses 
       SET title = $1, description = $2, level = $3, career_pathway_id = $4,
           thumbnail_url = $5, sort_order = $6, amount = $7
       WHERE id = $8`,
      [
        title,
        description,
        level,
        career_pathway_id,
        thumbnail_url,
        sort_order,
        amount,
        id,
      ]
    );

    res.redirect("/admin/courses");
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error.");
  }
};


// exports.deleteCourse = async (req, res) => {
//   const { id } = req.params;

//   try {
//     await pool.query("DELETE FROM courses WHERE id = $1", [id]);
//     await logActivityForUser(
//       req,
//       "Course deleted",
//       `Course ID: ${id}`
//     );
//     res.redirect("/admin/courses");
//   } catch (err) {
//     console.error("❌ Error deleting course:", err.message);
//     res.status(500).send("Server Error");
//   }
// };
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
  await logActivityForUser(
    req,
    "Benefit created",
    `Benefit title: ${title}`
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
    await logActivityForUser(
      req,
      "Event created",
      `Event title: ${title}`
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

    // ✅ Courses
    const coursesRes = await pool.query(
      `
      SELECT c.id, c.title AS course_title, e.enrolled_at
      FROM courses c
      JOIN course_enrollments e ON e.course_id = c.id
      WHERE e.user_id = $1
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

    res.render("admin/studentEnrollments", { courses: courses.rows, info });
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

// 📌 GET: All Schools
// exports.getSchools = async (req, res) => {
//   try {
//     const result = await pool.query(`
//       SELECT
//         s.id,
//         s.name,
//         s.email,
//         s.phone,
//         COUNT(*) FILTER (WHERE us.role_in_school = 'student') AS student_count,
//         COUNT(*) FILTER (WHERE us.role_in_school = 'teacher') AS teacher_count
//       FROM schools s
//       LEFT JOIN user_school us ON s.id = us.school_id
//       GROUP BY s.id
//       ORDER BY s.created_at DESC
//     `);

//     res.render("admin/schools", {
//       info: req.companyInfo || {},
//       schools: result.rows,
//       currentPage: "schools",
//     });
//   } catch (err) {
//     console.error("Error fetching schools:", err);
//     res.status(500).send("Error loading schools");
//   }
// };

exports.getSchools = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        s.id,
        s.name,
        s.email,
        s.phone,
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
    });
  } catch (err) {
    console.error("Error fetching schools:", err);
    res.status(500).send("Error loading schools");
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

    // Fetch students with classroom names
    const studentsResult = await pool.query(
      `
  SELECT u.id, 
         u.fullname AS full_name,
         u.email,
         u.phone,
         u.dob,
         u.gender,
         u.role,
         u.wallet_balance,
         u.created_at,
         c.name AS classroom_name
  FROM user_school us
  JOIN users2 u ON us.user_id = u.id
  LEFT JOIN classrooms c ON us.classroom_id = c.id
  WHERE us.school_id = $1 AND us.role_in_school = 'student'
  `,
      [id]
    );

    // Fetch teachers with classroom names
    const teachersResult = await pool.query(
      `
  SELECT u.id, 
         u.fullname AS full_name,
         u.email,
         u.phone,
         u.dob,
         u.gender,
         u.role,
         u.wallet_balance,
         u.created_at,
         c.name AS classroom_name
  FROM user_school us
  JOIN users2 u ON us.user_id = u.id
  LEFT JOIN classrooms c ON us.classroom_id = c.id
  WHERE us.school_id = $1 AND us.role_in_school = 'teacher'
  `,
      [id]
    );

    // Fetch classrooms
    // Fetch classrooms + counts
    const classroomsResult = await pool.query(
      `
  SELECT 
    c.id,
    c.name,
    COUNT(DISTINCT CASE WHEN us.role_in_school = 'student' THEN u.id END) AS student_count,
    COUNT(DISTINCT CASE WHEN us.role_in_school = 'teacher' THEN u.id END) AS teacher_count
  FROM classrooms c
  LEFT JOIN user_school us ON c.id = us.classroom_id
  LEFT JOIN users2 u ON us.user_id = u.id
  WHERE c.school_id = $1
  GROUP BY c.id, c.name
  ORDER BY c.created_at DESC
  `,
      [id]
    );

    // Fetch quotes for this school
    const quotesResult = await pool.query(
      `
      SELECT * FROM quotes WHERE school_id = $1 ORDER BY created_at DESC
    `,
      [id]
    );

    // Attach to school object
    school.students = studentsResult.rows;
    school.teachers = teachersResult.rows;
    school.classrooms = classroomsResult.rows;

    res.render("admin/school-details", {
      info: req.companyInfo || {},
      school,
      quotes: quotesResult.rows, // ✅ Pass quotes here
      currentPage: "schools",
    });
  } catch (err) {
    console.error("Error fetching school details:", err);
    res.status(500).send("Error loading school details");
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
    await logActivityForUser(
      req,
      "Quote approved",
      `Quote ID: ${id}`
    );
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
    await pool.query("DELETE FROM school_courses WHERE school_id = $1", [school_id]);

    // Get selected courses
    const courseIds = req.body[`school_${school_id}`] || [];

    if (courseIds.length > 0) {
      const insertValues = courseIds.map(id => `(${school_id}, ${id})`).join(",");
      await pool.query(`INSERT INTO school_courses (school_id, course_id) VALUES ${insertValues}`);
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
    const hashed = await bcrypt.hash(password || "123456", 10); // default pw if missing
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

