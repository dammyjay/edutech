const express = require("express");
const pool = require("../models/db");
const router = express.Router();
const { upload, lessonUpload } = require("../middlewares/upload");

// const parser = require("../middlewares/upload");
// const upload = require("../middlewares/upload");
const { ensureAdmin } = require("../middlewares/auth");
const activityLoggerMiddleware = require("../middlewares/activityMiddleware");

const adminController = require("../controllers/adminController");
const companyController = require("../controllers/companyController");
const articleController = require("../controllers/articleController");
const learningController = require("../controllers/learningController");
const { getCourseById } = require("../models/courseModel"); // adjust path if needed
const { getModulesByCourse } = require("../models/moduleModel"); // adjust path if needed
const {
  getQuizzesByLesson,
  createQuiz,
  deleteQuiz,
  getLessonAssignments,
  createLessonAssignment,
  deleteLessonAssignment,
  getModuleAssignments,
  createModuleAssignment,
  deleteModuleAssignment,
  getCourseProjects,
  createCourseProject,
  deleteCourseProject,
} = require("../controllers/learningController");

const multer = require("multer");
// const upload = multer({ dest: 'uploads/' }); // temp local storage
// const upload = require("../middlewares/upload");

router.get("/login", adminController.showLogin);
router.post("/login", adminController.login);
router.get("/dashboard", adminController.dashboard);


router.get("/analytics/export", adminController.exportAnalyticsPDF);
router.get("/analytics", adminController.analyticsPage);
router.get("/stats/overview", adminController.overview);
router.get("/stats/users", adminController.users);
router.get("/stats/courses", adminController.courses);
router.get("/stats/progress",adminController.progress);
router.get("/stats/quizzes", adminController.quizzes);
router.get("/stats/finance", adminController.finance);
router.get("/stats/feedback", adminController.feedback);
router.get("/stats/activity", adminController.activity);
router.get(
  "/stats/event-payments/details",
  adminController.eventPaymentDetails
);

router.get("/feedback", adminController.viewFeedback);

// Admin API (JSON)
router.get("/feedback/api", adminController.getFeedbackAPI);
router.get("/feedback/export/pdf", adminController.exportFeedbackPDF);
router.get("/feedback/export/csv", adminController.exportFeedbackCSV);
router.get("/feedback/export/excel", adminController.exportFeedbackExcel);
router.get("/feedback/detail/:id", adminController.getFeedbackDetail);
router.post("/feedback/publish/:id", adminController.togglePublish);
router.delete("/feedback/delete/:id", adminController.deleteFeedback);



router.get("/logout", adminController.logout);

router.get("/forgot-password", adminController.showForgotPasswordForm);
router.post("/forgot-password", adminController.handleForgotPassword);
router.get("/reset-password/:token", adminController.showResetPasswordForm);
router.post("/reset-password/:token", adminController.handleResetPassword);

router.get("/users/edit/:id", adminController.editUserForm);
router.post("/users/delete/:id", adminController.deleteUser);
router.post("/users/edit/:id", adminController.updateUser);

router.post(
  "/schools/:schoolId/users/:userId/reset-password",
  adminController.resetPassword
);
// company Info routes
router.get("/company", companyController.showForm);

// POST form with multiple file uploads mini
router.post(
  "/company",
  upload.fields([
    { name: "logo", maxCount: 1 },
    { name: "heroImage", maxCount: 1 },
  ]),
  companyController.saveInfo
);

router.get("/articles", articleController.showArticles);
router.get("/articles", articleController.showSearchArticles);
router.post("/articles", upload.single("image"), articleController.saveArticle);
// router.get('/articles/:id', articleController.showSingleArticle);

router.get("/articles/edit/:id", articleController.showEditForm);
router.post(
  "/articles/edit/:id",
  upload.single("image"),
  articleController.updateArticle
);
router.post("/articles/delete/:id", articleController.deleteArticle);

// Career Pathways
router.get("/pathways", adminController.showPathways);
// router.post("/admin/pathways", adminController.createPathway);
router.post(
  "/pathways",
  upload.single("thumbnail"),
  adminController.createPathway
);
router.post(
  "/pathways/edit/:id",
  upload.single("thumbnail"),
  adminController.editPathway
);

router.post("/pathways/delete/:id", adminController.deletePathway);

// Courses
router.get("/courses", adminController.showCourses);

// router.post(
//   "/courses",
//   upload.single("thumbnail"),
//   adminController.createCourse
// );

// router.post(
//   "/courses/edit/:id",
//   upload.single("thumbnail"),
//   adminController.editCourse
// );

// // existing create route
// router.post("/courses", upload.fields([
//   { name: "thumbnail", maxCount: 1 },
//   { name: "curriculum", maxCount: 1 }
// ]), adminController.createCourse);

// // existing edit route
// router.post("/courses/edit/:id", upload.fields([
//   { name: "thumbnail", maxCount: 1 },
//   { name: "curriculum", maxCount: 1 }
// ]), adminController.editCourse);

router.post(
  "/courses",
  upload.fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "curriculum", maxCount: 1 },
    { name: "certificate", maxCount: 1 },
  ]),
  adminController.createCourse
);

router.post(
  "/courses/edit/:id",
  upload.fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "curriculum", maxCount: 1 },
    { name: "certificate", maxCount: 1 },
  ]),
  adminController.editCourse
);



// 📘 View Course Curriculum (with proxy streaming support)
router.get("/courses/:id/curriculum", async (req, res) => {
  try {
    const courseId = req.params.id;
    console.log("📘 Loading curriculum for course ID:", courseId);

    const result = await pool.query("SELECT * FROM courses WHERE id = $1", [
      courseId,
    ]);
    if (result.rows.length === 0) {
      console.log("❌ Course not found");
      return res.status(404).send("Course not found");
    }

    const course = result.rows[0];
    console.log("✅ Course found:", course.title);
    console.log("📄 Curriculum URL:", course.curriculum_url);

    if (!course.curriculum_url) {
      return res
        .status(404)
        .send("No curriculum file uploaded for this course.");
    }

    // 🔹 Add a proxy link for embedding (resolves Cloudinary access issues)
    const proxyUrl = `/courses/${course.id}/curriculum/file`;

    // Pass proxy URL to the EJS view
    res.render("courseCurriculum", {
      course,
      proxyUrl,
      fullProxyUrl: `${req.protocol}://${req.get("host")}${proxyUrl}`,
    });
  } catch (err) {
    console.error("❌ Error loading curriculum:", err);
    res.status(500).send("Error loading curriculum: " + err.message);
  }
});

// ✅ Add this route below the one above (to actually serve the file)
router.get("/courses/:id/curriculum/file", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "SELECT curriculum_url FROM courses WHERE id=$1",
      [id]
    );
    if (!result.rows.length) return res.status(404).send("Course not found");

    const { curriculum_url } = result.rows[0];
    if (!curriculum_url) return res.status(404).send("No curriculum uploaded");

    const response = await fetch(curriculum_url);
    if (!response.ok) return res.status(500).send("Unable to fetch file");

    res.setHeader(
      "Content-Type",
      response.headers.get("content-type") || "application/octet-stream"
    );
    res.setHeader("Content-Disposition", "inline; filename=curriculum");

    response.body.pipe(res);
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).send("Error loading curriculum");
  }
});



router.post("/courses/delete/:id", adminController.deleteCourse);

router.get("/pathways/:id/courses", adminController.showCoursesByPathway);
router.post(
  "/pathways/:id/courses",
  upload.single("thumbnail"),
  adminController.createCourseUnderPathway
);
router.get("/courses/:id", learningController.viewSingleCourse);
// router.post("/admin/courses/:id/edit", learningController.updateCourse);

router.post(
  "/courses/:id/edit",
  upload.fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "curriculum", maxCount: 1 },
    { name: "certificate", maxCount: 1 },
  ]),
  learningController.updateCourse
);


// router.post(
//   "/modules/create",
//   upload.single("thumbnail"),
//   learningController.createModule
// );
// router.post(
//   "/modules/edit/:id",
//   upload.single("thumbnail"),
//   learningController.editModule
// );

// For multiple files (thumbnail + badge)
router.post(
  "/modules/create",
  upload.fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "badge_image", maxCount: 1 },
  ]),
  learningController.createModule
);

router.post(
  "/modules/edit/:id",
  upload.fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "badge_image", maxCount: 1 },
  ]),
  learningController.editModule
);

router.post("/modules/delete/:id", learningController.deleteModule);


router.post("/lessons/create", upload.none(), learningController.createLesson);

// router.post(
//   "/lessons/create",
//   lessonUpload.single("lessonFile"), // ⬅ must match the input name
//   learningController.createLesson
// );
router.post("/lessons/:id/edit", upload.none(), learningController.editLesson);
router.post("/lessons/:id/delete", learningController.deleteLesson);
router.get("/lessons/:id/json", learningController.getLessonJSON);

// Get or create quiz for lesson
router.get("/lesson/:lessonId/quiz", learningController.getOrCreateLessonQuiz);

router.post(
  "/lessons/:lessonId/quiz/ai-generate",
  upload.none(),
  learningController.aiGenerateQuizForLesson
);

// Preview AI-generated quiz (no DB save yet)
router.post(
  "/lessons/:lessonId/quiz/ai-preview",
  upload.none(),
  learningController.aiPreviewQuizForLesson
);

// Save confirmed quiz
router.post(
  "/lessons/:lessonId/quiz/ai-save",
  upload.none(),
  learningController.saveAIQuizForLesson
);

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
// router.post("/admin/courses/:id/project", learningController.createProject);
router.post("/courses/:id/project", learningController.createProject);
router.post("/projects/edit/:id", learningController.editProject);
router.post("/projects/delete/:id", learningController.deleteProject);



router.get("/benefits", adminController.showBenefits);
router.post("/benefits", upload.single("icon"), adminController.createBenefit);
router.get("/benefits/edit/:id", adminController.editBenefitForm);

router.post(
  "/benefits/edit/:id",
  upload.single("icon"),
  adminController.updateBenefit
);
router.post("/benefits/delete/:id", adminController.deleteBenefit);

router.post(
  "/events/create",
  upload.single("image"),
  adminController.createEvent
);

router.get("/events/registrations/:id", adminController.viewEventRegistrations);
router.get("/events", adminController.showEvents); // list all events
router.get(
  "/events/registrations/:id/export",
  adminController.exportEventRegistrations
);

// Edit event (update)
router.put("/events/:id", upload.single("image"), adminController.updateEvent);

// Delete event
router.delete("/events/:id", adminController.deleteEvent);

// Student management
router.get("/students", adminController.listStudents);
router.get("/students/:id", adminController.viewStudentDetails);
router.get("/students/:id/progress", adminController.viewStudentProgress);
router.get("/students/:id/enrollments", adminController.viewStudentEnrollments);

// Admin
router.post("/admin/assign-child", adminController.assignChildToParent);


// Download student course summary
router.get(
  "/student/:studentId/course-summary/:courseId/download",
  adminController.downloadCourseSummary
);

// routes/admin.js
router.get("/schools", adminController.getSchools);
router.post(
  "/schools/update",
  upload.single("logo"),
  adminController.updateSchoolInfo
);
router.get("/schools/:id", adminController.getSchoolDetails);

// for quotes and course assignment
router.get("/quotes", adminController.getQuotes);
router.get("/school-courses", adminController.getSchoolCourses);
router.post("/school-courses/assign", adminController.assignSchoolCourses);



// routes/admin.js
router.post("/quotes/:id/approve", adminController.approveQuote);
router.post("/quotes/:id/reject", adminController.rejectQuote);


// CRUD for users in a school
router.post("/schools/:schoolId/users", upload.single("profile_picture"), adminController.addUserToSchool);
router.put("/schools/:schoolId/users/:userId", upload.single("profile_picture"), adminController.updateUserInSchool);
router.delete("/schools/:schoolId/users/:userId", adminController.deleteUserFromSchool);
router.get("/classrooms/:id/students", adminController.getClassroomStudents);


// Assign multiple students to a classroom
// router.post(
//   "/classrooms/:id/add-students",
//   adminController.addStudentsToClassroom
// );

router.post("/classrooms/:id/assign", adminController.assignUsersToClassroom);

router.post(
  "/classrooms/new",
  activityLoggerMiddleware(
    "Classroom created",
    (req) => `Classroom: ${req.body.name}`
  ),
  adminController.createClassroom
);

// UPDATE classroom
router.put("/classrooms/:id", adminController.updateClassroom);

// DELETE classroom
router.delete("/classrooms/:id", adminController.deleteClassroom);
router.post(
  "/classrooms/:id/assign-courses",
  adminController.assignCoursesToClassroom
);

router.get("/classrooms/:id/courses", adminController.getClassroomCourses);
router.get(
  "/schools/:schoolId/download-progress",
  adminController.downloadSchoolProgressReport
);

router.get(
  "/schools/:schoolId/download-login-cards",
  adminController.downloadStudentLoginCards
);

module.exports = router;
