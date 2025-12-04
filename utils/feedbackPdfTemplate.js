module.exports = function buildFeedbackPDF(feedback) {
  return `
  <html>
  <head>
    <meta charset="utf-8">
    <style>
      body {
        font-family: Arial, sans-serif;
        padding: 30px;
        color: #2c3e50;
      }
      h1 {
        text-align: center;
        color: #34495e;
      }
      h3 { color: #2980b9; }

      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 20px;
        font-size: 12px;
      }

      th, td {
        border: 1px solid #ddd;
        padding: 8px;
      }

      th {
        background: #2c3e50;
        color: white;
        text-align: left;
      }

      tr:nth-child(even) { background: #f9f9f9; }

      .summary-boxes {
        display: flex;
        flex-wrap: wrap;
        gap: 15px;
        margin-top: 20px;
      }

      .box {
        background: #ecf0f1;
        padding: 15px;
        border-radius: 8px;
        width: 160px;
      }

      .footer {
        font-size: 10px;
        margin-top: 40px;
        text-align: center;
        color: gray;
      }
    </style>
  </head>

  <body>

    <h1>📄 Feedback Report</h1>
    <p style="text-align:center;color:gray;">Generated on: ${new Date().toLocaleString()}</p>

    <h3>Summary Statistics</h3>

    <div class="summary-boxes">
      <div class="box"><strong>Total Feedback:</strong> ${feedback.length}</div>
      <div class="box"><strong>Average Rating:</strong> ${(
        feedback.reduce((a, x) => a + (x.rating || 0), 0) / feedback.length
      ).toFixed(1)}</div>
      <div class="box"><strong>Students:</strong> ${
        feedback.filter((x) => x.user_type === "student").length
      }</div>
      <div class="box"><strong>Teachers:</strong> ${
        feedback.filter((x) => x.user_type === "teacher").length
      }</div>
      <div class="box"><strong>Parents:</strong> ${
        feedback.filter((x) => x.user_type === "parent").length
      }</div>
      <div class="box"><strong>School Owners:</strong> ${
        feedback.filter((x) => x.user_type === "school_owner").length
      }</div>
      <div class="box"><strong>Organizations:</strong> ${
        feedback.filter((x) => x.user_type === "organization").length
      }</div>
    </div>

    <h3 style="margin-top:35px;">All Feedback Entries</h3>

    <table>
      <tr>
        <th>Type</th>
        <th>Name</th>
        <th>Email</th>
        <th>Rating</th>
        <th>Sentiment</th>
        <th>Message</th>
        <th>Date</th>
        <th>Published</th>
      </tr>

      ${feedback
        .map(
          (f) => `
        <tr>
          <td>${f.user_type}</td>
          <td>${f.name}</td>
          <td>${f.email || ""}</td>
          <td>${f.rating || "—"}</td>
          <td>${f.sentiment_label || "—"}</td>
          <td>${f.message}</td>
          <td>${new Date(f.created_at).toLocaleDateString()}</td>
          <td>${f.is_published ? "Yes" : "No"}</td>
        </tr>
      `
        )
        .join("")}

    </table>

    <div class="footer">© ${new Date().getFullYear()} Feedback Report</div>

  </body>
  </html>`;
};
