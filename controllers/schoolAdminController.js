// controllers/schoolAdminController.js
const pool = require("../models/db");

// Dashboard: show pending users + classrooms

// exports.getDashboard = async (req, res) => {
//   const schoolId = req.session.user.school_id;

//     const infoResult = await pool.query(
//     "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
//     );
//     const info = infoResult.rows[0] || {};
//     const profilePic = req.session.user?.profile_picture || null;
//   // Pending teachers/students
//   const pendingUsers = await pool.query(
//     `SELECT u.id, u.fullname, u.email, us.role_in_school, us.joined_at
//      FROM users2 u
//      JOIN user_school us ON u.id = us.user_id
//      WHERE us.school_id = $1 AND us.approved = false`,
//     [schoolId]
//   );

//   // Classrooms for this school, including teacher from user_school
//   const classrooms = await pool.query(
//     `SELECT c.*,
//             t.fullname AS teacher_name,
//             (SELECT COUNT(*)
//                FROM user_school us2
//               WHERE us2.classroom_id = c.id
//                 AND us2.role_in_school = 'student'
//                 AND us2.approved = true
//             ) AS student_count
//      FROM classrooms c
//      LEFT JOIN user_school us ON us.classroom_id = c.id
//                              AND us.role_in_school = 'teacher'
//                              AND us.approved = true
//      LEFT JOIN users2 t ON t.id = us.user_id
//      WHERE c.school_id = $1`,
//     [schoolId]
//   );

//   res.render("school-admin/dashboard", {
//     schoolAdmin: req.session.user,
//     school: { id: schoolId, name: req.session.user.school_name },
//     pendingUsers: pendingUsers.rows,
//     classrooms: classrooms.rows,
//     info,
//     profilePic,
//   });
// };

// exports.getDashboard = async (req, res) => {
//   const schoolDbId = req.session.user.school_id; // already numeric PK
//   const schoolName = req.session.user.school_name; // from session

//   const infoResult = await pool.query(
//     "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
//   );
//   const info = infoResult.rows[0] || {};
//   const profilePic = req.session.user?.profile_picture || null;

//   // Pending teachers/students
//   const pendingUsers = await pool.query(
//     `SELECT u.id, u.fullname, u.email, us.role_in_school, us.joined_at
//      FROM users2 u
//      JOIN user_school us ON u.id = us.user_id
//      WHERE us.school_id = $1 AND us.approved = false`,
//     [schoolDbId]
//   );

//   // Classrooms
//   const classrooms = await pool.query(
//     `SELECT c.*,
//             t.fullname AS teacher_name,
//             (SELECT COUNT(*)
//                FROM user_school us2
//               WHERE us2.classroom_id = c.id
//                 AND us2.role_in_school = 'student'
//                 AND us2.approved = true
//             ) AS student_count
//      FROM classrooms c
//      LEFT JOIN user_school us ON us.classroom_id = c.id
//                              AND us.role_in_school = 'teacher'
//                              AND us.approved = true
//      LEFT JOIN users2 t ON t.id = us.user_id
//      WHERE c.school_id = $1`,
//     [schoolDbId]
//   );

//   // Teachers
//   const teachers = await pool.query(
//     `SELECT u.id, u.fullname, u.email, us.role_in_school, us.joined_at
//    FROM users2 u
//    JOIN user_school us ON u.id = us.user_id
//    WHERE us.school_id = $1 AND us.role_in_school = 'teacher' AND us.approved = true`,
//     [schoolDbId]
//   );

//   // Students
//   const students = await pool.query(
//     `SELECT u.id, u.fullname, u.email, us.role_in_school, us.joined_at
//    FROM users2 u
//    JOIN user_school us ON u.id = us.user_id
//    WHERE us.school_id = $1 AND us.role_in_school = 'student' AND us.approved = true`,
//     [schoolDbId]
//   );

//   res.render("school-admin/dashboard", {
//     schoolAdmin: req.session.user,
//     school: { id: schoolDbId, name: schoolName },
//     pendingUsers: pendingUsers.rows,
//     classrooms: classrooms.rows,
//     teachers: teachers.rows,
//     students: students.rows,
//     info,
//     profilePic,
//   });
// };

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

  res.render("school-admin/dashboard", {
    schoolAdmin: req.session.user,
    school: { id: schoolDbId, name: schoolName },
    pendingUsers: pendingUsers.rows,
    classrooms: classrooms.rows,
    teachers: teachers.rows,
    students: students.rows,
    info,
    profilePic,
  });
};


// Approve user (set approved = true)
exports.approveUser = async (req, res) => {
  const { id } = req.params;
  await pool.query(
    `UPDATE user_school 
     SET approved = true 
     WHERE user_id = $1 AND school_id = $2`,
    [id, req.session.user.school_id]
  );
  res.redirect("/school-admin/dashboard");
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
  } else if (role === "teacher") {
    await pool.query(
      `INSERT INTO classroom_teachers (classroom_id, teacher_id)
       VALUES ($1, $2)
       ON CONFLICT (classroom_id, teacher_id) DO NOTHING`,
      [classroomId, userId]
    );
  }

  res.redirect(`/school-admin/classrooms/${classroomId}`);
};


// View classroom
// exports.viewClassroom = async (req, res) => {
//   const { id } = req.params;
//   const classroom = await pool.query("SELECT * FROM classrooms WHERE id = $1", [
//     id,
//   ]);
//   const students = await pool.query(
//     `SELECT u.*
//      FROM users2 u
//      JOIN user_school us ON u.id = us.user_id
//      WHERE us.classroom_id = $1 AND us.approved = true`,
//     [id]
//   );
//   res.render("school-admin/classroom-detail", {
//     classroom: classroom.rows[0],
//     students: students.rows,
//   });
// };

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

    // Step 2: clear old assignments
    await pool.query("DELETE FROM classroom_teachers WHERE classroom_id = $1", [
      id,
    ]);

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
      }
    }

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
  res.redirect("/school-admin/dashboard");
};

exports.loadSection = async (req, res) => {
  const section = req.params.section;

  if (section === "teachers") {
    const teachers = await pool.query(
      `SELECT u.id, u.fullname, u.email, us.joined_at
       FROM users2 u
       JOIN user_school us ON u.id = us.user_id
       WHERE us.school_id = $1 AND us.role_in_school = 'teacher' AND us.approved = true`,
      [req.session.user.school_id]
    );
    return res.render("partials/teachers", {
      teachers: teachers.rows,
    });
  }

  if (section === "students") {
    const students = await pool.query(
      `SELECT u.id, u.fullname, u.email, us.joined_at
       FROM users2 u
       JOIN user_school us ON u.id = us.user_id
       WHERE us.school_id = $1 AND us.role_in_school = 'student' AND us.approved = true`,
      [req.session.user.school_id]
    );
    return res.render("partials/students", {
      students: students.rows,
    });
  }

    
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

//   // ✅ all approved students (for dropdown)
//   const students = await pool.query(
//     `SELECT u.id, u.fullname, u.email
//      FROM users2 u
//      JOIN user_school us ON u.id = us.user_id
//      WHERE us.school_id = $1 
//        AND us.role_in_school = 'student' 
//        AND us.approved = true`,
//     [req.session.user.school_id]
//   );

//   // Fetch students per classroom
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
//   }

//   return res.render("partials/classrooms", {
//     classrooms: classrooms.rows,
//     availableStudents: students.rows, // ✅ now defined
//   });
// }

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
    [req.session.user.school_id]
  );

  // ✅ fetch all approved students (for dropdown)
  const availableStudents = await pool.query(
    `SELECT u.id, u.fullname, u.email
     FROM users2 u
     JOIN user_school us ON u.id = us.user_id
     WHERE us.school_id = $1 
       AND us.role_in_school = 'student' 
       AND us.approved = true`,
    [req.session.user.school_id]
  );

  // ✅ fetch students per classroom
  for (let c of classrooms.rows) {
    const studentRows = await pool.query(
      `SELECT u.id, u.fullname, u.email, us.joined_at
       FROM users2 u
       JOIN user_school us ON u.id = us.user_id
       WHERE us.school_id = $1 AND us.classroom_id = $2 
         AND us.role_in_school = 'student' AND us.approved = true`,
      [req.session.user.school_id, c.id]
    );
    c.students = studentRows.rows;

    // ❌ filter out students already in this classroom
    c.availableStudents = availableStudents.rows.filter(
      (stu) => !studentRows.rows.some((s) => s.id === stu.id)
    );
  }

  return res.render("partials/classrooms", {
    classrooms: classrooms.rows,
  });
}


  if (section === "approvals") {
    const pendingUsers = await pool.query(
      `SELECT u.id, u.fullname, u.email, us.role_in_school, us.joined_at
       FROM users2 u
       JOIN user_school us ON u.id = us.user_id
       WHERE us.school_id = $1 AND us.approved = false`,
      [req.session.user.school_id]
    );
    return res.render("partials/approvals", {
      pendingUsers: pendingUsers.rows,
    });
  }

  if (section === "overview") {
    if (section === "overview") {
  // Get everything just like getDashboard
  const schoolDbId = req.session.user.school_id;

  const pendingUsers = await pool.query(
    `SELECT u.id, u.fullname, u.email, us.role_in_school, us.joined_at, u.profile_picture
     FROM users2 u
     JOIN user_school us ON u.id = us.user_id
     WHERE us.school_id = $1 AND us.approved = false`,
    [schoolDbId]
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
    [schoolDbId]
  );

  const teachers = await pool.query(
    `SELECT u.id, u.fullname, u.email, us.joined_at
     FROM users2 u
     JOIN user_school us ON u.id = us.user_id
     WHERE us.school_id = $1 AND us.role_in_school = 'teacher' AND us.approved = true`,
    [schoolDbId]
  );

  const students = await pool.query(
    `SELECT u.id, u.fullname, u.email, us.joined_at
     FROM users2 u
     JOIN user_school us ON u.id = us.user_id
     WHERE us.school_id = $1 AND us.role_in_school = 'student' AND us.approved = true`,
    [schoolDbId]
  );

  return res.render("partials/overview", {
    schoolAdmin: req.session.user,
    school: { id: schoolDbId, name: req.session.user.school_name },
    pendingUsers: pendingUsers.rows,
    classrooms: classrooms.rows,
    teachers: teachers.rows,
    students: students.rows,
  });
}

  }

  return res.send("<p>Section not found.</p>");
};

// exports.addStudentToClassroom = async (req, res) => {
//   const classroomId = req.params.id;
//   const { email } = req.body;
//   const schoolId = req.session.user.school_id;

//   try {
//     // Find the student by email
//     const studentResult = await pool.query(
//       `SELECT u.id
//        FROM users2 u
//        JOIN user_school us ON u.id = us.user_id
//        WHERE u.email = $1 AND us.school_id = $2
//          AND us.role_in_school = 'student'
//          AND us.approved = true`,
//       [email, schoolId]
//     );

//     if (!studentResult.rows.length) {
//       return res.status(404).send("Student not found or not approved.");
//     }

//     const studentId = studentResult.rows[0].id;

//     // Update user_school with the classroom assignment
//     await pool.query(
//       `UPDATE user_school
//        SET classroom_id = $1
//        WHERE user_id = $2 AND school_id = $3 AND role_in_school = 'student'`,
//       [classroomId, studentId, schoolId]
//     );

//     res.redirect("/school-admin/dashboard"); // 👈 or back to the section if using AJAX
//   } catch (err) {
//     console.error("Error adding student to classroom:", err);
//     res.status(500).send("Server error while adding student to classroom");
//   }
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



