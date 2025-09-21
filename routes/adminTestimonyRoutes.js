// const express = require("express");
// const router = express.Router();
// const pool = require("../models/db");

// // View all testimonies
// router.get("/admin/testimonies", async (req, res) => {
//   const infoResult = await pool.query(
//     "SELECT * FROM ministry_info ORDER BY id DESC LIMIT 1"
//   );
//   const result = await pool.query(
//     "SELECT * FROM testimonies ORDER BY created_at DESC"
//   );
//   res.render("admin/manageTestimonies", {
//     info: infoResult.rows[0] || {},
//     testimonies: result.rows,
//     title: "Manage Testimonies",
//   });
// });

// // Approve or unpublish
// router.post("/admin/testimonies/toggle/:id", async (req, res) => {
//   const id = req.params.id;
//   const { publish } = req.body;
//   await pool.query("UPDATE testimonies SET is_published = $1 WHERE id = $2", [
//     publish === "true",
//     id,
//   ]);
//   res.redirect("/admin/testimonies");
// });

// // Delete
// router.post("/admin/testimonies/delete/:id", async (req, res) => {
//   await pool.query("DELETE FROM testimonies WHERE id = $1", [req.params.id]);
//   res.redirect("/admin/testimonies");
// });

const express = require("express");
const router = express.Router();
const pool = require("../models/db");

// Show All Testimonies
router.get("/admin/testimonies", async (req, res) => {
  const info =
    (await pool.query("SELECT * FROM ministry_info ORDER BY id DESC LIMIT 1"))
      .rows[0] || {};
  const testimonies = (
    await pool.query("SELECT * FROM testimonies ORDER BY created_at DESC")
  ).rows;
  res.render("admin/manageTestimonies", { info, testimonies });
});

// Toggle Publish Status
router.post("/admin/testimonies/toggle/:id", async (req, res) => {
  const { publish } = req.body;
  await pool.query("UPDATE testimonies SET is_published = $1 WHERE id = $2", [
    publish === "true",
    req.params.id,
  ]);
  res.redirect("/admin/testimonies");
});

// Delete Testimony
router.post("/admin/testimonies/delete/:id", async (req, res) => {
  await pool.query("DELETE FROM testimonies WHERE id = $1", [req.params.id]);
  res.redirect("/admin/testimonies");
});

module.exports = router;
