"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";

type ResetResponse = { message: string };

export default function ResetPasswordPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [tokenLoaded, setTokenLoaded] = useState(false);
  const [studentPassword, setStudentPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get("token") || "");
    setTokenLoaded(true);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice("");
    if (studentPassword !== confirmPassword) { setError("Passwords do not match."); return; }
    if (studentPassword.length < 8) { setError("Your new password must contain at least 8 characters."); return; }
    if (!token) { setError("This reset link is missing its token. Request a new reset email."); return; }
    setBusy(true);
    try {
      const result = await api<ResetResponse>("/api/auth/student/reset-password", {
        method: "POST", body: JSON.stringify({ token, new_password: studentPassword }),
      });
      setNotice(result.message || "Your password has been reset.");
      setCompleted(true); setStudentPassword(""); setConfirmPassword("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : "Could not reset your password. Request a new link."));
    } finally { setBusy(false); }
  }

  return <main className="auth-shell">
    <section className="auth-aside">
      <div className="brand-mark">CT</div>
      <p className="eyebrow light">ACCOUNT RECOVERY</p>
      <h1>Back to<br/><span>your work.</span></h1>
      <p className="aside-copy">Reset your student password using the secure one-time link sent to your registered email address.</p>
      <p className="aside-foot">Never share reset links or passwords with anyone.</p>
    </section>
    <section className="auth-main">
      <div className="auth-card">
        <p className="eyebrow">SECURE RESET</p>
        <h2>Choose a new password</h2>
        <p className="subtext">Reset links expire after 30 minutes and can only be used once.</p>
        {!tokenLoaded ? <div className="loading-page"><span className="spinner"/> Checking reset link…</div> : completed ? <>
          <div className="alert success" role="status">{notice}</div>
          <button type="button" className="button primary full" onClick={() => router.replace("/")}>Return to sign in →</button>
        </> : !token ? <>
          <div className="alert error" role="alert">This reset link is missing its token. Please request a new one from the sign-in page.</div>
          <button type="button" className="button primary full" onClick={() => router.replace("/")}>Back to sign in →</button>
        </> : <form onSubmit={submit} className="form-stack">
          <label>New student password<input type="password" autoComplete="new-password" minLength={8} maxLength={128} value={studentPassword} onChange={e => setStudentPassword(e.target.value)} required/></label>
          <label>Confirm new password<input type="password" autoComplete="new-password" minLength={8} maxLength={128} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required/></label>
          {error && <div className="alert error" role="alert">{error}</div>}
          <button type="submit" className="button primary full" disabled={busy}>{busy ? <><span className="spinner"/> Resetting…</> : "Reset password"} <span aria-hidden>→</span></button>
        </form>}
        <button type="button" className="text-link" onClick={() => router.replace("/")}>← Back to sign in</button>
        <div className="secure-note"><span className="secure-dot"/> Reset tokens are one-time and expire automatically.</div>
      </div>
      <footer className="auth-footer">CLASS TEST PORTAL <span>•</span> ACADEMIC ASSESSMENTS</footer>
    </section>
  </main>;
}
