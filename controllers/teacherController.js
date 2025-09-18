const pool = require("../models/db");
const userController = require("./userController");

const puppeteer = require("puppeteer");


// ----------------- DASHBOARD WRAPPER -----------------
exports.getDashboard = (req, res) => {
  // Only render the shell with sidenav + empty main-content
  res.render("teacher/dashboard", { teacher: req.user });
};

// ----------------- DASHBOARD SECTION -----------------
exports.getDashboardSection = async (req, res) => {
  try {
    const teacherId = req.user.id;

    // Get classes
    const classesRes = await pool.query(
      `SELECT c.id, c.name
       FROM classrooms c
       JOIN classroom_teachers ct ON ct.classroom_id = c.id
       WHERE ct.teacher_id = $1`,
      [teacherId]
    );

    const classes = classesRes.rows;
    let classStats = [];

    for (const classroom of classes) {
      const statsRes = await pool.query(
        `SELECT COUNT(DISTINCT u.id) AS total_students,
                COUNT(DISTINCT l.id) AS total_lessons,
                COUNT(DISTINCT ulp.lesson_id) FILTER (WHERE ulp.completed_at IS NOT NULL) AS completed_lessons,
                ROUND(AVG(qs.score))::int AS avg_quiz,
                ROUND(AVG(asub.total))::int AS avg_assignment
         FROM user_school us
         JOIN users2 u ON u.id = us.user_id
         LEFT JOIN classroom_courses cc ON cc.classroom_id = us.classroom_id
         LEFT JOIN courses co ON co.id = cc.course_id
         LEFT JOIN modules m ON m.course_id = co.id
         LEFT JOIN lessons l ON l.module_id = m.id
         LEFT JOIN user_lesson_progress ulp ON ulp.lesson_id = l.id AND ulp.user_id = u.id
         LEFT JOIN quiz_submissions qs ON qs.student_id = u.id
         LEFT JOIN assignment_submissions asub ON asub.student_id = u.id
         WHERE us.classroom_id = $1 AND us.role_in_school = 'student' AND us.approved = true`,
        [classroom.id]
      );

      classStats.push({
        classroom_id: classroom.id,
        classroom_name: classroom.name,
        total_students: statsRes.rows[0].total_students || 0,
        total_lessons: statsRes.rows[0].total_lessons || 0,
        completed_lessons: statsRes.rows[0].completed_lessons || 0,
        avg_quiz: statsRes.rows[0].avg_quiz || "N/A",
        avg_assignment: statsRes.rows[0].avg_assignment || "N/A",
      });
    }

    res.render("teacher/sections/dashboard", { classStats, teacher: req.user });
  } catch (err) {
    console.error("Teacher Dashboard Section Error:", err);
    res.status(500).send("<p>Error loading dashboard section</p>");
  }
};

// ----------------- CLASSES SECTION -----------------
exports.getClassesSection = async (req, res) => {
  try {
    const teacherId = req.user.id;
    const classesRes = await pool.query(
      `SELECT c.id, c.name
       FROM classrooms c
       JOIN classroom_teachers ct ON ct.classroom_id = c.id
       WHERE ct.teacher_id = $1`,
      [teacherId]
    );
    res.render("teacher/sections/classes", { classes: classesRes.rows });
  } catch (err) {
    console.error("Teacher Classes Section Error:", err);
    res.status(500).send("<p>Error loading classes</p>");
  }
};

// ----------------- STUDENTS SECTION -----------------
exports.getStudentsSection = async (req, res) => {
  try {
    const teacherId = req.user.id;
    const studentsRes = await pool.query(
      `SELECT u.id, u.fullname, u.email, c.name AS classroom_name
       FROM user_school us
       JOIN users2 u ON u.id = us.user_id
       JOIN classrooms c ON c.id = us.classroom_id
       JOIN classroom_teachers ct ON ct.classroom_id = us.classroom_id
       WHERE ct.teacher_id = $1 AND us.role_in_school = 'student' AND us.approved = true`,
      [teacherId]
    );
    res.render("teacher/sections/students", { students: studentsRes.rows });
  } catch (err) {
    console.error("Teacher Students Section Error:", err);
    res.status(500).send("<p>Error loading students</p>");
  }
};

// ----------------- REPORTS SECTION -----------------
exports.getReportsSection = async (req, res) => {
  try {
    const teacherId = req.user.id;
    const reportsRes = await pool.query(
      `SELECT u.id, u.fullname, u.email, c.name AS classroom_name
       FROM user_school us
       JOIN users2 u ON u.id = us.user_id
       JOIN classrooms c ON c.id = us.classroom_id
       JOIN classroom_teachers ct ON ct.classroom_id = us.classroom_id
       WHERE ct.teacher_id = $1 AND us.role_in_school = 'student' AND us.approved = true`,
      [teacherId]
    );
    res.render("teacher/sections/reports", { students: reportsRes.rows });
  } catch (err) {
    console.error("Teacher Reports Section Error:", err);
    res.status(500).send("<p>Error loading reports</p>");
  }
};

// ----------------- STUDENT PROGRESS (standalone) -----------------
// ----------------- CLASSROOM STUDENTS -----------------
exports.viewClassroomStudents = async (req, res) => {
  try {
    const { id } = req.params; // classroomId
    const teacherId = req.user.id;

    // Check if teacher is assigned to this class
    const checkRes = await pool.query(
      `SELECT 1 FROM classroom_teachers WHERE classroom_id = $1 AND teacher_id = $2`,
      [id, teacherId]
    );
    if (checkRes.rowCount === 0) {
      return res.status(403).send("Not authorized to view this class");
    }

    // Fetch students
    const studentsRes = await pool.query(
      `SELECT u.id, u.fullname, u.email
       FROM user_school us
       JOIN users2 u ON u.id = us.user_id
       WHERE us.classroom_id = $1
         AND us.role_in_school = 'student'
         AND us.approved = true`,
      [id]
    );

    res.render("teacher/sections/classroom-students", {
      students: studentsRes.rows,
      classroomId: id,
    });
  } catch (err) {
    console.error("Teacher Classroom Students Error:", err);
    res.status(500).send("Error loading students");
  }
};

// ----------------- STUDENT PROGRESS -----------------

exports.viewStudentProgress = async (req, res) => {
  try {
    const { id } = req.params; // studentId
    const teacherId = req.user.id;

    // ✅ Ensure teacher is authorized for this student via classroom
    const checkRes = await pool.query(
      `SELECT 1
       FROM user_school us
       JOIN classroom_teachers ct ON ct.classroom_id = us.classroom_id
       WHERE us.user_id = $1 AND ct.teacher_id = $2`,
      [id, teacherId]
    );

    if (checkRes.rowCount === 0) {
      return res.status(403).send("Not authorized to view this student");
    }

    // ✅ Student info
    const studentRes = await pool.query(
      `SELECT id, fullname, email FROM users2 WHERE id = $1`,
      [id]
    );
    if (!studentRes.rows.length) {
      return res.status(404).send("Student not found");
    }
    const student = studentRes.rows[0];

    // ✅ Courses for this student (via classroom_courses + teacher tie)
    const coursesRes = await pool.query(
      `SELECT DISTINCT 
      c.id, 
      c.title AS course_title, 
      cc.assigned_at
   FROM classroom_courses cc
   JOIN courses c ON c.id = cc.course_id
   JOIN classroom_teachers ct ON ct.classroom_id = cc.classroom_id
   JOIN user_school us ON us.classroom_id = cc.classroom_id
   WHERE us.user_id = $1
     AND ct.teacher_id = $2
   ORDER BY c.title`,
      [id, teacherId]
    );

    if (!coursesRes.rows.length) {
      return res.render("teacher/sections/student-progress", {
        student,
        courses: [],
      });
    }

    const courseIds = coursesRes.rows.map((c) => c.id);

    // ✅ Modules
    const modulesRes = await pool.query(
      `SELECT id, title AS module_title, course_id
       FROM modules
       WHERE course_id = ANY($1::int[])
       ORDER BY order_number`,
      [courseIds]
    );

    // ✅ Lessons
    const lessonsRes = await pool.query(
      `SELECT l.id, l.title, l.module_id,
              CASE WHEN ulp.completed_at IS NOT NULL THEN true ELSE false END AS completed
       FROM lessons l
       LEFT JOIN user_lesson_progress ulp
              ON ulp.lesson_id = l.id AND ulp.user_id = $1
       WHERE l.module_id = ANY(SELECT id FROM modules WHERE course_id = ANY($2::int[]))
       ORDER BY l.order_number`,
      [id, courseIds]
    );

    // ✅ Quizzes (note: no module_id column → derive via lessons)
    const quizzesRes = await pool.query(
      `SELECT q.id, q.title, l.module_id, l.id AS lesson_id,
            COALESCE(qs.score, NULL) AS score
      FROM quizzes q
      JOIN lessons l ON q.lesson_id = l.id
      LEFT JOIN quiz_submissions qs
            ON qs.quiz_id = q.id AND qs.student_id = $1
      WHERE l.module_id = ANY(SELECT id FROM modules WHERE course_id = ANY($2::int[]))
      ORDER BY q.id
`,
      [id, courseIds]
    );

    // ✅ Module Assignments
    const assignmentsRes = await pool.query(
      `SELECT ma.id, ma.title, ma.module_id,
              COALESCE(asub.grade, NULL) AS grade,
              COALESCE(asub.total, NULL) AS total
       FROM module_assignments ma
       LEFT JOIN assignment_submissions asub
              ON asub.assignment_id = ma.id AND asub.student_id = $1
       WHERE ma.module_id = ANY(SELECT id FROM modules WHERE course_id = ANY($2::int[]))
       ORDER BY ma.id`,
      [id, courseIds]
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

        const totalLessons = moduleLessons.length;
        const completedLessons = moduleLessons.filter(
          (l) => l.completed
        ).length;
        const modulePercent = totalLessons
          ? Math.round((completedLessons / totalLessons) * 100)
          : 0;

        const moduleQuizzes = quizzesRes.rows.filter(
          (q) => q.module_id === module.id
        );
        const moduleAssignments = assignmentsRes.rows.filter(
          (a) => a.module_id === module.id
        );

        return {
          ...module,
          lessons: moduleLessons,
          totalLessons,
          completedLessons,
          percent: modulePercent,
          quizzes: moduleQuizzes,
          assignments: moduleAssignments,
        };
      });

      // Course-level progress
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

    // ✅ Render
    res.render("teacher/sections/student-progress", {
      student,
      courses,
    });
  } catch (err) {
    console.error("Teacher Student Progress Error:", err);
    res.status(500).send("Error loading progress");
  }
};


// exports.downloadQuizReport = async (req, res) => {
//   // const { quizId } = req.params;
//   // const studentId = req.user.role === "student" ? req.user.id : req.query.studentId; // adjust as needed
//   const { studentId, quizId } = req.params;

//   try {
    
//     // --- Student info
//     const studentRes = await pool.query(
//       `SELECT id, fullname, email FROM users2 WHERE id = $1`,
//       [studentId]
//     );
//     if (!studentRes.rows.length)
//       return res.status(404).send("Student not found");
//     const student = studentRes.rows[0];

//     // --- Quiz info + lesson/module/course
//     const quizRes = await pool.query(
//       `SELECT q.id, q.title AS quiz_title, l.title AS lesson_title, 
//               m.title AS module_title, c.title AS course_title
//        FROM quizzes q
//        JOIN lessons l ON q.lesson_id = l.id
//        JOIN modules m ON l.module_id = m.id
//        JOIN courses c ON m.course_id = c.id
//        WHERE q.id = $1`,
//       [quizId]
//     );
//     if (!quizRes.rows.length) return res.status(404).send("Quiz not found");
//     const quiz = quizRes.rows[0];

//     // --- Submission info
//     const submissionRes = await pool.query(
//       `SELECT id, score, created_at, review_data
//    FROM quiz_submissions
//    WHERE quiz_id = $1 AND student_id = $2
//    ORDER BY created_at DESC LIMIT 1`,
//       [quizId, studentId]
//     );
//     const submission = submissionRes.rows[0];

//     // Parse review_data
//     let reviewData = [];
//     if (submission && submission.review_data) {
//       try {
//         reviewData = JSON.parse(submission.review_data);
//       } catch (e) {
//         reviewData = [];
//       }
//     }

//     // Calculate stats
//     const totalQuestions = reviewData.length;
//     const answeredCount = reviewData.filter(
//       (r) => r.yourAnswer && r.yourAnswer.trim() !== ""
//     ).length;
//     const correctCount = reviewData.filter((r) => r.isCorrect).length;
//     const wrongCount = answeredCount - correctCount;

//     const html = `
//   <html>
//     <head>
//       <style>
//         body { font-family: Arial, sans-serif; padding: 30px; color: #2c3e50; }
//         h1 { text-align: center; color: #34495e; }
//         h2 { margin-top: 30px; color: #2980b9; border-bottom: 2px solid #ddd; padding-bottom: 5px; }
//         .meta { margin: 20px 0; padding: 10px; background: #ecf0f1; border-radius: 8px; }
//         table { width: 100%; border-collapse: collapse; margin: 15px 0; }
//         th, td { border: 1px solid #ddd; padding: 8px; font-size: 12px; vertical-align: top; }
//         th { background: #2c3e50; color: white; text-align: left; }
//         tr:nth-child(even) { background: #f9f9f9; }
//         .correct { color: #28a745; font-weight: bold; } /* green text */
//         .wrong { color: #dc3545; font-weight: bold; }   /* red text */
//         .footer { margin-top: 30px; font-size: 10px; text-align: center; color: gray; }
//       </style>
//     </head>
//     <body>
//       <h1>📝 Quiz Report</h1>
//       <p style="text-align:center; color: gray;">Generated on: ${new Date().toLocaleString()}</p>

//       <div class="meta">
//         <h2>👤 Student</h2>
//         <p><strong>Name:</strong> ${student.fullname}</p>
//         <p><strong>Email:</strong> ${student.email}</p>
//       </div>

//       <div class="meta">
//         <h2>📚 Course Info</h2>
//         <p><strong>Course:</strong> ${quiz.course_title}</p>
//         <p><strong>Module:</strong> ${quiz.module_title}</p>
//         <p><strong>Lesson:</strong> ${quiz.lesson_title}</p>
//         <p><strong>Quiz:</strong> ${quiz.quiz_title}</p>
//       </div>

//       <div class="meta">
//         <h2>📊 Quiz Result</h2>
//         <p><strong>Score:</strong> ${submission ? submission.score : "N/A"}</p>
//         <p><strong>Date:</strong> ${
//           submission
//             ? new Date(submission.created_at).toLocaleString()
//             : "Not taken"
//         }</p>
//         <p><strong>Answered:</strong> ${answeredCount}/${totalQuestions}</p>
//         <p><strong>Correct:</strong> ${correctCount}</p>
//         <p><strong>Wrong:</strong> ${wrongCount}</p>
//       </div>

//       ${
//         reviewData.length
//           ? `
//           <h2>📄 Answers</h2>
//           <table>
//             <tr>
//               <th>Question</th>
//               <th>Your Answer</th>
//               <th>Correct Answer</th>
//               <th>AI Feedback</th>
//             </tr>
//             ${reviewData
//               .map(
//                 (r) => `
//                 <tr>
//                   <td>${r.question}</td>
//                   <td class="${r.isCorrect ? "correct" : "wrong"}">
//                     ${r.yourAnswer || "—"}
//                   </td>
//                   <td>${r.correctAnswer}</td>
//                   <td>${r.feedback || ""}</td>
//                 </tr>`
//               )
//               .join("")}
//           </table>
//         `
//           : "<p>No answers recorded.</p>"
//       }

//       <div class="footer">© ${new Date().getFullYear()} Quiz Report</div>
//     </body>
//   </html>
// `;

//     // --- Generate PDF
//     const browser = await puppeteer.launch({
//       headless: true,
//       args: ["--no-sandbox", "--disable-setuid-sandbox"],
//     });
//     const page = await browser.newPage();
//     await page.setContent(html, { waitUntil: "networkidle0" });
//     const pdfBuffer = await page.pdf({ format: "A4", printBackground: true });
//     await browser.close();

//     // When sending PDF, include student name in filename
//     res.setHeader(
//       "Content-Disposition",
//       `attachment; filename=${student.fullname.replace(/\s+/g, "_")}_${
//         quiz.lesson_title
//       }_Quiz_Report.pdf`
//     );
//     // --- Send
//     // res.setHeader(
//     //   "Content-Disposition",
//     //   `attachment; filename=quiz_${quizId}_report.pdf`
//     // );
//     res.setHeader("Content-Type", "application/pdf");
//     res.send(pdfBuffer);
//   } catch (err) {
//     console.error("Quiz PDF Error:", err);
//     res.status(500).send("Error generating quiz report");
//   }
// };

exports.downloadQuizReport = async (req, res) => {
  const { studentId, quizId } = req.params;

  try {
    // --- Company Info
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0] || {};

    // --- Student + School info
    const studentRes = await pool.query(
      `SELECT u.id, u.fullname, u.email, 
              s.id AS school_id, s.name AS school_name, s.logo_url AS school_logo
       FROM users2 u
       LEFT JOIN user_school us ON u.id = us.user_id
       LEFT JOIN schools s ON us.school_id = s.id
       WHERE u.id = $1
       LIMIT 1`,
      [studentId]
    );
    if (!studentRes.rows.length)
      return res.status(404).send("Student not found");

    const student = studentRes.rows[0];

    // --- Quiz info + lesson/module/course
    const quizRes = await pool.query(
      `SELECT q.id, q.title AS quiz_title, l.title AS lesson_title, 
              m.title AS module_title, c.title AS course_title
       FROM quizzes q
       JOIN lessons l ON q.lesson_id = l.id
       JOIN modules m ON l.module_id = m.id
       JOIN courses c ON m.course_id = c.id
       WHERE q.id = $1`,
      [quizId]
    );
    if (!quizRes.rows.length) return res.status(404).send("Quiz not found");
    const quiz = quizRes.rows[0];

    // --- Submission info
    const submissionRes = await pool.query(
      `SELECT id, score, created_at, review_data
       FROM quiz_submissions
       WHERE quiz_id = $1 AND student_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [quizId, studentId]
    );
    const submission = submissionRes.rows[0];

    // Parse review_data
    let reviewData = [];
    if (submission && submission.review_data) {
      try {
        reviewData = JSON.parse(submission.review_data);
      } catch (e) {
        reviewData = [];
      }
    }

    // Calculate stats
    const totalQuestions = reviewData.length;
    const answeredCount = reviewData.filter(
      (r) => r.yourAnswer && r.yourAnswer.trim() !== ""
    ).length;
    const correctCount = reviewData.filter((r) => r.isCorrect).length;
    const wrongCount = answeredCount - correctCount;

    // --- Build HTML
    const html = `
  <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; padding: 30px; color: #2c3e50; }
        .header { text-align: center; margin-bottom: 30px; }
        .header img { max-height: 80px; margin: 0 10px; vertical-align: middle; }
        .header h1 { margin: 5px 0; color: #2c3e50; }
        .header h2 { margin: 0; font-size: 16px; color: #555; }
        h2 { margin-top: 30px; color: #2980b9; border-bottom: 2px solid #ddd; padding-bottom: 5px; }
        .meta { margin: 20px 0; padding: 10px; background: #ecf0f1; border-radius: 8px; }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; font-size: 12px; vertical-align: top; }
        th { background: #2c3e50; color: white; text-align: left; }
        tr:nth-child(even) { background: #f9f9f9; }
        .correct { color: #28a745; font-weight: bold; } /* green text */
        .wrong { color: #dc3545; font-weight: bold; }   /* red text */
        .footer { margin-top: 30px; font-size: 10px; text-align: center; color: gray; }
      </style>
    </head>
    <body>
      <div class="header">
        ${
          info.logo_url ? `<img src="${info.logo_url}" alt="Company Logo">` : ""
        }
        ${
          student.school_logo
            ? `<img src="${student.school_logo}" alt="School Logo">`
            : ""
        }
        <h1>${info.company_name || "Our Company"}</h1>
        <h2>${student.school_name || "Unknown School"}</h2>
      </div>

      <h1>📝 Quiz Report</h1>
      <p style="text-align:center; color: gray;">Generated on: ${new Date().toLocaleString()}</p>

      <div class="meta">
        <h2>👤 Student</h2>
        <p><strong>Name:</strong> ${student.fullname}</p>
        <p><strong>Email:</strong> ${student.email}</p>
      </div>

      <div class="meta">
        <h2>📚 Course Info</h2>
        <p><strong>Course:</strong> ${quiz.course_title}</p>
        <p><strong>Module:</strong> ${quiz.module_title}</p>
        <p><strong>Lesson:</strong> ${quiz.lesson_title}</p>
        <p><strong>Quiz:</strong> ${quiz.quiz_title}</p>
      </div>

      <div class="meta">
        <h2>📊 Quiz Result</h2>
        <p><strong>Score:</strong> ${submission ? submission.score : "N/A"}</p>
        <p><strong>Date:</strong> ${
          submission
            ? new Date(submission.created_at).toLocaleString()
            : "Not taken"
        }</p>
        <p><strong>Answered:</strong> ${answeredCount}/${totalQuestions}</p>
        <p><strong>Correct:</strong> ${correctCount}</p>
        <p><strong>Wrong:</strong> ${wrongCount}</p>
      </div>

      ${
        reviewData.length
          ? `
          <h2>📄 Answers</h2>
          <table>
            <tr>
              <th>Question</th>
              <th>Your Answer</th>
              <th>Correct Answer</th>
              <th>AI Feedback</th>
            </tr>
            ${reviewData
              .map(
                (r) => `
                <tr>
                  <td>${r.question}</td>
                  <td class="${r.isCorrect ? "correct" : "wrong"}">
                    ${r.yourAnswer || "—"}
                  </td>
                  <td>${r.correctAnswer}</td>
                  <td>${r.feedback || ""}</td>
                </tr>`
              )
              .join("")}
          </table>
        `
          : "<p>No answers recorded.</p>"
      }

      <div class="footer">© ${new Date().getFullYear()} ${
      info.company_name || "Company"
    } Quiz Report</div>
    </body>
  </html>
`;

    // --- Generate PDF
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({ format: "A4", printBackground: true });
    await browser.close();

    // --- File name with student + quiz
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${student.fullname.replace(/\s+/g, "_")}_${
        quiz.lesson_title
      }_Quiz_Report.pdf`
    );
    res.setHeader("Content-Type", "application/pdf");
    res.send(pdfBuffer);
  } catch (err) {
    console.error("Quiz PDF Error:", err);
    res.status(500).send("Error generating quiz report");
  }
};



// ----------------- DOWNLOAD REPORT -----------------
exports.downloadStudentReport = async (req, res) => {
  try {
    const { id } = req.params; // studentId
    const teacherId = req.user.id;

    // Authorization check
    const checkRes = await pool.query(
      `SELECT 1
       FROM user_school us
       JOIN classroom_teachers ct ON ct.classroom_id = us.classroom_id
       WHERE us.user_id = $1 AND ct.teacher_id = $2`,
      [id, teacherId]
    );
    if (checkRes.rowCount === 0) {
      return res.status(403).send("Not authorized");
    }

    // Reuse your existing userController PDF function
    return userController.downloadCourseSummary(req, res);
  } catch (err) {
    console.error("Teacher Report Download Error:", err);
    res.status(500).send("Error generating report");
  }
};
