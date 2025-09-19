// utils/activityHelper.js
const { logActivity } = require("./activityLogger");

async function logActivityForUser(req, action, details, scope = "school") {
  if (!req.session || !req.session.user) {
    console.warn("⚠️ No session user found for activity log");
    return;
  }

  const { id: userId, role, school_id: schoolId } = req.session.user;

  await logActivity({
    userId,
    role,
    action,
    details,
    schoolId: schoolId || null,
    scope,
  });
}

module.exports = logActivityForUser;
