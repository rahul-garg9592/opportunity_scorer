const express = require("express");
const multer = require("multer");
const bodyParser = require("body-parser");
const cors = require("cors");
const fs = require("fs");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Tesseract = require("tesseract.js")
const { exec } = require("child_process");
require("dotenv").config();

const app = express();
const upload = multer({ dest: "uploads/" });
const port = 7872;

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ----------------------------
// Job LLM Prompt Function
// ----------------------------
async function processJobWithLLM(message) {
  const prompt = `
You are an intelligent job evaluator. Given a WhatsApp message about a job opportunity, your task is to:

1. Extract job information.
2. If the tech stack is not explicitly mentioned, infer a relevant tech stack from the job description.
3. Score the job based on the following criteria.
4. Assign relevant tags.
5. Return everything as valid JSON.

--- Extract the following fields ---
- job_title
- job_description
- company_name
- location
- experience_required
- tech_stack (list)
- contact_info (list of emails and phone numbers)

--- Evaluate and return ---
- score (0 to 15)
- tier: "high", "medium", "low"
- tags (list): choose from ["unpaid", "well_paid", "negotiable", "student_friendly", "high_learning", "reputed_company", "startup", "remote", "full_time", "clear_info"]

--- Scoring Guidelines ---
- Compensation:
    - unpaid/intern → +1
    - negotiable → +2
    - stipend/salary/inr/lpa → +3
- Learning opportunity (training, mentorship, hands-on): +1 to +2
- Student friendly (0-1 yr, fresher, intern): +1 to +2
- Remote/hybrid/work from home: +1
- Reputed company (Google, Microsoft, Amazon, Flipkart): +2
- Full-time or clear job info: +1 to +2

Respond only with valid JSON. Use this job message:

"""${message}"""
`;

  const result = await model.generateContent(prompt);
  let text = result.response.text().trim();

  // Clean response and extract JSON
  text = text.replace(/```json|```/g, "").trim();
  const match = text.match(/\{[\s\S]*?\}/);
  if (!match) throw new Error("No valid JSON object found in model output.");

  const parsed = JSON.parse(match[0]);

  // If score missing, do fallback scoring
  if (!parsed.score) {
    const evaluated = fallbackScore(parsed);
    return { ...parsed, ...evaluated };
  }

  return parsed;
}

function fallbackScore(job) {
  let score = 0;
  const tags = [];

  const desc = (job.job_description || "").toLowerCase();
  const title = (Array.isArray(job.job_title) ? job.job_title.join(" ") : job.job_title || "").toLowerCase();
  const experience = (job.experience_required || "").toLowerCase();
  const company = (job.company_name || "").toLowerCase();
  const location = (job.location || "").toLowerCase();

  // --- Compensation ---
  if (/intern|unpaid/.test(desc)) {
    score += 1;
    tags.push("unpaid");
  } else if (desc.includes("negotiable")) {
    score += 2;
    tags.push("negotiable");
  } else if (/(inr|lpa|salary|stipend)/.test(desc)) {
    score += 3;
    tags.push("well_paid");
  }

  // --- Learning ---
  if (/mentorship|training|hands-on|learning/.test(desc)) {
    score += 2;
    tags.push("high_learning");
  }

  // --- Student Friendly ---
  if (/intern|fresher|0-1 year|entry/.test(desc + " " + experience)) {
    score += 2;
    tags.push("student_friendly");
  }

  // --- Company Reputation ---
  if (/google|amazon|microsoft|flipkart/.test(company)) {
    score += 2;
    tags.push("reputed_company");
  } else if (/startup/.test(desc)) {
    score += 1;
    tags.push("startup");
  }

  // --- Remote ---
  if (/remote|hybrid|work from home/.test(desc + location)) {
    score += 1;
    tags.push("remote");
  }

  // --- Full-time / Clear Info ---
  if (/full[-\s]?time|permanent/.test(desc)) {
    score += 2;
    tags.push("full_time");
  }

  const clarity = job.job_title && job.job_description && job.company_name && job.location;
  if (clarity && desc.length > 100) {
    score += 2;
    tags.push("clear_info");
  } else if (clarity) {
    score += 1;
  }

  let tier = "low";
  if (score >= 11) tier = "high";
  else if (score >= 7) tier = "medium";

  return { score, tier, tags };
}
 

// ----------------------------
// OCR from Uploaded Image
// ----------------------------
async function extractTextFromImage(imagePath) {
  const { data: { text } } = await Tesseract.recognize(imagePath, "eng");
  return text.trim();
}

// ----------------------------
// API Health Check
// ----------------------------
app.get("/", (req, res) => {
  res.send("✅ Job Parser API is running.");
});

// ----------------------------
// Main API Route
// ----------------------------
app.post("/api/parse-job", upload.single("image"), async (req, res) => {
  try {
    let message = req.body.text || "";

    // OCR from image if text not provided
    if (!message && req.file) {
      message = await extractTextFromImage(req.file.path);
      fs.unlinkSync(req.file.path); // delete temp image
    }

    // Scrape LinkedIn job if URL provided
    const match = message.match(/https:\/\/www\.linkedin\.com\/jobs\/view\/\d+/);
    if (match) {
      const url = match[0];
      const result = await new Promise((resolve, reject) => {
        exec(`node linkedinscrap.js ${url}`, (err, stdout, stderr) => {
          if (err) return reject(stderr);
          try {
            resolve(JSON.parse(stdout.trim()));
          } catch (e) {
            reject("Invalid JSON from scraper");
          }
        });
      });
      message = JSON.stringify(result, null, 2);
    }

    // Process with Gemini LLM
    const job = await processJobWithLLM(message);

    // Save to scored_jobs.json
    fs.appendFileSync("scored_jobs.json", JSON.stringify(job, null, 2) + ",\n");

    res.json({ status: "✅ Job parsed and scored successfully!", job });

  } catch (error) {
    console.error("❌", error);
    res.status(500).json({ status: "❌ Failed", error: error.toString() });
  }
});

app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
