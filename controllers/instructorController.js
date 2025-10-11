const pool = require("../models/db");



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
      `INSERT INTO messages (sender_id, receiver_id, message, is_read)
   VALUES ($1, $2, $3, FALSE)`,
      [senderId, receiverId, message]
    );


    res.json({ success: true, message: "Message sent successfully" });
  } catch (err) {
    console.error("Send chat message error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ✅ Get chat messages (conversation)
// exports.getChatMessages = async (req, res) => {
//   try {
//     const receiverId = req.params.receiverId;
//     const senderId = req.session.user?.id;

//     if (!senderId) {
//       return res.status(401).json({ success: false, message: "Not logged in" });
//     }

//     const { rows } = await pool.query(
//       `
//       SELECT
//         id, sender_id, receiver_id, message, created_at,
//         CASE WHEN sender_id = $1 THEN 'self' ELSE 'other' END AS sender
//       FROM messages
//       WHERE (sender_id = $1 AND receiver_id = $2)
//          OR (sender_id = $2 AND receiver_id = $1)
//       ORDER BY created_at ASC
//       `,
//       [senderId, receiverId]
//     );

//     // Optionally mark messages as read
//     await pool.query(
//       `UPDATE messages SET is_read = TRUE WHERE receiver_id = $1 AND sender_id = $2`,
//       [senderId, receiverId]
//     );

//     res.json(rows);
//   } catch (err) {
//     console.error("Get chat messages error:", err);
//     res.status(500).json({ success: false, message: "Server error" });
//   }
// };
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


// ✅ Get all chat conversations (students who have messaged instructor)
exports.getInstructorChats = async (req, res) => {
  try {
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0] || {};
    const instructorId = req.user.id;

    const { rows } = await pool.query(
      `
      SELECT DISTINCT 
        u.id AS student_id,
        u.fullname AS student_name,
        u.email,
        MAX(m.created_at) AS last_message_time
      FROM messages m
      JOIN users2 u ON 
        (u.id = m.sender_id AND m.receiver_id = $1)
        OR (u.id = m.receiver_id AND m.sender_id = $1)
      WHERE u.role = 'student'
      GROUP BY u.id, u.fullname, u.email
      ORDER BY last_message_time DESC
      `,
      [instructorId]
    );

    const profilePic = req.session.user
      ? req.session.user.profile_picture
      : null;

    res.render("instructor/chatList", {
      chats: rows,
      info,
      profilePic,
      role: "instructor",
      user: req.session.user,
    });
  } catch (err) {
    console.error("Get instructor chats error:", err);
    res.status(500).send("Error loading chats");
  }
};

// ✅ Full chat conversation with one student
exports.getChatWithStudent = async (req, res) => {
  try {
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0] || {};
    const instructorId = req.user.id;
    const studentId = req.params.studentId;

    const { rows } = await pool.query(
      `
      SELECT 
        m.id, m.sender_id, m.receiver_id, m.message, m.created_at,
        CASE WHEN m.sender_id = $1 THEN 'self' ELSE 'other' END AS sender
      FROM messages m
      WHERE (m.sender_id = $1 AND m.receiver_id = $2)
         OR (m.sender_id = $2 AND m.receiver_id = $1)
      ORDER BY m.created_at ASC
      `,
      [instructorId, studentId]
    );

    const studentResult = await pool.query(
      `SELECT id, fullname, email FROM users2 WHERE id = $1`,
      [studentId]
    );


    const profilePic = req.session.user
      ? req.session.user.profile_picture
      : null;

    res.render("instructor/chatView", {
      student: studentResult.rows[0],
      messages: rows,
      info,
      profilePic,
      role: "instructor",
      user: req.session.user,
    });
  } catch (err) {
    console.error("Get chat with student error:", err);
    res.status(500).send("Error loading chat conversation");
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

// exports.searchStudent = async (req, res) => {
//   try {
//     const instructorId = req.user.id;
//     const query = req.query.q ? req.query.q.trim() : "";

//     if (!query) return res.json([]);

//     const { rows } = await pool.query(
//       `
//       SELECT id, fullname, email, class_name
//       FROM users2
//       WHERE role IN ('student', 'school_student')
//         AND (
//           LOWER(fullname) LIKE LOWER($1)
//           OR LOWER(email) LIKE LOWER($1)
//           OR LOWER(class_name) LIKE LOWER($1)
//         )
//         AND school_id = (
//           SELECT school_id FROM users2 WHERE id = $2
//         )
//       LIMIT 20
//       `,
//       [`%${query}%`, instructorId]
//     );

//     res.json(rows);
//   } catch (err) {
//     console.error("Search student error:", err);
//     res.status(500).json([]);
//   }
// };

exports.searchStudent = async (req, res) => {
  try {
    const instructorId = req.user.id;
    const query = req.query.q ? req.query.q.trim() : "";

    if (!query) return res.json([]);

    const { rows } = await pool.query(
      `
      SELECT u.id, u.fullname, u.email, us.classroom_id AS class_name
      FROM users2 u
      JOIN user_school us ON u.id = us.user_id
      WHERE us.role_in_school = 'student'
        AND us.school_id = COALESCE(
          (SELECT school_id FROM user_school WHERE user_id = $2 LIMIT 1),
          us.school_id
        )
        AND (
          LOWER(u.fullname) LIKE LOWER($1)
          OR LOWER(u.email) LIKE LOWER($1)
          OR LOWER(CAST(us.classroom_id AS TEXT)) LIKE LOWER($1)
        )
      LIMIT 20
      `,
      [`%${query}%`, instructorId]
    );

    res.json(rows);
  } catch (err) {
    console.error("Search student error:", err);
    res.status(500).json([]);
  }
};


exports.getUnreadMessages = async (req, res) => {
  try {
    const instructorId = req.user.id;

    // ✅ Fetch unread (unopened) messages only
    const { rows } = await pool.query(
      `
      SELECT 
        m.id,
        m.sender_id,
        u.fullname AS sender_name,
        u.email AS sender_email,
        m.message,
        m.created_at
      FROM messages m
      JOIN users2 u ON m.sender_id = u.id
      WHERE m.receiver_id = $1
        AND m.is_read = FALSE
      ORDER BY m.created_at DESC
      `,
      [instructorId]
    );

    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0] || {};

    const profilePic = req.session.user
      ? req.session.user.profile_picture
      : null;

    res.render("instructor/inbox", {
      receivedMessages: rows,
      info,
      profilePic,
      role: "instructor",
      user: req.session.user,
    });
  } catch (err) {
    console.error("Get unread messages error:", err);
    res.status(500).send("Error loading unread messages");
  }
};



