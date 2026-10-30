# Class Test Portal — Vercel + Next.js + FastAPI + Supabase

This project is a class aptitude/programming test portal rebuilt with a Next.js frontend, Python FastAPI backend, and Supabase PostgreSQL. It is intended as a class-sized assessment MVP; run an end-to-end and concurrency test before a real exam.

## Added features

- **Student sign-up, sign-in, and Forgot password.** Students register with name, roll number, a unique email address, and password. New self-registered accounts remain pending until an admin approves them. Password recovery emails carry single-use, 30-minute reset links; only the SHA-256 token hash is stored in the database. Admins can add/import students and set recovery emails for existing accounts.
- **Large reusable question bank with distinct randomized sets.** Store hundreds or thousands of active questions; each exam setting chooses how many questions (1–500) to draw per attempt. Each attempt gets a saved randomized set, prioritizing questions that student has not seen before. Different students may share some questions, but the exact same combination is not reused across prior attempts in that category. A transaction-level lock prevents two students starting at the same time from receiving identical sets. If the bank cannot provide the configured count or another distinct combination, the app shows an actionable error instead of quietly assigning a smaller or identical set.
- **Manual or scheduled release.** Admin can open/close a test manually or specify start/end timestamps. Students see a waiting message or countdown when a test is not available. Start eligibility is enforced by the database clock, not just the browser.
- **Manual and bulk question entry.** Add/edit questions in the admin UI, upload CSV/Excel `.xlsx`, or import tables from Word `.docx`. Download templates from Admin → Questions. Old binary Word `.doc` files are not supported; save them as `.docx` first. Excel `.xls` is not supported; save as `.xlsx`. Import validates all rows before inserting and allows at most 1,500 rows / 3.8 MB per upload.
- **AI-assisted programming review.** An admin can request an AI score suggestion after a programming attempt is submitted. The review uses the question, expected output, rubric, submitted code and stated output. It does **not** execute the code. Suggested marks and feedback are stored separately from the official score; the official score changes only when the teacher reviews the suggestion and clicks **Save grade**.
- **Atomic submission.** The final answer snapshot is saved and the attempt's status, score and `submitted_at` are updated in one PostgreSQL transaction. Duplicate submissions return the final state instead of submitting twice.
- **Previous scores, answer review, roster import, and manual grading.**

## Technology and project layout

```text
class_test_portal_vercel/
├── backend/
│   ├── app.py                 # Vercel FastAPI entrypoint
│   ├── main.py                # API implementation
│   ├── requirements.txt
│   ├── vercel.json            # Function timeout for AI review
│   ├── .python-version
│   └── .env.example
├── frontend/
│   ├── app/page.tsx                 # Sign in, sign-up and Forgot password
│   ├── app/reset-password/page.tsx  # Reset from emailed one-time token
│   ├── app/dashboard/page.tsx
│   ├── app/admin/page.tsx
│   ├── app/exam/[attemptId]/page.tsx
│   ├── lib/api.ts
│   ├── public/templates/
│   │   ├── question-bank-template.csv
│   │   ├── question-bank-template.xlsx
│   │   ├── question-bank-template.docx
│   │   └── student-roster-template.csv
│   ├── package.json
│   └── .env.example
├── sql/schema.sql
├── sql/password_auth_migration.sql
├── sql/password_reset_migration.sql  # compatible migration filename
├── schema.sql
├── sample_students.csv
└── README.md
```

## Important security and operations notes

- The Supabase server-side secret/service-role key is used **only by the Python backend**. Never put it in a `NEXT_PUBLIC_*` variable or commit it to GitHub.
- If any credential or password hash has been exposed in a screenshot/chat/repository, rotate the affected secret and generate a new admin password hash.
- Self-registration uses a student password hashed server-side and requires admin approval. Use unique passwords and do not put real rosters or passwords in a public repo.
- JWTs are stored in browser localStorage in this MVP. Consider httpOnly secure cookies, login throttling, audit logging, and institutional single sign-on before using sensitive/high-stakes assessments.
- AI grading is optional. It requires an OpenAI API key in the **backend** environment. The backend uses a 60-second Vercel function maximum for this route, so a delayed AI request can still time out and should be retried from the admin panel. API usage can incur separate charges; check your API billing limits. Do not submit sensitive or unnecessary personal data to the AI service. AI output can be wrong and must be reviewed by a teacher; it is not a substitute for a compiler, test runner, or human judgement.
- Student code is never run on the Vercel server. A production auto-grader needs a separate, strongly isolated execution sandbox.
- Vercel's request body limits apply. Bulk imports are capped below the documented 4.5 MB function request payload limit.
- Free hosting quotas and eligibility can change. Check the current Vercel and Supabase terms before deploying for an examination.

## 1. Prepare Supabase

1. In the Supabase project used by this portal, open **SQL Editor**.
2. Back up/export important existing data before applying schema changes to a live project.
3. Run the full `schema.sql` file from this repository. It is designed to add columns/functions for the features above, but confirm that it executes successfully in the correct project.
4. Confirm these tables exist: `students`, `questions`, `exam_settings`, `attempts`, `attempt_questions`, `answers`.
5. Confirm these functions exist in the `public` schema and are executable by `service_role`: `start_attempt_atomic`, `save_answer_atomic`, `submit_attempt_atomic`, `grade_answer_atomic`.
6. Ensure both `aptitude` and `programming` rows exist in `exam_settings`. You can configure test title, duration, question count, release mode, and time window in Admin → Exam settings.

The schema enables RLS and keeps tables inaccessible through anonymous browser calls. The backend connects using a server-side key.

## Randomized unique question sets migration

For an existing deployment, run `sql/randomized_distinct_question_sets.sql` in the Supabase SQL Editor. It replaces only `start_attempt_atomic` and refreshes the API schema cache; it does not delete questions, answers, or attempts. New installations can run the full `schema.sql` instead.

The assignment algorithm uses a randomized set, favors questions that a student has not seen before, and allows overlap between students. It prevents reuse of an identical combination in past attempts in the same category. If there are too few possible combinations, it reports that more active questions are needed rather than silently giving two students the same set. With a small demo question bank, unique combinations will run out quickly; import the real bank and set the question count before opening the test.

## 2. Configure the backend environment

Required variables for the **backend Vercel project only**:

- `SUPABASE_URL`: project root, e.g. `https://your-project-ref.supabase.co` (do not append `/rest/v1`).
- `SUPABASE_SERVICE_ROLE_KEY`: a Supabase Secret key (`sb_secret_...`) or service-role key belonging to that same project.
- `JWT_SECRET`: random secret of at least 32 characters.
- `ADMIN_USERNAME`: admin username.
- `ADMIN_PASSWORD_HASH`: Werkzeug hash of the chosen admin password.
- `FRONTEND_ORIGIN`: exact frontend origin, e.g. `https://your-portal.vercel.app`.
- `FRONTEND_BASE_URL`: one frontend URL used in student password-reset links, e.g. `https://your-portal.vercel.app` (no trailing slash).
- `RESEND_API_KEY`: optional until password recovery is enabled; Resend sending API key, backend only.
- `PASSWORD_RESET_FROM`: verified sender, e.g. `Class Test Portal <no-reply@your-verified-domain.example>`.
- `OPENAI_API_KEY`: optional; enables AI programming-answer review.
- `OPENAI_MODEL`: optional; defaults to `gpt-4.1-mini`.

Generate a JWT secret locally:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Install backend requirements locally if needed, then create the admin password hash:

```bash
python -m pip install -r backend/requirements.txt
python -c "from werkzeug.security import generate_password_hash; print(generate_password_hash('ReplaceWithYourStrongPassword'))"
```

Paste these generated values into Vercel → backend project → Settings → Environment Variables. Never share the hash or key in a screenshot.

## 3. Deploy the backend to Vercel

1. Push this project folder to GitHub.
2. In Vercel, import the repository as a new project.
3. Set **Root Directory** to `backend`.
4. Vercel should detect the conventional `app.py` FastAPI entrypoint (it imports the implementation from `main.py`). Keep the provided `vercel.json`; it configures a 60-second function maximum for the optional AI grading call. If prompted, select the Python/FastAPI setup.
5. Add the required environment variables listed above. If AI grading is not wanted yet, omit `OPENAI_API_KEY`; the rest of the portal remains available.
6. Deploy, then test `https://YOUR-BACKEND.vercel.app/health` and `/docs`.
7. Keep the backend base URL (no trailing slash); you will configure it in the frontend.

## 4. Deploy the frontend to Vercel

1. Create a second Vercel project using the same GitHub repository.
2. Set **Root Directory** to `frontend` and framework to Next.js.
3. Set `NEXT_PUBLIC_API_BASE_URL=https://YOUR-BACKEND.vercel.app` (no `/api` suffix).
4. Deploy the frontend.
5. Copy its exact production origin into the backend project's `FRONTEND_ORIGIN` environment variable, then redeploy the backend.
6. Open the frontend, create a student registration, log in as admin, approve the student, and test the full exam lifecycle.

The frontend and backend are separate deployments because Next.js is a web frontend and FastAPI is a Python backend. Both connect to the same Supabase project, but only the backend receives the database secret.

## 5. Local development

### Backend, terminal 1

```bash
cd backend
python -m venv .venv
# Windows PowerShell: .venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
```

Set environment variables from `.env.example` in your shell (or use a local environment loader that is not committed), then:

```bash
uvicorn main:app --reload --port 8000
```

### Frontend, terminal 2

```bash
cd frontend
npm install
```

Create `frontend/.env.local` containing:

```text
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

Then run:

```bash
npm run dev
```

Open `http://localhost:3000`.

## 6. Student sign-up, approval and forgotten password recovery

- Student sign-up asks for full name, roll number, email address and password. The email address is required for self-service password recovery.
- Registration creates a pending account. A teacher must approve it in Admin → Students before sign-in works.
- Admin can create accounts or import a roster. Add an email address in the student form/roster so password recovery can work.
- Existing students who were created before email support must have their recovery email added in Admin → Students using the Recovery email field and **Save**. Until then, they should contact the teacher to recover access.
- CSV roster format (email is optional for old imported rosters, but required for recovery):

```csv
roll_number,full_name,email,password
DS001,Student One,student1@example.com,482913
DS002,Student Two,student2@example.com,725164
```

passwords are hashed server-side. Do not upload a real roster with passwords to a public GitHub repo.

### Enable the Forgot password email flow

1. For an existing PIN-based installation, back up the database and run `sql/password_auth_migration.sql` in Supabase SQL Editor before deploying the updated code. It preserves existing password hashes while renaming `pin_hash` to `password_hash`, and creates the new password-reset objects. For a new installation, run the updated `schema.sql`.
2. Create a Resend account and an API key with sending permissions. Add/verify a sending domain in Resend for sending to real student addresses. Resend's default test sender is for testing and is not a substitute for verifying your institution/domain for production email.
3. In the **backend Vercel project** → Settings → Environment Variables, set `RESEND_API_KEY`, `PASSWORD_RESET_FROM`, and `FRONTEND_BASE_URL` to your actual backend email key, verified sender, and exact production frontend URL.
4. Redeploy the backend. The frontend now shows **Forgot password?** on student sign-in. The API returns the same success message for unknown, pending and disabled accounts to avoid leaking registered accounts.
5. Test with one active test student whose email you can receive. Reset links expire after 30 minutes, are single-use, and the raw token is not stored in the database.

The email-sending integration uses Resend's HTTPS email API. Keep `RESEND_API_KEY` only in the backend environment; never place it in a `NEXT_PUBLIC_*` variable or GitHub. Admin credentials are currently environment-based, so admin password recovery is managed by the deployment owner by generating a new `ADMIN_PASSWORD_HASH` and updating the backend Vercel environment.

## 7. Bulk question import format

In Admin → Questions, download the CSV, Excel or Word template and fill in each row. Supported uploads are `.csv`, `.xlsx`, and `.docx` (Word tables). `.doc` and `.xls` are not supported; convert them first.

Required fields: `category`, `question_type`, `prompt`. Other supported columns:

- `category`: `aptitude` or `programming`.
- `question_type`: `mcq`, `short`, or `coding`.
- `options`: pipe-separated choices, such as `Choice A | Choice B | Choice C` (for MCQ).
- `correct_answer`: required for MCQ/short-answer questions. For accepted short answers, separate variants with `|`.
- `expected_output`: optional expected output for programming questions.
- `grading_rubric`: optional criteria supplied to the AI grader (e.g. algorithm 5 marks, correctness 3 marks, edge cases 2 marks).
- `topic`, `difficulty` (`Easy`, `Medium`, `Hard`), `marks`, `is_active` (`true`/`false`).

For programming questions set `category=programming` and `question_type=coding`. Questions are validated before any batch insert is attempted. The importer supports up to 1,500 questions per file; split larger files into batches. Check the import summary and any row errors before publishing an assessment.

## 8. Configure exams and random question selection

Open Admin → Exam settings and choose each category's title, duration, and question count. The question count is the number selected for each attempt from the active bank (not the total number stored). The schema supports 1–500 questions per attempt; the active bank must contain at least that many questions. Different students may receive overlapping questions, but their full question sets are kept distinct across prior attempts in that category. This requires enough possible combinations: for example, a bank of 40 questions with 20 per attempt has far fewer combinations than a bank of 500 with 30 per attempt. Import a larger bank if you see the 'cannot make another unique question set' message.

Choose one release mode:

- **Manual:** leave scheduled times blank and use the open/closed control. Students see that the test is not available until you open it.
- **Scheduled:** enter a start time and optional end time. The frontend displays a countdown before start and a closed message after the window ends. The server/database also enforces whether a student can start an attempt.

Use timestamps in your local timezone in the admin UI; the frontend converts them to UTC for storage. Validate start/end times and test with a student account before the exam.

## 9. AI-assisted programming grading

1. Add `OPENAI_API_KEY` to the backend project's environment variables and redeploy the backend. Set `OPENAI_MODEL` only if you want to override the default.
2. Add an optional `grading_rubric` to programming questions. Rubrics should specify what earns partial marks.
3. After a student submits, open Admin → Results and select the submitted attempt.
4. Click **AI assess** on a programming answer. The API sends the question, expected output, rubric, submitted code and stated output to the configured OpenAI model and asks for marks/feedback in a constrained JSON format.
5. Review the suggested marks and feedback. Click Save grade or edit the marks before saving. Manual grading overwrites the AI suggestion and records the source.

AI grading is a suggestion, may make mistakes, and is not an executed test. Do not treat the confidence estimate as a guarantee of correctness. For auto-grading with test cases, integrate a sandbox isolated from the web service instead.

## 10. Submission integrity and load testing

- The final client request sends the complete current answer state to `submit_attempt_atomic`. The database transaction saves all provided answers, applies objective marking/output matching, computes totals, and changes the attempt status and `submitted_at` together.
- Submission requests are intended to be idempotent: a retry returns an already-closed attempt's final state rather than duplicating it.
- Deadline enforcement uses the database clock. Expired attempts are stored as `expired` rather than `submitted` if the deadline has passed.
- Active attempts are resumed rather than generating a second attempt for the same student/category.
- Before a real examination, test at least 60 concurrent users performing login, dashboard load, question retrieval, autosave, and submit. Confirm every attempt ends in `submitted` or `expired` and has a `submitted_at` timestamp. Check Vercel function logs and Supabase API/database logs. Do not rely on a framework or hosting plan alone as proof of capacity.

## Troubleshooting

- **CORS:** set `FRONTEND_ORIGIN` to the exact frontend origin and redeploy backend.
- **Student cannot sign in after registration:** approve them in Admin → Students; ensure `is_active=true`.
- **Import fails:** use an included template; check enum values and required MCQ answers; ensure file is `.xlsx` or `.docx` rather than legacy `.xls`/`.doc`; keep file below 3.8 MB.
- **AI assess button errors:** check `OPENAI_API_KEY`, API account limits/billing, and backend logs.
- **Submission RPC missing:** run the full schema SQL in the correct Supabase project and verify the `public.submit_attempt_atomic` function and service-role execute grants.
- **Supabase returns unregistered API key:** use a URL and secret from the same project, and do not append `/rest/v1` to `SUPABASE_URL`.
- **Frontend cannot call API:** verify `NEXT_PUBLIC_API_BASE_URL` points to the backend deployment URL and redeploy frontend after changes.


### Student passwords
New student passwords must be at least 8 characters and are hashed server-side before storage. Existing student credential hashes are preserved by `sql/password_auth_migration.sql`; for existing accounts, the previous credential remains the initial password until the student resets it. Existing short PINs are still accepted as initial passwords for compatibility; students should use Forgot password to create a password of at least 8 characters. The roster CSV should use a `password` column. Delete local CSV files containing temporary passwords after import.


## 11. Email two-step authentication (2FA)

Student and admin sign-ins use a password followed by a six-digit code sent to a registered email address. The API does not return a session JWT until the code is verified. Codes expire after five minutes, can be used once, permit at most five attempts, and new codes are rate-limited to one per account per 60 seconds. OTP hashes are HMACed with the backend JWT secret before storage.

### New Supabase project
Run the latest root `schema.sql` once in the intended Supabase project.

### Existing Supabase project
Back up the database first. For an older PIN-based database, run `sql/password_auth_migration.sql` to preserve existing credential hashes while renaming `pin_hash` to `password_hash`; that migration also creates the reset-token table and reset functions. Then run `sql/randomized_distinct_question_sets.sql` only if your database has not yet received the unique randomized-set feature, and run `sql/email_two_factor_migration.sql` to create the OTP challenge table/functions. `sql/password_reset_migration.sql` duplicates the reset functions and is not normally needed when `password_auth_migration.sql` has already completed. If any attempt/question schema is older than this release, back up and compare it with the current root `schema.sql` before changing live data.

### Backend Vercel environment variables
Keep these on the backend project only:
- `RESEND_API_KEY`: Resend API key used for login OTP and password reset email.
- `TWO_FACTOR_FROM`: verified sender address for OTP emails; if blank, `PASSWORD_RESET_FROM` is reused.
- `ADMIN_MFA_EMAIL`: email address where the admin's second-factor code is delivered.
- `JWT_SECRET`: random secret of at least 32 characters. OTP digests are keyed with this secret; changing it invalidates existing sessions and requires a new login.
- Existing variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `FRONTEND_ORIGIN`, `FRONTEND_BASE_URL`, `PASSWORD_RESET_FROM`.

Student accounts must have a valid email on the student record before login. Students should sign up with their own email; existing accounts missing email addresses need the admin to add one through Admin → Students. The admin must configure `ADMIN_MFA_EMAIL`. If OTP email setup is missing, sign-in is intentionally blocked rather than bypassing the second factor.

### Deploy sequence
1. Update GitHub with all latest files.
2. Run the OTP SQL migration if using an existing database.
3. Add the new backend environment variables above and redeploy the backend Vercel project.
4. Redeploy frontend from the same updated repository; the frontend login page now asks for the OTP after password verification.
5. Test a student and admin login; incorrect codes, expired codes, reuse, and resend cooldown must all be checked before using it for a real exam.

### SMS option
This release implements email OTP. Phone OTP needs a phone-number field and an SMS gateway/provider such as Twilio or another provider, plus spend/rate limits and phone ownership verification. SMS delivery may incur charges. Do not claim SMS 2FA is enabled until that flow is implemented and tested.
