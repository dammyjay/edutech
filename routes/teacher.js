const express = require("express");
const router = express.Router();
const teacherController = require("../controllers/teacherController");

// ------------------ MAIN DASHBOARD WRAPPER ------------------
router.get("/dashboard", (req, res) => {
  teacherController.getDashboard(req, res);
});

// ------------------ SECTION LOADER (AJAX) ------------------
router.get("/section/:name", async (req, res) => {
  const { name } = req.params;
  try {
    switch (name) {
      case "dashboard":
        return teacherController.getDashboardSection(req, res);
      case "classes":
        return teacherController.getClassesSection(req, res);
      case "students":
        return teacherController.getStudentsSection(req, res);
      case "reports":
        return teacherController.getReportsSection(req, res);
      default:
        return res.status(404).send("<p>Section not found</p>");
    }
  } catch (err) {
    console.error("Teacher Section Load Error:", err);
    return res.status(500).send("<p>Error loading section</p>");
  }
});

// ------------------ CLASSROOM STUDENTS ------------------
router.get("/classroom/:id/students", (req, res) => {
  teacherController.viewClassroomStudents(req, res);
});

// ------------------ STUDENT PROGRESS ------------------
router.get("/student/:id/progress", (req, res) => {
  teacherController.viewStudentProgress(req, res);
});

// ------------------ DOWNLOAD REPORT ------------------
router.get("/student/:id/report", (req, res) => {
  teacherController.downloadStudentReport(req, res);
});

module.exports = router;
