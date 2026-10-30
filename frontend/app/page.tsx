"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, clearSession, getRole, getToken, setSession } from "@/lib/api";

type LoginResponse = { token: string; role: "student" | "admin"; user: { full_name?: string; roll_number?: string; username?: string }; mfa?: "email_otp" };
type LoginStartResponse = { requires_otp: true; challenge_id: string; role: "student" | "admin"; delivery_hint: string; expires_in_seconds: number; resend_after_seconds: number; message: string };
type RegistrationResponse = { status: string; message: string };
type MessageResponse = { message: string };

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"student" | "admin">("student");
  const [studentFlow, setStudentFlow] = useState<"signin" | "signup" | "forgot">("signin");
  const [roll, setRoll] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [studentPassword, setStudentPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [username, setUsername] = useState("teacher");
  const [password, setPassword] = useState("");
  const [otpChallenge, setOtpChallenge] = useState<LoginStartResponse | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [resendSeconds, setResendSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!getToken()) return;
    const role = getRole();
    // Validate stored session before redirecting; legacy sessions without 2FA are rejected.
    api<{ role: string }>("/api/me").then(() => {
      if (!cancelled) router.replace(role === "admin" ? "/admin" : "/dashboard");
    }).catch(() => clearSession());
    return () => { cancelled = true; };
  }, [router]);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setTimeout(() => setResendSeconds(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendSeconds]);

  function resetOtpFlow() {
    setOtpChallenge(null);
    setOtpCode("");
    setResendSeconds(0);
    setError("");
    setNotice("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      if (otpChallenge) {
        const result = await api<LoginResponse>("/api/auth/otp/verify", {
          method: "POST", body: JSON.stringify({ challenge_id: otpChallenge.challenge_id, code: otpCode.trim() }),
        });
        setSession(result.token, result.role);
        router.replace(result.role === "admin" ? "/admin" : "/dashboard");
        return;
      }
      if (mode === "student" && studentFlow === "forgot") {
        const result = await api<MessageResponse>("/api/auth/student/forgot-password", {
          method: "POST", body: JSON.stringify({ email: email.trim() }),
        });
        setNotice(result.message || "If an approved student account uses that email, reset instructions will be sent shortly.");
        return;
      }
      if (mode === "student" && studentFlow === "signup") {
        if (studentPassword !== confirmPassword) throw new Error("Passwords do not match.");
        const result = await api<RegistrationResponse>("/api/auth/student/register", {
          method: "POST", body: JSON.stringify({ roll_number: roll.trim(), full_name: fullName.trim(), email: email.trim(), password: studentPassword }),
        });
        setNotice(result.message || "Registration received. Ask your teacher to approve your account.");
        setStudentFlow("signin"); setStudentPassword(""); setConfirmPassword("");
        return;
      }
      const result = mode === "student"
        ? await api<LoginStartResponse>("/api/auth/student", { method: "POST", body: JSON.stringify({ roll_number: roll.trim(), password: studentPassword }) })
        : await api<LoginStartResponse>("/api/auth/admin", { method: "POST", body: JSON.stringify({ username: username.trim(), password }) });
      if (!result.requires_otp || !result.challenge_id) throw new Error("The server did not start the second verification step. Please try again.");
      setOtpChallenge(result);
      setOtpCode("");
      setResendSeconds(result.resend_after_seconds || 60);
      setNotice(result.message || `A six-digit verification code was sent to ${result.delivery_hint}.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : "Request failed. Please try again."));
    } finally { setBusy(false); }
  }

  async function resendOtp() {
    if (!otpChallenge) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<LoginStartResponse>("/api/auth/otp/resend", {
        method: "POST", body: JSON.stringify({ challenge_id: otpChallenge.challenge_id }),
      });
      setOtpChallenge(result);
      setOtpCode("");
      setResendSeconds(result.resend_after_seconds || 60);
      setNotice(result.message || `A new code was sent to ${result.delivery_hint}. The previous code is no longer valid.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : "Could not resend the verification code."));
    } finally { setBusy(false); }
  }

  const verifying = Boolean(otpChallenge);
  const signup = !verifying && mode === "student" && studentFlow === "signup";
  const forgot = !verifying && mode === "student" && studentFlow === "forgot";

  return <main className="auth-shell">
    <section className="auth-aside">
      <div className="brand-mark">CT</div>
      <p className="eyebrow light">ASSESSMENT PORTAL</p>
      <h1>Make every test<br/><span>count.</span></h1>
      <p className="aside-copy">A focused space for aptitude assessments, programming tests and clear progress tracking.</p>
      <div className="aside-points"><div><span>01</span> Timed assessments</div><div><span>02</span> Saved answers</div><div><span>03</span> Results history</div></div>
      <p className="aside-foot">For students and authorized staff.</p>
    </section>
    <section className="auth-main">
      <div className="auth-card">
        <p className="eyebrow">{verifying ? "TWO-STEP VERIFICATION" : forgot ? "ACCOUNT RECOVERY" : signup ? "NEW STUDENT ACCOUNT" : "WELCOME BACK"}</p>
        <h2>{verifying ? "Check your email" : forgot ? "Reset your student password" : signup ? "Create your student account" : "Sign in to continue"}</h2>
        <p className="subtext">{verifying
          ? `Enter the six-digit code sent to ${otpChallenge?.delivery_hint}. It expires in five minutes and can be used once.`
          : forgot
            ? "Enter the email address linked to your student account. We'll send a one-time reset link if the account is eligible."
            : signup
              ? "Register with your roll number and email. Your teacher must approve the account before you can sign in."
              : "Choose your account type. After your password is verified, we will ask for a code sent to your registered email."}</p>
        {!verifying && <>
          <div className="segmented" role="tablist" aria-label="Account type">
            <button type="button" className={mode === "student" ? "selected" : ""} onClick={() => { setMode("student"); setStudentFlow("signin"); setError(""); setNotice(""); }}>Student</button>
            <button type="button" className={mode === "admin" ? "selected" : ""} onClick={() => { setMode("admin"); setStudentFlow("signin"); setError(""); setNotice(""); }}>Admin / Teacher</button>
          </div>
          {mode === "student" && !forgot && <div className="mode-switch" style={{display:"flex",gap:8,margin:"12px 0 18px"}}>
            <button type="button" className={`button ${studentFlow === "signin" ? "primary" : "secondary"} small`} onClick={() => { setStudentFlow("signin"); setError(""); setNotice(""); }}>Student sign in</button>
            <button type="button" className={`button ${studentFlow === "signup" ? "primary" : "secondary"} small`} onClick={() => { setStudentFlow("signup"); setError(""); setNotice(""); }}>Create account</button>
          </div>}
        </>}
        <form onSubmit={submit} className="form-stack">
          {verifying ? <label>Six-digit email code<input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" type="text" value={otpCode} onChange={e => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456" minLength={6} maxLength={6} required/></label>
            : mode === "student" ? forgot ? <label>Account email<input autoComplete="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" maxLength={254} required/></label> : <>
              {signup && <label>Full name<input autoComplete="name" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Your name as registered in class" minLength={2} maxLength={200} required/></label>}
              {signup && <label>Email address<input autoComplete="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" maxLength={254} required/></label>}
              <label>Roll number<input autoComplete="username" value={roll} onChange={e => setRoll(e.target.value)} placeholder="e.g. DS001" required/></label>
              <label>Student password<input autoComplete={signup ? "new-password" : "current-password"} type="password" value={studentPassword} onChange={e => setStudentPassword(e.target.value)} placeholder={signup ? "Create a password (at least 8 characters)" : "Enter your password"} minLength={signup ? 8 : 1} maxLength={128} required/></label>
              {signup && <label>Confirm password<input autoComplete="new-password" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} minLength={8} maxLength={128} required/></label>}
            </> : <>
              <label>Admin username<input autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required/></label>
              <label>Password<input autoComplete="current-password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter admin password" required/></label>
            </>}
          {error && <div className="alert error" role="alert">{error}</div>}
          {notice && <div className="alert success" role="status">{notice}</div>}
          <button className="button primary full" type="submit" disabled={busy}>{busy ? <><span className="spinner"/> Please wait…</> : verifying ? "Verify code and sign in" : forgot ? "Send reset link" : signup ? "Submit registration" : `Continue as ${mode === "student" ? "student" : "admin"}`} <span aria-hidden>→</span></button>
        </form>
        {verifying && <div style={{display:"flex",gap:12,justifyContent:"space-between",alignItems:"center",marginTop:14,flexWrap:"wrap"}}>
          <button type="button" className="text-link" disabled={busy || resendSeconds > 0} onClick={resendOtp}>{resendSeconds > 0 ? `Resend code in ${resendSeconds}s` : "Resend code"}</button>
          <button type="button" className="text-link" disabled={busy} onClick={resetOtpFlow}>Use another account</button>
        </div>}
        {!verifying && mode === "student" && !signup && !forgot && <button type="button" className="text-link" onClick={() => { setStudentFlow("forgot"); setError(""); setNotice(""); setEmail(""); }}>Forgot password?</button>}
        {!verifying && forgot && <button type="button" className="text-link" onClick={() => { setStudentFlow("signin"); setError(""); setNotice(""); }}>← Back to student sign in</button>}
        {!verifying && mode === "admin" && <p className="small-note" style={{marginTop:15}}>Admin two-step codes are sent to the administrator email configured on the backend.</p>}
        <div className="secure-note"><span className="secure-dot"/> Passwords are verified by the portal API. Session access is granted only after email OTP verification. Student registrations require teacher approval.</div>
      </div>
      <footer className="auth-footer">CLASS TEST PORTAL <span>•</span> ACADEMIC ASSESSMENTS</footer>
    </section>
  </main>;
}
