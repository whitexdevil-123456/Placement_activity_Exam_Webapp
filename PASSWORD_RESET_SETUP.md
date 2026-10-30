# Student password setup and recovery

Student accounts use a roll number plus a password. Passwords are hashed by the Python backend before they are stored in Supabase. New student passwords must be at least 8 characters. The admin account continues to use `ADMIN_USERNAME` and `ADMIN_PASSWORD_HASH` from the backend environment.

## Existing deployment: migrate PINs to passwords

1. Back up important Supabase data.
2. Open Supabase Dashboard → SQL Editor.
3. Run the complete `sql/password_auth_migration.sql` file from this project.
4. The migration renames `students.pin_hash` to `students.password_hash`, preserving existing hashes, and creates the password-reset token table/functions. It does not delete students, questions, attempts, answers or results.
5. Deploy the updated backend and frontend from GitHub.
6. Existing students can use their previous PIN as their initial password because its stored hash is preserved. Ask them to use **Forgot password?** to set a unique password of at least 8 characters.

For a new Supabase project, run the updated root `schema.sql` instead of the migration. Do not run the full schema against live data without making a backup and checking the changes first.

## Add recovery email addresses

- New self-registration asks for full name, roll number, email and password. Student accounts remain pending until an admin approves them.
- In Admin → Students, add or update a recovery email for existing accounts.
- The roster CSV header is `roll_number,full_name,email,password`. A legacy `pin` CSV column name is also recognized by the UI, but imported values still need to meet the new 8-character minimum. Use unique temporary passwords and delete local roster files after import.

## Configure password-reset email

The backend sends reset links using Resend.

1. Create a Resend API key and verify a sender domain/address in Resend.
2. In Vercel → backend project → Settings → Environment Variables, set:
   - `RESEND_API_KEY`: the Resend API key.
   - `PASSWORD_RESET_FROM`: the verified sender, e.g. `Class Test Portal <no-reply@your-domain.example>`.
   - `FRONTEND_BASE_URL`: the exact frontend origin, e.g. `https://your-frontend.vercel.app`, with no trailing slash.
3. Redeploy the backend after saving environment variables.
4. Test **Forgot password?** using an approved student with access to the recovery mailbox.

Reset tokens are stored hashed, expire after 30 minutes, and are single-use. The response does not disclose whether an email belongs to an account. If no email arrives, check the Resend logs, sender verification and Vercel backend logs.

Keep `RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `JWT_SECRET` exclusively in backend environment variables. Never commit them to GitHub or expose them to the browser.


## Relationship with two-step login
After a successful password reset, the next sign-in still requires email OTP. The password-reset link is not a login session and does not bypass the second factor. Configure `RESEND_API_KEY`, `TWO_FACTOR_FROM`, and `ADMIN_MFA_EMAIL` in the backend Vercel project to enable login OTP. See `EMAIL_2FA_STEP_BY_STEP.md` for the complete deployment process.
