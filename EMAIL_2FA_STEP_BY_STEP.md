# Step-by-step: Deploy password login, forgot password, and email OTP 2FA

This is the consolidated deployment guide for the current project. It includes the password-based student login, forgot-password links, email OTP for both student and admin sign-in, randomized aptitude sets, scheduled tests, question imports, AI-assisted grading, and transactional submission.

## What this 2FA release does

- Student enters roll number + password, then a six-digit code is sent to the student's registered email.
- Admin enters username + password, then a six-digit code is sent to `ADMIN_MFA_EMAIL`.
- The API issues a session token only after OTP verification.
- OTP expires after five minutes, is single-use, is limited to five wrong attempts, and can be resent no more often than once per account per 60 seconds.
- Forgot-password remains a separate email link flow with a 30-minute one-time token.
- This release implements email OTP only. SMS OTP is not configured; adding it requires phone fields, phone verification, an SMS provider, rate limits, and likely messaging cost.

## 0. Protect credentials first

An older screenshot exposed a Supabase secret and an admin password hash. Before deployment:

1. Rotate the Supabase secret key and use the replacement only on the backend.
2. Generate a fresh `JWT_SECRET` with at least 32 random characters.
3. Generate a fresh admin password hash and use it in the backend environment.
4. Never commit `.env`, actual `.streamlit/secrets.toml`, Resend keys, Supabase secret keys, or generated production credentials to GitHub.

## 1. Extract and update GitHub

1. Download the complete ZIP and extract it.
2. Open the extracted folder and confirm it has `backend/`, `frontend/`, `schema.sql`, `sql/`, and `README.md` in the root.
3. Open the GitHub repository connected to your Vercel backend.
4. Replace the repository contents with the current extracted project contents. Preserve the `backend` and `frontend` directories at the repository root.
5. Check that there is no real `.env` file or secret configuration in the repository. `.env.example` files are templates only.
6. Commit and push the updated code to the branch configured as the production branch in Vercel.

## 2. Prepare the Supabase database

First identify whether your Supabase project is empty or already contains students/questions/attempts. Take a backup if any data must be preserved.

### A. New, empty database

1. Open Supabase Dashboard → SQL Editor.
2. Open the project's root `schema.sql` and paste the entire file.
3. Run it once and ensure there are no SQL errors.

### B. Existing database from an older PIN/portal release

Do not blindly run the full root schema against an existing, populated database. Back up first, then run the required migrations:

1. `sql/password_auth_migration.sql` — preserves existing credential hashes while renaming `pin_hash` to `password_hash`; it also creates the password-reset token table/functions.
2. `sql/randomized_distinct_question_sets.sql` — run only if the database does not yet have the current randomized-question-set function.
3. `sql/email_two_factor_migration.sql` — creates the private login OTP challenge table and the create/verify OTP database functions.

`sql/password_reset_migration.sql` duplicates the reset table/functions and normally is not needed if `password_auth_migration.sql` already succeeded. Compare the existing schema first; do not run redundant migrations just because files exist.

## 3. Configure the email provider

The project uses Resend over HTTPS for password-reset emails and login OTPs.

1. Create a Resend account at https://resend.com/.
2. Add and verify a sender domain/address in Resend.
3. Create a Resend API key.
4. Keep the key private. Do not put it in a `NEXT_PUBLIC_*` variable or GitHub.

## 4. Deploy the backend on Vercel

1. Open Vercel → Add New → Project and import the GitHub repository (or open the existing backend project).
2. In Project Settings, set **Root Directory** to `backend`.
3. Under **Settings → Environment Variables**, set at least these values in Production:

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | Root project URL like `https://YOUR-PROJECT-REF.supabase.co`; no `/rest/v1` suffix |
| `SUPABASE_SERVICE_ROLE_KEY` | New `sb_secret_...` key from that exact Supabase project |
| `JWT_SECRET` | A newly generated random string, at least 32 characters |
| `ADMIN_USERNAME` | Admin login name, e.g. `teacher` |
| `ADMIN_PASSWORD_HASH` | Fresh Werkzeug hash of the admin password |
| `ADMIN_MFA_EMAIL` | Mailbox where admin login OTPs should be received |
| `RESEND_API_KEY` | Resend API key |
| `TWO_FACTOR_FROM` | Verified sender, e.g. `Class Test Portal <no-reply@yourdomain.com>` |
| `PASSWORD_RESET_FROM` | Verified sender for reset emails; can match `TWO_FACTOR_FROM` |
| `FRONTEND_BASE_URL` | Exact frontend production origin; no trailing slash |
| `FRONTEND_ORIGIN` | Exact frontend production origin; no trailing slash |
| `OPENAI_API_KEY` | Optional; only if AI-assisted programming assessment is required |
| `OPENAI_MODEL` | Optional; defaults to `gpt-4.1-mini` |

4. Deploy/redeploy the backend.
5. Open `https://YOUR-BACKEND.vercel.app/health` and ensure the `email_otp_configured` property is `true`. This indicates configuration values are present; it does not guarantee that email can reach an inbox.
6. Open `/docs` to see the FastAPI endpoint list.

## 5. Deploy the frontend on Vercel

The repository is deployed twice: once for the backend and once for the frontend.

1. In Vercel, click **Add New → Project** and import the same GitHub repository again.
2. Set **Root Directory** to `frontend`.
3. Add `NEXT_PUBLIC_API_BASE_URL` with the backend origin, e.g. `https://your-backend.vercel.app` (no path and no trailing slash).
4. Deploy and copy the exact frontend production URL, e.g. `https://your-portal.vercel.app`.

Then go back to the backend project's settings:

1. Set `FRONTEND_ORIGIN` to the exact frontend URL.
2. Set `FRONTEND_BASE_URL` to the same exact frontend URL.
3. Save and redeploy the backend; Vercel environment-variable changes apply only to new deployments.

## 6. Ensure every account has an email

- New student registrations require roll number, name, email, and password. Registration remains pending until an admin approves it.
- Existing active student accounts must have a correct email address; add missing emails through Admin → Students.
- Admin login OTP always goes to `ADMIN_MFA_EMAIL` from backend environment variables.
- If email OTP is not configured, sign-in is blocked intentionally; there is no password-only bypass in this release.

## 7. Test authentication and recovery

Perform these tests before real students use the app:

1. Student enters roll number/password and sees a masked email address in the OTP step.
2. Correct code completes login; incorrect code is rejected and does not create a session.
3. A code expires in five minutes, can be used only once, and locks after five incorrect tries.
4. Resend waits 60 seconds and invalidates the previous code.
5. Admin login also requires email OTP sent to `ADMIN_MFA_EMAIL`.
6. Forgot password sends a one-time reset link; the link expires after 30 minutes, can be consumed once, and the new password works.
7. An existing token issued before 2FA is rejected; sign in again after deployment.
8. Check Vercel backend logs and Resend email logs if no OTP arrives.

## 8. Test assessment workflows

1. Confirm admin can import questions from the included CSV/XLSX/DOCX templates.
2. Configure exam title, duration, question count, and manual/scheduled release.
3. Start two demo-student attempts and verify they receive distinct full sets while some individual questions may overlap.
4. Save answers, submit, and check the `attempts` table: completed attempts should have `status = 'submitted'` and non-null `submitted_at`.
5. Test the programming AI suggestion, then verify teacher confirmation is required before saving the official mark.
6. Load-test at least 50–60 simulated students (login, dashboard, question retrieval, autosaves, submit) before running a real timed examination.

## Troubleshooting

- **No OTP email**: check `RESEND_API_KEY`, sender verification, `TWO_FACTOR_FROM`, Resend logs and backend Vercel logs.
- **Student blocked before OTP**: check that account is approved/active and has an email.
- **Admin can't sign in**: check `ADMIN_MFA_EMAIL`, `ADMIN_PASSWORD_HASH`, and Resend configuration.
- **`two-step verification database migration is missing`**: run `sql/email_two_factor_migration.sql` against the correct Supabase project, then retry.
- **CORS error**: verify `FRONTEND_ORIGIN` exactly matches the actual frontend domain and redeploy the backend.
- **Old session suddenly rejected**: this is expected; log in again so that the new session includes the 2FA claim.
- **OTP code doesn't work after rotating `JWT_SECRET`**: request a fresh code; codes issued before rotation are invalid.
