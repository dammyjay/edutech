// // utils/ai.js
// const OpenAI = require("openai");

// const client = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY,
// });

// async function askTutor({ question, lessonContext, userName }) {
//   const system = `You are a supportive EdTech tutor.
// - Explain clearly in steps.
// - When asked about code, give short runnable snippets.
// - If the student looks confused, ask one probing question.
// - If there's a video or lesson context, use it to answer.`;

//   const user = [
//     `Student: ${userName || "Student"}`,
//     lessonContext ? `Lesson context:\n${lessonContext}` : null,
//     `Question:\n${question}`,
//   ]
//     .filter(Boolean)
//     .join("\n\n");

//   const resp = await client.chat.completions.create({
//     model: "gpt-4o-mini",
//     messages: [
//       { role: "system", content: system },
//       { role: "user", content: user },
//     ],
//     temperature: 0.3,
//   });

//   return (
//     resp.choices[0]?.message?.content?.trim() ||
//     "I’m not sure yet. Try rephrasing that?"
//   );
// }

// module.exports = { askTutor };


// utils/ai.js
const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function askTutor({ question, lessonContext = "", userName = "Student" }) {
  try {
    // 🧹 Clean lesson context (remove HTML tags, trim spaces)
    let cleanContext = lessonContext.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

    // ✅ Summarize automatically if lesson text is very long
    if (cleanContext.length > 3500) {
      console.log("🔹 Summarizing long lesson before sending to model...");

      const summaryResp = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a summarizer. Condense long lessons into short, clear summaries under 1000 characters.",
          },
          {
            role: "user",
            content: `Summarize this lesson briefly:\n${cleanContext}`,
          },
        ],
        max_tokens: 500,
        temperature: 0.5,
      });

      cleanContext =
        summaryResp.choices[0]?.message?.content ||
        "Summary unavailable. Please check the lesson.";
    }

    // 🧠 Create system role and user message
    const system = `You are a supportive EdTech tutor. 
- Explain clearly in steps.
- When asked about code, give short runnable snippets.
- If the student looks confused, ask one probing question.
- If there's a video or lesson context, use it to answer.`;

    const userMessage = [
      `Student: ${userName}`,
      cleanContext ? `Lesson context:\n${cleanContext}` : null,
      `Question:\n${question}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    // ✅ Ask the AI Tutor
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMessage },
      ],
      max_tokens: 700,
      temperature: 0.5,
    });

    return (
      resp.choices[0]?.message?.content?.trim() ||
      "🤖 I’m not sure yet. Try rephrasing that?"
    );
  } catch (err) {
    console.error("AI Tutor Error:", err.message);
    return "⚠️ Sorry, I couldn’t process your question right now.";
  }
}

module.exports = { askTutor };
