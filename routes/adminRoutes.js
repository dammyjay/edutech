const express = require("express");
const router = express.Router();
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

// const galleryController = require("../controllers/galleryController");
// const devotionalController = require("../controllers/devotionalController");

// const demoVideoController = require("../controllers/demoVideoController");

const multer = require("multer");
// const upload = multer({ dest: 'uploads/' }); // temp local storage
const upload = require("../middlewares/upload");

router.get("/login", adminController.showLogin);
router.post("/login", adminController.login);
router.get("/dashboard", adminController.dashboard);
router.get("/logout", adminController.logout);

router.get("/users/edit/:id", adminController.editUserForm);
router.post("/users/delete/:id", adminController.deleteUser);
router.post("/users/edit/:id", adminController.updateUser);

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

// const galleryController = require('../controllers/galleryController');

// router.get("/gallery", galleryController.showGalleryUpload); // show the form
// router.post(
//   "/gallery/upload",
//   upload.single("image"),
//   galleryController.uploadImage
// ); // handle upload

// // Show edit form
// router.get("/gallery/edit/:id", galleryController.showEditImage);
// // Handle edit form submission
// router.post(
//   "/gallery/edit/:id",
//   upload.single("image"),
//   galleryController.editImage
// );
// // Handle delete
// router.post("/gallery/delete/:id", galleryController.deleteImage);

// // Show category management page
// router.get("/gallery/categories", galleryController.showCategories);

// // Handle new category creation
// router.post("/gallery/categories", galleryController.createCategory);

// // (Optional) Handle category deletion
// router.post("/gallery/categories/delete/:id", galleryController.deleteCategory);

// // Handle category edit form submission
// router.post("/gallery/categories/edit/:id", galleryController.editCategory);

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
router.post(
  "/courses",
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

// router.get("/courses/:courseId", async (req, res) => {
//   const courseId = req.params.courseId;
//   const tab = req.query.tab || "details";

//   const course = await getCourseById(courseId);
//   const modules = await getModulesByCourse(courseId);
//   const lessons = await getLessonsByModules(modules.map((m) => m.id));
//   const assignment = await getCourseAssignment(courseId);
//   const project = await getCourseProject(courseId);

//   res.render("admin/singleCourse", {
//     course,
//     modules,
//     lessons,
//     assignment,
//     project,
//     activeTab: tab,
//   });
// });

//benefits
// router.get("/admin/courses/:id", async (req, res) => {
//   const courseId = req.params.id;
//   const course = await getCourseById(courseId);
//   const modules = await getModulesByCourse(courseId);
//   const lessons = await getLessonsByCourse(courseId);
//   const assignment = null;
//   const project = null;

//   res.render("admin/singleCourse", {
//     course,
//     modules,
//     lessons,
//     assignment,
//     project,
//     activeTab: req.query.tab || "details",
//   });
// });

// router.get("/admin/courses/:id", learningController.getSingleCourse);

// router.get("/courses/:id", learningController.viewSingleCourse);
router.get("/courses/:id", learningController.viewSingleCourse);
router.post("/admin/courses/:id/edit", learningController.updateCourse);
// router.post("/admin/courses/:id/delete", learningController.deleteCourse);

// Modules
// router.post("/admin/courses/:id/modules", learningController.createModule);
// router.post("/admin/modules/:id/edit", learningController.editModule);
// router.post("/admin/modules/:id/delete", learningController.deleteModule);

router.post(
  "/modules/create",
  upload.single("thumbnail"),
  learningController.createModule
);
router.post(
  "/modules/edit/:id",
  upload.single("thumbnail"),
  learningController.editModule
);
router.post("/modules/delete/:id", learningController.deleteModule);


router.post("/lessons/create", upload.none(), learningController.createLesson);
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
// router.post('/quiz-question/create', learningController.createQuizQuestion);
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

router.get("/benefits", adminController.showBenefits);
router.post("/benefits", upload.single("icon"), adminController.createBenefit);
router.get("/benefits/edit/:id", adminController.editBenefitForm);
router.post(
  "/benefits/edit/:id",
  upload.single("icon"),
  adminController.updateBenefit
);
router.post("/benefits/delete/:id", adminController.deleteBenefit);

// router.get("/admin/events", adminController.listEvents);
// router.post("/events", upload.single("image"), adminController.createEvent);
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

// router.post(
//   "/remove-child",
//   ensureAdmin,
//   adminController.removeChildFromParent
// );

// Download student course summary
router.get(
  "/student/:studentId/course-summary/:courseId/download",
  adminController.downloadCourseSummary
);

// routes/admin.js
router.get("/schools", adminController.getSchools);
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

module.exports = router;
