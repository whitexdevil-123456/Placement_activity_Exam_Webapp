# Complete Deployment Guide — Password Login, Forgot Password, and Email 2FA

This guide applies the password-based login, forgot-password flow, email OTP two-step verification, randomized question sets, bulk question import, exam scheduling, and transactional submission features in one release.

## Recommended deployment shape

- GitHub repository contains the entire project folder contents, including `backend/` and `frontend/`.
- Vercel backend project Root Directory: `backend`.
- Vercel frontend project Root Directory: `frontend`.
- Supabase stores students, questions, exam settings, attempts, answers, reset tokens, and login OTP challenges.
- Resend sends password-reset links and login OTP emails.

## Part A — Before deployment

1. Download and extract the full project ZIP.
2. Back up any important existing Supabase data.
3. Rotate any Supabase secret exposed in a screenshot or repository. Generate a new random `JWT_SECRET` of at least 32 characters and a new admin password hash.
4. Make sure every active student has a correct email address and configure one email for admin OTP.

## Part B — Update GitHub

1. Open the repository used by your Vercel deployment.
2. Replace the repository files with all files in this project; preserve the folder structure.
3. Do not upload local `.env` files, `.streamlit/secrets.toml`, API keys, or other secrets.
4. Commit the changes to the branch configured in Vercel (usually `main`).

## Part C — Migrate Supabase

### If this is a new, empty database

1. Open Supabase Dashboard → SQL Editor.
2. Run the entire root `schema.sql` once.
3. Confirm no SQL error appears.

### If this is an existing database and you have not applied previous project migrations

1. Back up the database first.
2. Run `sql/password_auth_migration.sql` to preserve existing PIN hashes and rename `pin_hash` to `password_hash`. The previous PIN remains the initial password hash; students should change it after deployment.
3. If the question-set uniqueness function has not been installed, run `sql/randomized_distinct_question_sets.sql`.
4. Run `sql/email_two_factor_migration.sql` to create the OTP table/functions.
5. Do not run the full schema against a live populated database without comparing schema differences. Do not run the duplicated `sql/password_reset_migration.sql` if `password_auth_migration.sql` already created the reset tables/functions.

## Part D — Configure Resend

1. Create a Resend account at https://resend.com/.
2. Add and verify a sender domain/address in Resend.
3. Create an API key. Keep it secret.
4. Verify email delivery by sending a test message before using login OTP in production.

## Part E — Deploy the backend project on Vercel

1. In Vercel, create/import a project from the GitHub repository.
2. Set Root Directory to `backend`.
3. Add these environment variables under backend Project Settings → Environment Variables:
   - `SUPABASE_URL`: project root URL, with no `/rest/v1` suffix.
   - `SUPABASE_SERVICE_ROLE_KEY`: new server-side `sb_secret_...` key from that same Supabase project.
   - `JWT_SECRET`: random secret at least 32 characters long.
   - `ADMIN_USERNAME`: preferred admin username (e.g. `teacher`).
   - `ADMIN_PASSWORD_HASH`: Werkzeug-generated hash of the admin password.
   - `ADMIN_MFA_EMAIL`: the admin mailbox where the second factor should be sent.
   - `RESEND_API_KEY`: Resend API key.
   - `TWO_FACTOR_FROM`: verified sender, such as `Class Test Portal <no-reply@your-domain.com>`; may be omitted if `PASSWORD_RESET_FROM` is already set to the same verified sender.
   - `PASSWORD_RESET_FROM`: verified sender for password-reset messages.
   - `FRONTEND_BASE_URL`: exact production frontend URL, no trailing slash, for password reset links.
   - `FRONTEND_ORIGIN`: exact frontend origin, no trailing slash.
   - `OPENAI_API_KEY`: optional, only if AI programming grading is enabled.
4. Deploy.
5. Test `https://YOUR-BACKEND.vercel.app/health` and `/docs`.
6. In health JSON, verify `email_otp_configured` is true. It checks that Resend key, sender and admin MFA email are configured; it does not guarantee inbox delivery.

## Part F — Deploy the frontend project on Vercel

1. Import the same GitHub repository as a second Vercel project.
2. Set Root Directory to `frontend`.
3. Add `NEXT_PUBLIC_API_BASE_URL` with your backend base URL, e.g. `https://your-backend.vercel.app`, without a path or trailing slash.
4. Deploy.
5. Copy the production frontend URL, e.g. `https://your-portal.vercel.app`.
6. Return to the backend project's environment variables and set `FRONTEND_ORIGIN` and `FRONTEND_BASE_URL` to the exact frontend URL. Redeploy the backend.
7. If the frontend's API URL changes, update `NEXT_PUBLIC_API_BASE_URL` and redeploy the frontend.

## Part G — Verify passwords and 2FA

1. Open the frontend deployment.
2. Student login: enter roll number and password; the backend sends a six-digit email code and does not issue a session token until the code is verified.
3. Verify that a correct code signs in; incorrect codes are rejected; codes expire after five minutes; codes are single-use; a challenge allows at most five incorrect attempts; resend is limited to one code per account per 60 seconds.
4. Admin login: enter admin username/password; the code must arrive at `ADMIN_MFA_EMAIL`.
5. Register a student and approve it from Admin. Ensure the student's email is correct.
6. For existing students, use Admin → Students to add missing email addresses before enabling required 2FA logins.
7. Test **Forgot password?** separately: reset email, link expiration, single use, and new password login.
8. Existing browser sessions issued before 2FA are no longer accepted; users must log in again.

## Part H — Before an actual exam

- Test login, question allocation, autosave and atomic submission with several accounts.
- Verify submitted attempts have `status = 'submitted'` and `submitted_at` in Supabase.
- Simulate 50–60 concurrent students before scheduling an actual assessment.
- Keep a result export/backup procedure and review Vercel, Supabase, and Resend logs after tests.

## Email vs SMS OTP

This release implements email OTP for both students and admin. SMS OTP is not implemented in this version. To add mobile OTP, the app needs phone-number fields, phone ownership verification, an SMS provider such as Twilio, abuse/rate limits and a plan for SMS costs.
