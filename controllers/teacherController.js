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

    // ✅ Teacher profile
    const profileRes = await pool.query(
      `SELECT fullname, email, profile_picture
       FROM users2 
       WHERE id = $1`,
      [teacherId]
    );
    const profile = profileRes.rows[0] || {};

    // ✅ Key stats (with last_activity)
    const statsRes = await pool.query(
      `WITH last_activity AS (
         SELECT user_id, MAX(created_at) AS last_login
         FROM activities
         GROUP BY user_id
       )
       SELECT 
          COUNT(DISTINCT ct.classroom_id) AS total_classes,
          COUNT(DISTINCT s.id) AS total_students,
          COUNT(DISTINCT l.id) AS total_lessons,
          COUNT(DISTINCT ulp.lesson_id) FILTER (WHERE ulp.completed_at IS NOT NULL) AS lessons_completed,
          ROUND(
            (COUNT(DISTINCT ulp.lesson_id) FILTER (WHERE ulp.completed_at IS NOT NULL)::numeric / 
             NULLIF(COUNT(DISTINCT l.id), 0)) * 100, 1
          ) AS lesson_progress,
          ROUND(AVG(qs.score::numeric),1) AS avg_quiz_score,
          ROUND(AVG(asub.grade::numeric),1) AS avg_assignment_score,
          ROUND(
            (COUNT(DISTINCT u.id) FILTER (WHERE la.last_login >= NOW() - INTERVAL '7 days')
            * 100.0 / NULLIF(COUNT(DISTINCT u.id),0))::numeric, 1
          ) AS engagement_last7

       FROM classroom_teachers ct
       JOIN user_school s 
         ON ct.classroom_id = s.classroom_id 
        AND s.role_in_school = 'student' 
        AND s.approved = true
       JOIN users2 u ON u.id = s.user_id
       LEFT JOIN last_activity la ON la.user_id = u.id
       LEFT JOIN classroom_courses cc ON ct.classroom_id = cc.classroom_id
       LEFT JOIN courses cr ON cc.course_id = cr.id
       LEFT JOIN modules m ON cr.id = m.course_id
       LEFT JOIN lessons l ON m.id = l.module_id
       LEFT JOIN user_lesson_progress ulp 
         ON ulp.user_id = u.id AND ulp.lesson_id = l.id
       LEFT JOIN quiz_submissions qs ON qs.student_id = u.id
       LEFT JOIN assignment_submissions asub ON asub.student_id = u.id
       WHERE ct.teacher_id = $1
       GROUP BY ct.teacher_id`,
      [teacherId]
    );
    const keyStats = statsRes.rows[0] || {};

    // ✅ Class overview
    const classStatsRes = await pool.query(
      `WITH last_activity AS (
         SELECT user_id, MAX(created_at) AS last_login
         FROM activities
         GROUP BY user_id
       )
       SELECT 
          c.id, 
          c.name AS class_name,
          COUNT(DISTINCT s.id) AS students,
          COUNT(DISTINCT l.id) AS total_lessons,
          COUNT(DISTINCT ulp.lesson_id) FILTER (WHERE ulp.completed_at IS NOT NULL) AS lessons_completed,
          ROUND(AVG(qs.score::numeric),1) AS avg_quiz_score,
          ROUND(AVG(asub.grade::numeric),1) AS avg_assignment_score,
          ROUND(
            (COUNT(DISTINCT u.id) FILTER (WHERE la.last_login >= NOW() - INTERVAL '7 days')
            * 100.0 / NULLIF(COUNT(DISTINCT u.id),0))::numeric, 1
          ) AS engagement

       FROM classrooms c
       JOIN classroom_teachers ct ON c.id = ct.classroom_id
       JOIN user_school s ON s.classroom_id = c.id 
                          AND s.role_in_school = 'student' 
                          AND s.approved = true
       JOIN users2 u ON u.id = s.user_id
       LEFT JOIN last_activity la ON la.user_id = u.id
       LEFT JOIN classroom_courses cc ON c.id = cc.classroom_id
       LEFT JOIN courses cr ON cc.course_id = cr.id
       LEFT JOIN modules m ON cr.id = m.course_id
       LEFT JOIN lessons l ON l.module_id = m.id
       LEFT JOIN user_lesson_progress ulp ON ulp.user_id = u.id AND ulp.lesson_id = l.id
       LEFT JOIN quiz_submissions qs ON qs.student_id = u.id
       LEFT JOIN assignment_submissions asub ON asub.student_id = u.id
       WHERE ct.teacher_id = $1
       GROUP BY c.id, c.name
       ORDER BY c.name`,
      [teacherId]
    );
    const classStats = classStatsRes.rows;

    // ✅ Student snapshots
    const topStudentsRes = await pool.query(
      `SELECT u.id, u.fullname, ROUND(AVG(qs.score::numeric),1) AS avg_score
       FROM users2 u
       JOIN quiz_submissions qs ON qs.student_id = u.id
       WHERE u.id IN (
         SELECT us.user_id
         FROM user_school us
         JOIN classroom_teachers ct ON ct.classroom_id = us.classroom_id
         WHERE ct.teacher_id = $1 AND us.role_in_school='student'
       )
       GROUP BY u.id
       ORDER BY avg_score DESC NULLS LAST
       LIMIT 3`,
      [teacherId]
    );
    const topStudents = topStudentsRes.rows;

    const strugglingStudentsRes = await pool.query(
      `SELECT u.id, u.fullname,
              COUNT(ulp.lesson_id) FILTER (WHERE ulp.completed_at IS NOT NULL) AS lessons_done
       FROM users2 u
       JOIN user_school us ON us.user_id = u.id
       LEFT JOIN user_lesson_progress ulp ON ulp.user_id = u.id
       WHERE us.classroom_id IN (
         SELECT classroom_id FROM classroom_teachers WHERE teacher_id = $1
       )
       AND us.role_in_school = 'student'
       GROUP BY u.id
       ORDER BY lessons_done ASC NULLS FIRST
       LIMIT 3`,
      [teacherId]
    );
    const strugglingStudents = strugglingStudentsRes.rows;

    const pendingAssignmentsRes = await pool.query(
      `SELECT COUNT(asub.*) AS pending_assignments
   FROM assignment_submissions asub
   JOIN module_assignments ma ON ma.id = asub.assignment_id
   JOIN modules m ON m.id = ma.module_id
   JOIN courses cr ON cr.id = m.course_id
   JOIN classroom_courses cc ON cc.course_id = cr.id
   JOIN classroom_teachers ct ON ct.classroom_id = cc.classroom_id
   WHERE ct.teacher_id = $1
     AND asub.grade IS NULL`,
      [teacherId]
    );

    const pendingAssignments =
      pendingAssignmentsRes.rows[0]?.pending_assignments || 0;

    // ✅ Render dashboard section
    res.render("teacher/sections/dashboard", {
      profile,
      keyStats,
      classStats,
      topStudents,
      strugglingStudents,
      pendingAssignments,
      teacher: req.user,
    });
  } catch (err) {
    console.error("Teacher Dashboard Section Error:", err);
    res.status(500).send("<p>Error loading dashboard section</p>");
  }
};


exports.getDashboardData = async (req, res) => {
  try {
    const teacherId = req.user.id;
    const { classId } = req.query;

    let classFilter = "";
    const params = [teacherId];

    if (classId && classId !== "all") {
      params.push(classId);
      classFilter = ` AND ct.classroom_id = $2 `;
    }

     const profileRes = await pool.query(
       `SELECT fullname, email, profile_picture
       FROM users2 
       WHERE id = $1`,
       [teacherId]
     );
     const profile = profileRes.rows[0] || {};

    // ✅ Key Stats (with filter)
    const statsRes = await pool.query(
      `WITH last_activity AS (
         SELECT user_id, MAX(created_at) AS last_login
         FROM activities GROUP BY user_id
       )
       SELECT 
          COUNT(DISTINCT ct.classroom_id) AS total_classes,
          COUNT(DISTINCT s.id) AS total_students,
          COUNT(DISTINCT l.id) AS total_lessons,
          COUNT(DISTINCT ulp.lesson_id) FILTER (WHERE ulp.completed_at IS NOT NULL) AS lessons_completed,
          ROUND(AVG(qs.score::numeric),1) AS avg_quiz_score,
          ROUND(AVG(asub.grade::numeric),1) AS avg_assignment_score,
          ROUND(
            (COUNT(DISTINCT u.id) FILTER (WHERE la.last_login >= NOW() - INTERVAL '7 days')
             * 100.0 / NULLIF(COUNT(DISTINCT u.id),0))::numeric, 1
          ) AS engagement_last7
       FROM classroom_teachers ct
       JOIN user_school s ON ct.classroom_id = s.classroom_id 
                          AND s.role_in_school = 'student' 
                          AND s.approved = true
       JOIN users2 u ON u.id = s.user_id
       LEFT JOIN last_activity la ON la.user_id = u.id
       LEFT JOIN classroom_courses cc ON ct.classroom_id = cc.classroom_id
       LEFT JOIN courses cr ON cc.course_id = cr.id
       LEFT JOIN modules m ON cr.id = m.course_id
       LEFT JOIN lessons l ON l.module_id = m.id
       LEFT JOIN user_lesson_progress ulp ON ulp.user_id = u.id AND ulp.lesson_id = l.id
       LEFT JOIN quiz_submissions qs ON qs.student_id = u.id
       LEFT JOIN assignment_submissions asub ON asub.student_id = u.id
       WHERE ct.teacher_id = $1 ${classFilter}
       GROUP BY ct.teacher_id`,
      params
    );
    const keyStats = statsRes.rows[0] || {};

    // ✅ Class overview
    const classStatsRes = await pool.query(
      `WITH last_activity AS (
         SELECT user_id, MAX(created_at) AS last_login
         FROM activities GROUP BY user_id
       )
       SELECT 
          c.id, 
          c.name AS class_name,
          COUNT(DISTINCT s.id) AS students,
          COUNT(DISTINCT l.id) AS total_lessons,
          COUNT(DISTINCT ulp.lesson_id) FILTER (WHERE ulp.completed_at IS NOT NULL) AS lessons_completed,
          ROUND(AVG(qs.score::numeric),1) AS avg_quiz_score,
          ROUND(AVG(asub.grade::numeric),1) AS avg_assignment_score,
          ROUND(
            (COUNT(DISTINCT u.id) FILTER (WHERE la.last_login >= NOW() - INTERVAL '7 days')
             * 100.0 / NULLIF(COUNT(DISTINCT u.id),0))::numeric, 1
          ) AS engagement
       FROM classrooms c
       JOIN classroom_teachers ct ON c.id = ct.classroom_id
       JOIN user_school s ON s.classroom_id = c.id 
                          AND s.role_in_school = 'student' 
                          AND s.approved = true
       JOIN users2 u ON u.id = s.user_id
       LEFT JOIN last_activity la ON la.user_id = u.id
       LEFT JOIN classroom_courses cc ON c.id = cc.classroom_id
       LEFT JOIN courses cr ON cc.course_id = cr.id
       LEFT JOIN modules m ON cr.id = m.course_id
       LEFT JOIN lessons l ON l.module_id = m.id
       LEFT JOIN user_lesson_progress ulp ON ulp.user_id = u.id AND ulp.lesson_id = l.id
       LEFT JOIN quiz_submissions qs ON qs.student_id = u.id
       LEFT JOIN assignment_submissions asub ON asub.student_id = u.id
       WHERE ct.teacher_id = $1 ${classFilter}
       GROUP BY c.id, c.name
       ORDER BY c.name`,
      params
    );
    const classStats = classStatsRes.rows;

    // ✅ Top students
    const topStudentsRes = await pool.query(
      `SELECT u.id, u.fullname, ROUND(AVG(qs.score::numeric),1) AS avg_score
       FROM users2 u
       JOIN quiz_submissions qs ON qs.student_id = u.id
       WHERE u.id IN (
         SELECT us.user_id
         FROM user_school us
         JOIN classroom_teachers ct ON ct.classroom_id = us.classroom_id
         WHERE ct.teacher_id = $1 ${classFilter}
           AND us.role_in_school = 'student'
       )
       GROUP BY u.id
       ORDER BY avg_score DESC NULLS LAST
       LIMIT 3`,
      params
    );
    const topStudents = topStudentsRes.rows;

    // ✅ Struggling students
    const strugglingStudentsRes = await pool.query(
      `SELECT u.id, u.fullname,
              COUNT(ulp.lesson_id) FILTER (WHERE ulp.completed_at IS NOT NULL) AS lessons_done
       FROM users2 u
       JOIN user_school us ON us.user_id = u.id
       LEFT JOIN user_lesson_progress ulp ON ulp.user_id = u.id
       WHERE us.classroom_id IN (
         SELECT classroom_id FROM classroom_teachers WHERE teacher_id = $1 ${classFilter}
       )
       AND us.role_in_school = 'student'
       GROUP BY u.id
       ORDER BY lessons_done ASC NULLS FIRST
       LIMIT 3`,
      params
    );
    const strugglingStudents = strugglingStudentsRes.rows;

    // ✅ Pending assignments
    const pendingAssignmentsRes = await pool.query(
      `SELECT COUNT(asub.*) AS pending_assignments
       FROM assignment_submissions asub
       JOIN module_assignments ma ON ma.id = asub.assignment_id
       JOIN modules m ON m.id = ma.module_id
       JOIN courses cr ON cr.id = m.course_id
       JOIN classroom_courses cc ON cc.course_id = cr.id
       JOIN classroom_teachers ct ON ct.classroom_id = cc.classroom_id
       WHERE ct.teacher_id = $1 ${classFilter}
         AND asub.grade IS NULL`,
      params
    );
    const pendingAssignments =
      pendingAssignmentsRes.rows[0]?.pending_assignments || 0;

    // ✅ Render *only* the inner content of dashboard
    res.render("teacher/sections/dashboard", {
      keyStats,
      classStats,
      topStudents,
      strugglingStudents,
      pendingAssignments,
      profile,
    });
  } catch (err) {
    console.error("Dashboard Data Error:", err);
    res.status(500).send("<p>Error loading dashboard data</p>");
  }
};



// ----------------- CLASSES SECTION -----------------
// exports.getClassesSection = async (req, res) => {
//   try {
//     const teacherId = req.user.id;
//     const classesRes = await pool.query(
//       `SELECT c.id, c.name
//        FROM classrooms c
//        JOIN classroom_teachers ct ON ct.classroom_id = c.id
//        WHERE ct.teacher_id = $1`,
//       [teacherId]
//     );
//     res.render("teacher/sections/classes", { classes: classesRes.rows });
//   } catch (err) {
//     console.error("Teacher Classes Section Error:", err);
//     res.status(500).send("<p>Error loading classes</p>");
//   }
// };

exports.getClassesSection = async (req, res) => {
  try {
    const teacherId = req.user.id;

    // Fetch teacher's classes
    const classesRes = await pool.query(
      `SELECT c.id, c.name
       FROM classrooms c
       JOIN classroom_teachers ct ON ct.classroom_id = c.id
       WHERE ct.teacher_id = $1`,
      [teacherId]
    );
    const classes = classesRes.rows;

    // Students per class
    const studentCountsRes = await pool.query(
      `SELECT c.id, c.name, COUNT(us.user_id) AS student_count
       FROM classrooms c
       JOIN classroom_teachers ct ON ct.classroom_id = c.id
       LEFT JOIN user_school us 
         ON us.classroom_id = c.id 
        AND us.role_in_school = 'student' 
        AND us.approved = true
       WHERE ct.teacher_id = $1
       GROUP BY c.id, c.name
       ORDER BY c.name`,
      [teacherId]
    );

    // Avg quiz score per class
    const quizScoresRes = await pool.query(
      `SELECT c.id, c.name, ROUND(AVG(qs.score::numeric),1) AS avg_quiz_score
       FROM classrooms c
       JOIN classroom_teachers ct ON ct.classroom_id = c.id
       LEFT JOIN user_school us 
         ON us.classroom_id = c.id 
        AND us.role_in_school = 'student' 
        AND us.approved = true
       LEFT JOIN quiz_submissions qs ON qs.student_id = us.user_id
       WHERE ct.teacher_id = $1
       GROUP BY c.id, c.name
       ORDER BY c.name`,
      [teacherId]
    );

    // Gender distribution (all students across teacher's classes)
    const genderRes = await pool.query(
      `SELECT u.gender, COUNT(*) AS count
       FROM classrooms c
       JOIN classroom_teachers ct ON ct.classroom_id = c.id
       JOIN user_school us ON us.classroom_id = c.id 
                          AND us.role_in_school = 'student' 
                          AND us.approved = true
       JOIN users2 u ON u.id = us.user_id
       WHERE ct.teacher_id = $1
       GROUP BY u.gender`,
      [teacherId]
    );

    // ✅ Total lessons across all teacher’s classes
    const lessonsRes = await pool.query(
      `SELECT COUNT(l.id) AS total_lessons
       FROM lessons l
       JOIN modules m ON m.id = l.module_id
       JOIN courses co ON co.id = m.course_id
       JOIN classroom_courses cc ON cc.course_id = co.id
       JOIN classrooms c ON c.id = cc.classroom_id
       JOIN classroom_teachers ct ON ct.classroom_id = c.id
       WHERE ct.teacher_id = $1`,
      [teacherId]
    );

    // ✅ Lessons per class
    const lessonsPerClassRes = await pool.query(
      `SELECT c.id, c.name, COUNT(l.id) AS lesson_count
       FROM classrooms c
       JOIN classroom_teachers ct ON ct.classroom_id = c.id
       LEFT JOIN classroom_courses cc ON cc.classroom_id = c.id
       LEFT JOIN courses co ON co.id = cc.course_id
       LEFT JOIN modules m ON m.course_id = co.id
       LEFT JOIN lessons l ON l.module_id = m.id
       WHERE ct.teacher_id = $1
       GROUP BY c.id, c.name
       ORDER BY c.name`,
      [teacherId]
    );

    // === Build overview ===
    const totalClasses = classes.length;
    const totalStudents = studentCountsRes.rows.reduce(
      (sum, c) => sum + parseInt(c.student_count || 0),
      0
    );
    const avgQuizScore = quizScoresRes.rows.length
      ? (
          quizScoresRes.rows.reduce(
            (sum, c) => sum + (parseFloat(c.avg_quiz_score) || 0),
            0
          ) / quizScoresRes.rows.length
        ).toFixed(1)
      : null;

    const overview = {
      total_classes: totalClasses,
      total_students: totalStudents,
      avg_quiz_score: avgQuizScore,
      total_lessons: parseInt(lessonsRes.rows[0]?.total_lessons || 0), // ✅ real total
      avg_assignment_score: "–",
      engagement_last7: 0,
    };

    res.render("teacher/sections/classes", {
      classes,
      overview,
      studentCounts: studentCountsRes.rows,
      quizScores: quizScoresRes.rows,
      genderStats: genderRes.rows,
      lessonsPerClass: lessonsPerClassRes.rows, // ✅ pass into EJS
    });
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

// ----------------- CLASSROOM STUDENTS -----------------
exports.viewClassroomStudents = async (req, res) => {
  try {
    const { id } = req.params; // classroomId
    const teacherId = req.user.id;

    // ✅ Check teacher permission
    const checkRes = await pool.query(
      `SELECT 1 FROM classroom_teachers WHERE classroom_id = $1 AND teacher_id = $2`,
      [id, teacherId]
    );
    if (checkRes.rowCount === 0) {
      return res.status(403).send("Not authorized to view this class");
    }

    // ✅ Fetch students with stats
    const studentsRes = await pool.query(
      `WITH last_activity AS (
         SELECT user_id, MAX(created_at) AS last_login
         FROM activities
         GROUP BY user_id
       )
       SELECT 
          u.id,
          u.fullname,
          u.email,
          u.gender,
          COUNT(DISTINCT ulp.lesson_id) FILTER (WHERE ulp.completed_at IS NOT NULL) AS lessons_completed,
          COUNT(DISTINCT l.id) AS total_lessons,
          ROUND(AVG(qs.score::numeric),1) AS avg_quiz_score,
          ROUND(AVG(asub.grade::numeric),1) AS avg_assignment_score,
          la.last_login
       FROM user_school us
       JOIN users2 u ON u.id = us.user_id
       LEFT JOIN last_activity la ON la.user_id = u.id
       LEFT JOIN classroom_courses cc ON us.classroom_id = cc.classroom_id
       LEFT JOIN courses cr ON cc.course_id = cr.id
       LEFT JOIN modules m ON m.course_id = cr.id
       LEFT JOIN lessons l ON l.module_id = m.id
       LEFT JOIN user_lesson_progress ulp ON ulp.user_id = u.id AND ulp.lesson_id = l.id
       LEFT JOIN quiz_submissions qs ON qs.student_id = u.id
       LEFT JOIN assignment_submissions asub ON asub.student_id = u.id
       WHERE us.classroom_id = $1
         AND us.role_in_school = 'student'
         AND us.approved = true
       GROUP BY u.id, u.fullname, u.email, u.gender, la.last_login
       ORDER BY u.fullname`,
      [id]
    );

    const students = studentsRes.rows;

    // ✅ Gender breakdown
    const genderSummary = await pool.query(
      `SELECT u.gender, COUNT(*) 
       FROM user_school us
       JOIN users2 u ON u.id = us.user_id
       WHERE us.classroom_id = $1 AND us.role_in_school = 'student' AND us.approved = true
       GROUP BY u.gender`,
      [id]
    );

    // ✅ Top student
    const topStudent = students.reduce(
      (best, s) =>
        (s.avg_quiz_score || 0) > (best.avg_quiz_score || 0) ? s : best,
      { avg_quiz_score: 0 }
    );

    // ✅ Avg progress
    const avgProgress =
      students.length > 0
        ? Math.round(
            students.reduce(
              (sum, s) =>
                sum +
                (s.total_lessons > 0
                  ? (s.lessons_completed / s.total_lessons) * 100
                  : 0),
              0
            ) / students.length
          )
        : 0;

    // ✅ Progress distribution
    const progressDist = { low: 0, mid: 0, high: 0 };
    students.forEach((s) => {
      const percent =
        s.total_lessons > 0 ? (s.lessons_completed / s.total_lessons) * 100 : 0;
      if (percent < 50) progressDist.low++;
      else if (percent < 75) progressDist.mid++;
      else progressDist.high++;
    });

    res.render("teacher/sections/classroom-students", {
      students,
      classroomId: id,
      genderSummary: genderSummary.rows,
      topStudent,
      avgProgress,
      progressDist,
    });
  } catch (err) {
    console.error("Teacher Classroom Students Error:", err);
    res.status(500).send("Error loading students");
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

// ✅ Get chat messages (conversation
exports.getChatMessages = async (req, res) => {
  try {
    const receiverId = req.params.receiverId;
    const senderId = req.session.user?.id;

    if (!senderId) {
      return res.status(401).json({ success: false, message: "Not logged in" });
    }

    // 1️⃣ Mark messages as delivered when fetched
    await pool.query(
      `UPDATE messages
       SET is_delivered = TRUE
       WHERE receiver_id = $1 AND sender_id = $2 AND is_delivered = FALSE`,
      [senderId, receiverId]
    );

    // 2️⃣ Fetch all chat messages
    const { rows } = await pool.query(
      `
      SELECT 
        id, sender_id, receiver_id, message, created_at, is_read, is_delivered,
        CASE WHEN sender_id = $1 THEN 'self' ELSE 'other' END AS sender
      FROM messages
      WHERE (sender_id = $1 AND receiver_id = $2)
         OR (sender_id = $2 AND receiver_id = $1)
      ORDER BY created_at ASC
      `,
      [senderId, receiverId]
    );

    // 3️⃣ Optionally mark as read
    await pool.query(
      `UPDATE messages 
       SET is_read = TRUE 
       WHERE receiver_id = $1 AND sender_id = $2 AND is_read = FALSE`,
      [senderId, receiverId]
    );

    res.json(rows);
  } catch (err) {
    console.error("Get chat messages error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.markMessagesAsRead = async (req, res) => {
  try {
    const { receiverId } = req.params;
    const senderId = req.session.user?.id;

    await pool.query(
      `UPDATE messages
       SET is_read = TRUE
       WHERE receiver_id = $1 AND sender_id = $2 AND is_read = FALSE`,
      [senderId, receiverId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Mark read error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
