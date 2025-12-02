function buildFeedbackAdminEmail({
  name,
  user_type,
  email,
  school_name,
  student_class,
  organization_name,
  rating,
  category,
  message,
  extra,
}) {
  return `
  <div style="font-family: Arial, sans-serif; background:#f8f8f8; padding:20px;">
    <div style="max-width:700px; margin:0 auto; background:white; padding:25px; border-radius:10px; border:1px solid #ddd;">

      <div style="text-align:center; margin-bottom:20px;">
        <img src="https://acad.jkthub.com/images/JKT logo bg.png" alt="Logo" style="height:55px;">
      </div>

      <h2 style="color:#222; margin-bottom:10px;">📬 New Feedback Received</h2>

      <p style="color:#444; font-size:15px;">
        A new feedback entry has been submitted by a <strong>${user_type}</strong>.
      </p>

      <hr style="margin:20px 0;">

      <h3 style="color:#333;">👤 User Details</h3>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email || "No email provided"}</p>
      ${school_name ? `<p><strong>School:</strong> ${school_name}</p>` : ""}
      ${student_class ? `<p><strong>Class:</strong> ${student_class}</p>` : ""}
      ${
        organization_name
          ? `<p><strong>Organization:</strong> ${organization_name}</p>`
          : ""
      }

      <hr style="margin:20px 0;">

      <h3 style="color:#333;">⭐ Feedback Summary</h3>
      <p><strong>Rating:</strong> ${rating}/5</p>
      <p><strong>Category:</strong> ${category || "None"}</p>
      <p><strong>Extra Data:</strong> ${
        extra ? JSON.stringify(extra) : "None"
      }</p>

      <div style="margin-top:15px; padding:15px; background:#fafafa; border-left:4px solid #2196F3;">
        <strong>Message:</strong>
        <blockquote style="color:#555; font-style:italic; margin-top:10px;">
          ${message}
        </blockquote>
      </div>

      <hr style="margin:25px 0;">

      <p style="font-size:13px; color:#777; text-align:center;">
        This is an automated alert from <strong>JKT Hub Feedback System</strong>.
      </p>

    </div>
  </div>
  `;
}

module.exports = buildFeedbackAdminEmail;
