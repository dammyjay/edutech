module.exports = function buildAnalyticsPDF(data) {
  const {
    overview,
    users,
    courses,
    quizzes,
    activity,
    finance,
    eventPaymentDetails,
  } = data;

  function tableRows(items, cols) {
    return items
      .map((item) => {
        return `<tr>${cols
          .map((c) => `<td>${item[c] ?? "—"}</td>`)
          .join("")}</tr>`;
      })
      .join("");
  }

  return `
<html>
<head>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>

<meta charset="utf-8" />
<style>
  body { font-family: Arial, sans-serif; padding: 30px; color: #2c3e50; }
  h1 { text-align: center; color: #34495e; }
  h2 { margin-top: 30px; color: #2980b9; }
  h3 { margin-top: 20px; }

  table {
    width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px;
  }
  th, td {
    border: 1px solid #ddd; padding: 6px;
  }
  th { background: #2c3e50; color: white; text-align: left; }
  tr:nth-child(even) { background: #f9f9f9; }

  .cards { display: flex; flex-wrap: wrap; gap: 15px; }
  .card {
    background: #ecf0f1; padding: 12px; border-radius: 8px;
    width: 180px;
  }
  .footer { margin-top: 40px; text-align: center; font-size: 10px; color: gray; }
</style>
</head>

<body>

<h1>📊 Analytics Report</h1>
<p style="text-align:center;color:gray;">Generated on ${new Date().toLocaleString()}</p>

<h2>Summary Cards</h2>
<div class="cards">
  <div class="card"><strong>Total Users:</strong> ${overview.total_users}</div>
  <div class="card"><strong>Active (24h):</strong> ${overview.dau}</div>
  <div class="card"><strong>New (7d):</strong> ${
    overview.new_users?.new_7d
  }</div>
  <div class="card"><strong>Total Courses:</strong> ${
    courses.counts.total_courses
  }</div>
  <div class="card"><strong>Avg Quiz Score:</strong> ${
    quizzes.summary.avg_score
  }</div>
  <div class="card"><strong>Total Revenue:</strong> ${
    finance.revenue.total_revenue
  }</div>
  <div class="card"><strong>Revenue (30d):</strong> ${
    finance.revenue.revenue_30d
  }</div>
</div>

<h2>Users by Role</h2>
<h2>Users by Role (Chart)</h2>
<canvas id="usersRoleChart" width="400" height="200"></canvas>

<table>
  <tr><th>Role</th><th>Count</th></tr>
  ${tableRows(users.byRole, ["role", "count"])}
</table>


<h2>Top Courses Progress</h2>
<canvas id="coursesProgressChart" width="400" height="200"></canvas>

<h2>Top Courses</h2>
<table>
  <thead>
    <tr>
      <th>Course</th>
      <th>Total Lessons</th>
      <th>Avg Completed Lessons</th>
      <th>Individual Students</th>
      <th>School Students</th>
      <th>Total Enrollments</th>
      <th>Avg Progress</th>
    </tr>
  </thead>
  <tbody>
    ${courses.topCourses
      .map(
        (c) => `
      <tr>
        <td>${c.title}</td>
        <td>${c.total_lessons}</td>
        <td>${c.avg_completed_lessons}</td>
        <td>${c.individual_enrollments}</td>
        <td>${c.school_enrollments}</td>
        <td>${c.total_enrollments}</td>
        <td>${c.avg_progress}%</td>
      </tr>
    `
      )
      .join("")}
  </tbody>
</table>

<h2>Quiz Pass / Fail</h2>
<table>
  <tr><th>Status</th><th>Count</th></tr>
  ${tableRows(quizzes.passFail, ["passed", "count"])}
</table>

<h2>School Payments</h2>
<table>
  <tr><th>Status</th><th>Count</th></tr>
  ${tableRows(finance.schoolPayments, ["status", "count"])}
</table>

<h2>Event Payments</h2>
<table>
  <tr><th>Status</th><th>Count</th><th>Total Collected</th></tr>
  ${tableRows(finance.eventPayments, [
    "payment_status",
    "count",
    "total_collected",
  ])}
</table>

<h2>Event Payment Details</h2>
<table>
  <tr><th>User</th><th>Email</th><th>Event</th><th>Status</th><th>Amount</th><th>Date</th></tr>
  ${eventPaymentDetails
    .map(
      (e) => `
    <tr>
      <td>${e.fullname}</td>
      <td>${e.email}</td>
      <td>${e.event_title}</td>
      <td>${e.payment_status}</td>
      <td>${e.amount}</td>
      <td>${new Date(e.created_at).toLocaleDateString()}</td>
    </tr>
  `
    )
    .join("")}
</table>

<h2>Recent Activity</h2>
<table>
  <tr><th>Date</th><th>Role</th><th>Action</th><th>Details</th></tr>
  ${activity.feed
    .map(
      (a) => `
      <tr>
        <td>${new Date(a.created_at).toLocaleString()}</td>
        <td>${a.role}</td>
        <td>${a.action}</td>
        <td>${a.details || ""}</td>
      </tr>
      `
    )
    .join("")}
</table>

<div class="footer">© ${new Date().getFullYear()} Analytics Report</div>

<script>
  // Users by Role Chart
  const usersRoleCtx = document.getElementById('usersRoleChart').getContext('2d');
  new Chart(usersRoleCtx, {
    type: 'bar',
    data: {
      labels: ${JSON.stringify(users.byRole.map((u) => u.role))},
      datasets: [{
        label: 'Number of Users',
        data: ${JSON.stringify(users.byRole.map((u) => u.count))},
        backgroundColor: 'rgba(52, 152, 219, 0.6)',
        borderColor: 'rgba(52, 152, 219, 1)',
        borderWidth: 1
      }]
    },
    options: { responsive: true, plugins: { legend: { display: false } } }
  });

  // Top Courses Progress Chart
  const coursesProgressCtx = document.getElementById('coursesProgressChart').getContext('2d');
  new Chart(coursesProgressCtx, {
    type: 'line',
    data: {
      labels: ${JSON.stringify(courses.topCourses.map((c) => c.title))},
      datasets: [{
        label: 'Avg Progress (%)',
        data: ${JSON.stringify(courses.topCourses.map((c) => c.avg_progress))},
        backgroundColor: 'rgba(46, 204, 113, 0.6)',
        borderColor: 'rgba(46, 204, 113, 1)',
        fill: false,
        tension: 0.1
      }]
    },
    options: { responsive: true }
  });
</script>


</body>
</html>
`;
};
