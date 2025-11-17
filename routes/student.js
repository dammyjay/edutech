const express = require("express");
const router = express.Router();
const multer = require("multer");
// const upload = multer({ dest: 'uploads/' }); // temp local storage
// const upload = require("../middlewares/upload");
const { upload, lessonUpload } = require("../middlewares/upload");

const studentController = require("../controllers/studentController");

const { ensureAuthenticated } = require("../middlewares/auth");
router.get("/dashboard", studentController.getDashboard);
router.get("/courses", studentController.getEnrolledCourses);
router.get("/analytics", studentController.getAnalytics);
router.post("/update-xp", studentController.updateXP);
router.post("/award-badge", studentController.awardBadge);
// Mark lesson complete
router.post("/lessons/:lessonId/complete", studentController.completeLesson);
// router.post("/courses/enroll/:courseId", studentController.enrollInCourse); 

router.post(
  "/courses/enroll/:courseId",
  ensureAuthenticated,
  studentController.enrollInCourse
);

router.post(
  "/profile/edit",
  upload.single("profilePic"),
  studentController.editProfile
);

router.get(
  "/lessons/:lessonId",
  ensureAuthenticated,
  studentController.viewLesson
);

router.get(
  "/modules/:moduleId",
  ensureAuthenticated,
  studentController.getModuleDetails
);

// Get quiz questions for a lesson
router.get('/lessons/:id/quiz', studentController.getLessonQuiz);

router.post(
  "/lessons/:id/quiz/submit",
  express.json(),
  studentController.submitLessonQuiz
);

router.get("/quizzes/mine", studentController.getMyQuizzes);
router.get("/quizzes/submission/:id", studentController.getQuizSubmissionById);




// routes/student.js
router.get('/lessons/:id', studentController.getLesson);


router.post("/ai/ask", ensureAuthenticated, studentController.askAITutor);

// router.get(
//   "/student/assignments/:id",
//   studentController.viewAssignment
// );

// router.post(
//   "/student/assignments/:id/submit",
//   upload.single("file"),
//   studentController.submitAssignment
// );

router.get(
  "/assignments/:id",
  ensureAuthenticated, // 🔑 protect
  studentController.viewAssignment
);

router.post(
  "/assignments/:id/submit",
  ensureAuthenticated, // 🔑 protect
  upload.single("file"),
  studentController.submitAssignment
);

// routes/student.js
router.get(
  "/assignments/mine",
  ensureAuthenticated,
  studentController.getMyAssignments
);
router.get(
  "/assignments/submission/:id",
  ensureAuthenticated,
  studentController.getSubmissionById
);

// ✅ Parent request response (approve / reject)
router.post(
  "/parent-request/respond",
  studentController.respondToParentRequest
);

// routes/student.js
router.get("/classroom", studentController.getClassroom);

// routes/student.js
router.get("/teacher", studentController.getTeacher);

// studentRoutes.js
router.post("/chat/send", studentController.sendChatMessage);
router.get("/chat/messages/:receiverId", studentController.getChatMessages);
router.post("/chat/markRead/:receiverId", studentController.markMessagesAsRead);


router.post(
  "/projects/submit",
  upload.single("projectFile"),
  studentController.submitProject
);


module.exports = router;
