// const pool = require("../models/db");

// async function logActivity({
//   userId,
//   role,
//   action,
//   details,
//   schoolId = null,
//   scope = null,
// }) {
//   try {
//     await pool.query(
//       `INSERT INTO activities (user_id, action, details, school_id, created_at)
//        VALUES ($1, $2, $3, $4, NOW())`,
//       [userId, action, details, schoolId]
//     );
//     console.log(`✅ Activity logged: ${role} - ${action}`);
//   } catch (err) {
//     console.error("❌ Failed to log activity:", err.message);
//   }
// }

// // Wrapper: auto-extract from session
// async function logActivityForUser(req, action, details, schoolId = null) {
//   if (!req.session?.user) return;

//   const { id: userId, role, school_id } = req.session.user;

//   return logActivity({
//     userId,
//     role,
//     action,
//     details,
//     schoolId: schoolId || schoolId, // prefer explicit, fallback to session
//     scope: schoolId || school_id ? "school" : "global",
//   });
// }

// module.exports = { logActivity, logActivityForUser };


const pool = require("../models/db");

async function logActivity({
  userId,
  role,
  action,
  details,
  schoolId = null,
  scope = "global",
}) {
  try {
    await pool.query(
      `INSERT INTO activities (user_id, role, action, details, school_id, scope, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [userId, role, action, details, schoolId, scope]
    );
    console.log(`✅ Activity logged: ${role} - ${action}`);
  } catch (err) {
    console.error("❌ Failed to log activity:", err.message);
  }
}

// Wrapper: auto-extract from session
async function logActivityForUser(req, action, details, schoolId = null) {
  if (!req.session?.user) return;

  const { id: userId, role, school_id } = req.session.user;

  return logActivity({
    userId,
    role,
    action,
    details,
    schoolId: schoolId || school_id || null,
    scope: schoolId || school_id ? "school" : "global",
  });
}

module.exports = { logActivity, logActivityForUser };
