# Student PIN-to-password migration

The app now labels and accepts student **passwords**. Passwords are stored as Werkzeug password hashes in `students.password_hash`, never as plaintext.

## Existing deployment
1. Back up Supabase.
2. Run `sql/password_auth_migration.sql` in the Supabase SQL Editor. This renames `pin_hash` to `password_hash` without losing existing hashes, adds password reset tokens/functions, and preserves students, questions, attempts, answers and scores.
3. Deploy the updated backend and frontend.
4. Existing accounts can use their former PIN as their initial password; recommend that they use Forgot password to set an 8+ character password.
5. Students newly created or imported by admin must have a password at least 8 characters long. The CSV header is `roll_number,full_name,email,password`. Legacy `pin` CSV headers are still accepted by the admin importer, but values will become the student's initial password.

## New deployment
Run the updated root `schema.sql` in a new Supabase project.

## Security
Avoid shared or easily guessed passwords. Use unique temporary passwords for roster imports, have students change them, and delete the original CSV after import. Never include production student passwords in GitHub.
