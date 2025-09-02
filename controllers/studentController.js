const pool = require("../models/db");
// controllers/studentController.js
const { askTutor } = require("../utils/ai");

// GET: Student Dashboard

exports.getDashboard = async (req, res) => {
  const studentId = req.user.id;

  try {
    // Company Info
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0] || {};
    const profilePic = req.session.user?.profile_picture || null;

    // Wallet
    const walletResult = await pool.query(
      "SELECT wallet_balance2 FROM users2 WHERE id = $1",
      [studentId]
    );
    const walletBalance = walletResult.rows[0]?.wallet_balance2 || 0;

    // Student
    const studentRes = await pool.query("SELECT * FROM users2 WHERE id = $1", [
      studentId,
    ]);
    const student = studentRes.rows[0];

    // Enrolled Courses
    const enrolledCoursesRes = await pool.query(
      `
      SELECT c.*, p.title AS pathway_name, e.progress
      FROM course_enrollments e
      JOIN courses c ON c.id = e.course_id
      JOIN career_pathways p ON c.career_pathway_id = p.id
      WHERE e.user_id = $1
      ORDER BY p.title, c.title
      `,
      [studentId]
    );

    // Modules (🔑 with unlocked flag)
    const courseIds = enrolledCoursesRes.rows.map((c) => c.id);
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
      // if (
      //   modulesRes.rows.length > 0 &&
      //   !modulesRes.rows.some((m) => m.unlocked)
      // ) {
      //   const firstModule = modulesRes.rows[0];
      //   firstModule.unlocked = true;
      //   await pool.query(
      //     `INSERT INTO unlocked_modules (student_id, module_id)
      //      VALUES ($1,$2)
      //      ON CONFLICT (student_id,module_id) DO NOTHING`,
      //     [studentId, firstModule.id]
      //   );
      // }

      // Auto-unlock the first module (by order_number) of each course if none unlocked yet
      for (const courseId of courseIds) {
        const unlockedCheck = await pool.query(
          `SELECT 1 FROM unlocked_modules um
     JOIN modules m ON m.id = um.module_id
     WHERE um.student_id = $1 AND m.course_id = $2
     LIMIT 1`,
          [studentId, courseId]
        );

        if (unlockedCheck.rows.length === 0) {
          // find the module with the smallest order_number for this course
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

            // also mark it as unlocked in your modulesRes.rows
            const moduleRow = modulesRes.rows.find(
              (m) => m.id === firstModuleId
            );
            if (moduleRow) moduleRow.unlocked = true;
          }
        }
      }
    }

    // Lessons (🔑 with unlocked flag)
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
        `
        SELECT l.*,
               EXISTS(
                 SELECT 1 FROM unlocked_lessons ul
                 WHERE ul.student_id = $2 AND ul.lesson_id = l.id
               ) AS unlocked,
               EXISTS(SELECT 1 FROM quizzes q WHERE q.lesson_id = l.id) AS has_quiz
        FROM lessons l
        WHERE l.module_id = ANY($1)
        ORDER BY l.id ASC
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

    // --- Assignments (same as before)
    // let moduleAssignments = {};
    // if (moduleIds.length > 0) {
    //   const assignmentsRes = await pool.query(
    //     `
    //     SELECT a.*, m.title AS module_title
    //     FROM module_assignments a
    //     JOIN modules m ON a.module_id = m.id
    //     WHERE a.module_id = ANY($1)
    //     ORDER BY a.id ASC
    //     `,
    //     [moduleIds]
    //   );

    //   // ✅ fetch unlocked assignments for this student
    //   const unlockedAssignmentsRes = await pool.query(
    //     `SELECT assignment_id FROM unlocked_assignments WHERE student_id=$1`,
    //     [studentId]
    //   );
    //   const unlockedAssignments = unlockedAssignmentsRes.rows.map(
    //     (r) => r.assignment_id
    //   );

    //   assignmentsRes.rows.forEach((assign) => {
    //     if (!moduleAssignments[assign.module_id])
    //       moduleAssignments[assign.module_id] = [];

    //     // assignment is unlocked only if it exists in unlocked_assignments
    //     assign.unlocked = unlockedAssignments.includes(assign.id);

    //     moduleAssignments[assign.module_id].push(assign);
    //   });

    // }

    // --- Assignments (🔑 unlock when last lesson's quiz attempted)
    let moduleAssignments = {};
    if (moduleIds.length > 0) {
      const assignmentsRes = await pool.query(
        `
    SELECT a.*, m.title AS module_title
    FROM module_assignments a
    JOIN modules m ON a.module_id = m.id
    WHERE a.module_id = ANY($1)
    ORDER BY a.id ASC
    `,
        [moduleIds]
      );

      for (const assign of assignmentsRes.rows) {
        if (!moduleAssignments[assign.module_id])
          moduleAssignments[assign.module_id] = [];

        // find last lesson of this module
        const lessonsForMod = moduleLessons[assign.module_id] || [];
        const lastLesson = lessonsForMod[lessonsForMod.length - 1];

        if (lastLesson) {
          // check if student attempted the quiz for that lesson
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

    // Group by pathway & course
    let pathwayCourses = {};
    let courseModules = {};
    for (const course of enrolledCoursesRes.rows) {
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

    const badgesRes = await pool.query(
      "SELECT * FROM user_badges WHERE user_id = $1",
      [studentId]
    );

    const certificatesRes = await pool.query(
      `SELECT COUNT(*) FROM course_enrollments WHERE user_id = $1 AND progress = 100`,
      [studentId]
    );
    const certificatesCount = parseInt(certificatesRes.rows[0].count);

    const xpHistoryRes = await pool.query(
      `SELECT * FROM xp_history WHERE user_id = $1 ORDER BY earned_at DESC LIMIT 10`,
      [studentId]
    );

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

    // Module view (kept same, you can later inject unlocked flag here too)
    let moduleInfo = null;
    let lessons = [];
    let selectedLesson = null;
    // if (req.query.section === "module" && req.query.moduleId) {
    //   const moduleRes = await pool.query(
    //     `SELECT * FROM modules WHERE id = $1 LIMIT 1`,
    //     [req.query.moduleId]
    //   );
    //   moduleInfo = moduleRes.rows[0] || null;

    //   const lessonsRes = await pool.query(
    //     `
    //     SELECT l.*,
    //            EXISTS(
    //              SELECT 1 FROM unlocked_lessons ul
    //              WHERE ul.student_id = $2 AND ul.lesson_id = l.id
    //            ) AS unlocked,
    //            EXISTS(SELECT 1 FROM quizzes q WHERE q.lesson_id = l.id) AS has_quiz
    //     FROM lessons l
    //     WHERE module_id = $1
    //     ORDER BY l.id ASC
    //     `,
    //     [req.query.moduleId, studentId]
    //   );
    //   lessons = lessonsRes.rows;

    //   if (req.query.lessonId) {
    //     const lessonRes = await pool.query(
    //       `SELECT * FROM lessons WHERE id = $1 LIMIT 1`,
    //       [req.query.lessonId]
    //     );
    //     selectedLesson = lessonRes.rows[0] || null;
    //   }
    // }

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

    // Render with unlocked flags
    res.render("student/dashboard", {
      student,
      profilePic,
      isLoggedIn: !!req.session.user,
      users: req.session.user,
      info,
      walletBalance,
      subscribed: req.query.subscribed,
      enrolledCourses: enrolledCoursesRes.rows,
      pathwayCourses,
      courseModules,
      moduleLessons,
      moduleAssignments,
      lessonCounts,
      courses: enrolledCoursesRes.rows,
      completedCourses,
      completedProjects,
      certificatesCount,
      badges: badgesRes.rows,
      xpHistory: xpHistoryRes.rows,
      engagementData,
      selectedPathway: req.query.pathway || null,
      section: req.query.section || null,
      moduleInfo,
      lessons,
      selectedLesson,
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
        ORDER BY l.id ASC
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
exports.awardBadge = async (req, res) => {
  const userId = req.user.id;
  const { badge_name } = req.body;

  try {
    await pool.query(
      `
      INSERT INTO user_badges (user_id, badge_name)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
    `,
      [userId, badge_name]
    );

    res.json({ message: "Badge awarded successfully" });
  } catch (err) {
    console.error("Badge awarding error:", err.message);
    res.status(500).json({ error: "Server error awarding badge" });
  }
};

// POST: Mark lesson complete, award XP, and check for badge
exports.completeLesson = async (req, res) => {
  const userId = req.user.id;
  const lessonId = req.params.lessonId;

  try {
    // 1. Mark lesson as completed (if not already)
    await pool.query(
      `
      INSERT INTO user_lesson_progress (user_id, lesson_id, completed_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT DO NOTHING
    `,
      [userId, lessonId]
    );

    // 2. Award XP (say 10 XP per lesson)
    const xpGained = 10;
    const activity = `Completed lesson ${lessonId}`;
    await pool.query(
      "UPDATE users2 SET xp = COALESCE(xp, 0) + $1 WHERE id = $2",
      [xpGained, userId]
    );

    // 3. Log XP history
    await pool.query(
      `
      INSERT INTO xp_history (user_id, xp, activity)
      VALUES ($1, $2, $3)
    `,
      [userId, xpGained, activity]
    );

    // 4. Count total completed lessons
    const result = await pool.query(
      `
      SELECT COUNT(*) FROM user_lesson_progress
      WHERE user_id = $1
    `,
      [userId]
    );

    const completedCount = parseInt(result.rows[0].count);

    // 5. Award badge based on threshold
    const badgeThresholds = [
      { count: 5, name: "Beginner Streak" },
      { count: 10, name: "Learning Champ" },
      { count: 20, name: "Knowledge Seeker" },
    ];

    for (const badge of badgeThresholds) {
      if (completedCount >= badge.count) {
        await pool.query(
          `
          INSERT INTO user_badges (user_id, badge_name)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `,
          [userId, badge.name]
        );
      }
    }

    res.json({ message: "Lesson completed, XP added, badge checked." });
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
    const feedbackPrompt = `
You are an AI tutor. Use the following LESSON CONTENT to explain quiz answers:

"${lesson.content}"

Now here is a student's quiz attempt for the lesson "${lesson.title}":

${reviewData
  .map(
    (r) => `
QuestionId: ${r.id}
Question: ${r.question}
Student answered: ${r.yourAnswer || "No answer"}
Correct answer: ${r.correctAnswer}
Result: ${r.isCorrect ? "✅ Correct" : "❌ Wrong"}
`
  )
  .join("\n\n")}

TASK:
For EACH question (correct OR wrong):
- Use the QuestionId from above in the JSON.
- If correct → give a short reinforcement explanation.
- If wrong → explain why their answer is incorrect AND what the correct answer means.
- Base explanations on the LESSON CONTENT.
- Be supportive.

OUTPUT:
Return only valid JSON in this format:
[
  { "questionId": 12, "feedback": "..." },
  { "questionId": 15, "feedback": "..." }
]
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
exports.askAITutor = async (req, res) => {
  try {
    const userId = req.user?.id || req.session.user?.id;
    const { question, lessonId } = req.body;

    // Pull a little lesson context if provided (title + content)
    let lessonContext = "";
    if (lessonId) {
      const ctx = await pool.query(
        `SELECT title, content FROM lessons WHERE id = $1 LIMIT 1`,
        [lessonId]
      );
      if (ctx.rows[0]) {
        lessonContext = `Title: ${ctx.rows[0].title}\n\n${
          ctx.rows[0].content || ""
        }`;
      }
    }

    const userName = req.session?.user?.fullname || "Student";
    const answer = await askTutor({ question, lessonContext, userName });

    // (Optional) Persist chat logs
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

// ✅ Student submits an assignment
exports.submitAssignment = async (req, res) => {
  try {
    const assignmentId = req.params.assignmentId || req.body.assignmentId;

    // ✅ Try different sources for studentId
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
      `SELECT id, title, instructions FROM module_assignments WHERE id=$1`,
      [assignmentId]
    );
    if (aRes.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Assignment not found." });
    }
    const assignment = aRes.rows[0];

    // ✅ Save submission
    const save = await pool.query(
      `INSERT INTO assignment_submissions (assignment_id, student_id, description, file_url)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [assignmentId, studentId, description, file]
    );
    const submission = save.rows[0];

    // ✅ AI grading
    const gradingPrompt = `
You are an AI tutor. A student submitted an assignment.

ASSIGNMENT TITLE: ${assignment.title}
INSTRUCTIONS: ${assignment.instructions}

STUDENT SUBMISSION:
"${description}"

TASK:
- Grade the submission based on instructions.
- Give a score out of 100.
- Assign a grade (A, B, C, D, F).
- Provide constructive, encouraging feedback (3–5 sentences).

OUTPUT:
Return only JSON:
{
  "score": 85,
  "grade": "B",
  "feedback": "..."
}
`;

    let score = null,
      grade = null,
      feedbackText = null;

    try {
      const raw = await askTutor({ question: gradingPrompt });
      console.log("AI Raw Response:", raw); // 🔍 debug what AI sends

      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        score = parsed.score ?? null;
        grade = parsed.grade ?? null;
        feedbackText = parsed.feedback ?? null;
      }

      if (!feedbackText) {
        // fallback if AI didn’t provide feedback
        feedbackText =
          "Your assignment was graded, but detailed feedback was not generated. Please try again or ask your tutor.";
      }
    } catch (err) {
      console.error("AI grading failed:", err.message);
      feedbackText =
        "AI grading unavailable. Your assignment has been submitted.";
    }

    // ✅ Update submission with grading
    await pool.query(
      `UPDATE assignment_submissions
       SET score=$1, grade=$2, ai_feedback=$3
       WHERE id=$4`,
      [score, grade, feedbackText, submission.id]
    );

    res.json({
      success: true,
      message: "Assignment submitted and graded ✅",
      submissionId: submission.id,
      score,
      grade,
      feedbackText,
    });

    // ✅ Unlock next module after assignment is graded
    if (score !== null) {
      // grading happened
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
      }
    }
  } catch (err) {
    console.error("Assignment submit error:", err.message);
    res
      .status(500)
      .json({ success: false, message: "Failed to submit assignment" });
  }
};

// StudentController.js
exports.getMyAssignments = async (req, res) => {
  try {
    const submissions = await pool.query(
      `SELECT s.id, s.assignment_id, s.description, s.file_url, 
          s.score, s.grade, s.ai_feedback, s.submitted_at,
          ma.title AS assignment_title, ma.instructions,
          m.title AS module_title, c.title AS course_title
   FROM assignment_submissions s
   JOIN module_assignments ma ON s.assignment_id = ma.id
   JOIN modules m ON ma.module_id = m.id
   JOIN courses c ON m.course_id = c.id
   WHERE s.student_id = $1
   ORDER BY s.submitted_at DESC`,
      [req.user.id]
    );

    res.json({ success: true, submissions: submissions.rows });
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

    res.json({ success: true, submission: sub.rows[0] });
  } catch (err) {
    console.error("Fetch single submission error:", err.message);
    res
      .status(500)
      .json({ success: false, message: "Failed to load submission" });
  }
};
