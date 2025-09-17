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
    `SELECT c.*,
            t.fullname AS teacher_name,
            (SELECT COUNT(*) 
               FROM user_school us2 
              WHERE us2.classroom_id = c.id 
                AND us2.role_in_school = 'student' 
                AND us2.approved = true
            ) AS student_count
     FROM classrooms c
     LEFT JOIN user_school us ON us.classroom_id = c.id 
                             AND us.role_in_school = 'teacher' 
                             AND us.approved = true
     LEFT JOIN users2 t ON t.id = us.user_id
     WHERE c.school_id = $1`,
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
  await pool.query(
    "INSERT INTO classrooms (school_id, name, teacher_id) VALUES ($1, $2, $3)",
    [schoolId, name, teacher_id || null]
  );
  res.redirect("/school-admin/classrooms");
};

// Assign student/teacher to a classroom
exports.assignToClassroom = async (req, res) => {
  const { classroomId, userId } = req.params;
  await pool.query(
    `UPDATE user_school
     SET classroom_id = $1
     WHERE user_id = $2 AND school_id = $3`,
    [classroomId, userId, req.session.user.school_id]
  );
  res.redirect(`/school-admin/classrooms/${classroomId}`);
};

// View classroom
// View classroom
exports.viewClassroom = async (req, res) => {
  const { id } = req.params;
  const classroom = await pool.query("SELECT * FROM classrooms WHERE id = $1", [
    id,
  ]);
  const students = await pool.query(
    `SELECT u.* 
     FROM users2 u
     JOIN user_school us ON u.id = us.user_id
     WHERE us.classroom_id = $1 AND us.approved = true`,
    [id]
  );
  res.render("school-admin/classroom-detail", {
    classroom: classroom.rows[0],
    students: students.rows,
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
  const { id } = req.params;
  const { name, teacher_id } = req.body;
  await pool.query(
    "UPDATE classrooms SET name = $1, teacher_id = $2 WHERE id = $3",
    [name, teacher_id || null, id]
  );
  res.redirect("/school-admin/classrooms");
};

// Delete classroom
exports.deleteClassroom = async (req, res) => {
  const { id } = req.params;
  await pool.query("DELETE FROM classrooms WHERE id = $1", [id]);
  res.redirect("/school-admin/classrooms");
};
