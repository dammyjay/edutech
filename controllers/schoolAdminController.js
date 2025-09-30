// controllers/schoolAdminController.js
const pool = require("../models/db");
const { logActivityForUser } = require("../utils/activityLogger");


exports.getDashboard = async (req, res) => {
  const schoolDbId = req.session.user.school_id; // numeric PK
  console.log("session.school_id:", schoolDbId);

  // Get school name
  const schoolRow = await pool.query(
    "SELECT id, name FROM schools WHERE id = $1",
    [schoolDbId]
  );

  if (!schoolRow.rows.length) {
    return res.status(404).send("School not found");
  }

  const schoolName = schoolRow.rows[0].name;

  // Company info
  const infoResult = await pool.query(
    "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
  );
  const info = infoResult.rows[0] || {};
  const profilePic = req.session.user?.profile_picture || null;

  // Pending teachers/students
  const pendingUsers = await pool.query(
    `SELECT u.id, u.fullname, u.email, us.role_in_school, us.joined_at
     FROM users2 u
     JOIN user_school us ON u.id = us.user_id
     WHERE us.school_id = $1 AND us.approved = false`,
    [schoolDbId]
  );

  // Classrooms
  const classrooms = await pool.query(
    `SELECT c.id, c.name,
       COALESCE(STRING_AGG(u.fullname, ', '), 'Unassigned') AS teacher_names,
       COALESCE(ARRAY_AGG(u.id) FILTER (WHERE u.id IS NOT NULL), '{}') AS teacher_ids,
       (SELECT COUNT(*) 
          FROM user_school us2 
         WHERE us2.classroom_id = c.id
           AND us2.role_in_school = 'student'
           AND us2.approved = true) AS student_count
FROM classrooms c
LEFT JOIN classroom_teachers ct ON c.id = ct.classroom_id
LEFT JOIN users2 u ON u.id = ct.teacher_id
WHERE c.school_id = $1
GROUP BY c.id, c.name;`,
    [schoolDbId]
  );

  // Teachers
  const teachers = await pool.query(
    `SELECT u.id, u.fullname, u.email, us.role_in_school, us.joined_at
     FROM users2 u
     JOIN user_school us ON u.id = us.user_id
     WHERE us.school_id = $1 AND us.role_in_school = 'teacher' AND us.approved = true`,
    [schoolDbId]
  );

  // Students
  const students = await pool.query(
    `SELECT u.id, u.fullname, u.email, us.role_in_school, us.joined_at
     FROM users2 u
     JOIN user_school us ON u.id = us.user_id
     WHERE us.school_id = $1 AND us.role_in_school = 'student' AND us.approved = true`,
    [schoolDbId]
  );

  // ✅ Recent activities (limit 10 for dashboard)
  const recentActivities = await pool.query(
    `SELECT a.id, a.action, a.details, a.role, a.scope, a.created_at, u.fullname
     FROM activities a
     LEFT JOIN users2 u ON a.user_id = u.id
     WHERE a.school_id = $1 OR a.scope = 'global'
     ORDER BY a.created_at DESC
     LIMIT 10`,
    [schoolDbId]
  );

  // Student Engagement
  const studentEngagement = await pool.query(
    `SELECT 
    u.id,
    u.fullname,
    u.email,
    COUNT(DISTINCT l.id) AS total_lessons,  -- all lessons available in their classrooms
    COUNT(DISTINCT ulp.lesson_id) FILTER (WHERE ulp.completed_at IS NOT NULL) AS lessons_completed,
    COUNT(DISTINCT a.id) AS activities_logged,
    COALESCE(
      ROUND(
        (COUNT(DISTINCT ulp.lesson_id) FILTER (WHERE ulp.completed_at IS NOT NULL)::numeric /
         NULLIF(COUNT(DISTINCT l.id), 0)) * 100
      , 1),
      0
    ) AS engagement_rate
FROM users2 u
JOIN user_school us 
    ON u.id = us.user_id
JOIN classrooms c 
    ON us.classroom_id = c.id
JOIN classroom_courses cc 
    ON c.id = cc.classroom_id
JOIN courses cr 
    ON cc.course_id = cr.id
JOIN modules m 
    ON cr.id = m.course_id
JOIN lessons l 
    ON m.id = l.module_id
LEFT JOIN user_lesson_progress ulp 
    ON ulp.user_id = u.id AND ulp.lesson_id = l.id
LEFT JOIN activities a 
    ON a.user_id = u.id
WHERE us.school_id = $1
  AND us.role_in_school = 'student'
  AND us.approved = true
GROUP BY u.id, u.fullname, u.email
ORDER BY engagement_rate DESC;

`,
    [schoolDbId]
  );

  // Teacher Performance
  const teacherPerformance = await pool.query(
    `WITH student_engagement AS (
    SELECT 
      u.id AS student_id,             -- ✅ use users2.id instead of user_school.id
      ct.teacher_id,
      COUNT(DISTINCT ulp.lesson_id) FILTER (WHERE ulp.completed_at IS NOT NULL) AS lessons_completed,
      COUNT(DISTINCT l.id) AS total_lessons
    FROM classroom_teachers ct
    JOIN user_school us2 
      ON ct.classroom_id = us2.classroom_id
     AND us2.role_in_school = 'student'
     AND us2.approved = true
    JOIN users2 u 
      ON us2.user_id = u.id           -- ✅ proper student link
    LEFT JOIN classroom_courses cc 
      ON ct.classroom_id = cc.classroom_id
    LEFT JOIN courses cr 
      ON cc.course_id = cr.id
    LEFT JOIN modules m 
      ON cr.id = m.course_id
    LEFT JOIN lessons l 
      ON m.id = l.module_id
    LEFT JOIN user_lesson_progress ulp 
      ON ulp.user_id = u.id AND ulp.lesson_id = l.id
    GROUP BY u.id, ct.teacher_id
  )
  SELECT 
    t.id,
    t.fullname,
    t.email,
    COUNT(DISTINCT ct.classroom_id) AS classrooms_assigned,
    COUNT(DISTINCT s.id) AS total_students,
    ROUND(
      COALESCE(AVG(
        CASE WHEN se.total_lessons > 0 
             THEN (se.lessons_completed::numeric / se.total_lessons) * 100
             ELSE 0
        END
      ), 0), 1
    ) AS avg_engagement
  FROM users2 t
  JOIN user_school us 
    ON t.id = us.user_id
  LEFT JOIN classroom_teachers ct 
    ON t.id = ct.teacher_id
  LEFT JOIN user_school s 
    ON ct.classroom_id = s.classroom_id 
   AND s.role_in_school = 'student'
   AND s.approved = true
  LEFT JOIN student_engagement se 
    ON se.teacher_id = t.id AND se.student_id = s.id
  WHERE us.school_id = $1
    AND us.role_in_school = 'teacher'
    AND us.approved = true
  GROUP BY t.id, t.fullname, t.email
  ORDER BY total_students DESC;

`,
    [schoolDbId]
  );

  res.render("school-admin/dashboard", {
    schoolAdmin: req.session.user,
    school: { id: schoolDbId, name: schoolName },
    pendingUsers: pendingUsers.rows,
    classrooms: classrooms.rows,
    teachers: teachers.rows,
    students: students.rows,
    recentActivities: recentActivities.rows, // ✅ pass it
    teacherPerformance: teacherPerformance.rows, // ✅ add this
    studentEngagement: studentEngagement.rows, // ✅ add this
    info,
    profilePic,
  });
};

exports.loadSection = async (req, res) => {
  const section = req.params.section;
  const schoolId = req.session.user.school_id;

  if (section === "teachers") {
    const teachers = await pool.query(
      `SELECT u.id, u.fullname, u.email, us.joined_at
       FROM users2 u
       JOIN user_school us ON u.id = us.user_id
       WHERE us.school_id = $1 AND us.role_in_school = 'teacher' AND us.approved = true`,
      [schoolId]
    );
    return res.render("partials/teachers", { teachers: teachers.rows });
  }

  if (section === "students") {
    const students = await pool.query(
      `SELECT u.id, u.fullname, u.email, us.joined_at
       FROM users2 u
       JOIN user_school us ON u.id = us.user_id
       WHERE us.school_id = $1 AND us.role_in_school = 'student' AND us.approved = true`,
      [schoolId]
    );
    return res.render("partials/students", { students: students.rows });
  }

  if (section === "classrooms") {
    const classrooms = await pool.query(
      `SELECT c.id, c.name,
         COALESCE(STRING_AGG(u.fullname, ', '), 'Unassigned') AS teacher_names,
         COALESCE(ARRAY_AGG(u.id) FILTER (WHERE u.id IS NOT NULL), '{}') AS teacher_ids,
         (SELECT COUNT(*) 
            FROM user_school us2 
           WHERE us2.classroom_id = c.id
             AND us2.role_in_school = 'student'
             AND us2.approved = true) AS student_count
       FROM classrooms c
       LEFT JOIN classroom_teachers ct ON c.id = ct.classroom_id
       LEFT JOIN users2 u ON u.id = ct.teacher_id
       WHERE c.school_id = $1
       GROUP BY c.id, c.name;`,
      [schoolId]
    );

    const availableStudents = await pool.query(
      `SELECT u.id, u.fullname, u.email
       FROM users2 u
       JOIN user_school us ON u.id = us.user_id
       WHERE us.school_id = $1 
         AND us.role_in_school = 'student' 
         AND us.approved = true`,
      [schoolId]
    );

    for (let c of classrooms.rows) {
      const studentRows = await pool.query(
        `SELECT u.id, u.fullname, u.email, us.joined_at
         FROM users2 u
         JOIN user_school us ON u.id = us.user_id
         WHERE us.school_id = $1 AND us.classroom_id = $2 
           AND us.role_in_school = 'student' AND us.approved = true`,
        [schoolId, c.id]
      );
      c.students = studentRows.rows;
      c.availableStudents = availableStudents.rows.filter(
        (stu) => !studentRows.rows.some((s) => s.id === stu.id)
      );
    }

    const openClassroom = req.query.openClassroom || null;
    return res.render("partials/classrooms", {
      classrooms: classrooms.rows,
      openClassroom,
    });
  }

  if (section === "approvals") {
    const pendingUsers = await pool.query(
      `SELECT u.id, u.fullname, u.email, us.role_in_school, us.joined_at
       FROM users2 u
       JOIN user_school us ON u.id = us.user_id
       WHERE us.school_id = $1 AND us.approved = false`,
      [schoolId]
    );
    return res.render("partials/approvals", {
      pendingUsers: pendingUsers.rows,
    });
  }

  // === Quotes ===
  if (section === "quotes") {
    const quotes = await pool.query(
      "SELECT id, requested_students, price_quote, status, created_at FROM quotes WHERE school_id=$1 ORDER BY id DESC",
      [schoolId]
    );
    return res.render("partials/quotes", { quotes: quotes.rows });
  }

  // === Payments (with adjustments) ===
  if (section === "payments") {
    const payments = await pool.query(
      `SELECT sp.id,
            sp.amount AS base_amount,
            COALESCE(SUM(adj.extra_amount), 0) AS adjustments_total,
            (sp.amount + COALESCE(SUM(adj.extra_amount), 0)) AS total_amount,
            sp.student_limit + COALESCE(SUM(adj.extra_students), 0) AS effective_student_limit,
            sp.status,
            sp.start_date,
            sp.end_date,
            sp.created_at
     FROM school_payments sp
     LEFT JOIN school_payment_adjustments adj
       ON sp.id = adj.school_payment_id AND adj.status = 'paid'
     WHERE sp.school_id = $1
     GROUP BY sp.id
     ORDER BY sp.created_at DESC`,
      [schoolId]
    );

    return res.render("partials/payments", { payments: payments.rows });
  }

  if (section === "classroom-courses") {
    const classrooms = await pool.query(
      "SELECT id, name FROM classrooms WHERE school_id=$1",
      [schoolId]
    );

    // ✅ Only fetch courses assigned to this school
    const courses = await pool.query(
      `SELECT c.id, c.title
     FROM courses c
     INNER JOIN school_courses sc ON c.id = sc.course_id
     WHERE sc.school_id = $1
     ORDER BY c.title`,
      [schoolId]
    );

    const classroomCourses = await pool.query(
      `SELECT cc.id, c.name AS classroom, cr.title AS course
     FROM classroom_courses cc
     JOIN classrooms c ON cc.classroom_id = c.id
     JOIN courses cr ON cc.course_id = cr.id
     WHERE c.school_id=$1`,
      [schoolId]
    );

    return res.render("partials/classroom-courses", {
      classrooms: classrooms.rows,
      courses: courses.rows, // ✅ now only school courses
      classroomCourses: classroomCourses.rows,
    });
  }

  if (section === "overview") {
    const pendingUsers = await pool.query(
      `SELECT u.id, u.fullname, u.email, us.role_in_school, us.joined_at, u.profile_picture
       FROM users2 u
       JOIN user_school us ON u.id = us.user_id
       WHERE us.school_id = $1 AND us.approved = false`,
      [schoolId]
    );

    const classrooms = await pool.query(
      `SELECT c.id, c.name,
         COALESCE(STRING_AGG(u.fullname, ', '), 'Unassigned') AS teacher_names,
         COALESCE(ARRAY_AGG(u.id) FILTER (WHERE u.id IS NOT NULL), '{}') AS teacher_ids,
         (SELECT COUNT(*) 
            FROM user_school us2 
           WHERE us2.classroom_id = c.id
             AND us2.role_in_school = 'student'
             AND us2.approved = true) AS student_count
       FROM classrooms c
       LEFT JOIN classroom_teachers ct ON c.id = ct.classroom_id
       LEFT JOIN users2 u ON u.id = ct.teacher_id
       WHERE c.school_id = $1
       GROUP BY c.id, c.name;`,
      [schoolId]
    );

    const teachers = await pool.query(
      `SELECT u.id, u.fullname, u.email, us.joined_at
       FROM users2 u
       JOIN user_school us ON u.id = us.user_id
       WHERE us.school_id = $1 AND us.role_in_school = 'teacher' AND us.approved = true`,
      [schoolId]
    );

    const students = await pool.query(
      `SELECT u.id, u.fullname, u.email, us.joined_at
       FROM users2 u
       JOIN user_school us ON u.id = us.user_id
       WHERE us.school_id = $1 AND us.role_in_school = 'student' AND us.approved = true`,
      [schoolId]
    );

    // ✅ Recent activities
    const recentActivities = await pool.query(
      `SELECT a.id, a.action, a.details, a.role, a.scope, a.created_at, u.fullname
     FROM activities a
     LEFT JOIN users2 u ON a.user_id = u.id
     WHERE a.school_id = $1 OR a.scope = 'global'
     ORDER BY a.created_at DESC
     LIMIT 10`,
      [schoolId]
    );

    // Student Engagement
    const studentEngagement = await pool.query(
      `SELECT 
    u.id,
    u.fullname,
    u.email,
    COUNT(DISTINCT l.id) AS total_lessons,  -- all lessons available in their classrooms
    COUNT(DISTINCT ulp.lesson_id) FILTER (WHERE ulp.completed_at IS NOT NULL) AS lessons_completed,
    COUNT(DISTINCT a.id) AS activities_logged,
    COALESCE(
      ROUND(
        (COUNT(DISTINCT ulp.lesson_id) FILTER (WHERE ulp.completed_at IS NOT NULL)::numeric /
         NULLIF(COUNT(DISTINCT l.id), 0)) * 100
      , 1),
      0
    ) AS engagement_rate
FROM users2 u
JOIN user_school us 
    ON u.id = us.user_id
JOIN classrooms c 
    ON us.classroom_id = c.id
JOIN classroom_courses cc 
    ON c.id = cc.classroom_id
JOIN courses cr 
    ON cc.course_id = cr.id
JOIN modules m 
    ON cr.id = m.course_id
JOIN lessons l 
    ON m.id = l.module_id
LEFT JOIN user_lesson_progress ulp 
    ON ulp.user_id = u.id AND ulp.lesson_id = l.id
LEFT JOIN activities a 
    ON a.user_id = u.id
WHERE us.school_id = $1
  AND us.role_in_school = 'student'
  AND us.approved = true
GROUP BY u.id, u.fullname, u.email
ORDER BY engagement_rate DESC;

`,
      [schoolId]
    );
    // Teacher Performance
    const teacherPerformance = await pool.query(
      `WITH student_engagement AS (
    SELECT 
      u.id AS student_id,             -- ✅ use users2.id instead of user_school.id
      ct.teacher_id,
      COUNT(DISTINCT ulp.lesson_id) FILTER (WHERE ulp.completed_at IS NOT NULL) AS lessons_completed,
      COUNT(DISTINCT l.id) AS total_lessons
    FROM classroom_teachers ct
    JOIN user_school us2 
      ON ct.classroom_id = us2.classroom_id
     AND us2.role_in_school = 'student'
     AND us2.approved = true
    JOIN users2 u 
      ON us2.user_id = u.id           -- ✅ proper student link
    LEFT JOIN classroom_courses cc 
      ON ct.classroom_id = cc.classroom_id
    LEFT JOIN courses cr 
      ON cc.course_id = cr.id
    LEFT JOIN modules m 
      ON cr.id = m.course_id
    LEFT JOIN lessons l 
      ON m.id = l.module_id
    LEFT JOIN user_lesson_progress ulp 
      ON ulp.user_id = u.id AND ulp.lesson_id = l.id
    GROUP BY u.id, ct.teacher_id
  )
  SELECT 
    t.id,
    t.fullname,
    t.email,
    COUNT(DISTINCT ct.classroom_id) AS classrooms_assigned,
    COUNT(DISTINCT s.id) AS total_students,
    ROUND(
      COALESCE(AVG(
        CASE WHEN se.total_lessons > 0 
             THEN (se.lessons_completed::numeric / se.total_lessons) * 100
             ELSE 0
        END
      ), 0), 1
    ) AS avg_engagement
  FROM users2 t
  JOIN user_school us 
    ON t.id = us.user_id
  LEFT JOIN classroom_teachers ct 
    ON t.id = ct.teacher_id
  LEFT JOIN user_school s 
    ON ct.classroom_id = s.classroom_id 
   AND s.role_in_school = 'student'
   AND s.approved = true
  LEFT JOIN student_engagement se 
    ON se.teacher_id = t.id AND se.student_id = s.id
  WHERE us.school_id = $1
    AND us.role_in_school = 'teacher'
    AND us.approved = true
  GROUP BY t.id, t.fullname, t.email
  ORDER BY total_students DESC;

`,
      [schoolId]
    );

    return res.render("partials/overview", {
      schoolAdmin: req.session.user,
      school: { id: schoolId, name: req.session.user.school_name },
      pendingUsers: pendingUsers.rows,
      classrooms: classrooms.rows,
      teachers: teachers.rows,
      students: students.rows,
      recentActivities: recentActivities.rows, // ✅ pass it
      teacherPerformance: teacherPerformance.rows, // ✅ add this
      studentEngagement: studentEngagement.rows, // ✅ add this
    });
  }

  return res.send("<p>Section not found.</p>");
};

// Approve user (set approved = true)
// exports.approveUser = async (req, res) => {
//   const { id } = req.params;
//   await pool.query(
//     `UPDATE user_school
//      SET approved = true
//      WHERE user_id = $1 AND school_id = $2`,
//     [id, req.session.user.school_id]
//   );

//   // 📝 Log activity
//   await logActivityForUser(req, "User approved", `Approved user ID: ${id}`);

//   res.redirect("/school-admin/dashboard");
// };
// controllers/schoolAdminController.js
exports.approveUser = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(
      `UPDATE user_school 
       SET approved = true 
       WHERE user_id = $1 AND school_id = $2`,
      [id, req.session.user.school_id]
    );

    await logActivityForUser(req, "User approved", `Approved user ID: ${id}`);

    if (req.xhr || req.headers.accept.indexOf("json") > -1) {
      return res.json({ success: true, id });
    }

    res.redirect("/school-admin/dashboard");
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// Bulk approval
exports.approveAllUsers = async (req, res) => {
  try {
    await pool.query(
      `UPDATE user_school
       SET approved = true
       WHERE school_id = $1 AND approved = false`,
      [req.session.user.school_id]
    );

    await logActivityForUser(req, "Bulk approval", "Approved all pending users");

    if (req.xhr || req.headers.accept.indexOf("json") > -1) {
      return res.json({ success: true });
    }

    res.redirect("/school-admin/dashboard");
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
};



// Reject user (remove link)
exports.rejectUser = async (req, res) => {
  const { id } = req.params;
  await pool.query(
    `DELETE FROM user_school 
     WHERE user_id = $1 AND school_id = $2`,
    [id, req.session.user.school_id]
  );
  res.redirect("/school-admin/dashboard");
};

// List classrooms
exports.listClassrooms = async (req, res) => {
  const schoolId = req.session.user.school_id;
  const result = await pool.query(
    "SELECT * FROM classrooms WHERE school_id = $1",
    [schoolId]
  );
  res.render("school-admin/classrooms", { classrooms: result.rows });
};

// Create classroom
exports.createClassroom = async (req, res) => {
  const schoolId = req.session.user.school_id;
  const { name, teacher_id } = req.body;

  try {
    // Step 1: create classroom
    const result = await pool.query(
      "INSERT INTO classrooms (school_id, name) VALUES ($1, $2) RETURNING id",
      [schoolId, name]
    );

    const classroomId = result.rows[0].id;
     await logActivityForUser(req, "Classroom created", `Classroom: ${name}`);


    // Step 2: assign teachers (into classroom_teachers)
    if (teacher_id) {
      const teacherIds = Array.isArray(teacher_id) ? teacher_id : [teacher_id];
      for (const tid of teacherIds) {
        await pool.query(
          `INSERT INTO classroom_teachers (classroom_id, teacher_id)
           VALUES ($1, $2)
           ON CONFLICT (classroom_id, teacher_id) DO NOTHING`,
          [classroomId, tid]
        );
      }
    }

    res.redirect("/school-admin/dashboard");
  } catch (err) {
    console.error("Error creating classroom:", err);
    res.status(500).send("Server error while creating classroom");
  }
};

// Assign student/teacher to a classroom
exports.assignToClassroom = async (req, res) => {
  const { classroomId, userId } = req.params;

  // Check if this is a teacher or student
  const roleResult = await pool.query(
    `SELECT role_in_school FROM user_school WHERE user_id = $1 AND school_id = $2`,
    [userId, req.session.user.school_id]
  );

  if (!roleResult.rows.length) {
    return res.status(400).send("User not part of this school");
  }

  const role = roleResult.rows[0].role_in_school;

  if (role === "student") {
    await pool.query(
      `UPDATE user_school
       SET classroom_id = $1
       WHERE user_id = $2 AND school_id = $3`,
      [classroomId, userId, req.session.user.school_id]
    );
    await logActivityForUser(req, "Student assigned to classroon", `student ID: ${name}`);
  } else if (role === "teacher") {
    await pool.query(
      `INSERT INTO classroom_teachers (classroom_id, teacher_id)
       VALUES ($1, $2)
       ON CONFLICT (classroom_id, teacher_id) DO NOTHING`,
      [classroomId, userId]
    );
    await logActivityForUser(req, "Teacher assigned to classroom", `Teacher ID: ${userId}`);
  }

  res.redirect(`/school-admin/classrooms/${classroomId}`);
};


exports.viewClassroom = async (req, res) => {
  const { id } = req.params;

  const classroom = await pool.query("SELECT * FROM classrooms WHERE id = $1", [
    id,
  ]);

  const students = await pool.query(
    `SELECT u.* 
     FROM users2 u
     JOIN user_school us ON u.id = us.user_id
     WHERE us.classroom_id = $1 AND us.approved = true AND us.role_in_school = 'student'`,
    [id]
  );

//   const teachers = await pool.query(
//     `SELECT u.*
//      FROM users2 u
//      JOIN user_school us ON u.id = us.user_id
//      WHERE us.classroom_id = $1 AND us.approved = true AND us.role_in_school = 'teacher'`,
//     [id]
//   );

    const teachers = await pool.query(
      `SELECT u.* 
        FROM users2 u
        JOIN classroom_teachers ct ON u.id = ct.teacher_id
        WHERE ct.classroom_id = $1`,
      [id]
    );
  res.render("school-admin/classroom-detail", {
    classroom: classroom.rows[0],
    students: students.rows,
    teachers: teachers.rows,
  });
};

// Edit classroom form
exports.editClassroomForm = async (req, res) => {
  const { id } = req.params;
  const classroom = await pool.query("SELECT * FROM classrooms WHERE id = $1", [
    id,
  ]);
  res.render("school-admin/edit-classroom", { classroom: classroom.rows[0] });
};

// Update classroom
exports.updateClassroom = async (req, res) => {
  const { id } = req.params; // classroomId
  const { name, teacher_id } = req.body;

  try {
    // Step 1: update classroom name
    await pool.query("UPDATE classrooms SET name = $1 WHERE id = $2", [
      name,
      id,
    ]);
    await logActivityForUser(req, "Classroom renamed", `Classroom: ${name}`);

    // Step 2: clear old assignments
    await pool.query("DELETE FROM classroom_teachers WHERE classroom_id = $1", [
      id,
    ]);
    await logActivityForUser(req, "Teacher Deleted from classroom", `Classroom: ${name}`);
    // Step 3: insert new teacher list
    if (teacher_id) {
      const teacherIds = Array.isArray(teacher_id) ? teacher_id : [teacher_id];
      for (const tid of teacherIds) {
        await pool.query(
          `INSERT INTO classroom_teachers (classroom_id, teacher_id)
           VALUES ($1, $2)
           ON CONFLICT (classroom_id, teacher_id) DO NOTHING`,
          [id, tid]
        );
        await logActivityForUser(
          req,
          "Teacher assigned to class",
          `Classroom: ${tid}`
        );
      }
    }
    await logActivityForUser(req, "Classroom updated", `Classroom: ${name}`);
    res.redirect("/school-admin/dashboard");
  } catch (err) {
    console.error("Error updating classroom:", err);
    res.status(500).send("Server error while updating classroom");
  }
};


// Delete classroom
exports.deleteClassroom = async (req, res) => {
  const { id } = req.params;
  await pool.query("DELETE FROM classrooms WHERE id = $1", [id]);
  await logActivityForUser(req, "Classroom deleted", `Classroom ID: ${id}`);
  res.redirect("/school-admin/dashboard");
};

// exports.loadSection = async (req, res) => {
//   const section = req.params.section;

//   if (section === "teachers") {
//     const teachers = await pool.query(
//       `SELECT u.id, u.fullname, u.email, us.joined_at
//        FROM users2 u
//        JOIN user_school us ON u.id = us.user_id
//        WHERE us.school_id = $1 AND us.role_in_school = 'teacher' AND us.approved = true`,
//       [req.session.user.school_id]
//     );
//     return res.render("partials/teachers", {
//       teachers: teachers.rows,
//     });
//   }

//   if (section === "students") {
//     const students = await pool.query(
//       `SELECT u.id, u.fullname, u.email, us.joined_at
//        FROM users2 u
//        JOIN user_school us ON u.id = us.user_id
//        WHERE us.school_id = $1 AND us.role_in_school = 'student' AND us.approved = true`,
//       [req.session.user.school_id]
//     );
//     return res.render("partials/students", {
//       students: students.rows,
//     });
//   }

    
// // if (section === "classrooms") {
// //   const classrooms = await pool.query(
// //     `SELECT c.id, c.name,
// //        COALESCE(STRING_AGG(u.fullname, ', '), 'Unassigned') AS teacher_names,
// //        COALESCE(ARRAY_AGG(u.id) FILTER (WHERE u.id IS NOT NULL), '{}') AS teacher_ids,
// //        (SELECT COUNT(*)
// //           FROM user_school us2
// //          WHERE us2.classroom_id = c.id
// //            AND us2.role_in_school = 'student'
// //            AND us2.approved = true) AS student_count
// //      FROM classrooms c
// //      LEFT JOIN classroom_teachers ct ON c.id = ct.classroom_id
// //      LEFT JOIN users2 u ON u.id = ct.teacher_id
// //      WHERE c.school_id = $1
// //      GROUP BY c.id, c.name;`,
// //     [req.session.user.school_id]
// //   );

// //   // ✅ all approved students (for dropdown)
// //   const students = await pool.query(
// //     `SELECT u.id, u.fullname, u.email
// //      FROM users2 u
// //      JOIN user_school us ON u.id = us.user_id
// //      WHERE us.school_id = $1
// //        AND us.role_in_school = 'student'
// //        AND us.approved = true`,
// //     [req.session.user.school_id]
// //   );

// //   // Fetch students per classroom
// //   for (let c of classrooms.rows) {
// //     const studentRows = await pool.query(
// //       `SELECT u.id, u.fullname, u.email, us.joined_at
// //        FROM users2 u
// //        JOIN user_school us ON u.id = us.user_id
// //        WHERE us.school_id = $1 AND us.classroom_id = $2
// //          AND us.role_in_school = 'student' AND us.approved = true`,
// //       [req.session.user.school_id, c.id]
// //     );
// //     c.students = studentRows.rows;
// //   }

// //   return res.render("partials/classrooms", {
// //     classrooms: classrooms.rows,
// //     availableStudents: students.rows, // ✅ now defined
// //   });
// // }

// if (section === "classrooms") {
//   const classrooms = await pool.query(
//     `SELECT c.id, c.name,
//        COALESCE(STRING_AGG(u.fullname, ', '), 'Unassigned') AS teacher_names,
//        COALESCE(ARRAY_AGG(u.id) FILTER (WHERE u.id IS NOT NULL), '{}') AS teacher_ids,
//        (SELECT COUNT(*)
//           FROM user_school us2
//          WHERE us2.classroom_id = c.id
//            AND us2.role_in_school = 'student'
//            AND us2.approved = true) AS student_count
//      FROM classrooms c
//      LEFT JOIN classroom_teachers ct ON c.id = ct.classroom_id
//      LEFT JOIN users2 u ON u.id = ct.teacher_id
//      WHERE c.school_id = $1
//      GROUP BY c.id, c.name;`,
//     [req.session.user.school_id]
//   );

//   // ✅ fetch all approved students (for dropdown)
//   const availableStudents = await pool.query(
//     `SELECT u.id, u.fullname, u.email
//      FROM users2 u
//      JOIN user_school us ON u.id = us.user_id
//      WHERE us.school_id = $1
//        AND us.role_in_school = 'student'
//        AND us.approved = true`,
//     [req.session.user.school_id]
//   );

//   // ✅ fetch students per classroom
//   for (let c of classrooms.rows) {
//     const studentRows = await pool.query(
//       `SELECT u.id, u.fullname, u.email, us.joined_at
//        FROM users2 u
//        JOIN user_school us ON u.id = us.user_id
//        WHERE us.school_id = $1 AND us.classroom_id = $2
//          AND us.role_in_school = 'student' AND us.approved = true`,
//       [req.session.user.school_id, c.id]
//     );
//     c.students = studentRows.rows;

//     // ❌ filter out students already in this classroom
//     c.availableStudents = availableStudents.rows.filter(
//       (stu) => !studentRows.rows.some((s) => s.id === stu.id)
//     );
//   }
  

//     const openClassroom = req.query.openClassroom || null;
//   return res.render("partials/classrooms", {
//     classrooms: classrooms.rows,
//     openClassroom,
//   });
// }


//   if (section === "approvals") {
//     const pendingUsers = await pool.query(
//       `SELECT u.id, u.fullname, u.email, us.role_in_school, us.joined_at
//        FROM users2 u
//        JOIN user_school us ON u.id = us.user_id
//        WHERE us.school_id = $1 AND us.approved = false`,
//       [req.session.user.school_id]
//     );
//     return res.render("partials/approvals", {
//       pendingUsers: pendingUsers.rows,
//     });
//   }

//   if (section === "overview") {
//     if (section === "overview") {
//   // Get everything just like getDashboard
//   const schoolDbId = req.session.user.school_id;

//   const pendingUsers = await pool.query(
//     `SELECT u.id, u.fullname, u.email, us.role_in_school, us.joined_at, u.profile_picture
//      FROM users2 u
//      JOIN user_school us ON u.id = us.user_id
//      WHERE us.school_id = $1 AND us.approved = false`,
//     [schoolDbId]
//   );

//   const classrooms = await pool.query(
//     `SELECT c.id, c.name,
//        COALESCE(STRING_AGG(u.fullname, ', '), 'Unassigned') AS teacher_names,
//        COALESCE(ARRAY_AGG(u.id) FILTER (WHERE u.id IS NOT NULL), '{}') AS teacher_ids,
//        (SELECT COUNT(*)
//           FROM user_school us2
//          WHERE us2.classroom_id = c.id
//            AND us2.role_in_school = 'student'
//            AND us2.approved = true) AS student_count
//      FROM classrooms c
//      LEFT JOIN classroom_teachers ct ON c.id = ct.classroom_id
//      LEFT JOIN users2 u ON u.id = ct.teacher_id
//      WHERE c.school_id = $1
//      GROUP BY c.id, c.name;`,
//     [schoolDbId]
//   );

//   const teachers = await pool.query(
//     `SELECT u.id, u.fullname, u.email, us.joined_at
//      FROM users2 u
//      JOIN user_school us ON u.id = us.user_id
//      WHERE us.school_id = $1 AND us.role_in_school = 'teacher' AND us.approved = true`,
//     [schoolDbId]
//   );

//   const students = await pool.query(
//     `SELECT u.id, u.fullname, u.email, us.joined_at
//      FROM users2 u
//      JOIN user_school us ON u.id = us.user_id
//      WHERE us.school_id = $1 AND us.role_in_school = 'student' AND us.approved = true`,
//     [schoolDbId]
//   );

//   return res.render("partials/overview", {
//     schoolAdmin: req.session.user,
//     school: { id: schoolDbId, name: req.session.user.school_name },
//     pendingUsers: pendingUsers.rows,
//     classrooms: classrooms.rows,
//     teachers: teachers.rows,
//     students: students.rows,
//   });
// }

//   }

//   return res.send("<p>Section not found.</p>");
// };




exports.addStudentToClassroom = async (req, res) => {
  const classroomId = req.params.id;
  const { student_id } = req.body;
  const schoolId = req.session.user.school_id;

  try {
    if (!student_id) {
      return res
        .status(400)
        .json({ success: false, message: "No student selected." });
    }

    // Verify the student exists and is approved
    const studentResult = await pool.query(
      `SELECT u.id, u.fullname, u.email, us.joined_at
       FROM users2 u
       JOIN user_school us ON u.id = us.user_id
       WHERE u.id = $1 AND us.school_id = $2 
         AND us.role_in_school = 'student' 
         AND us.approved = true`,
      [student_id, schoolId]
    );

    if (!studentResult.rows.length) {
      return res
        .status(404)
        .json({
          success: false,
          message: "Student not found or not approved.",
        });
    }

    const student = studentResult.rows[0];

    // Update user_school with the classroom assignment
    await pool.query(
      `UPDATE user_school
       SET classroom_id = $1
       WHERE user_id = $2 AND school_id = $3 
         AND role_in_school = 'student' 
         AND approved = true`,
      [classroomId, student_id, schoolId]
    );

    // ✅ Return JSON for AJAX
    res.json({
      success: true,
      student,
    });
  } catch (err) {
    console.error("Error adding student to classroom:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error while adding student" });
  }
};


// ------------------ QUOTES ------------------ //
exports.getQuotes = async (req, res) => {
  try {
    const schoolId = req.session.user.school_id;
    const quotes = await pool.query(
      "SELECT id, text, author FROM quotes WHERE school_id=$1 ORDER BY id DESC",
      [schoolId]
    );
    res.render("partials/quotes", { quotes: quotes.rows });
  } catch (err) {
    console.error("Error fetching quotes:", err);
    res.status(500).send("Server Error");
  }
};

// exports.addQuote = async (req, res) => {
//   try {
//     const { text, author } = req.body;
//     const schoolId = req.session.user.school_id;

//     await pool.query(
//       "INSERT INTO quotes (text, author, school_id) VALUES ($1, $2, $3)",
//       [text, author, schoolId]
//     );
//     res.redirect("/school-admin/dashboard");
//   } catch (err) {
//     console.error("Error adding quote:", err);
//     res.status(500).send("Server Error");
//   }
// };

exports.addQuote = async (req, res) => {
  try {
    const { requested_students, price_quote } = req.body;
    const schoolId = req.session.user.school_id;

    await pool.query(
      `INSERT INTO quotes (school_id, requested_students, price_quote, status) 
       VALUES ($1, $2, $3, 'pending')`,
      [schoolId, requested_students, price_quote]
    );
    await logActivityForUser(req, "quote created created", `School ID: ${schoolId}`);

    res.redirect("/school-admin/dashboard");
  } catch (err) {
    console.error("Error adding quote:", err);
    res.status(500).send("Server Error");
  }
};


exports.deleteQuote = async (req, res) => {
  try {
    await pool.query("DELETE FROM quotes WHERE id=$1", [req.params.id]);
    
    res.redirect("/school-admin/dashboard");
  } catch (err) {
    console.error("Error deleting quote:", err);
    res.status(500).send("Server Error");
  }
};

// ------------------ PAYMENTS ------------------ //
exports.getPayments = async (req, res) => {
  try {
    const schoolId = req.session.user.school_id;
    const payments = await pool.query(
      `SELECT p.id, u.fullname, p.amount, p.status, p.updated_at
       FROM payments p
       JOIN users2 u ON p.user_id = u.id
       WHERE p.school_id=$1
       ORDER BY p.updated_at DESC`,
      [schoolId]
    );
    res.render("partials/payments", { payments: payments.rows });
  } catch (err) {
    console.error("Error fetching payments:", err);
    res.status(500).send("Server Error");
  }
};

exports.updatePayment = async (req, res) => {
  try {
    const { paymentId, status } = req.body;
    await pool.query("UPDATE payments SET status=$1 WHERE id=$2", [
      status,
      paymentId,
    ]);
    res.redirect("/school-admin/dashboard");
  } catch (err) {
    console.error("Error updating payment:", err);
    res.status(500).send("Server Error");
  }
};

// ------------------ CLASSROOM ↔ COURSES ------------------ //
// exports.getClassroomCourses = async (req, res) => {
//   try {
//     const schoolId = req.session.user.school_id;

//     const classrooms = await pool.query(
//       "SELECT id, name FROM classrooms WHERE school_id=$1",
//       [schoolId]
//     );

//     const courses = await pool.query(
//       "SELECT id, title FROM courses ORDER BY title"
//     );

//     const classroomCourses = await pool.query(
//       `SELECT cc.id, c.name AS classroom, cr.title AS course
//        FROM classroom_courses cc
//        JOIN classrooms c ON cc.classroom_id = c.id
//        JOIN courses cr ON cc.course_id = cr.id
//        WHERE c.school_id=$1
//        ORDER BY c.name, cr.title`,
//       [schoolId]
//     );

//     res.render("partials/classroom-courses", {
//       classrooms: classrooms.rows,
//       courses: courses.rows,
//       classroomCourses: classroomCourses.rows,
//     });
//   } catch (err) {
//     console.error("Error fetching classroom courses:", err);
//     res.status(500).send("Server Error");
//   }
// };

// 📌 School Admin: Manage classroom-course assignments
exports.getClassroomCourses = async (req, res) => {
  try {
    const schoolId = req.session.user.school_id;
    console.log("School Admin Dashboard -> School ID:", schoolId);

    // ✅ Only classrooms for this school
    const classrooms = await pool.query(
      "SELECT id, name FROM classrooms WHERE school_id=$1",
      [schoolId]
    );

    // ✅ Only fetch courses assigned to this school (via school_courses)
    const courses = await pool.query(
      `SELECT c.id, c.title
       FROM courses c
       INNER JOIN school_courses sc ON c.id = sc.course_id
       WHERE sc.school_id = $1
       ORDER BY c.title`,
      [schoolId]
    );

    console.log("Allowed Courses for this school:", courses.rows);

    // ✅ Classroom-course assignments only for this school
    const classroomCourses = await pool.query(
      `SELECT cc.id, c.name AS classroom, cr.title AS course
       FROM classroom_courses cc
       JOIN classrooms c ON cc.classroom_id = c.id
       JOIN courses cr ON cc.course_id = cr.id
       WHERE c.school_id=$1
       ORDER BY c.name, cr.title`,
      [schoolId]
    );

    res.render("partials/classroom-courses", {
      classrooms: classrooms.rows,
      courses: courses.rows, // ✅ filtered by school
      classroomCourses: classroomCourses.rows,
    });
  } catch (err) {
    console.error("Error fetching classroom courses:", err);
    res.status(500).send("Server Error");
  }
};



// exports.assignCourseToClassroom = async (req, res) => {
//   try {
//     const { classroomId, courseId } = req.body;

//     // prevent duplicate assignment
//     const exists = await pool.query(
//       "SELECT 1 FROM classroom_courses WHERE classroom_id=$1 AND course_id=$2",
//       [classroomId, courseId]
//     );

//     if (exists.rows.length === 0) {
//       await pool.query(
//         "INSERT INTO classroom_courses (classroom_id, course_id) VALUES ($1, $2)",
//         [classroomId, courseId]
//       );
//     }

//     res.redirect("/school-admin/dashboard");
//   } catch (err) {
//     console.error("Error assigning course:", err);
//     res.status(500).send("Server Error");
//   }
// };

exports.assignCourseToClassroom = async (req, res) => {
  try {
    const { classroomId, courseId } = req.body;
    const schoolId = req.session.user.school_id;

    // ✅ Check that this course actually belongs to the school
    const validCourse = await pool.query(
      "SELECT 1 FROM school_courses WHERE school_id=$1 AND course_id=$2",
      [schoolId, courseId]
    );
    if (!validCourse.rows.length) {
      return res.status(403).send("Not allowed to assign this course.");
    }

    // ✅ Prevent duplicates
    const exists = await pool.query(
      "SELECT 1 FROM classroom_courses WHERE classroom_id=$1 AND course_id=$2",
      [classroomId, courseId]
    );

    if (!exists.rows.length) {
      await pool.query(
        "INSERT INTO classroom_courses (classroom_id, course_id) VALUES ($1, $2)",
        [classroomId, courseId]
      );
    }
    await logActivityForUser(req, "course assigned to classroom", `Classroom ID: ${classroomId}`);
    res.redirect("/school-admin/dashboard");
  } catch (err) {
    console.error("Error assigning course:", err);
    res.status(500).send("Server Error");
  }
};


exports.updateClassroomCourse = async (req, res) => {
  try {
    const { courseId } = req.body;
    const { id } = req.params; // classroom_course.id

    await pool.query(
      "UPDATE classroom_courses SET course_id=$1 WHERE id=$2",
      [courseId, id]
    );
    await logActivityForUser(req, "Classroom course updated", `Course ID: ${courseId}`);

    res.redirect("/school-admin/dashboard");
  } catch (err) {
    console.error("Error updating classroom course:", err);
    res.status(500).send("Server Error");
  }
};

exports.deleteClassroomCourse = async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query("DELETE FROM classroom_courses WHERE id=$1", [id]);

    res.redirect("/school-admin/dashboard");
  } catch (err) {
    console.error("Error deleting classroom course:", err);
    res.status(500).send("Server Error");
  }
};


// POST /school/payments/:paymentId/adjustments
exports.addPaymentAdjustment = async (req, res) => {
  const { paymentId } = req.params;
  const { extra_students, extra_amount } = req.body;

  const result = await pool.query(
    `INSERT INTO school_payment_adjustments (school_payment_id, extra_students, extra_amount)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [paymentId, extra_students, extra_amount]
  );

  res.json({ success: true, adjustment: result.rows[0] });
};


