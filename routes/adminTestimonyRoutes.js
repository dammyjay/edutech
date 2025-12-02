
const express = require("express");
const router = express.Router();
const pool = require("../models/db");

// Show All Testimonies
router.get("/admin/testimonies", async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }
  const info =
    (await pool.query("SELECT * FROM company_info ORDER BY id DESC LIMIT 1"))
      .rows[0] || {};
  const testimonies = (
    await pool.query("SELECT * FROM testimonies ORDER BY created_at DESC")
  ).rows;
  res.render("admin/manageTestimonies", {
    info,
    testimonies,
    role: "admin",
    users: req.session.user,
  });
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
