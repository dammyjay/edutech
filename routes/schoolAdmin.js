const express = require("express");
const router = express.Router();
const schoolAdminController = require("../controllers/schoolAdminController");

// Dashboard
router.get("/dashboard", schoolAdminController.getDashboard);

// Approvals
router.post("/approve/:id", schoolAdminController.approveUser);
router.post("/reject/:id", schoolAdminController.rejectUser);

// Classroom CRUD
router.get("/classrooms", schoolAdminController.listClassrooms);
// router.get("/classrooms/new", schoolAdminController.newClassroomForm);
router.post("/classrooms/new", schoolAdminController.createClassroom);
router.get("/classrooms/:id", schoolAdminController.viewClassroom);
router.get("/classrooms/:id/edit", schoolAdminController.editClassroomForm);
router.post("/classrooms/:id/edit", schoolAdminController.updateClassroom);
router.post("/classrooms/:id/delete", schoolAdminController.deleteClassroom);
router.get("/section/:section", schoolAdminController.loadSection);
// Add student to a classroom
router.post("/classrooms/:id/add-student", schoolAdminController.addStudentToClassroom);


// Quotes
router.get("/section/quotes", schoolAdminController.getQuotes);
router.post("/quotes/add", schoolAdminController.addQuote);
router.post("/quotes/delete/:id", schoolAdminController.deleteQuote);

// Payments
router.get("/section/payments", schoolAdminController.getPayments);
router.post("/payments/update", schoolAdminController.updatePayment);

// Courses & Classrooms
router.get("/section/classroom-courses", schoolAdminController.getClassroomCourses);
router.post("/classroom-courses/assign", schoolAdminController.assignCourseToClassroom);
router.post(
  "/classroom-courses/update/:id",
  schoolAdminController.updateClassroomCourse
);
router.post(
  "/classroom-courses/delete/:id",
  schoolAdminController.deleteClassroomCourse
);
router.post(
  "/classroom-courses/assign",
  schoolAdminController.addPaymentAdjustment
);



module.exports = router;
