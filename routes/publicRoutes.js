const express = require("express");
const router = express.Router();
const pool = require("../models/db");
// const upload = require("../middleware/upload");
const axios = require("axios");
const userController = require("../controllers/userController");
const sendEmail = require("../utils/sendEmail");
const { feedback } = require("../controllers/adminController");
const { buildFeedbackThankYouEmail } = require("../utils/emailTemplates"); 
// const buildFeedbackThankYouEmail = require("../utils/feedbackEmailTemplate");
const buildFeedbackAdminEmail = require("../utils/feedbackAdminEmail");

router.get("/events/:id", userController.showEvent);

router.get("/", async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];

    const [
      infoResult,
      career_pathwaysResult,
      usersResult,
      benefitsRes,
      allImagesResult,
      coursesResult,
      eventsResult,
      schoolsCountRes,
      teachersCountRes,
      studentsCountRes,
      totalUsersRes,
    ] = await Promise.all([
      pool.query("SELECT * FROM company_info ORDER BY id DESC LIMIT 1"),
      pool.query(
        "SELECT * FROM career_pathways WHERE show_on_homepage = true ORDER BY created_at"
      ),
      pool.query("SELECT * FROM users2"),
      pool.query("SELECT * FROM benefits ORDER BY created_at ASC"),
      pool.query("SELECT image_url, title FROM gallery_images"),
      pool.query(`
        SELECT courses.*, cp.title AS pathway_name
        FROM courses
        LEFT JOIN career_pathways cp ON cp.id = courses.career_pathway_id
        ORDER BY cp.title ASC, courses.level ASC, sort_order ASC LIMIT 10
      `),
      pool.query(
        "SELECT * FROM events WHERE show_on_homepage = true ORDER BY event_date ASC LIMIT 5"
      ),
      pool.query("SELECT COUNT(*) FROM schools"),
      pool.query(`
        SELECT COUNT(*) 
        FROM user_school us 
        JOIN users2 u ON u.id = us.user_id 
        WHERE us.role_in_school = 'teacher'
      `),
      pool.query(`
        SELECT COUNT(*) 
        FROM user_school us 
        JOIN users2 u ON u.id = us.user_id 
        WHERE us.role_in_school = 'student'
      `),
      pool.query("SELECT COUNT(*) FROM users2"),
    ]);

    const faqsResult = await pool.query(
      "SELECT * FROM faqs WHERE is_published = true ORDER BY created_at DESC LIMIT 5"
    );

    const TestimonyResult = await pool.query(
      `
        SELECT * FROM testimonies 
        WHERE is_published = true
        ORDER BY md5($1 || id::text)
        LIMIT 5
      `,
      [today]
    );

    const info = infoResult.rows[0];
    const users = usersResult.rows;
    const career_pathways = career_pathwaysResult.rows;
    const allImages = allImagesResult.rows;
    const faqs = faqsResult.rows;
    const testimonies = TestimonyResult.rows;

    // Daily shuffle for carousel
    function getDailyImages(images, count) {
      const today = new Date();
      let seed =
        today.getFullYear() * 10000 +
        (today.getMonth() + 1) * 100 +
        today.getDate();
      let arr = images.slice();
      let random = function () {
        var x = Math.sin(seed++) * 10000;
        return x - Math.floor(x);
      };
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr.slice(0, count);
    }

    const carouselImages = getDailyImages(allImages, 5);
    const events = eventsResult.rows;

    let walletBalance = 0;
    if (req.session.user) {
      const walletResult = await pool.query(
        "SELECT wallet_balance2 FROM users2 WHERE email = $1",
        [req.session.user.email]
      );
      walletBalance = walletResult.rows[0]?.wallet_balance2 || 0;
    }

    const stats = {
      schools: schoolsCountRes.rows[0].count,
      teachers: teachersCountRes.rows[0].count,
      students: studentsCountRes.rows[0].count,
      totalUsers: totalUsersRes.rows[0].count,
    };

    res.render("home", {
      info,
      users,
      events,
      walletBalance,
      career_pathways,
      title: "Company Home",
      activePage: "home", // 👈 Pass active page
      profilePic: req.session.user ? req.session.user.profile_picture : null,
      benefits: benefitsRes.rows,
      courses: coursesResult.rows,
      isLoggedIn: !!req.session.user,
      subscribed: req.query.subscribed,
      carouselImages,
      stats,
      faqs,
      testimonies,
      activePage: "home", // 👈 Pass active page
    });
  } catch (err) {
    console.error("❌ Error fetching homepage data:", err.message);
    res
      .status(500)
      .render("error", { message: "Server Error. Please try again later." });
  }
});


router.get("/faq", async (req, res) => {
  try {
    const search = req.query.search || "";
    let faqResult;
    let walletBalance = 0;
    if (req.session.user) {
      const walletResult = await pool.query(
        "SELECT wallet_balance2 FROM users2 WHERE email = $1",
        [req.session.user.email]
      );
      walletBalance = walletResult.rows[0]?.wallet_balance2 || 0;
    }

    if (search) {
      faqResult = await pool.query(
        "SELECT * FROM faqs WHERE LOWER(question) LIKE $1 ORDER BY created_at DESC",
        [`%${search.toLowerCase()}%`]
      );
    } else {
      faqResult = await pool.query(
        "SELECT * FROM faqs ORDER BY created_at DESC"
      );
    }

    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );

    res.render("faq", {
      info: infoResult.rows[0] || {},
      faqs: faqResult.rows,
      search, // pass current search back to the EJS view
      users: req.session.user || null,
      isLoggedIn: !!req.session.user,
      subscribed: req.query.subscribed,
      walletBalance,
      activePage: "faq", // 👈 Pass active page
    });
  } catch (err) {
    console.error("Error fetching FAQs:", err);
    res.status(500).send("Error loading FAQs");
  }
});

router.post("/faq/ask", async (req, res) => {
  const { question, email } = req.body;

  if (!question || question.trim() === "") {
    return res.redirect("/faq");
  }

  await pool.query("INSERT INTO faqs (question, email) VALUES ($1, $2)", [
    question,
    email || null,
  ]);
  res.redirect("/faq");
});

// Show Testimony Form Page (optional if part of another page)
router.get("/testimony", async (req, res) => {
  const infoResult = await pool.query(
    "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
  );
  const testimonyResult = await pool.query(
    "SELECT * FROM testimonies WHERE is_published = true ORDER BY id"
  );

  const q = await pool.query(
    "SELECT name, message, rating, user_type, created_at FROM feedback WHERE is_published = true ORDER BY created_at DESC LIMIT 50"
  );
  const user = req.session.user;
    let walletBalance = 0;
    if (user) {
      const wallet = await pool.query(
        "SELECT wallet_balance2 FROM users2 WHERE email = $1",
        [user.email]
      );
      walletBalance = wallet.rows[0]?.wallet_balance2 || 0;
    }
  
  res.render("testimony", {
    info: infoResult.rows[0] || {},
    testimonies: testimonyResult.rows,
    title: "Submit Testimony",
    activePage: "testimony", // 👈 Pass active page
    isLoggedIn: !!req.session.user,
    subscribed: req.query.subscribed,
    users: user,
    walletBalance,
    subscribed: req.query.subscribed,
    paid: req.query.paid,
    feedbacks: q.rows,
  });
});

// Handle Testimony Submission
router.post("/testimony", async (req, res) => {
  const { name, email, message } = req.body;
   

  if (!message || !name) {
    return res.redirect("/testimony?error=Message and name are required");
  }

  await pool.query(
    "INSERT INTO testimonies (name, email, message, created_at) VALUES ($1, $2, $3, NOW())",
    [name, email || null, message]
  );

  // Optionally email admin
  const adminEmail = "imoledayoimmanuel@gmail.com";
  const subject = "New Testimony Submitted";
  const body = `<h3>New Testimony</h3><p><strong>Name:</strong> ${name}</p><p>${message}</p>`;

  try {
    await sendEmail(adminEmail, subject, body);
  } catch (err) {
    console.error("Failed to send testimony alert:", err.message);
  }

  res.redirect("/testimony?success=true");
});

// Show Published Testimonies on Home or Testimony Page
router.get("/testimonies", async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM testimonies WHERE is_published = true ORDER BY created_at DESC"
  );

  const q = await pool.query(
    "SELECT name, message, rating, user_type, created_at FROM feedback WHERE is_published = true ORDER BY created_at DESC LIMIT 50"
  );
    const user = req.session.user;
  res.render("testimonies", {
    testimonies: result.rows,
    title: "Testimonies",
    activePage: "testimony", // 👈 Pass active page
    isLoggedIn: !!req.session.user,
    subscribed: req.query.subscribed,
    users: user,
    feedbacks: q.rows,
  });
});

// Show feedback form
router.get("/feedback", async (req, res) => {
  const infoResult = await pool.query(
    "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
  );

  

  const user = req.session.user;
  let walletBalance = 0;
  if (user) {
    const wallet = await pool.query(
      "SELECT wallet_balance2 FROM users2 WHERE email = $1",
      [user.email]
    );
    walletBalance = wallet.rows[0]?.wallet_balance2 || 0;
  }
  res.render("feedback", {
    info: infoResult.rows[0] || {},
    title: "Feedback",
    activePage: "feedback",
    isLoggedIn: !!req.session.user,
    subscribed: req.query.subscribed,
    users: user,
    walletBalance,
    subscribed: req.query.subscribed,
    paid: req.query.paid,
  });
});

// router.post("/feedback", async (req, res) => {
//   try {
//     const {
//       user_type,
//       name,
//       email,
//       school_name,
//       student_class,
//       organization_name,
//       rating,
//       category,
//       message,
//     } = req.body;

//     const extra = req.body.extra ? JSON.parse(req.body.extra) : {};

//     await pool.query(
//       `INSERT INTO feedback
//       (user_type, name, email, school_name, student_class, organization_name, rating, category, message, extra)
//       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
//       [
//         user_type,
//         name,
//         email || null,
//         school_name || null,
//         student_class || null,
//         organization_name || null,
//         rating,
//         category || null,
//         message,
//         extra,
//       ]
//     );

//     await sendEmail(
//            email,
//            "Your OTP Code",
//            `Your code is: ${otp}`
//          );
//     // Return JSON success instead of redirect
//     res.json({ success: true, message: "Feedback submitted successfully" });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ success: false, error: "Server error" });
//   }
// });

router.post("/feedback", async (req, res) => {
  try {
    const {
      user_type,
      name,
      email,
      school_name,
      student_class,
      organization_name,
      rating,
      category,
      message,
    } = req.body;

    const extra = req.body.extra ? JSON.parse(req.body.extra) : {};

    await pool.query(
      `INSERT INTO feedback 
      (user_type, name, email, school_name, student_class, organization_name, rating, category, message, extra) 
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        user_type,
        name,
        email || null,
        school_name || null,
        student_class || null,
        organization_name || null,
        rating,
        category || null,
        message,
        extra,
      ]
    );

    if (email) {
      await sendEmail(
        email,
        "Thank You for Your Feedback ❤️",
        buildFeedbackThankYouEmail({ name, user_type, rating, message })
      );

      // ADMIN EMAIL — sends instantly when new feedback arrives
      await sendEmail(
        process.env.BREVO_FROM, // store admin email in .env
        "New Feedback Submitted 📥",
        buildFeedbackAdminEmail({
          name,
          user_type,
          email,
          school_name,
          student_class,
          organization_name,
          rating,
          category,
          message,
          extra,
        })
      );
    }

    res.json({ success: true, message: "Feedback submitted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

router.get("/make-payment", async (req, res) => {
  if (!req.session.user || !req.session.user.email) {
    return res.redirect("/admin/login"); // Redirect if not logged in
  }

  try {
    const userEmail = req.session.user.email;

    // Fetch user details from database
    const result = await pool.query(
      "SELECT fullname, email, profile_picture FROM users2 WHERE email = $1",
      [userEmail]
    );

    if (result.rows.length === 0) {
      return res.status(404).send("User not found");
    }

    const user = result.rows[0];

    res.render("payment", {
      title: "Make Payment",
      fullname: user.fullname,
      activePage: "payment", // 👈 Pass active page
      email: user.email,
      profilePic: user.profile_picture || null,
    });
  } catch (err) {
    console.error("Error fetching user for payment:", err);
    res.status(500).send("Server error");
  }
});


router.post("/verify-payment", async (req, res) => {
  const { reference, email, fullName } = req.body;

  try {
    console.log(
      "🔍 Verifying payment with ref:",
      reference,
      "Email:",
      email,
      "Full Name:",
      fullName
    );

    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, // Make sure this is set in your .env file
        },
      }
    );
    console.log("✅ Paystack Response:", response.data);

    const payment = response.data.data;

    if (payment.status === "success") {
      const amount = payment.amount / 100;

      // Save transaction to DB
      await pool.query(
        `INSERT INTO transactions (fullname, email, amount, reference, status)
         VALUES ($1, $2, $3, $4, $5)`,
        [fullName, email, amount, reference, "success"]
      );

      // ✅ Update user's wallet balance
      await pool.query(
        `UPDATE users2 SET wallet_balance2 = wallet_balance2 + $1 WHERE email = $2`,
        [amount, email]
      );

      return res.json({
        success: true,
        message: "Payment verified successfully and wallet updated",
      });
    } else {
      return res
        .status(400)
        .json({ success: false, message: "Payment verification failed" });
    }
  } catch (error) {
    console.error(
      "❌ Error verifying payment:",
      error.response?.data || error.message
    );
    return res.status(500).json({
      success: false,
      message:
        error.response?.data?.message ||
        "Server error during payment verification",
    });
  }
});

router.get("/courses", async (req, res) => {
  const infoResult = await pool.query(
    "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
  );
  const info = infoResult.rows[0] || {};

  const usersResult = await pool.query ("SELECT * FROM users2");
    const users = usersResult.rows;
  const careerPathwaysResult = await pool.query(
    "SELECT * FROM career_pathways ORDER BY title"
  );
  const coursesResult = await pool.query(`
    SELECT courses.*, cp.title AS pathway_name
    FROM courses
    LEFT JOIN career_pathways cp ON cp.id = courses.career_pathway_id
    ORDER BY cp.title ASC, courses.level ASC, sort_order ASC
  `);

  const enrolledCoursesRes = await pool.query(
    `SELECT course_id FROM course_enrollments WHERE user_id = $1`,
    [req.user?.id]
  );
  const enrolledCourseIds = enrolledCoursesRes.rows.map((r) => r.course_id);


  // Grouping courses by pathway and level
  const groupedCourses = {};

  coursesResult.rows.forEach((course) => {
    const pathway = course.pathway_name || "Unassigned";
    const level = course.level || "Unspecified";

    if (!groupedCourses[pathway]) groupedCourses[pathway] = {};
    if (!groupedCourses[pathway][level]) groupedCourses[pathway][level] = [];

    groupedCourses[pathway][level].push(course);
  });

  let walletBalance = 0;
     if (req.session.user) {
       const walletResult = await pool.query(
         "SELECT wallet_balance2 FROM users2 WHERE email = $1",
         [req.session.user.email]
       );
       walletBalance = walletResult.rows[0]?.wallet_balance2 || 0;
     }

   const isLoggedIn = !!req.session.user; // or whatever property you use for login
   const profilePic = req.session.user
     ? req.session.user.profile_picture
     : null;
   console.log("User session:", req.session.user);
   console.log("Is user logged in:", isLoggedIn);

  res.render("userCourses", {
    info,
    users,
    isLoggedIn: !!req.session.user,
    profilePic,
    walletBalance,
    enrolledCourseIds,
    groupedCourses,
    careerPathways: careerPathwaysResult.rows,
    subscribed: req.query.subscribed,
    activePage: "courses", // 👈 Pass active page
  });
});


router.get("/pay-event/:regId", async (req, res) => {
  const { regId } = req.params;

  try {
    const regResult = await pool.query(
      `SELECT r.*, e.title, e.amount, e.image_url, e.event_date, e.discount_deadline, e.discount_amount, e.location
       FROM event_registrations r
       JOIN events e ON r.event_id = e.id
       WHERE r.id = $1`,
      [regId]
    );

    if (regResult.rows.length === 0) {
      return res.status(404).send("Registration not found");
    }

    const reg = regResult.rows[0];
    console.log("Registration details:", reg);

    // ✅ Ensure correct amount is sent to Paystack
    reg.amount_paid = reg.total_amount || reg.amount_paid || e.amount || 0;

    res.render("eventPayment", {
      reg,
      title: "Event Payment",
    });
  } catch (err) {
    console.error("Error loading payment page:", err);
    res.status(500).send("Server error");
  }
});


// =========================
// POST Verify Payment
// =========================


router.post("/verify-event-payment", async (req, res) => {
  const { reference, regId } = req.body;

  try {
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    const payment = response.data.data;
    console.log("Paystack Response:", payment);

    if (payment.status === "success") {
      const amountPaid = payment.amount / 100; // convert from kobo

      // Fetch registration details
      const regResult = await pool.query(
        `SELECT * FROM event_registrations WHERE id = $1`,
        [regId]
      );

      if (regResult.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Registration not found" });
      }

      const reg = regResult.rows[0];
      const totalEventFee =
        reg.total_amount || reg.amount * (reg.num_people || 1);

      // Calculate cumulative amount
      const newTotalPaid = (reg.amount_paid || 0) + amountPaid;
      let paymentStatus = "partial";

      if (newTotalPaid >= totalEventFee) {
        paymentStatus = "completed";
      }

      // Update registration record
      await pool.query(
        `UPDATE event_registrations
         SET amount_paid = $1, payment_status = $2
         WHERE id = $3`,
        [newTotalPaid, paymentStatus, regId]
      );

      return res.json({
        success: true,
        message:
          paymentStatus === "completed"
            ? "Full payment completed"
            : "Partial payment recorded",
        remainingBalance:
          paymentStatus === "partial" ? totalEventFee - newTotalPaid : 0,
      });
    } else {
      return res.json({ success: false, message: "Payment failed" });
    }
  } catch (err) {
    console.error("❌ Error verifying event payment:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});



router.get("/pathways/:id", async (req, res) => {
   const { id } = req.params;

   try {
     // Get company info
     const infoResult = await pool.query(
       "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
     );
     const info = infoResult.rows[0] || {};

     // Get the pathway details
     const pathwayResult = await pool.query(
       "SELECT * FROM career_pathways WHERE id = $1",
       [id]
     );
     const pathway = pathwayResult.rows[0];

     if (!pathway) return res.status(404).send("Pathway not found");

     // Get courses under this pathway, grouped by level
     const courseResult = await pool.query(
       `SELECT * FROM courses 
       WHERE career_pathway_id = $1
       ORDER BY level ASC, sort_order ASC`,
       [id]
     );

      let walletBalance = 0;
      if (req.session.user) {
        const walletResult = await pool.query(
          "SELECT wallet_balance2 FROM users2 WHERE email = $1",
          [req.session.user.email]
        );
        walletBalance = walletResult.rows[0]?.wallet_balance2 || 0;
      }

     const courses = courseResult.rows;

     const groupedCourses = {};
     courses.forEach((course) => {
       const level = course.level || "Unspecified";
       if (!groupedCourses[level]) groupedCourses[level] = [];
       groupedCourses[level].push(course);
     });

     const usersResult = await pool.query("SELECT * FROM users2");
     const users = usersResult.rows;
     const isLoggedIn = !!req.session.user; // or whatever property you use for login
     const profilePic = req.session.user
       ? req.session.user.profile_picture
       : null;
     console.log("User session:", req.session.user);
     console.log("Is user logged in:", isLoggedIn);

     res.render("singlePathway", {
       info,
       users,
       isLoggedIn: !!req.session.user,
       profilePic,
       pathway,
       groupedCourses,
       subscribed: req.query.subscribed,
       walletBalance,
       activePage: "pathway", // 👈 Pass active page
     });
   } catch (err) {
     console.error("❌ Error fetching pathway details:", err.message);
     res.status(500).send("Server error");
   }
});

router.get("/courses/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // Get company info
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0] || {};

    // Get the course details
    const courseResult = await pool.query(
      "SELECT * FROM courses WHERE id = $1",
      [id]
    );
    const course = courseResult.rows[0];

    if (!course) return res.status(404).send("Course not found");

    // Get modules for this course (flat array, not grouped by level)
    const modulesResult = await pool.query(
      `SELECT * FROM modules 
       WHERE course_id = $1
       ORDER BY order_number ASC`,
      [id]
    );

    const modules = modulesResult.rows;

      const enrolledCoursesRes = await pool.query(
        `SELECT course_id FROM course_enrollments WHERE user_id = $1`,
        [req.user?.id]
      );
    const enrolledCourseIds = enrolledCoursesRes.rows.map((r) => r.course_id);
    
    let walletBalance = 0;
    if (req.session.user) {
      const walletResult = await pool.query(
        "SELECT wallet_balance2 FROM users2 WHERE email = $1",
        [req.session.user.email]
      );
      walletBalance = walletResult.rows[0]?.wallet_balance2 || 0;
    }

    const usersResult = await pool.query("SELECT * FROM users2");
    const users = usersResult.rows;
    const isLoggedIn = !!req.session.user;
    const profilePic = req.session.user
      ? req.session.user.profile_picture
      : null;

    res.render("singleCourse", {
      info,
      users,
      isLoggedIn,
      profilePic,
      course,
      enrolledCourseIds,
      walletBalance,
      modules,
      subscribed: req.query.subscribed,
      activePage: "courses", // 👈 Pass active page
    });
  } catch (err) {
    console.error("❌ Error fetching course details:", err.message);
    res.status(500).send("Server error");
  }
});



  module.exports = router;
