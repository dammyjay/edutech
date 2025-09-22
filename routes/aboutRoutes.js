// const express = require("express");
// const router = express.Router();
// const aboutController = require("../controllers/aboutController");
// // const isAdmin = require("../middlewares/isAdmin");

// router.get("/about", aboutController.getAboutPage);
// router.get("/admin/about", aboutController.getEditAboutPage);
// router.post("/admin/about/update", aboutController.updateAboutSection);

// module.exports = router;



const express = require("express");
const router = express.Router();
const aboutController = require("../controllers/aboutController");
const multer = require("multer");
const upload = multer({ dest: "uploads/" }); // temp storage before Cloudinary

router.get("/about", aboutController.getAboutPage);
router.get("/admin/about", aboutController.getEditAboutPage);

router.get("/about", aboutController.getAboutPage);
// Create About section (with optional image upload)
router.post(
  "/admin/about/create",
  upload.single("section_image"), // 👈 handles the <input type="file" name="section_image">
  aboutController.createAboutSection
);

// Update About section (with optional image upload)
router.post(
  "/admin/about/update/:id",
  upload.single("section_image"),
  aboutController.updateAboutSection
);
router.post("/admin/about/delete/:id", aboutController.deleteAboutSection);
router.post("/admin/about/delete/:id", aboutController.deleteAboutSection);

module.exports = router;
