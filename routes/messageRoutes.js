const express = require("express");
const router = express.Router();
const messageController = require("../controllers/messageController");

// Send a message
router.post("/messages/send", messageController.sendMessage);

// Get chat history between two users
router.get("/messages/:userId", messageController.getConversation);

module.exports = router;
