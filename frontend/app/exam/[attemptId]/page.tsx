"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, ApiError, clearSession, getToken } from "@/lib/api";

type Answer = { question_id: number; answer_text: string; code_answer: string; output_answer: string };
type Question = { id: number; category: string; question_type: "mcq" | "short" | "coding"; prompt: string; options: string[]; topic?: string; difficulty?: string; marks: number; display_order: number; answer: Partial<Answer> };
type Detail = { attempt: { id: string; category: string; status: string; deadline_at: string; started_at: string; submitted_at?: string; score: number; max_score: number }; questions: Question[] };
type SubmitResult = { id: string; status: "submitted" | "expired"; score: number; max_score: number; submitted_at?: string };
const emptyAnswer = (id: number): Answer => ({ question_id: id, answer_text: "", code_answer: "", output_answer: "" });
const formatTime = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60).toString().padStart(2, "0")}:${(Math.max(0, seconds) % 60).toString().padStart(2, "0")}`;

export default function ExamPage() {
  const params = useParams<{ attemptId: string }>();
  const attemptId = params.attemptId;
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const latestAnswers = useRef<Record<number, Answer>>({});
  const saveTimers = useRef<Map<number, number>>(new Map());
  const pendingSaves = useRef(0);
  const submittedOnce = useRef(false);
  const [loadError, setLoadError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [saveLabel, setSaveLabel] = useState("All answers saved");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitted, setSubmitted] = useState<SubmitResult | null>(null);

  useEffect(() => {
    if (!getToken()) { router.replace("/"); return; }
    let cancelled = false;
    api<Detail>(`/api/attempts/${attemptId}`).then(data => {
      if (cancelled) return;
      setDetail(data);
      const initial: Record<number, Answer> = {};
      for (const q of data.questions) {
        initial[q.id] = {
          question_id: q.id,
          answer_text: String(q.answer?.answer_text ?? ""),
          code_answer: String(q.answer?.code_answer ?? ""),
          output_answer: String(q.answer?.output_answer ?? ""),
        };
      }
      latestAnswers.current = initial;
      setAnswers(initial);
      if (data.attempt.status !== "in_progress") {
        setSubmitted({ id: data.attempt.id, status: data.attempt.status as "submitted" | "expired", score: Number(data.attempt.score || 0), max_score: Number(data.attempt.max_score || 0), submitted_at: data.attempt.submitted_at });
      }
    }).catch(e => {
      setLoadError(e instanceof ApiError ? e.message : "Could not load this exam.");
      if (e instanceof ApiError && e.status === 401) router.replace("/");
    }).finally(() => setLoading(false));
    return () => { cancelled = true; };
  }, [attemptId, router]);

  const persistAnswer = useCallback(async (questionId: number, answer: Answer) => {
    if (submitting || submittedOnce.current) return;
    pendingSaves.current += 1;
    setSaveLabel("Saving answers…");
    try {
      await api(`/api/attempts/${attemptId}/answers/${questionId}`, {
        method: "PUT",
        body: JSON.stringify({ answer_text: answer.answer_text || null, code_answer: answer.code_answer || null, output_answer: answer.output_answer || null }),
      });
      pendingSaves.current -= 1;
      if (pendingSaves.current <= 0) setSaveLabel("All answers saved");
    } catch (e) {
      pendingSaves.current = Math.max(0, pendingSaves.current - 1);
      if (e instanceof ApiError && (e.status === 401 || e.status === 409)) {
        setSaveLabel(e.status === 401 ? "Session expired — sign in again" : "Deadline reached — submit your exam");
      } else {
        setSaveLabel("Connection issue — final submission will retry saving all answers");
      }
    }
  }, [attemptId, submitting]);

  const setAnswer = useCallback((questionId: number, patch: Partial<Answer>) => {
    const next = { ...latestAnswers.current, [questionId]: { ...(latestAnswers.current[questionId] || emptyAnswer(questionId)), ...patch, question_id: questionId } };
    latestAnswers.current = next;
    setAnswers(next);
    const oldTimer = saveTimers.current.get(questionId);
    if (oldTimer) window.clearTimeout(oldTimer);
    setSaveLabel("Unsaved changes");
    const timer = window.setTimeout(() => {
      saveTimers.current.delete(questionId);
      void persistAnswer(questionId, next[questionId]);
    }, 850);
    saveTimers.current.set(questionId, timer);
  }, [persistAnswer]);

  const submitExam = useCallback(async (automatic = false) => {
    if (!detail || submittedOnce.current || submitting || detail.attempt.status !== "in_progress") return;
    submittedOnce.current = true;
    setSubmitting(true); setSubmitError(""); setConfirmOpen(false);
    for (const timer of saveTimers.current.values()) window.clearTimeout(timer);
    saveTimers.current.clear();
    try {
      // The server uses a single PostgreSQL transaction to persist this complete answer snapshot,
      // grade objective answers, and set status/submitted_at. Autosave is not the source of truth.
      const finalAnswers = detail.questions.map(q => latestAnswers.current[q.id] || emptyAnswer(q.id));
      const result = await api<SubmitResult>(`/api/attempts/${attemptId}/submit`, {
        method: "POST", body: JSON.stringify({ answers: finalAnswers }),
      });
      if (!result || !["submitted", "expired"].includes(result.status)) throw new Error("The database did not confirm final submission.");
      setSubmitted(result); setSaveLabel("Submission saved"); setDetail(prev => prev ? { ...prev, attempt: { ...prev.attempt, status: result.status, score: result.score, max_score: result.max_score, submitted_at: result.submitted_at } } : prev);
    } catch (e) {
      submittedOnce.current = false;
      const message = e instanceof ApiError ? e.message : (e instanceof Error ? e.message : "Submission failed.");
      setSubmitError(`${automatic ? "Time is up. " : ""}${message} Your answers remain on this page. Check your connection and try submission again.`);
      setSaveLabel("Submission not confirmed");
    } finally { setSubmitting(false); }
  }, [attemptId, detail, submitting]);

  useEffect(() => () => {
    for (const timer of saveTimers.current.values()) window.clearTimeout(timer);
    saveTimers.current.clear();
  }, []);

  function logout() { clearSession(); router.replace("/"); }
  if (loading) return <div className="loading-page"><span className="spinner" style={{borderColor:"#cfdfd5",borderTopColor:"#176b53"}}/> Loading assessment…</div>;
  if (!detail) return <main className="app-page"><Header onLogout={logout}/><div className="container"><div className="alert error">{loadError || "Unable to load this exam."}</div><button className="button secondary" onClick={() => router.replace("/dashboard")}>Return to dashboard</button></div></main>;
  const answered = detail.questions.filter(q => {
    const a = answers[q.id];
    return q.question_type === "coding" ? Boolean(a?.code_answer.trim() || a?.output_answer.trim()) : Boolean(a?.answer_text.trim());
  }).length;
  const readOnly = detail.attempt.status !== "in_progress" || !!submitted;
  const categoryName = detail.attempt.category === "aptitude" ? "Aptitude Test" : "Programming Test";

  if (submitted) return <main className="app-page"><Header onLogout={logout}/><div className="container"><section className="success-screen"><div className="success-icon">✓</div><p className="eyebrow">ASSESSMENT COMPLETE</p><h1>{submitted.status === "expired" ? "Time expired" : "Submission confirmed"}</h1><p>Your answers have been saved by the database. You can safely return to your dashboard.</p><div className="score-box"><strong>{Number(submitted.score || 0).toFixed(2)} / {Number(submitted.max_score || 0).toFixed(2)}</strong><span>Current score · coding answers may require teacher review</span></div><div className="inline-form" style={{justifyContent:"center"}}><span className={`badge ${submitted.status === "submitted" ? "green" : "amber"}`}>Status: {submitted.status}</span><span className="small-note">Submitted: {submitted.submitted_at ? new Date(submitted.submitted_at).toLocaleString() : "Recorded"}</span></div><button className="button primary" style={{marginTop:23}} onClick={() => router.replace("/dashboard")}>Return to dashboard →</button></section></div></main>;

  return <main className="app-page">
    <Header onLogout={logout}/>
    <div className="container">
      <div className="page-heading"><div><p className="eyebrow">LIVE ASSESSMENT</p><h1>{categoryName}</h1><p>Read each prompt carefully. Your answers autosave, and submission writes the final answer set in one database transaction.</p></div><span className="badge green">{detail.questions.length} questions</span></div>
      {loadError && <div className="alert error" style={{marginBottom:16}}>{loadError}</div>}
      <div className="exam-layout">
        <section>
          {detail.questions.map((q, index) => <article className="question-card" id={`question-${q.id}`} key={q.id}>
            <div className="question-overline"><span>QUESTION {String(index + 1).padStart(2, "0")} / {String(detail.questions.length).padStart(2, "0")}</span><span>{q.topic || q.difficulty || "Assessment"} · {q.marks} mark{q.marks === 1 ? "" : "s"}</span></div>
            <h3>{q.prompt}</h3>
            {q.question_type === "mcq" ? <div className="option-list">{(q.options || []).map((option, i) => <label className="option" key={`${q.id}-${option}`}><input type="radio" name={`question-${q.id}`} value={option} disabled={readOnly} checked={(answers[q.id]?.answer_text || "") === option} onChange={() => setAnswer(q.id, { answer_text: option, code_answer: "", output_answer: "" })}/><span><strong style={{display:"inline-block",width:24,color:"#7f8c85"}}>{String.fromCharCode(65 + i)}.</strong>{option}</span></label>)}</div> : q.question_type === "short" ? <label className="field-label">Your answer<input className="control" value={answers[q.id]?.answer_text || ""} disabled={readOnly} onChange={e => setAnswer(q.id, { answer_text: e.target.value, code_answer: "", output_answer: "" })} placeholder="Type your answer"/></label> : <div className="code-inputs"><label className="field-label">Your code<textarea value={answers[q.id]?.code_answer || ""} disabled={readOnly} onChange={e => setAnswer(q.id, { code_answer: e.target.value, answer_text: "" })} placeholder="Write your solution here…" spellCheck={false}/></label><label className="field-label">Program output<textarea value={answers[q.id]?.output_answer || ""} disabled={readOnly} onChange={e => setAnswer(q.id, { output_answer: e.target.value, answer_text: "" })} placeholder="Enter the output produced by your code" spellCheck={false}/></label><p className="small-note no-margin">Code is submitted for teacher review; this portal does not execute arbitrary student code on the server.</p></div>}
          </article>)}
          <div className="submit-bar"><div><strong style={{display:"block",fontSize:13}}>Ready to finish?</strong><span className="small-note">{answered} of {detail.questions.length} questions answered · {saveLabel}</span></div><button className="button primary" disabled={readOnly || submitting} onClick={() => setConfirmOpen(true)}>{submitting ? "Submitting…" : "Submit assessment →"}</button></div>
          {submitError && <div className="alert error" role="alert" style={{marginTop:12}}>{submitError}<div style={{marginTop:10}}><button className="button danger small" disabled={submitting} onClick={() => void submitExam(false)}>Retry submission</button></div></div>}
        </section>
        <aside className="exam-sidebar"><ExamTimer deadlineAt={detail.attempt.deadline_at} answered={answered} total={detail.questions.length} onExpire={() => void submitExam(true)} /><div className="panel" style={{marginTop:13}}><h3 className="section-title">Question navigator</h3><p className="section-subtitle">Select a number to jump to that question.</p><div className="question-nav">{detail.questions.map((q, i) => <button type="button" key={q.id} className={q.question_type === "coding" ? (answers[q.id]?.code_answer.trim() || answers[q.id]?.output_answer.trim() ? "answered" : "") : (answers[q.id]?.answer_text.trim() ? "answered" : "")} onClick={() => document.getElementById(`question-${q.id}`)?.scrollIntoView({behavior:"smooth",block:"start"})}>{i + 1}</button>)}</div><div className="progress-track"><div className="progress-bar" style={{width:`${detail.questions.length ? answered / detail.questions.length * 100 : 0}%`}}/></div><p className="small-note" style={{marginBottom:0,marginTop:13}}>Green numbers have an answer. The final submission includes the latest answers even if an autosave is still pending.</p></div></aside>
      </div>
    </div>
    {confirmOpen && <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><p className="eyebrow">FINAL CHECK</p><h2 id="confirm-title">Submit this assessment?</h2><p>You have answered <strong>{answered} of {detail.questions.length}</strong> questions. Once the database confirms submission, the attempt is locked and cannot be edited.</p>{submitError && <div className="alert error">{submitError}</div>}<div className="modal-actions"><button className="button secondary" onClick={() => setConfirmOpen(false)} disabled={submitting}>Go back</button><button className="button primary" onClick={() => void submitExam(false)} disabled={submitting}>{submitting ? "Saving and submitting…" : "Confirm and submit"}</button></div></section></div>}
  </main>;
}


function ExamTimer({ deadlineAt, answered, total, onExpire }: { deadlineAt: string; answered: number; total: number; onExpire: () => void }) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const onExpireRef = useRef(onExpire);
  const expirationHandled = useRef(false);
  onExpireRef.current = onExpire;
  useEffect(() => {
    expirationHandled.current = false;
    const calc = () => {
      const remain = Math.ceil((new Date(deadlineAt).getTime() - Date.now()) / 1000);
      setSecondsLeft(Math.max(0, remain));
      if (remain <= 0 && !expirationHandled.current) {
        expirationHandled.current = true;
        onExpireRef.current();
      }
    };
    calc();
    const interval = window.setInterval(calc, 1000);
    return () => window.clearInterval(interval);
  }, [deadlineAt]);
  return <div className="timer-panel"><div><div className="timer-label">TIME REMAINING</div><div className="timer-digits">{secondsLeft === null ? "--:--" : formatTime(secondsLeft)}</div></div><span className="badge" style={{background:"rgba(255,255,255,.14)",color:"#fff"}}>{answered}/{total} answered</span><div className="timer-caption">Deadline is enforced by the server.</div></div>;
}

function Header({ onLogout }: { onLogout: () => void }) { return <header className="topbar"><a className="brand" href="/dashboard"><span className="brand-mark">CT</span><span>Class Test Portal<small>SECURE ASSESSMENT</small></span></a><div className="top-actions"><span className="badge amber">In progress</span><button className="button secondary small" onClick={onLogout}>Sign out</button></div></header>; }
