const pool = require("../models/db");

// ✅ Send Message
exports.sendMessage = async (req, res) => {
  try {
    const senderId = req.user.id; // assuming you store logged-in user
    const { receiver_id, message } = req.body;

    if (!receiver_id || !message.trim()) {
      return res.status(400).json({ success: false, message: "Invalid input" });
    }

    await pool.query(
      `INSERT INTO messages (sender_id, receiver_id, message) VALUES ($1, $2, $3)`,
      [senderId, receiver_id, message]
    );

    res.json({ success: true, message: "Message sent" });
  } catch (err) {
    console.error("Send message error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ✅ Get conversation between logged-in user and another user
exports.getConversation = async (req, res) => {
  try {
    const userId = req.user.id;
    const receiverId = req.params.userId;

    const result = await pool.query(
      `
      SELECT 
        m.*,
        s.fullname AS sender_name,
        r.fullname AS receiver_name
      FROM messages m
      JOIN users2 s ON s.id = m.sender_id
      JOIN users2 r ON r.id = m.receiver_id
      WHERE 
        (m.sender_id = $1 AND m.receiver_id = $2)
        OR (m.sender_id = $2 AND m.receiver_id = $1)
      ORDER BY m.created_at ASC
      `,
      [userId, receiverId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Fetch conversation error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
