// const { pool } = require("../models/db");

// exports.getGallery = async (req, res) => {
//   const categories = await pool.query("SELECT * FROM gallery_categories");
//   const images = await pool.query(`
//     SELECT gi.*, gc.name as category_name
//     FROM gallery_images gi
//     JOIN gallery_categories gc ON gi.category_id = gc.id
//     ORDER BY gi.uploaded_at DESC
//   `);

//   const isLoggedIn = !!req.session.user; // or whatever property you use for login
//   const profilePic = req.session.user ? req.session.user.profile_picture : null;

//   let walletBalance = 0;
//   if (req.session.user) {
//     const walletResult = await pool.query(
//       "SELECT wallet_balance2 FROM users2 WHERE email = $1",
//       [req.session.user.email]
//     );
//     walletBalance = walletResult.rows[0]?.wallet_balance2 || 0;
//   }

//   const infoResult = await pool.query(
//     "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
//   );
//   const info = infoResult.rows[0] || {};
//   // ✅ Extract paid status from query
//   const paid = req.query.paid;
//   res.render("gallery", {
//     categories: categories.rows,
//     images: images.rows,
//     info,
//     isLoggedIn,
//     users: req.session.user,
//     subscribed: req.query.subscribed,
//     paid,
//     walletBalance,
//   });
// };

// // Add uploadGalleryImage, createCategory, deleteImage as needed


const pool = require("../models/db");
// const uploadToCloudinary = require("../utils/cloudinary"); // assuming you already use this
const cloudinary = require("../utils/cloudinary");
const fs = require("fs");


// GET gallery page
exports.getGallery = async (req, res) => {
  const categories = await pool.query("SELECT * FROM gallery_categories");
  const images = await pool.query(`
    SELECT gi.*, gc.name as category_name
    FROM gallery_images gi
    JOIN gallery_categories gc ON gi.category_id = gc.id
    ORDER BY gi.uploaded_at DESC
  `);

  const infoResult = await pool.query(
    "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
  );
  const info = infoResult.rows[0] || {};
  const user = req.session.user;

  let walletBalance = 0;
  if (user) {
    const wallet = await pool.query(
      "SELECT wallet_balance2 FROM users2 WHERE email = $1",
      [user.email]
    );
    walletBalance = wallet.rows[0]?.wallet_balance2 || 0;
  }

  res.render("gallery", {
    categories: categories.rows,
    images: images.rows,
    info,
    isLoggedIn: !!user,
    users: user,
    walletBalance,
    subscribed: req.query.subscribed,
    paid: req.query.paid,
    info: infoResult.rows[0] || {},
    role: "admin",
  });
};

// GET admin gallery dashboard
exports.getAdminGallery = async (req, res) => {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/admin/login");
  }
  const categories = await pool.query(
    "SELECT * FROM gallery_categories ORDER BY name ASC"
  );
  const images = await pool.query(`
    SELECT gi.*, gc.name as category_name
    FROM gallery_images gi
    JOIN gallery_categories gc ON gi.category_id = gc.id
    ORDER BY gi.uploaded_at DESC
  `);

  const infoResult = await pool.query(
    "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
  );
  const info = infoResult.rows[0] || {};

  res.render("admin/gallery", {
    categories: categories.rows,
    images: images.rows,
    info,
    info: infoResult.rows[0] || {},
    role: "admin",
    users: req.session.user,
  });
};

// Upload new image
exports.uploadGalleryImage = async (req, res) => {
  const { title, category_id } = req.body;
  let image_url = null;

  if (req.file) {
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: "image",
    });
    image_url = result.secure_url;
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    await pool.query(
      "INSERT INTO gallery_images (title, image_url, category_id) VALUES ($1, $2, $3)",
      [title, result.secure_url, category_id]
    );

    res.redirect("/admin/gallery");
  };
};

// Create category
exports.createCategory = async (req, res) => {
  const { name } = req.body;
  await pool.query("INSERT INTO gallery_categories (name) VALUES ($1)", [name]);
  res.redirect("/admin/gallery");
};

// Delete image
exports.deleteImage = async (req, res) => {
  const { id } = req.params;
  await pool.query("DELETE FROM gallery_images WHERE id = $1", [id]);
  res.redirect("/admin/gallery");
};

// Delete category
exports.deleteCategory = async (req, res) => {
  const { id } = req.params;
  await pool.query("DELETE FROM gallery_categories WHERE id = $1", [id]);
  res.redirect("/admin/gallery");
};
