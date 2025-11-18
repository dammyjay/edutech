const pool = require("../models/db");
// controllers/studentController.js
const { askTutor } = require("../utils/ai");
const PDFDocument = require("pdfkit");

// GET: Student Dashboard
exports.getDashboard = async (req, res) => {
  const studentId = req.session.user.id;
  const role = req.session.user.role; // "student", "individual_student", "user"

  try {
    // --- Company Info
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0] || {};
    const profilePic = req.session.user?.profile_picture || null;

    // --- Wallet
    const walletResult = await pool.query(
      "SELECT wallet_balance2 FROM users2 WHERE id = $1",
      [studentId]
    );
    const walletBalance = walletResult.rows[0]?.wallet_balance2 || 0;

    // --- Student base info
    const studentRes = await pool.query("SELECT * FROM users2 WHERE id = $1", [
      studentId,
    ]);
    const student = studentRes.rows[0];

    // Vars that differ per role
    let school = null;
    let classroom = null;
    let teacher = null;
    let classmates = [];
    let teachers = [];
    let instructors = [];
    let enrolledCourses = [];

    // ✅ School-linked students
    if (role === "student") {
      // Role in school
      const roleRes = await pool.query(
        `SELECT role_in_school, classroom_id 
         FROM user_school
         WHERE user_id = $1 AND approved = true
         LIMIT 1`,
        [studentId]
      );
      if (roleRes.rows.length) {
        student.role = roleRes.rows[0].role_in_school;
      }

      // School
      const schoolRes = await pool.query(
        `SELECT s.id, s.name
         FROM schools s
         JOIN user_school us ON s.id = us.school_id
         WHERE us.user_id = $1
           AND us.role_in_school = 'student'
           AND us.approved = true
         LIMIT 1`,
        [studentId]
      );
      school = schoolRes.rows[0] || null;

      // Classroom
      const classroomRes = await pool.query(
        `SELECT c.id, c.name
         FROM classrooms c
         JOIN user_school us ON c.id = us.classroom_id
         WHERE us.user_id = $1
           AND us.role_in_school = 'student'
           AND us.approved = true
         LIMIT 1`,
        [studentId]
      );
      classroom = classroomRes.rows[0] || null;

      // Teacher(s)
      if (classroom) {
        const teacherRes = await pool.query(
          `SELECT u.id, u.fullname, u.email
           FROM users2 u
           JOIN classroom_teachers ct ON ct.teacher_id = u.id
           WHERE ct.classroom_id = $1
           LIMIT 1`,
          [classroom.id]
        );
        teacher = teacherRes.rows[0] || null;
      }

      // Classmates (only if viewing classroom section)
      if (classroom && req.query.section === "classroom") {
        const matesRes = await pool.query(
          `SELECT u.id, u.fullname, u.email
           FROM users2 u
           JOIN user_school us ON us.user_id = u.id
           WHERE us.classroom_id = $1
             AND us.role_in_school = 'student'
             AND us.approved = true
             AND u.id != $2`,
          [classroom.id, studentId]
        );
        classmates = matesRes.rows;
      }

      // Teachers (only if viewing teacher section)
      if (classroom && req.query.section === "teacher") {
        const tRes = await pool.query(
          `SELECT u.id, u.fullname, u.email
           FROM users2 u
           JOIN classroom_teachers ct ON ct.teacher_id = u.id
           WHERE ct.classroom_id = $1`,
          [classroom.id]
        );
        teachers = tRes.rows;
      }

      // Instructors (if viewing instructor section or school overview)

      if (
        classroom &&
        (req.query.section === "instructors" || req.query.section === "teacher")
      ) {
        const iRes = await pool.query(
          `SELECT u.id, u.fullname, u.email, u.profile_picture
     FROM users2 u
     JOIN classroom_instructors ci ON ci.instructor_id = u.id
     WHERE ci.classroom_id = $1`,
          [classroom.id]
        );
        instructors = iRes.rows;
      }

      // Enrolled courses (from classroom)
      if (classroom) {
        const enrolledCoursesRes = await pool.query(
          `SELECT cr.*, p.title AS pathway_name
           FROM classroom_courses cc
           JOIN courses cr ON cc.course_id = cr.id
           LEFT JOIN career_pathways p ON cr.career_pathway_id = p.id
           WHERE cc.classroom_id = $1
           ORDER BY cr.title`,
          [classroom.id]
        );
        enrolledCourses = enrolledCoursesRes.rows;
      }
    }

    // ✅ Independent students (user / individual_student)
    else if (role === "user" || role === "individual_student") {
      const enrolledCoursesRes = await pool.query(
        `SELECT c.*, p.title AS pathway_name, e.progress
         FROM course_enrollments e
         JOIN courses c ON c.id = e.course_id
         JOIN career_pathways p ON c.career_pathway_id = p.id
         WHERE e.user_id = $1
         ORDER BY p.title, c.title`,
        [studentId]
      );
      enrolledCourses = enrolledCoursesRes.rows;
    }

    // --- Parent requests
    const requestsRes = await pool.query(
      `SELECT r.id, u.fullname AS parent_name, u.email AS parent_email, r.status
       FROM parent_child_requests r
       JOIN users2 u ON r.parent_id = u.id
       WHERE r.child_id = $1 AND r.status = 'pending'`,
      [studentId]
    );
    const parentRequests = requestsRes.rows;

    // --- Calculate progress for each enrolled course
    for (let course of enrolledCourses) {
      const totalLessonsRes = await pool.query(
        `SELECT COUNT(*) FROM lessons l
         JOIN modules m ON l.module_id = m.id
         WHERE m.course_id = $1`,
        [course.id]
      );
      const totalLessons = parseInt(totalLessonsRes.rows[0].count) || 1;

      const completedLessonsRes = await pool.query(
        `SELECT COUNT(DISTINCT ul.lesson_id)
         FROM user_lesson_progress ul
         JOIN lessons l ON ul.lesson_id = l.id
         JOIN modules m ON l.module_id = m.id
         WHERE ul.user_id = $1 AND m.course_id = $2`,
        [studentId, course.id]
      );
      const completedLessons = parseInt(completedLessonsRes.rows[0].count);

      course.progress = Math.round((completedLessons / totalLessons) * 100);
    }

    // --- Modules (with unlocked flag)
    const courseIds = enrolledCourses.map((c) => c.id);
    let modulesRes = { rows: [] };
    if (courseIds.length > 0) {
      modulesRes = await pool.query(
        `SELECT m.*,
               EXISTS(
                 SELECT 1 FROM unlocked_modules um
                 WHERE um.student_id = $2 AND um.module_id = m.id
               ) AS unlocked
         FROM modules m
         WHERE course_id = ANY($1)
         ORDER BY m.order_number ASC`,
        [courseIds, studentId]
      );

      // Auto-unlock first module per course
      for (const courseId of courseIds) {
        const unlockedCheck = await pool.query(
          `SELECT 1 FROM unlocked_modules um
           JOIN modules m ON m.id = um.module_id
           WHERE um.student_id = $1 AND m.course_id = $2
           LIMIT 1`,
          [studentId, courseId]
        );

        if (unlockedCheck.rows.length === 0) {
          const firstModuleRes = await pool.query(
            `SELECT id FROM modules
             WHERE course_id = $1
             ORDER BY order_number ASC
             LIMIT 1`,
            [courseId]
          );

          if (firstModuleRes.rows.length > 0) {
            const firstModuleId = firstModuleRes.rows[0].id;
            await pool.query(
              `INSERT INTO unlocked_modules (student_id, module_id)
               VALUES ($1,$2)
               ON CONFLICT (student_id,module_id) DO NOTHING`,
              [studentId, firstModuleId]
            );

            const moduleRow = modulesRes.rows.find(
              (m) => m.id === firstModuleId
            );
            if (moduleRow) moduleRow.unlocked = true;
          }
        }
      }
    }

    // --- Lessons (with unlocked flag)
    const moduleIds = modulesRes.rows.map((m) => m.id);
    let lessonCounts = {};
    let moduleLessons = {};
    if (moduleIds.length > 0) {
      const countRes = await pool.query(
        `SELECT module_id, COUNT(*) AS total_lessons
         FROM lessons
         WHERE module_id = ANY($1)
         GROUP BY module_id`,
        [moduleIds]
      );
      countRes.rows.forEach((row) => {
        lessonCounts[row.module_id] = parseInt(row.total_lessons);
      });

      const lessonsRes = await pool.query(
        `SELECT l.*,
                EXISTS(
                  SELECT 1 FROM unlocked_lessons ul
                  WHERE ul.student_id = $2 AND ul.lesson_id = l.id
                ) AS unlocked,
                EXISTS(SELECT 1 FROM quizzes q WHERE q.lesson_id = l.id) AS has_quiz
         FROM lessons l
         WHERE l.module_id = ANY($1)
         ORDER BY l.order_number ASC`,
        [moduleIds, studentId]
      );

      for (const mod of modulesRes.rows) {
        if (!mod.unlocked) continue;
        const lessonsForModule = lessonsRes.rows.filter(
          (l) => l.module_id === mod.id
        );
        if (
          lessonsForModule.length > 0 &&
          !lessonsForModule.some((l) => l.unlocked)
        ) {
          const firstLesson = lessonsForModule[0];
          firstLesson.unlocked = true;
          await pool.query(
            `INSERT INTO unlocked_lessons (student_id, lesson_id)
             VALUES ($1,$2)
             ON CONFLICT (student_id,lesson_id) DO NOTHING`,
            [studentId, firstLesson.id]
          );
        }
      }

      lessonsRes.rows.forEach((lesson) => {
        if (!moduleLessons[lesson.module_id])
          moduleLessons[lesson.module_id] = [];
        moduleLessons[lesson.module_id].push(lesson);
      });
    }

    // --- Assignments (unlocked after last lesson quiz attempted)
    let moduleAssignments = {};
    if (moduleIds.length > 0) {
      const assignmentsRes = await pool.query(
        `SELECT a.*, m.title AS module_title
         FROM module_assignments a
         JOIN modules m ON a.module_id = m.id
         WHERE a.module_id = ANY($1)
         ORDER BY a.id ASC`,
        [moduleIds]
      );

      for (const assign of assignmentsRes.rows) {
        if (!moduleAssignments[assign.module_id])
          moduleAssignments[assign.module_id] = [];

        const lessonsForMod = moduleLessons[assign.module_id] || [];
        const lastLesson = lessonsForMod[lessonsForMod.length - 1];

        if (lastLesson) {
          const quizAttemptRes = await pool.query(
            `SELECT 1
             FROM quiz_submissions qs
             JOIN quizzes q ON q.id = qs.quiz_id
             WHERE qs.student_id = $1 AND q.lesson_id = $2
             LIMIT 1`,
            [studentId, lastLesson.id]
          );
          assign.unlocked = quizAttemptRes.rows.length > 0;
        } else {
          assign.unlocked = false;
        }

        moduleAssignments[assign.module_id].push(assign);
      }
    }

    // --- Group by pathway & course
    let pathwayCourses = {};
    let courseModules = {};
    for (const course of enrolledCourses) {
      if (!pathwayCourses[course.pathway_name]) {
        pathwayCourses[course.pathway_name] = [];
      }
      pathwayCourses[course.pathway_name].push(course);
    }
    for (const mod of modulesRes.rows) {
      if (!courseModules[mod.course_id]) {
        courseModules[mod.course_id] = [];
      }
      courseModules[mod.course_id].push(mod);
    }

    // --- Fetch project submissions for this student (keyed by project.id)
    let courseProjects = {}; // store projects per course
    let projectSubmissions = {}; // keyed by project.id

    if (enrolledCourses.length > 0) {
      const courseIds = enrolledCourses.map((c) => c.id);

      // Fetch projects for courses
      const projectsRes = await pool.query(
        `SELECT cp.id, cp.course_id, cp.title, cp.description, cp.resource_url
     FROM course_projects cp
     WHERE cp.course_id = ANY($1)
     ORDER BY cp.id ASC`,
        [courseIds]
      );

      // Group projects by course_id
      projectsRes.rows.forEach((project) => {
        if (!courseProjects[project.course_id]) {
          courseProjects[project.course_id] = [];
        }
        courseProjects[project.course_id].push(project);
      });

      // Fetch submissions for this student
      const submissionsRes = await pool.query(
        `SELECT ps.id AS project_id, ps.course_id, ps.file_url, ps.notes, ps.submitted_at
        FROM project_submissions ps
        WHERE ps.student_id = $1 AND ps.course_id = ANY($2)`,
        [studentId, courseIds]
      );

      // Key submissions by project.id
      submissionsRes.rows.forEach((sub) => {
        projectSubmissions[sub.project_id] = sub;
      });
    }

    // --- Stats
    const completedCoursesRes = await pool.query(
      `SELECT COUNT(*) FROM course_enrollments 
       WHERE user_id = $1 AND progress = 100`,
      [studentId]
    );
    const completedCourses = parseInt(completedCoursesRes.rows[0].count);

    const completedProjectsRes = await pool.query(
      `SELECT COUNT(*) FROM course_projects
       WHERE course_id IN (
         SELECT course_id FROM course_enrollments WHERE user_id = $1
       )`,
      [studentId]
    );
    const completedProjects = parseInt(completedProjectsRes.rows[0].count);

    const badgesRes = await pool.query(
      "SELECT * FROM user_badges WHERE user_id = $1",
      [studentId]
    );

    const certificatesRes = await pool.query(
      `SELECT c.id AS course_id, c.title AS course_title, uc.issued_at, uc.certificate_url
       FROM user_certificates uc
       JOIN courses c ON uc.course_id = c.id
       WHERE uc.user_id = $1`,
      [studentId]
    );
    const certificates = certificatesRes.rows;

    const xpHistoryRes = await pool.query(
      `SELECT * FROM xp_history 
       WHERE user_id = $1 
       ORDER BY earned_at DESC 
       LIMIT 10`,
      [studentId]
    );
    const xpHistory = xpHistoryRes.rows;

    const xpTotalRes = await pool.query(
      `SELECT COALESCE(SUM(xp), 0) AS total 
       FROM xp_history 
       WHERE user_id = $1`,
      [studentId]
    );
    const totalXP = xpTotalRes.rows[0].total;

    const engagementRes = await pool.query(
      `SELECT TO_CHAR(completed_at, 'Day') AS day, COUNT(*) AS count
       FROM user_lesson_progress
       WHERE user_id = $1 AND completed_at >= NOW() - INTERVAL '6 days'
       GROUP BY day
       ORDER BY MIN(completed_at)`,
      [studentId]
    );
    const engagementData = {
      labels: engagementRes.rows.map((r) => r.day.trim()),
      data: engagementRes.rows.map((r) => parseInt(r.count)),
    };

    // Module view (kept same, you can later inject unlocked flag here too)
    let moduleInfo = null;
    let lessons = [];
    let selectedLesson = null;

    if (req.query.section === "module" && req.query.moduleId) {
      const moduleRes = await pool.query(
        `SELECT * FROM modules WHERE id = $1 LIMIT 1`,
        [req.query.moduleId]
      );
      moduleInfo = moduleRes.rows[0] || null;

      // 🔑 Only keep modules from this course
      if (moduleInfo) {
        const modsRes = await pool.query(
          `SELECT * FROM modules WHERE course_id = $1 ORDER BY id ASC`,
          [moduleInfo.course_id]
        );
        courseModules = { [moduleInfo.course_id]: modsRes.rows };

        // also refetch lessons only for this course
        const moduleIdsForThisCourse = modsRes.rows.map((m) => m.id);
        if (moduleIdsForThisCourse.length > 0) {
          const lessonsRes2 = await pool.query(
            `SELECT l.*,
                    EXISTS(
                      SELECT 1 FROM unlocked_lessons ul
                      WHERE ul.student_id = $2 AND ul.lesson_id = l.id
                    ) AS unlocked,
                    EXISTS(SELECT 1 FROM quizzes q WHERE q.lesson_id = l.id) AS has_quiz
             FROM lessons l
             WHERE module_id = ANY($1)
             ORDER BY l.id ASC`,
            [moduleIdsForThisCourse, studentId]
          );

          moduleLessons = {};
          lessonsRes2.rows.forEach((lsn) => {
            if (!moduleLessons[lsn.module_id])
              moduleLessons[lsn.module_id] = [];
            moduleLessons[lsn.module_id].push(lsn);
          });
        }
      }
    }

    // Pathway filter (same)
    if (req.query.pathway && pathwayCourses[req.query.pathway]) {
      pathwayCourses = {
        [req.query.pathway]: pathwayCourses[req.query.pathway],
      };
      const allowedCourseIds = pathwayCourses[req.query.pathway].map(
        (c) => c.id
      );
      courseModules = Object.fromEntries(
        Object.entries(courseModules).filter(([courseId]) =>
          allowedCourseIds.includes(parseInt(courseId))
        )
      );
    }

    // --- Parents
    const { rows: parents } = await pool.query(
      `SELECT u.id, u.fullname, u.email
       FROM users2 u
       JOIN parent_children pc ON u.id = pc.parent_id
       WHERE pc.child_id = $1 AND u.role = 'parent'`,
      [studentId]
    );

    // --- Fetch projects for each enrolled course
    if (enrolledCourses.length > 0) {
      const courseIds = enrolledCourses.map((c) => c.id);

      const projectsRes = await pool.query(
        `SELECT cp.id, cp.course_id, cp.title, cp.description, cp.resource_url
      FROM course_projects cp
      WHERE cp.course_id = ANY($1)
      ORDER BY cp.id ASC`,
        [courseIds]
      );

      // Group projects by course_id
      projectsRes.rows.forEach((project) => {
        if (!courseProjects[project.course_id]) {
          courseProjects[project.course_id] = [];
        }
        courseProjects[project.course_id].push(project);
      });

      // Example: courseCompleted is true if completedCourses > 0
    }
    const courseCompleted = completedCourses > 0;
    let courseFinalUnlocked = {}; // key = course.id, value = true/false

    for (const course of enrolledCourses) {
      const modulesForCourse = modulesRes.rows.filter(
        (m) => m.course_id === course.id
      );
      let allModulesCompleted = true;

      for (const mod of modulesForCourse) {
        const lessonsForModule = moduleLessons[mod.id] || [];

        // Check if all lessons in module are completed
        const allLessonsCompleted = lessonsForModule.every((l) => {
          // Completed if student finished lesson or submitted quiz
          // Adjust based on your user_lesson_progress and quiz_submissions logic
          return l.unlocked && l.completed_at;
        });

        if (!allLessonsCompleted) {
          allModulesCompleted = false;
          break;
        }
      }

      courseFinalUnlocked[course.id] = allModulesCompleted;
    }

    // --- Render
    res.render("student/dashboard", {
      student,
      profilePic,
      isLoggedIn: !!req.session.user,
      users: req.session.user,
      info,
      walletBalance,
      school,
      classroom,
      teacher,
      classmates,
      teachers,
      instructors,
      subscribed: req.query.subscribed,
      enrolledCourses,
      pathwayCourses,
      courseModules,
      moduleLessons,
      moduleAssignments,
      lessonCounts,
      completedCourses,
      completedProjects,
      certificates,
      certificatesCount: certificates.length,
      badges: badgesRes.rows,
      totalXP,
      xpHistory,
      engagementData,
      selectedPathway: req.query.pathway || null,
      section: req.query.section || null,
      moduleInfo,
      lessons: [],
      selectedLesson: null,
      parentRequests,
      parents,
      projectSubmissions,
      courseProjects,
      courseCompleted,
      courseFinalUnlocked,
    });
  } catch (err) {
    console.error("Dashboard Error:", err.message);
    res.status(500).send("Server Error");
  }
};

exports.getEnrolledCourses = async (req, res) => {
  const studentId = req.user.id;

  try {
    // Company Info
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0] || {};
    const isLoggedIn = !!req.session.user;
    const profilePic = req.session.user
      ? req.session.user.profile_picture
      : null;

    // Student, enrolled courses, badges, xp
    const [studentRes, enrolledCoursesRes, badgesRes, xpHistoryRes] =
      await Promise.all([
        pool.query("SELECT * FROM users2 WHERE id = $1", [studentId]),
        pool.query(
          `
          SELECT c.*, p.title AS pathway_name, e.progress
          FROM course_enrollments e
          JOIN courses c ON c.id = e.course_id
          JOIN career_pathways p ON c.career_pathway_id = p.id
          WHERE e.user_id = $1
          ORDER BY p.title, c.title
          `,
          [studentId]
        ),
        pool.query(`SELECT * FROM user_badges WHERE user_id = $1`, [studentId]),
        pool.query(
          `SELECT * FROM xp_history WHERE user_id = $1 ORDER BY earned_at DESC LIMIT 10`,
          [studentId]
        ),
      ]);

    const courses = enrolledCoursesRes.rows;
    const courseIds = courses.map((c) => c.id);

    // --- Fetch modules with unlock status
    let modulesRes = { rows: [] };
    if (courseIds.length > 0) {
      modulesRes = await pool.query(
        `
        SELECT m.*,
               EXISTS(
                 SELECT 1 FROM unlocked_modules um
                 WHERE um.student_id = $2 AND um.module_id = m.id
               ) AS unlocked
        FROM modules m
        WHERE course_id = ANY($1)
        ORDER BY m.id ASC
        `,
        [courseIds, studentId]
      );

      // Auto-unlock first module if none unlocked
      if (
        modulesRes.rows.length > 0 &&
        !modulesRes.rows.some((m) => m.unlocked)
      ) {
        const firstModule = modulesRes.rows[0];
        firstModule.unlocked = true;
        await pool.query(
          `INSERT INTO unlocked_modules (student_id, module_id)
           VALUES ($1,$2)
           ON CONFLICT (student_id,module_id) DO NOTHING`,
          [studentId, firstModule.id]
        );
      }
    }

    // --- Fetch lessons with unlock status
    const moduleIds = modulesRes.rows.map((m) => m.id);
    let moduleLessons = {};
    if (moduleIds.length > 0) {
      const lessonsRes = await pool.query(
        `
        SELECT l.*,
               EXISTS(
                 SELECT 1 FROM unlocked_lessons ul
                 WHERE ul.student_id = $2 AND ul.lesson_id = l.id
               ) AS unlocked,
               EXISTS(SELECT 1 FROM quizzes q WHERE q.lesson_id = l.id) AS has_quiz
        FROM lessons l
        WHERE l.module_id = ANY($1)
        ORDER BY l.order_number ASC
        `,
        [moduleIds, studentId]
      );

      // Auto-unlock first lesson if none unlocked
      if (
        lessonsRes.rows.length > 0 &&
        !lessonsRes.rows.some((l) => l.unlocked)
      ) {
        const firstLesson = lessonsRes.rows[0];
        firstLesson.unlocked = true;
        await pool.query(
          `INSERT INTO unlocked_lessons (student_id, lesson_id)
           VALUES ($1,$2)
           ON CONFLICT (student_id,lesson_id) DO NOTHING`,
          [studentId, firstLesson.id]
        );
      }

      lessonsRes.rows.forEach((lesson) => {
        if (!moduleLessons[lesson.module_id])
          moduleLessons[lesson.module_id] = [];
        moduleLessons[lesson.module_id].push(lesson);
      });
    }

    const engagementRes = await pool.query(
      `
      SELECT
        TO_CHAR(completed_at, 'Day') AS day,
        COUNT(*) AS count
      FROM user_lesson_progress
      WHERE user_id = $1 AND completed_at >= NOW() - INTERVAL '6 days'
      GROUP BY day
      ORDER BY MIN(completed_at)
      `,
      [studentId]
    );
    const engagementData = {
      labels: engagementRes.rows.map((r) => r.day.trim()),
      data: engagementRes.rows.map((r) => parseInt(r.count)),
    };

    // --- Grouping: pathways → courses → modules
    let pathwayCourses = {};
    let courseModules = {};
    for (const course of courses) {
      if (!pathwayCourses[course.pathway_name]) {
        pathwayCourses[course.pathway_name] = [];
      }
      pathwayCourses[course.pathway_name].push(course);
    }
    for (const mod of modulesRes.rows) {
      if (!courseModules[mod.course_id]) {
        courseModules[mod.course_id] = [];
      }
      courseModules[mod.course_id].push(mod);
    }

    // Wallet
    let walletBalance = 0;
    if (req.session.user) {
      const walletResult = await pool.query(
        "SELECT wallet_balance2 FROM users2 WHERE email = $1",
        [req.session.user.email]
      );
      walletBalance = walletResult.rows[0]?.wallet_balance2 || 0;
    }

    // Stats (same as before)
    const completedCoursesRes = await pool.query(
      `SELECT COUNT(*) FROM course_enrollments WHERE user_id = $1 AND progress = 100`,
      [studentId]
    );
    const completedCourses = parseInt(completedCoursesRes.rows[0].count);

    const completedProjectsRes = await pool.query(
      `
      SELECT COUNT(*) FROM course_projects
      WHERE course_id IN (
        SELECT course_id FROM course_enrollments WHERE user_id = $1
      )
      `,
      [studentId]
    );
    const completedProjects = parseInt(completedProjectsRes.rows[0].count);

    const certificatesRes = await pool.query(
      `SELECT COUNT(*) FROM course_enrollments WHERE user_id = $1 AND progress = 100`,
      [studentId]
    );
    const certificatesCount = parseInt(certificatesRes.rows[0].count);

    // const courses = enrolledCoursesRes.rows;

    // ✅ Calculate progress for each enrolled course
    for (let course of courses) {
      const totalLessonsRes = await pool.query(
        `SELECT COUNT(*) FROM lessons l
         JOIN modules m ON l.module_id = m.id
         WHERE m.course_id = $1`,
        [course.id]
      );
      const totalLessons = parseInt(totalLessonsRes.rows[0].count) || 1;

      const completedLessonsRes = await pool.query(
        `SELECT COUNT(DISTINCT ul.lesson_id)
         FROM user_lesson_progress ul
         JOIN lessons l ON ul.lesson_id = l.id
         JOIN modules m ON l.module_id = m.id
         WHERE ul.user_id = $1 AND m.course_id = $2`,
        [studentId, course.id]
      );
      const completedLessons = parseInt(completedLessonsRes.rows[0].count);

      course.progress = Math.round((completedLessons / totalLessons) * 100);
    }


    // Render
    res.render("student/dashboard", {
      student: studentRes.rows[0],
      info,
      isLoggedIn,
      profilePic,
      users: req.session.user,
      walletBalance,
      enrolledCourses: courses,
      pathwayCourses,
      courseModules,
      moduleLessons,
      courses, // keep courses for tab
      completedCourses,
      completedProjects,
      certificatesCount,
      badges: badgesRes.rows,
      xpHistory: xpHistoryRes.rows,
      engagementData,
      section: req.query.section || null,
      selectedPathway: req.query.pathway || null,
    });
  } catch (err) {
    console.error("Error fetching courses:", err.message);
    res.status(500).send("Server Error");
  }
};


// GET: Learning Analytics

exports.getAnalytics = async (req, res) => {
  const studentId = req.user.id;

  try {
    const result = await pool.query(
      `
      SELECT m.title AS module, COUNT(l.id) AS lessons_completed
      FROM lessons l
      JOIN modules m ON l.module_id = m.id
      JOIN user_lesson_progress p ON p.lesson_id = l.id
      WHERE p.user_id = $1
      GROUP BY m.title
      ORDER BY m.title
    `,
      [studentId]
    );

    const labels = result.rows.map((row) => row.module);
    const data = result.rows.map((row) => Number(row.lessons_completed));

    res.render("student/dashboard", {
      chart: { labels, data },
    });
  } catch (err) {
    console.error("Error loading analytics:", err.message);
    res.status(500).send("Server Error");
  }
};

// POST: Update XP and log it
exports.updateXP = async (req, res) => {
  const userId = req.user.id;
  const { xpGained, activity = "learning" } = req.body;

  try {
    const user = await pool.query("SELECT xp FROM users2 WHERE id = $1", [
      userId,
    ]);
    const currentXP = user.rows[0]?.xp || 0;
    const newXP = currentXP + Number(xpGained);

    await Promise.all([
      pool.query("UPDATE users2 SET xp = $1 WHERE id = $2", [newXP, userId]),
      pool.query(
        `INSERT INTO xp_history (user_id, xp, activity)
         VALUES ($1, $2, $3)`,
        [userId, xpGained, activity]
      ),
    ]);

    res.json({ message: "XP updated", xp: newXP });
  } catch (err) {
    console.error("XP update error:", err);
    res.status(500).json({ error: "Server error updating XP" });
  }
};

// POST: Award Badge
// exports.awardBadge = async (req, res) => {
//   const userId = req.user.id;
//   const { badge_name } = req.body;

//   try {
//     await pool.query(
//       `
//       INSERT INTO user_badges (user_id, badge_name)
//       VALUES ($1, $2)
//       ON CONFLICT DO NOTHING
//     `,
//       [userId, badge_name]
//     );

//     res.json({ message: "Badge awarded successfully" });
//   } catch (err) {
//     console.error("Badge awarding error:", err.message);
//     res.status(500).json({ error: "Server error awarding badge" });
//   }
// };

exports.awardBadge = async (req, res) => {
  const userId = req.user.id;
  const { badge_name, module_id } = req.body; // pass module_id from frontend

  try {
    // ✅ Get badge image from module
    const moduleRes = await pool.query(
      `SELECT badge_image FROM modules WHERE id=$1`,
      [module_id]
    );
    const badgeImage = moduleRes.rows[0]?.badge_image || null;

    await pool.query(
      `
      INSERT INTO user_badges (user_id, badge_name, module_id, badge_image, awarded_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT DO NOTHING
      `,
      [userId, badge_name, module_id, badgeImage]
    );

    res.json({ message: "Badge awarded successfully" });
  } catch (err) {
    console.error("Badge awarding error:", err.message);
    res.status(500).json({ error: "Server error awarding badge" });
  }
};


// POST: Mark lesson complete, award XP, and check for badge
// exports.completeLesson = async (req, res) => {
//   const userId = req.user.id;
//   const lessonId = req.params.lessonId;

//   try {
//     // // 1. Mark lesson as completed (if not already)
//     // await pool.query(
//     //   `
//     //   INSERT INTO user_lesson_progress (user_id, lesson_id, completed_at)
//     //   VALUES ($1, $2, NOW())
//     //   ON CONFLICT DO NOTHING
//     // `,
//     //   [userId, lessonId]
//     // );

//     // 2. Award XP (say 10 XP per lesson)
//     // const xpGained = 10;
//     // const activity = `Completed lesson ${lessonId}`;
//     // await pool.query(
//     //   "UPDATE users2 SET xp = COALESCE(xp, 0) + $1 WHERE id = $2",
//     //   [xpGained, userId]
//     // );

//     // 3. Log XP history
//     // await pool.query(
//     //   `
//     //   INSERT INTO xp_history (user_id, xp, activity)
//     //   VALUES ($1, $2, $3)
//     // `,
//     //   [userId, xpGained, activity]
//     // );

//     // 4. Count total completed lessons
//     // const result = await pool.query(
//     //   `
//     //   SELECT COUNT(*) FROM user_lesson_progress
//     //   WHERE user_id = $1
//     // `,
//     //   [userId]
//     // );

//     const completedCount = parseInt(result.rows[0].count);

//     // 5. Award badge based on threshold
//     // const badgeThresholds = [
//     //   { count: 5, name: "Beginner Streak" },
//     //   { count: 10, name: "Learning Champ" },
//     //   { count: 20, name: "Knowledge Seeker" },
//     // ];

//     // const badgeThresholds = [
//     //   { count: 5, name: "Beginner Streak" },
//     //   { count: 10, name: "Learning Champ" },
//     //   { count: 20, name: "Knowledge Seeker" },
//     //   { count: 50, name: "Master Learner" },
//     //   { count: 100, name: "Legendary Scholar" },
//     // ];


//     // for (const badge of badgeThresholds) {
//     //   if (completedCount >= badge.count) {
//     //     await pool.query(
//     //       `
//     //       INSERT INTO user_badges (user_id, badge_name)
//     //       VALUES ($1, $2)
//     //       ON CONFLICT DO NOTHING
//     //     `,
//     //       [userId, badge.name]
//     //     );
//     //   }
//     // }
//     // res.json({ message: "Lesson completed, XP added, badge checked." });

//     // await pool.query(
//     //   `
//     //     UPDATE course_enrollments
//     //     SET progress = (
//     //       SELECT ROUND(100.0 * COUNT(DISTINCT ul.lesson_id) / COUNT(l.id))
//     //       FROM lessons l
//     //       LEFT JOIN unlocked_lessons ul
//     //       ON l.id = ul.lesson_id AND ul.student_id = $1
//     //       WHERE l.module_id IN (
//     //         SELECT id FROM modules WHERE course_id = (
//     //           SELECT course_id FROM modules WHERE id = (
//     //             SELECT module_id FROM lessons WHERE id = $2
//     //           )
//     //         )
//     //       )
//     //     )
//     //     WHERE user_id = $1
//     //     AND course_id = (SELECT course_id FROM modules WHERE id = (SELECT module_id FROM lessons WHERE id = $2))
//     //   `,
//     //   [userId, lessonId]
//     // );

//     await pool.query(
//       `UPDATE course_enrollments
//         SET progress = (
//           SELECT ROUND(100.0 * COUNT(DISTINCT cl.lesson_id) / COUNT(l.id))
//           FROM lessons l
//           LEFT JOIN user_lesson_progress cl
//             ON l.id = cl.lesson_id AND cl.user_id = $1
//           WHERE l.module_id IN (
//             SELECT id FROM modules WHERE course_id = (
//               SELECT course_id FROM modules WHERE id = (
//                 SELECT module_id FROM lessons WHERE id = $2
//               )
//             )
//           )
//         )
//         WHERE user_id = $1
//         AND course_id = (
//           SELECT course_id FROM modules WHERE id = (SELECT module_id FROM lessons WHERE id = $2)
//         )

//       `
//     );
//     // After updating progress
//     const certCheck = await pool.query(
//       `
//   SELECT progress, course_id FROM course_enrollments
//   WHERE user_id = $1 AND course_id = (
//     SELECT course_id FROM modules WHERE id = (
//       SELECT module_id FROM lessons WHERE id = $2
//     )
//   )
// `,
//       [userId, lessonId]
//     );

//     if (certCheck.rows[0]?.progress === 100) {
//       const courseId = certCheck.rows[0].course_id;
//       await pool.query(
//         `
//     INSERT INTO user_certificates (user_id, course_id, certificate_url)
//     VALUES ($1, $2, $3)
//     ON CONFLICT (user_id, course_id) DO NOTHING
//   `,
//         [userId, courseId, `/certificates/${userId}_${courseId}.pdf`]
//       );
//     }
//   } catch (err) {
//     console.error("Lesson completion error:", err.message);
//     res.status(500).json({ error: "Server error completing lesson" });
//   }
// };


exports.completeLesson = async (req, res) => {
  const userId = req.user.id;
  const lessonId = req.params.lessonId;

  try {
    // 1️⃣ Mark lesson as completed
    await pool.query(
      `
      INSERT INTO user_lesson_progress (user_id, lesson_id, completed_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT DO NOTHING
      `,
      [userId, lessonId]
    );

    // 2️⃣ Update course progress
    await pool.query(
      `UPDATE course_enrollments
       SET progress = (
         SELECT ROUND(100.0 * COUNT(DISTINCT cl.lesson_id) / COUNT(l.id))
         FROM lessons l
         LEFT JOIN user_lesson_progress cl
           ON l.id = cl.lesson_id AND cl.user_id = $1
         WHERE l.module_id IN (
           SELECT id FROM modules WHERE course_id = (
             SELECT course_id FROM modules WHERE id = (
               SELECT module_id FROM lessons WHERE id = $2
             )
           )
         )
       )
       WHERE user_id = $1
       AND course_id = (
         SELECT course_id FROM modules WHERE id = (SELECT module_id FROM lessons WHERE id = $2)
       )
      `,
      [userId, lessonId]
    );

    // 3️⃣ Check if course is completed (progress 100%)
    const certCheck = await pool.query(
      `SELECT progress, course_id FROM course_enrollments
       WHERE user_id = $1 AND course_id = (
         SELECT course_id FROM modules WHERE id = (
           SELECT module_id FROM lessons WHERE id = $2
         )
       )`,
      [userId, lessonId]
    );

    if (certCheck.rows[0]?.progress === 100) {
      const courseId = certCheck.rows[0].course_id;

      // 4️⃣ Get student name and course title
      const studentRes = await pool.query(
        `SELECT fullname FROM users2 WHERE id = $1`,
        [userId]
      );
      const studentName = studentRes.rows[0].fullname;

      const courseRes = await pool.query(
        `SELECT title FROM courses WHERE id = $1`,
        [courseId]
      );
      const courseTitle = courseRes.rows[0].title;

      // 5️⃣ Generate PDF certificate
      const pdfDir = path.join(__dirname, "../public/certificates");
      if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });

      const pdfPath = path.join(pdfDir, `${userId}_${courseId}.pdf`);
      const doc = new PDFDocument();

      doc.pipe(fs.createWriteStream(pdfPath));
      doc.fontSize(28).text("Certificate of Completion", { align: "center" });
      doc.moveDown(2);
      doc.fontSize(20).text("This certifies that", { align: "center" });
      doc.moveDown();
      doc.fontSize(24).text(studentName, { align: "center", underline: true });
      doc.moveDown();
      doc
        .fontSize(20)
        .text("has successfully completed the course", { align: "center" });
      doc.moveDown();
      doc.fontSize(24).text(courseTitle, { align: "center", underline: true });
      doc.moveDown(2);
      doc
        .fontSize(16)
        .text(`Date: ${new Date().toDateString()}`, { align: "center" });
      doc.end();

      // 6️⃣ Save certificate record in database
      await pool.query(
        `INSERT INTO user_certificates (user_id, course_id, certificate_url)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, course_id) DO NOTHING`,
        [userId, courseId, `/certificates/${userId}_${courseId}.pdf`]
      );
    }

    res.json({
      message: "Lesson completed and certificate generated if course finished.",
    });
  } catch (err) {
    console.error("Lesson completion error:", err.message);
    res.status(500).json({ error: "Server error completing lesson" });
  }
};


// POST: Enroll in course using wallet balance

// exports.enrollInCourse = async (req, res) => {
//   console.log("req.user:", req.user); // 👈 Add this
//   const userId = req.user.id;
//   const courseId = req.params.courseId;

//   try {
//     // 1. Check if already enrolled
//     const check = await pool.query(
//       "SELECT * FROM course_enrollments WHERE user_id = $1 AND course_id = $2",
//       [userId, courseId]
//     );

//     if (check.rows.length > 0) {
//       return res.redirect("/student/courses?msg=Already enrolled");
//     }

//     // 2. Get course info
//     const courseRes = await pool.query("SELECT * FROM courses WHERE id = $1", [
//       courseId,
//     ]);
//     const course = courseRes.rows[0];

//     if (!course) {
//       return res.status(404).send("Course not found.");
//     }

//     if (course.amount > 0) {
//       // 3. Get user wallet
//       const userRes = await pool.query(
//         "SELECT wallet_balance2 FROM users2 WHERE id = $1",
//         [userId]
//       );
//       const wallet = userRes.rows[0].wallet_balance;

//       if (wallet < course.amount) {
//         return res.redirect(
//           "/student/dashboard?msg=Insufficient wallet balance"
//         );
//       }

//       // 4. Deduct wallet
//       await pool.query(
//         "UPDATE users2 SET wallet_balance2 = wallet_balance2 - $1 WHERE id = $2",
//         [course.amount, userId]
//       );

//       // 4b. Get new wallet balance
//       const updatedWalletRes = await pool.query(
//         "SELECT wallet_balance FROM users2 WHERE id = $1",
//         [userId]
//       );
//       const newWalletBalance = updatedWalletRes.rows[0]?.wallet_balance;
//     }

//     // 5. Enroll student
//     await pool.query(
//       "INSERT INTO course_enrollments (user_id, course_id, progress) VALUES ($1, $2, 0)",
//       [userId, courseId]
//     );

//     res.redirect("/student/courses?msg=Enrollment successful");
//   } catch (err) {
//     console.error("Enrollment error:", err);
//     res.status(500).send("Server error");
//   }
// };

exports.enrollInCourse = async (req, res) => {
  console.log("req.user:", req.user);
  const userId = req.user.id;
  const courseId = req.params.courseId;

  try {
    // 1. Check if already enrolled
    const check = await pool.query(
      "SELECT * FROM course_enrollments WHERE user_id = $1 AND course_id = $2",
      [userId, courseId]
    );

    if (check.rows.length > 0) {
      return res.redirect("/student/courses?msg=Already enrolled");
    }

    // 2. Get course info
    const courseRes = await pool.query("SELECT * FROM courses WHERE id = $1", [
      courseId,
    ]);
    const course = courseRes.rows[0];

    if (!course) {
      return res.status(404).send("Course not found.");
    }

    if (course.amount > 0) {
      // 3. Get user wallet
      const userRes = await pool.query(
        "SELECT wallet_balance2 FROM users2 WHERE id = $1",
        [userId]
      );
      const wallet = userRes.rows[0].wallet_balance2; // ✅ fixed

      if (wallet < course.amount) {
        return res.redirect(
          "/student/dashboard?msg=Insufficient wallet balance"
        );
      }

      // 4. Deduct wallet
      await pool.query(
        "UPDATE users2 SET wallet_balance2 = wallet_balance2 - $1 WHERE id = $2",
        [course.amount, userId]
      );

      // Optional: log new balance
      const updatedWalletRes = await pool.query(
        "SELECT wallet_balance2 FROM users2 WHERE id = $1",
        [userId]
      );
      console.log(
        "New wallet balance:",
        updatedWalletRes.rows[0].wallet_balance2
      );
    }

    // 5. Enroll student
    await pool.query(
      "INSERT INTO course_enrollments (user_id, course_id, progress) VALUES ($1, $2, 0)",
      [userId, courseId]
    );

    res.redirect("/student/courses?msg=Enrollment successful");
  } catch (err) {
    console.error("Enrollment error:", err);
    res.status(500).send("Server error");
  }
};


exports.editProfile = async (req, res) => {
  const { fullname, gender, dob } = req.body;
  const profilePic = req.file?.path || req.body.existingPic;

  await pool.query(
    `UPDATE users2 SET fullname = $1, gender = $2, dob = $3, profile_picture = $4 WHERE id = $5`,
    [fullname, gender, dob, profilePic, req.user.id]
  );

  req.session.user.fullname = fullname;
  req.session.user.gender = gender;
  req.session.user.dob = dob;
  req.session.user.profile_picture = profilePic;

  res.redirect("/student/dashboard?section=profile");
};


exports.viewLesson = async (req, res) => {
  const lessonId = req.params.lessonId;

  try {
    const lessonRes = await pool.query(
      `SELECT l.*, m.title AS module_title, c.title AS course_title
       FROM lessons l
       JOIN modules m ON l.module_id = m.id
       JOIN courses c ON m.course_id = c.id
       WHERE l.id = $1`,
      [lessonId]
    );

    if (lessonRes.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Lesson not found" });
    }

    const lesson = lessonRes.rows[0];

    res.json({
      success: true,
      id: lesson.id,
      title: lesson.title,
      module_title: lesson.module_title,
      course_title: lesson.course_title,
      video_url: lesson.video_url,
      content: lesson.content,
      has_quiz: !!lesson.quiz_id,
      
    });
  } catch (err) {
    console.error("Error loading lesson:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getModuleDetails = async (req, res) => {
  const moduleId = req.params.moduleId;
  const studentId = req.user.id;

  try {
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0] || {};

    const profilePic = req.session.user?.profile_picture || null;
    const walletResult = await pool.query(
      "SELECT wallet_balance2 FROM users2 WHERE id = $1",
      [studentId]
    );
    const walletBalance = walletResult.rows[0]?.wallet_balance2 || 0;
    const moduleRes = await pool.query("SELECT * FROM modules WHERE id = $1", [
      moduleId,
    ]);
    const module = moduleRes.rows[0];
    if (!module) return res.status(404).send("Module not found");

    // const lessonsRes = await pool.query(
    //   `SELECT * FROM lessons WHERE module_id = $1 ORDER BY id ASC`,
    //   [moduleId]
    // );

    const lessons = await pool.query(
      `SELECT l.*,
     EXISTS(
       SELECT 1 FROM unlocked_lessons ul
       WHERE ul.student_id=$2 AND ul.lesson_id=l.id
     ) AS unlocked
   FROM lessons l
   WHERE l.module_id=$1
   ORDER BY l.id ASC`,
      [moduleId, studentId]
    );

    lessons.rows.forEach((l, idx) => {
      if (idx === 0) l.unlocked = true; // first lesson always unlocked
    });


    res.render("student/moduleDetails", {
      profilePic,
      isLoggedIn: !!req.session.user,
      users: req.session.user,
      info,
      walletBalance,
      subscribed: req.query.subscribed,
      module,
      // lessons: lessonsRes.rows,
      lessons: lessons.rows,
    });
  } catch (err) {
    console.error("Error loading module:", err.message);
    res.status(500).send("Server error");
  }
};

exports.getLessonQuiz = async (req, res) => {
  const lessonId = req.params.id;
  const studentId = req.session?.student?.id || req.user?.id;

  try {
    // 1️⃣ Get quiz for this lesson
    const quizRes = await pool.query(
      `SELECT id FROM quizzes WHERE lesson_id = $1`,
      [lessonId]
    );
    if (quizRes.rows.length === 0) {
      return res.json({
        success: false,
        message: "No quiz found for this lesson",
      });
    }
    const quizId = quizRes.rows[0].id;

    // 2️⃣ Check if student already submitted
    if (studentId) {
      const subRes = await pool.query(
        `SELECT score, passed, review_data, created_at
         FROM quiz_submissions
         WHERE quiz_id = $1 AND student_id = $2
         ORDER BY created_at DESC
         LIMIT 1`,
        [quizId, studentId]
      );

      if (subRes.rows.length > 0) {
        const sub = subRes.rows[0];
        let reviewData = sub.review_data;

        // 🔑 Ensure it's parsed into an array
        if (typeof reviewData === "string") {
          try {
            reviewData = JSON.parse(reviewData);
          } catch (err) {
            console.error("❌ Could not parse review_data JSON:", err.message);
            reviewData = [];
          }
        }

        return res.json({
          success: true,
          alreadySubmitted: true,
          score: sub.score,
          passed: sub.passed,
          reviewData, // ✅ always array now
          feedback:
            sub.score >= 80
              ? "🌟 Excellent work! You clearly understood this lesson."
              : sub.score >= 50
              ? "👍 Good attempt. Review the explanations for the wrong answers."
              : "📘 Don’t worry! Revisit the lesson content and try again.",
        });
      }

    }

    // 3️⃣ Otherwise, fetch quiz questions
    const questionsRes = await pool.query(
      `SELECT id, question, question_type, options
       FROM quiz_questions
       WHERE quiz_id = $1
       ORDER BY id ASC`,
      [quizId]
    );

    if (questionsRes.rows.length === 0) {
      return res.json({
        success: false,
        message: "No quiz questions found for this lesson",
      });
    }

    const questions = questionsRes.rows.map((q) => {
      let options = [];
      if (q.options) {
        if (Array.isArray(q.options)) {
          options = q.options;
        } else if (typeof q.options === "string") {
          options = q.options.split(",").map((opt) => opt.trim());
        }
      }
      return { ...q, options };
    });

    return res.json({
      success: true,
      alreadySubmitted: false,
      questions,
    });
  } catch (err) {
    console.error("Error fetching quiz:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.submitLessonQuiz = async (req, res) => {
  try {
    const { lessonId, answers } = req.body;
    const studentId =
      req.session?.student?.id || req.user?.id || req.body.studentId;

    if (!lessonId || !answers) {
      return res.status(400).json({
        success: false,
        message: "Lesson ID and answers are required.",
      });
    }
    if (!studentId) {
      return res.status(400).json({
        success: false,
        message: "Student ID missing. Please log in again.",
      });
    }

    // ✅ Fetch lesson content
    const lessonRes = await pool.query(
      `SELECT id, title, content FROM lessons WHERE id=$1`,
      [lessonId]
    );
    if (lessonRes.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Lesson not found" });
    }
    const lesson = lessonRes.rows[0];

    // ✅ Find the quiz for this lesson
    const quizRes = await pool.query(
      `SELECT id FROM quizzes WHERE lesson_id=$1`,
      [lessonId]
    );
    if (quizRes.rows.length === 0) {
      return res.json({
        success: false,
        message: "No quiz found for this lesson",
      });
    }
    const quizId = quizRes.rows[0].id;

    // ✅ Fetch quiz questions
    const qRes = await pool.query(
      `SELECT qq.id, qq.question, qq.options, qq.correct_option
       FROM quiz_questions qq
       WHERE qq.quiz_id = $1
       ORDER BY qq.id ASC`,
      [quizId]
    );
    const questions = qRes.rows;
    if (questions.length === 0) {
      return res.json({ success: false, message: "No quiz questions found" });
    }

    // ✅ Score student answers
    let score = 0;
    const reviewData = [];
    questions.forEach((q) => {
      const yourAnswer = answers[`q${q.id}`] || "";
      const isCorrect =
        yourAnswer.toString().trim().toLowerCase() ===
        q.correct_option.toString().trim().toLowerCase();

      if (isCorrect) score++;

      reviewData.push({
        id: q.id,
        question: q.question,
        yourAnswer,
        correctAnswer: q.correct_option,
        isCorrect,
      });
    });

    const percent = Math.round((score / questions.length) * 100);

    // ✅ AI Prompt WITH lesson content
//     const feedbackPrompt = `
// You are an AI tutor. Use the following LESSON CONTENT to explain quiz answers:

// "${lesson.content}"

// Now here is a student's quiz attempt for the lesson "${lesson.title}":

// ${reviewData
//   .map(
//     (r) => `
// QuestionId: ${r.id}
// Question: ${r.question}
// Student answered: ${r.yourAnswer || "No answer"}
// Correct answer: ${r.correctAnswer}
// Result: ${r.isCorrect ? "✅ Correct" : "❌ Wrong"}
// `
//   )
//   .join("\n\n")}

// TASK:
// For EACH question (correct OR wrong):
// - Use the QuestionId from above in the JSON.
// - If correct → give a short reinforcement explanation.
// - If wrong → explain why their answer is incorrect AND what the correct answer means.
// - Base explanations on the LESSON CONTENT.
// - Be supportive.

// OUTPUT:
// Return only valid JSON in this format:
// [
//   { "questionId": 12, "feedback": "..." },
//   { "questionId": 15, "feedback": "..." }
// ]
    // `;
    
    const feedbackPrompt = `
You are an AI tutor. Give short, simple feedback for each quiz question.

Do NOT restate the lesson.  
Do NOT repeat the questions in detail.  
Do NOT write short explanations.

For each item, return JSON like this:
[
  { "questionId": 1, "feedback": "…" }
]

Student quiz review:
${JSON.stringify(reviewData, null, 2)}
`;


    let perQuestionFeedback = [];
    try {
      const raw = await askTutor({ question: feedbackPrompt });
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        perQuestionFeedback = JSON.parse(jsonMatch[0]);
      }
    } catch (err) {
      console.error("AI feedback error:", err.message);
    }

    // ✅ Attach AI feedback
    reviewData.forEach((r) => {
      const fb = perQuestionFeedback.find((f) => f.questionId == r.id);
      r.feedback = fb
        ? fb.feedback
        : r.isCorrect
        ? "✅ Correct! Great understanding."
        : "❌ Incorrect. Review the lesson content.";
    });

    // ✅ Save submission
    // await pool.query(
    //   `INSERT INTO quiz_submissions (quiz_id, student_id, score, passed, review_data)
    //    VALUES ($1,$2,$3,$4,$5)`,
    //   [quizId, studentId, percent, percent >= 50, JSON.stringify(reviewData)]
    // );

    // res.json({
    //   success: true,
    //   score: percent,
    //   passed: percent >= 50,
    //   reviewData,
    //   feedback:
    //     percent >= 80
    //       ? "🌟 Excellent work! You clearly understood this lesson."
    //       : percent >= 50
    //       ? "👍 Good attempt. Review the explanations for the wrong answers."
    //       : "📘 Don’t worry! Revisit the lesson content and try again.",
    // });

    // ✅ Unlock next lesson if passed
    // if (percent >= 50) {
    //   const nextLessonRes = await pool.query(
    //     `SELECT id FROM lessons
    //  WHERE module_id = (SELECT module_id FROM lessons WHERE id=$1)
    //    AND id > $1
    //  ORDER BY id ASC
    //  LIMIT 1`,
    //     [lessonId]
    //   );

    //   if (nextLessonRes.rows.length > 0) {
    //     const nextLessonId = nextLessonRes.rows[0].id;

    //     await pool.query(
    //       `INSERT INTO unlocked_lessons (student_id, lesson_id)
    //    VALUES ($1, $2)
    //    ON CONFLICT (student_id, lesson_id) DO NOTHING`,
    //       [studentId, nextLessonId]
    //     );
    //   }
    // }

    // ✅ Save submission
    await pool.query(
      `INSERT INTO quiz_submissions (quiz_id, student_id, score, passed, review_data)
   VALUES ($1,$2,$3,$4,$5)`,
      [quizId, studentId, percent, percent >= 50, JSON.stringify(reviewData)]
    );

    // ✅ Mark lesson as completed when quiz is submitted
    await pool.query(
      `INSERT INTO user_lesson_progress (user_id, lesson_id, completed_at)
   VALUES ($1, $2, NOW())
   ON CONFLICT (user_id, lesson_id) DO NOTHING`,
      [studentId, lessonId]
    );

    const xpGained = 10;
    await pool.query(
      "UPDATE users2 SET xp = COALESCE(xp, 0) + $1 WHERE id = $2",
      [xpGained, studentId]
    );

    await pool.query(
      `INSERT INTO xp_history (user_id, xp, activity)
   VALUES ($1, $2, $3)`,
      [studentId, xpGained, `Completed quiz for lesson ${lessonId}`]
    );

    // ✅ Unlock next lesson if passed
    // if (percent >= 50) {
    //   const nextLessonRes = await pool.query(
    //     `SELECT id FROM lessons
    //  WHERE module_id = (SELECT module_id FROM lessons WHERE id=$1)
    //    AND id > $1
    //  ORDER BY id ASC
    //  LIMIT 1`,
    //     [lessonId]
    //   );

    //   if (nextLessonRes.rows.length > 0) {
    //     const nextLessonId = nextLessonRes.rows[0].id;

    //     await pool.query(
    //       `INSERT INTO unlocked_lessons (student_id, lesson_id)
    //    VALUES ($1, $2)
    //    ON CONFLICT (student_id, lesson_id) DO NOTHING`,
    //       [studentId, nextLessonId]
    //     );
    //   }
    // }

    // ✅ Unlock next lesson OR assignment (pass/fail doesn’t matter anymore)
    const nextLessonRes = await pool.query(
      `SELECT id FROM lessons 
       WHERE module_id = (SELECT module_id FROM lessons WHERE id=$1)
         AND id > $1
       ORDER BY id ASC
       LIMIT 1`,
      [lessonId]
    );

    if (nextLessonRes.rows.length > 0) {
      // unlock the next lesson
      const nextLessonId = nextLessonRes.rows[0].id;
      await pool.query(
        `INSERT INTO unlocked_lessons (student_id, lesson_id)
         VALUES ($1, $2)
         ON CONFLICT (student_id, lesson_id) DO NOTHING`,
        [studentId, nextLessonId]
      );
    } else {
      // no more lessons → unlock the assignment
      const moduleIdRes = await pool.query(
        `SELECT module_id FROM lessons WHERE id=$1`,
        [lessonId]
      );
      const moduleId = moduleIdRes.rows[0].module_id;

      await pool.query(
        `INSERT INTO unlocked_assignments (student_id, assignment_id)
         SELECT $1, id 
         FROM module_assignments 
         WHERE module_id=$2
         ON CONFLICT (student_id, assignment_id) DO NOTHING`,
        [studentId, moduleId]
      );
    }

    // ✅ Count completed lessons
    const completedRes = await pool.query(
      `SELECT COUNT(*) FROM user_lesson_progress WHERE user_id = $1`,
      [studentId]
    );
    const completedCount = parseInt(completedRes.rows[0].count);

    // ✅ Count total lessons
    const totalRes = await pool.query(`SELECT COUNT(*) FROM lessons`);
    const totalLessons = parseInt(totalRes.rows[0].count) || 1;

    // ✅ Calculate completion %
    const completionRate = (completedCount / totalLessons) * 100;

    // ✅ Award badges based on % completed
    if (completionRate >= 20) {
      await pool.query(
        `INSERT INTO user_badges (user_id, badge_name, awarded_at)
     VALUES ($1, 'Beginner', NOW()) 
     ON CONFLICT DO NOTHING`,
        [studentId]
      );
    }
    if (completionRate >= 50) {
      await pool.query(
        `INSERT INTO user_badges (user_id, badge_name, awarded_at)
     VALUES ($1, 'Intermediate', NOW()) 
     ON CONFLICT DO NOTHING`,
        [studentId]
      );
    }
    if (completionRate >= 80) {
      await pool.query(
        `INSERT INTO user_badges (user_id, badge_name, awarded_at)
     VALUES ($1, 'Advanced', NOW()) 
     ON CONFLICT DO NOTHING`,
        [studentId]
      );
    }
    if (completionRate === 100) {
      await pool.query(
        `INSERT INTO user_badges (user_id, badge_name, awarded_at)
     VALUES ($1, 'Master', NOW()) 
     ON CONFLICT DO NOTHING`,
        [studentId]
      );
    }

    // Get module ID and badge image for the lesson
    const moduleRes = await pool.query(
      `SELECT id, badge_image FROM modules 
   WHERE id = (SELECT module_id FROM lessons WHERE id=$1)`,
      [lessonId]
    );
    const moduleId = moduleRes.rows[0]?.id;
    const badgeImage = moduleRes.rows[0]?.badge_image || null;

    // Award badges with module_id and badge_image
    if (completionRate >= 20) {
      await pool.query(
        `INSERT INTO user_badges (user_id, badge_name, module_id, badge_image, awarded_at)
     VALUES ($1, 'Beginner', $2, $3, NOW()) 
     ON CONFLICT DO NOTHING`,
        [studentId, moduleId, badgeImage]
      );
    }
    if (completionRate >= 50) {
      await pool.query(
        `INSERT INTO user_badges (user_id, badge_name, module_id, badge_image, awarded_at)
     VALUES ($1, 'Intermediate', $2, $3, NOW()) 
     ON CONFLICT DO NOTHING`,
        [studentId, moduleId, badgeImage]
      );
    }

    if (completionRate >= 80) {
      await pool.query(
        `INSERT INTO user_badges (user_id, badge_name, module_id, badge_image, awarded_at)
     VALUES ($1, 'Advance', $2, $3, NOW()) 
     ON CONFLICT DO NOTHING`,
        [studentId, moduleId, badgeImage]
      );
    }

    if (completionRate >= 100) {
      await pool.query(
        `INSERT INTO user_badges (user_id, badge_name, module_id, badge_image, awarded_at)
     VALUES ($1, 'Master', $2, $3, NOW()) 
     ON CONFLICT DO NOTHING`,
        [studentId, moduleId, badgeImage]
      );
    }
    // ... same for Advanced and Master

    // ✅ Respond to frontend
    res.json({
      success: true,
      score: percent,
      passed: percent >= 50,
      reviewData,
      feedback:
        percent >= 80
          ? "🌟 Excellent work! You clearly understood this lesson."
          : percent >= 50
          ? "👍 Good attempt. Review the explanations for the wrong answers."
          : "📘 Don’t worry! Revisit the lesson content and try again.",
    });
  } catch (err) {
    console.error("Quiz submit error:", err.message);
    res.status(500).json({ success: false, message: "Failed to submit quiz." });
  }
};

exports.getMyQuizzes = async (req, res) => {
  try {
    const submissions = await pool.query(
      `SELECT qs.id, qs.quiz_id, qs.score, qs.passed, qs.review_data, qs.created_at,
              l.id AS lesson_id, l.title AS lesson_title,
              m.title AS module_title, c.title AS course_title
       FROM quiz_submissions qs
       JOIN quizzes q ON qs.quiz_id = q.id
       JOIN lessons l ON q.lesson_id = l.id
       JOIN modules m ON l.module_id = m.id
       JOIN courses c ON m.course_id = c.id
       WHERE qs.student_id = $1
       ORDER BY qs.created_at DESC`,
      [req.user.id]
    );

    res.json({ success: true, submissions: submissions.rows });
  } catch (err) {
    console.error("Fetch quizzes error:", err.message);
    res.status(500).json({ success: false, message: "Failed to fetch quizzes" });
  }
};

// 📌 Get single quiz submission by ID
exports.getQuizSubmissionById = async (req, res) => {
  try {
    const { id } = req.params;
    const sub = await pool.query(
      `SELECT qs.*, 
              l.title AS lesson_title, l.content AS lesson_content,
              m.title AS module_title, c.title AS course_title
       FROM quiz_submissions qs
       JOIN quizzes q ON qs.quiz_id = q.id
       JOIN lessons l ON q.lesson_id = l.id
       JOIN modules m ON l.module_id = m.id
       JOIN courses c ON m.course_id = c.id
       WHERE qs.id = $1 AND qs.student_id = $2`,
      [id, req.user.id]
    );

    if (sub.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Quiz submission not found" });
    }

    res.json({ success: true, submission: sub.rows[0] });
  } catch (err) {
    console.error("Fetch quiz submission error:", err.message);
    res.status(500).json({ success: false, message: "Failed to load quiz submission" });
  }
};


exports.getLesson = async (req, res) => {
  try {
    const lessonId = req.params.id;
    const lesson = await Lesson.findByPk(lessonId); // or your DB query
    if (!lesson) return res.status(404).json({ error: "Lesson not found" });

    res.json({
      id: lesson.id,
      title: lesson.title,
      video_url: lesson.video_url,
      content: lesson.content,
      has_quiz: !!lesson.quiz_id,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /student/ai/ask
// exports.askAITutor = async (req, res) => {
//   try {
//     const userId = req.user?.id || req.session.user?.id;
//     const { question, lessonId } = req.body;

//     // Pull a little lesson context if provided (title + content)
//     let lessonContext = "";
//     if (lessonId) {
//       const ctx = await pool.query(
//         `SELECT title, content FROM lessons WHERE id = $1 LIMIT 1`,
//         [lessonId]
//       );
//       if (ctx.rows[0]) {
//         lessonContext = `Title: ${ctx.rows[0].title}\n\n${
//           ctx.rows[0].content || ""
//         }`;
//       }
//     }

//     const userName = req.session?.user?.fullname || "Student";
//     const answer = await askTutor({ question, lessonContext, userName });

//     // (Optional) Persist chat logs
//     // await pool.query(
//     //   `INSERT INTO ai_tutor_logs (user_id, lesson_id, question, answer)
//     //    VALUES ($1,$2,$3,$4)`,
//     //   [userId || null, lessonId || null, question, answer]
//     // );

//     res.json({ ok: true, answer });
//   } catch (e) {
//     console.error("AI tutor error:", e.message);
//     res.status(500).json({ ok: false, error: "Tutor is unavailable." });
//   }
// };
// POST /student/ai/ask
exports.askAITutor = async (req, res) => {
  try {
    const userId = req.user?.id || req.session.user?.id;
    const { question, lessonId } = req.body;

    let lessonContext = "";

    if (lessonId) {
      const ctx = await pool.query(
        `SELECT title, content FROM lessons WHERE id = $1 LIMIT 1`,
        [lessonId]
      );

      if (ctx.rows[0]) {
        const { title, content } = ctx.rows[0];

        // 🧹 Clean HTML tags & limit to 3000 characters
        const cleanText = content
          ? content.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
          : "";

        const shortText =
          cleanText.length > 3000
            ? cleanText.slice(0, 3000) + "..."
            : cleanText;

        lessonContext = `Lesson Title: ${title}\n\nSummary of Lesson:\n${shortText}`;
      }
    }

    const userName = req.session?.user?.fullname || "Student";

    // ✅ Now ask the tutor safely
    const answer = await askTutor({ question, lessonContext, userName });

    // Optional: log chat
    // await pool.query(
    //   `INSERT INTO ai_tutor_logs (user_id, lesson_id, question, answer)
    //    VALUES ($1,$2,$3,$4)`,
    //   [userId || null, lessonId || null, question, answer]
    // );

    res.json({ ok: true, answer });
  } catch (e) {
    console.error("AI tutor error:", e.message);
    res.status(500).json({ ok: false, error: "Tutor is unavailable." });
  }
};


exports.viewAssignment = async (req, res) => {
  try {
    const assignmentId = parseInt(req.params.id);
    const studentId = req.session.user?.id; // adjust if you use JWT or req.user

    if (isNaN(assignmentId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid assignment ID" });
    }

    // ✅ Fetch assignment
    const result = await pool.query(
      `SELECT ma.*, m.title AS module_title, c.title AS course_title
       FROM module_assignments ma
       JOIN modules m ON ma.module_id = m.id
       JOIN courses c ON m.course_id = c.id
       WHERE ma.id = $1`,
      [assignmentId]
    );

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Assignment not found" });
    }
    const assignment = result.rows[0];

    // ✅ Check if student already submitted
    const subRes = await pool.query(
      `SELECT id, description, file_url, score, grade, ai_feedback, created_at
      FROM assignment_submissions
      WHERE assignment_id = $1 AND student_id = $2
      ORDER BY created_at DESC LIMIT 1`,
          [assignmentId, studentId]
    );

    if (subRes.rows.length > 0) {
      // already submitted
      return res.json({
        success: true,
        submitted: true,
        assignment: {
          id: assignment.id,
          title: assignment.title,
          instructions: assignment.instructions,
          due_date: assignment.due_date,
          module_title: assignment.module_title,
          course_title: assignment.course_title,
        },
        submission: subRes.rows[0],
      });
    }

    // no submission yet
    res.json({
      success: true,
      submitted: false,
      assignment: {
        id: assignment.id,
        title: assignment.title,
        instructions: assignment.instructions,
        due_date: assignment.due_date,
        module_title: assignment.module_title,
        course_title: assignment.course_title,
      },
    });
  } catch (err) {
    console.error("View assignment error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.submitAssignment = async (req, res) => {
  try {
    const assignmentId = req.params.assignmentId || req.body.assignmentId;

    let studentId =
      req.session?.student?.id || req.user?.id || req.body.studentId;
    const { description } = req.body;
    const file = req.file ? req.file.path : null; // multer file path

    if (!assignmentId || !description) {
      return res.status(400).json({
        success: false,
        message: "Assignment ID and description are required.",
      });
    }
    if (!studentId) {
      return res.status(400).json({
        success: false,
        message: "Student ID missing. Please log in again.",
      });
    }

    // ✅ Check assignment exists
    const aRes = await pool.query(
      `SELECT id, title, instructions 
       FROM module_assignments 
       WHERE id=$1`,
      [assignmentId]
    );
    if (aRes.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Assignment not found." });
    }
    const assignment = aRes.rows[0];

    // ✅ Save submission (ungraded first)
    const save = await pool.query(
      `INSERT INTO assignment_submissions (assignment_id, student_id, description, file_url)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [assignmentId, studentId, description, file]
    );
    const submission = save.rows[0];

    // ✅ AI grading
    const gradingPrompt = `
You are an AI tutor grading a student's assignment.

--- ASSIGNMENT INSTRUCTIONS ---
${assignment.instructions}

Inside the instructions, the "Evaluation Criteria" or "Marking Scheme" is described.
Extract those criteria and use them as the official rubric.

--- STUDENT SUBMISSION ---
"${description}"

--- TASK ---
1. Parse the evaluation criteria from the assignment instructions.
2. Check how well the student's submission meets each criterion.
3. Assign a score for EACH criterion (out of its allocated weight).
4. Sum up the weighted scores to a total (0–100).
5. Assign a grade:
   - A (90–100)
   - B (75–89)
   - C (60–74)
   - D (40–59)
   - F (<40)
6. Provide constructive feedback (3–5 sentences), explaining strengths and weaknesses.

--- OUTPUT FORMAT ---
Return ONLY valid JSON, e.g.:

{
  "criteria": {
    "Theoretical answers": 10,
    "Correct use of interface & tools": 0,
    "Part creation and arrangement": 0,
    "Obstacle Step build": 0,
    "Use of colors and materials": 0,
    "Proper saving and submission": 0
  },
  "total": 10,
  "grade": "F",
  "feedback": "The submission does not follow the required structure..."
}
`;

    let total = null,
      grade = null,
      feedbackText = null,
      criteria = null;

    try {
      const raw = await askTutor({ question: gradingPrompt });
      console.log("AI Raw Response:", raw);

      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        total = parsed.total ?? null;
        grade = parsed.grade ?? null;
        feedbackText = parsed.feedback ?? null;
        criteria = parsed.criteria ?? null;
      }

      if (!feedbackText) {
        feedbackText =
          "Your assignment was graded, but detailed feedback was not generated.";
      }
    } catch (err) {
      console.error("AI grading failed:", err.message);
      feedbackText =
        "AI grading unavailable. Your assignment has been submitted.";
    }

    // ✅ Update submission with grading
    await pool.query(
      `UPDATE assignment_submissions
       SET score=$1, total=$1, grade=$2, ai_feedback=$3, criteria=$4
       WHERE id=$5`,
      [total, grade, feedbackText, criteria ? JSON.stringify(criteria) : null, submission.id]
    );

    res.json({
      success: true,
      message: "Assignment submitted and graded ✅",
      submissionId: submission.id,
      total,
      grade,
      feedbackText,
      criteria,
    });

    // ✅ Unlock next module if grading happened
    if (total !== null) {
      const nextModuleRes = await pool.query(
        `SELECT id FROM modules 
         WHERE course_id = (SELECT course_id FROM modules WHERE id=(SELECT module_id FROM module_assignments WHERE id=$1))
           AND id > (SELECT module_id FROM module_assignments WHERE id=$1)
         ORDER BY id ASC
         LIMIT 1`,
        [assignmentId]
      );

      if (nextModuleRes.rows.length > 0) {
        const nextModuleId = nextModuleRes.rows[0].id;

        await pool.query(
          `INSERT INTO unlocked_modules (student_id, module_id)
           VALUES ($1, $2)
           ON CONFLICT (student_id, module_id) DO NOTHING`,
          [studentId, nextModuleId]
        );

        // 🔑 Auto-unlock first lesson
        const firstLessonRes = await pool.query(
          `SELECT id FROM lessons WHERE module_id=$1 ORDER BY id ASC LIMIT 1`,
          [nextModuleId]
        );
        if (firstLessonRes.rows.length > 0) {
          await pool.query(
            `INSERT INTO unlocked_lessons (student_id, lesson_id)
             VALUES ($1, $2)
             ON CONFLICT (student_id, lesson_id) DO NOTHING`,
            [studentId, firstLessonRes.rows[0].id]
          );
        }
      }
    }
  } catch (err) {
    console.error("Assignment submit error:", err.message);
    res.status(500).json({ success: false, message: "Failed to submit assignment" });
  }
};

exports.getMyAssignments = async (req, res) => {
  try {
    const submissions = await pool.query(
      `SELECT s.id, s.assignment_id, s.description, s.file_url, 
              s.score, s.total, s.grade, s.ai_feedback, s.criteria,
              s.created_at AS submitted_at,
              ma.title AS assignment_title, ma.instructions,
              m.title AS module_title, c.title AS course_title
       FROM assignment_submissions s
       JOIN module_assignments ma ON s.assignment_id = ma.id
       JOIN modules m ON ma.module_id = m.id
       JOIN courses c ON m.course_id = c.id
       WHERE s.student_id = $1
       ORDER BY s.created_at DESC`,
      [req.user.id]
    );

    // ✅ Parse criteria JSON safely
    const rows = submissions.rows.map((r) => ({
      ...r,
      criteria: r.criteria ? JSON.parse(r.criteria) : null,
    }));

    res.json({ success: true, submissions: rows });
  } catch (err) {
    console.error("Fetch submissions error:", err.message);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch submissions" });
  }
};

exports.getSubmissionById = async (req, res) => {
  try {
    const { id } = req.params;
    const sub = await pool.query(
      `SELECT s.*, 
          ma.title AS assignment_title, ma.instructions,
          m.title AS module_title, c.title AS course_title
       FROM assignment_submissions s
       JOIN module_assignments ma ON s.assignment_id = ma.id
       JOIN modules m ON ma.module_id = m.id
       JOIN courses c ON m.course_id = c.id
       WHERE s.id = $1 AND s.student_id = $2`,
      [id, req.user.id]
    );

    if (sub.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Submission not found" });
    }

    const row = sub.rows[0];
    res.json({
      success: true,
      submission: {
        ...row,
        criteria: row.criteria ? JSON.parse(row.criteria) : null, total: row.total,
      },
    });
  } catch (err) {
    console.error("Fetch single submission error:", err.message);
    res
      .status(500)
      .json({ success: false, message: "Failed to load submission" });
  }
};

exports.respondToParentRequest = async (req, res) => {
  const studentId = req.user.id;
  const { requestId, action } = req.body;

  try {
    // Check if request exists and belongs to this student
    const reqRes = await pool.query(
      `SELECT * FROM parent_child_requests WHERE id=$1 AND child_id=$2`,
      [requestId, studentId]
    );
    if (reqRes.rows.length === 0) {
      return res.status(400).send("❌ Invalid request");
    }

    if (action === "approve") {
      const parentId = reqRes.rows[0].parent_id;

      // 1. Update request status
      await pool.query(
        `UPDATE parent_child_requests SET status='approved' WHERE id=$1`,
        [requestId]
      );

      // 2. Create parent-child link
      await pool.query(
        `INSERT INTO parent_children (parent_id, child_id)
         VALUES ($1,$2)
         ON CONFLICT DO NOTHING`,
        [parentId, studentId]
      );
    } else if (action === "reject") {
      await pool.query(
        `UPDATE parent_child_requests SET status='rejected' WHERE id=$1`,
        [requestId]
      );
    }

    res.redirect("/student/dashboard?section=profile");
  } catch (err) {
    console.error("Parent request response error:", err.message);
    res.status(500).send("Server error responding to parent request");
  }
};

// controllers/studentController.js
exports.getClassroom = async (req, res) => {
  const studentId = req.user.id;

  try {
    // find the student’s classroom
    const classroomRes = await pool.query(
      `SELECT c.id, c.name
       FROM classrooms c
       JOIN user_school us ON c.id = us.classroom_id
       WHERE us.user_id = $1
         AND us.role_in_school = 'student'
         AND us.approved = true
       LIMIT 1`,
      [studentId]
    );
    const classroom = classroomRes.rows[0];
    if (!classroom) return res.send("You are not assigned to a classroom yet.");

    // fetch classmates
    const classmatesRes = await pool.query(
      `SELECT u.id, u.fullname, u.email
       FROM users2 u
       JOIN user_school us ON u.id = us.user_id
       WHERE us.classroom_id = $1
         AND us.role_in_school = 'student'
         AND us.approved = true
         AND u.id != $2`,
      [classroom.id, studentId]
    );

    res.render("student/classroom", {
      classroom,
      classmates: classmatesRes.rows,
    });
  } catch (err) {
    console.error("Classroom Error:", err.message);
    res.status(500).send("Server Error");
  }
};

// controllers/studentController.js
exports.getTeacher = async (req, res) => {
  const studentId = req.user.id;

  try {
    // find the student’s classroom
    const classroomRes = await pool.query(
      `SELECT c.id
       FROM classrooms c
       JOIN user_school us ON c.id = us.classroom_id
       WHERE us.user_id = $1
         AND us.role_in_school = 'student'
         AND us.approved = true
       LIMIT 1`,
      [studentId]
    );
    const classroom = classroomRes.rows[0];
    if (!classroom) return res.send("You are not assigned to a classroom yet.");

    // fetch teacher(s) for that classroom
    const teacherRes = await pool.query(
      `SELECT u.id, u.fullname, u.email
       FROM users2 u
       JOIN classroom_teachers ct ON ct.teacher_id = u.id
       WHERE ct.classroom_id = $1`,
      [classroom.id]
    );

    res.render("student/teacher", {
      teachers: teacherRes.rows,
    });
  } catch (err) {
    console.error("Teacher Error:", err.message);
    res.status(500).send("Server Error");
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

exports.submitProject = async (req, res) => {
  try {
    const studentId = req.session.studentId;
    const { courseId, projectId, notes } = req.body;

    // Check if the course is completed
    const courseCheck = await db.query(
      "SELECT * FROM enrollments WHERE student_id=$1 AND course_id=$2 AND completed=true",
      [studentId, courseId]
    );

    if (courseCheck.rowCount === 0) {
      return res
        .status(403)
        .send("Complete all modules first to submit the project.");
    }

    // Handle file upload
    const filePath = req.file ? req.file.path : null;
    if (!filePath) {
      return res.status(400).send("Please upload your project file.");
    }

    // Save submission to DB keyed by project_id
    await db.query(
      `INSERT INTO project_submissions (student_id, course_id, project_id, file_url, notes, submitted_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (student_id, project_id) DO UPDATE
       SET file_url = EXCLUDED.file_url,
           notes = EXCLUDED.notes,
           submitted_at = NOW()`,
      [studentId, courseId, projectId, filePath, notes]
    );

    res.redirect(`/student/dashboard?section=projects&courseId=${courseId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("An error occurred while submitting your project.");
  }
};




