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

module.exports = router;
