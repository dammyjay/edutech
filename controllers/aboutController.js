



const pool = require("../models/db");

const fs = require("fs");
const cloudinary = require("cloudinary").v2;

// Create new section
exports.createAboutSection = async (req, res) => {
  const { section_key, section_title, content, section_order } = req.body;
  let image_url = null;

  try {
    if (req.file) {
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: "about_sections",
      });
      image_url = result.secure_url;
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }

    await pool.query(
      `INSERT INTO about_sections (section_key, section_title, content, section_order, section_image)
       VALUES ($1, $2, $3, $4, $5)`,
      [section_key, section_title, content, section_order || 0, image_url]
    );

    res.redirect("/admin/about");
  } catch (err) {
    console.error("❌ Error creating section:", err);
    res.redirect("/admin/about?error=create");
  }
};

// Update section
exports.updateAboutSection = async (req, res) => {
  const { id } = req.params;
  const { section_title, content, section_order, remove_image } = req.body;
  let image_url = null;

  try {
    // ✅ If a new file is uploaded
    if (req.file) {
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: "about_sections",
      });
      image_url = result.secure_url;
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }

    if (remove_image === "true") {
      // ✅ Explicitly set section_image to NULL if remove_image is checked
      await pool.query(
        `UPDATE about_sections
         SET section_title = $1,
             content = $2,
             section_order = $3,
             section_image = NULL,
             updated_at = NOW()
         WHERE id = $4`,
        [section_title, content, section_order || 0, id]
      );
    } else {
      // ✅ Either keep old image, or replace with uploaded one
      await pool.query(
        `UPDATE about_sections
         SET section_title = $1,
             content = $2,
             section_order = $3,
             section_image = COALESCE($4, section_image),
             updated_at = NOW()
         WHERE id = $5`,
        [section_title, content, section_order || 0, image_url, id]
      );
    }

    res.redirect("/admin/about");
  } catch (err) {
    console.error("❌ Error updating section:", err);
    res.redirect("/admin/about?error=update");
  }
};


// Delete section (same as yours)
exports.deleteAboutSection = async (req, res) => {
  const { id } = req.params;
  await pool.query("DELETE FROM about_sections WHERE id = $1", [id]);
  res.redirect("/admin/about");
};


// // Show about page to users
exports.getAboutPage = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }
  const result = await pool.query("SELECT * FROM about_sections ORDER BY id");
  const infoResult = await pool.query(
    "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
  );

  res.render("about", {
    sections: result.rows,
    info: infoResult.rows[0] || {},
    isLoggedIn: !!req.session.user,
    users: req.session.user,
    subscribed: req.query.subscribed,
    paid: req.query.paid,
    walletBalance: 0,
    activePage: "about", // 👈 Pass active page
    role: 'admin' // 👈 Pass role
  });
};

// // Show admin edit view
exports.getEditAboutPage = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }
  const result = await pool.query("SELECT * FROM about_sections ORDER BY id");
  const infoResult = await pool.query(
    "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
  );
  res.render("admin/editAbout", {
    sections: result.rows,
    info: infoResult.rows[0] || {},
    role: "admin",
    users: req.session.user,
  });
};

// // Create new section
// // exports.createAboutSection = async (req, res) => {
// //   const { section_key, section_title, content } = req.body;

// //   await pool.query(
// //     `INSERT INTO about_sections (section_key, section_title, content)
// //      VALUES ($1, $2, $3)`,
// //     [section_key, section_title, content]
// //   );

// //   res.redirect("/admin/about");
// // };

// exports.createAboutSection = async (req, res) => {
//   const { section_key, section_title, content } = req.body;

//   try {
//     await pool.query(
//       `INSERT INTO about_sections (section_key, section_title, content)
//        VALUES ($1, $2, $3)`,
//       [section_key, section_title, content]
//     );
//     res.redirect("/admin/about");
//   } catch (err) {
//     console.error("❌ Error creating section:", err);
//     res.redirect("/admin/about?error=duplicate");
//   }
// };


// // Update section
// exports.updateAboutSection = async (req, res) => {
//   const { section_key, content } = req.body;
//   await pool.query(
//     "UPDATE about_sections SET content = $1, updated_at = NOW() WHERE section_key = $2",
//     [content, section_key]
//   );
//   res.redirect("/admin/about");
// };

// // Delete section
// exports.deleteAboutSection = async (req, res) => {
//   const { id } = req.params;
//   await pool.query("DELETE FROM about_sections WHERE id = $1", [id]);
//   res.redirect("/admin/about");
// };


