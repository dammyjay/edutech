// routes/instructor.js
const express = require("express");
const router = express.Router();
const { ensureInstructorOrAdmin } = require("../middlewares/auth");
const learningController = require("../controllers/learningController");
const adminController = require("../controllers/adminController");
const instructorController = require("../controllers/instructorController");
// const upload = require("../middlewares/upload");
const { upload, lessonUpload } = require("../middlewares/upload");

router.post("/login", adminController.login);
// Instructor dashboard
// router.get("/dashboard", (req, res) => {
//   res.render("instructor/dashboard", {
//     info: req.user || { fullname: "Instructor" }, // better than req.info
//   });
// });


router.get("/dashboard", adminController.instructorDashboard);

// Courses
router.post(
  "/courses",
  ensureInstructorOrAdmin,
  upload.single("thumbnail"),
  adminController.createCourse
);


router.post(
  "/courses/edit/:id",
  upload.single("thumbnail"),
  adminController.editCourse
);
router.post("/courses/delete/:id", adminController.deleteCourse);

router.get("/pathways/:id/courses", adminController.showCoursesByPathway);
router.post(
  "/pathways/:id/courses",
  upload.single("thumbnail"),
  adminController.createCourseUnderPathway
);
router.get("/courses/:id", learningController.viewSingleCourse);
router.post("/admin/courses/:id/edit", learningController.updateCourse);

router.post(
  "/modules/create",
  ensureInstructorOrAdmin,
  upload.single("thumbnail"),
  learningController.createModule
);

router.post(
  "/modules/edit/:id",
  upload.single("thumbnail"),
  learningController.editModule
);
router.post("/modules/delete/:id", learningController.deleteModule);

router.post(
  "/lessons/create",
  ensureInstructorOrAdmin,
  upload.none(),
  learningController.createLesson
);

router.post("/lessons/:id/edit", upload.none(), learningController.editLesson);
router.post("/lessons/:id/delete", learningController.deleteLesson);
router.get("/lessons/:id/json", learningController.getLessonJSON);

// Get or create quiz for lesson
router.get("/lesson/:lessonId/quiz", learningController.getOrCreateLessonQuiz);


// Create question
router.post(
  "/quiz-question/create",
  upload.none(),
  learningController.createQuizQuestion
);

router.post(
  "/quiz-question/:id/edit",
  upload.none(), // multer middleware to parse form-data
  learningController.editQuizQuestion
);

// Delete question
router.post("/quiz-question/:id/delete", learningController.deleteQuizQuestion);

router.post(
  "/assignments/create",
  upload.none(),
  learningController.createAssignment
);
router.post(
  "/assignments/:id/edit",
  upload.none(),
  learningController.editAssignment
);

// Delete
router.post("/assignments/:id/delete", learningController.deleteAssignment);

// Projects
router.post("/admin/courses/:id/project", learningController.createProject);

// Download student course summary
router.get(
  "/student/:studentId/course-summary/:courseId/download",
  adminController.downloadCourseSummary
);

router.get("/dashboard", ensureInstructorOrAdmin, (req, res) => {
  res.render("instructor/dashboard", { info: req.info });
});

// studentRoutes.js
router.post("/instructor/chat/send", adminController.sendChatMessage);
router.get("/chat/messages/:receiverId", adminController.getChatMessages);

router.get("/chats", instructorController.getInstructorChats);
router.get("/chats/:studentId", instructorController.getChatWithStudent);
router.post("/chat/markRead/:receiverId", instructorController.markMessagesAsRead);
router.get("/search-student", instructorController.searchStudent);
router.get("/messages/unread", instructorController.getUnreadMessages);



// router.get("/chats", adminController.getInstructorChats);
// router.get("/chats/:studentId", adminController.getChatWithStudent);


module.exports = router;
