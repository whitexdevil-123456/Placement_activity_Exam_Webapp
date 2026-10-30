# Deployment and acceptance checklist

## Secrets and database
- [ ] Rotate any Supabase key previously exposed in screenshots/chat and regenerate the admin password hash.
- [ ] Set the Supabase URL and server-side secret only in the backend project's environment.
- [ ] Run `schema.sql` in the intended Supabase project and confirm all SQL functions exist.
- [ ] Set a random `JWT_SECRET` of at least 32 characters.
- [ ] Set `FRONTEND_ORIGIN` to the production frontend URL.
- [ ] For student password recovery, set `FRONTEND_BASE_URL`, `RESEND_API_KEY`, and `PASSWORD_RESET_FROM` in backend Vercel settings.
- [ ] For AI grading only, configure `OPENAI_API_KEY` on the backend and check API billing/limits.

## Deploy
- [ ] Deploy backend Vercel project with root directory `backend`.
- [ ] Test `/health` and `/docs` on the backend URL.
- [ ] Deploy frontend Vercel project with root directory `frontend`.
- [ ] Set `NEXT_PUBLIC_API_BASE_URL` and redeploy frontend.
- [ ] Update backend `FRONTEND_ORIGIN` and redeploy backend.

## Student/admin acceptance tests
- [ ] Student can register with roll number, email and password.
- [ ] Pending student cannot sign in before admin approval.
- [ ] Forgot password email is sent and one-time, expiring link updates the password.
- [ ] Admin can approve/disable accounts.
- [ ] Admin can add a single MCQ, short answer, and programming question.
- [ ] Admin can import the supplied CSV/XLSX/DOCX question templates.
- [ ] Admin can configure question count/duration and open a manual test.
- [ ] A student sees a waiting message/countdown before a scheduled test starts.
- [ ] Database prevents starting before the scheduled window or after its end.
- [ ] Student receives a randomized subset rather than the whole question bank.
- [ ] Answers autosave and final submission saves the last client answer snapshot.
- [ ] Attempt status and timestamp are updated by the DB transaction.
- [ ] Repeated submit call does not overwrite a final attempt unexpectedly.
- [ ] Student sees previous score; admin sees submitted answers and grades.
- [ ] AI grading sends only needed assessment content, saves suggestion, and requires human review.

## Load test
- [ ] Test 60 concurrent simulated students logging in and loading dashboard/questions.
- [ ] Simulate overlapping autosaves and 60 final submissions.
- [ ] Check Vercel function logs and Supabase logs for timeouts/rate limits.
- [ ] Verify every attempt is finalized correctly and has `submitted_at`.
- [ ] Export/back up results and document a recovery procedure before a real examination.


## Random question-set behavior

- [ ] Run `sql/randomized_distinct_question_sets.sql` in Supabase SQL Editor if upgrading an existing deployment.
- [ ] Set the exam question count to no more than the active question count.
- [ ] Ensure the question bank is large enough to create a different combination for every student; overlap between question sets is allowed.
- [ ] Start two demo-student attempts and verify the question IDs overlap partially but the sorted ID sets are not identical.
- [ ] Try more simultaneous starts than one student to confirm transaction locking prevents duplicate combinations.


## Student password recovery

- [ ] Run `sql/password_auth_migration.sql` on an existing PIN-based Supabase database before deploying the updated code (the updated `schema.sql` supports new installations).
- [ ] Confirm student accounts have a unique, correct email address. Add addresses for existing students in Admin → Students → Recovery email → Save.
- [ ] Configure backend Vercel environment variables `RESEND_API_KEY`, `PASSWORD_RESET_FROM` (verified sender), and `FRONTEND_BASE_URL` (frontend production URL).
- [ ] Redeploy backend; test Forgot password, email delivery, token expiry and one-time use.
- [ ] Keep the Resend API key and Supabase secret server-side only.


## Email 2FA acceptance tests
- [ ] Configure `RESEND_API_KEY`, `TWO_FACTOR_FROM` (or verified `PASSWORD_RESET_FROM`), and `ADMIN_MFA_EMAIL` on the backend deployment.
- [ ] Student accounts have correct registered email addresses.
- [ ] Run `sql/email_two_factor_migration.sql` on existing databases, or the latest root schema on a new database.
- [ ] Student and admin password login sends a six-digit OTP and does not return a session token yet.
- [ ] Valid OTP creates a session; invalid OTP does not.
- [ ] OTP expires after five minutes, allows at most five tries, and cannot be reused.
- [ ] Resend is rate-limited and invalidates previous codes.
- [ ] Existing sessions without `mfa=email_otp` are rejected and users sign in again.
- [ ] Review Resend delivery logs and Vercel backend logs before the real exam.
