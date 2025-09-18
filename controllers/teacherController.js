const pool = require("../models/db");
const userController = require("./userController");

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

    res.render("teacher/classroom-students", {
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

    const progressRes = await pool.query(
      `SELECT l.title AS lesson_title, ulp.completed_at,
              q.title AS quiz_title, qs.score,
              ma.title AS assignment_title, asub.total, asub.grade
       FROM users2 u
       LEFT JOIN user_lesson_progress ulp ON ulp.user_id = u.id
       LEFT JOIN lessons l ON l.id = ulp.lesson_id
       LEFT JOIN quiz_submissions qs ON qs.student_id = u.id
       LEFT JOIN quizzes q ON q.id = qs.quiz_id
       LEFT JOIN assignment_submissions asub ON asub.student_id = u.id
       LEFT JOIN module_assignments ma ON ma.id = asub.assignment_id
       WHERE u.id = $1`,
      [id]
    );

    res.render("teacher/student-progress", {
      studentId: id,
      progress: progressRes.rows,
    });
  } catch (err) {
    console.error("Teacher Student Progress Error:", err);
    res.status(500).send("Error loading progress");
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
