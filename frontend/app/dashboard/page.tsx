"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, clearSession, getRole, getToken } from "@/lib/api";

type Setting = {
  category: "aptitude" | "programming"; title: string; duration_minutes: number; questions_per_attempt: number; is_active: boolean;
  release_mode?: "manual" | "scheduled"; manual_open?: boolean; scheduled_start_at?: string | null; scheduled_end_at?: string | null;
};
type Attempt = { id: string; category: string; status: string; started_at: string; deadline_at: string; submitted_at?: string; score: number; max_score: number };
type Dashboard = { student: { full_name: string; roll_number: string }; settings: Setting[]; attempts: Attempt[] };
const label = (c: string) => c === "aptitude" ? "Aptitude Test" : "Programming Test";
const stamp = (v?: string) => v ? new Date(v).toLocaleString() : "—";

function availability(setting: Setting | undefined, now: number) {
  if (!setting || !setting.is_active) return { canStart: false, text: "Currently unavailable", detail: "This assessment has been disabled by the teacher." };
  if ((setting.release_mode || "manual") === "manual") {
    return setting.manual_open
      ? { canStart: true, text: "Ready to start", detail: "The teacher has opened this assessment." }
      : { canStart: false, text: "Waiting for teacher", detail: "This assessment will appear here when the teacher opens it." };
  }
  if (!setting.scheduled_start_at) return { canStart: false, text: "No test scheduled", detail: "The teacher has not set a start time yet." };
  const start = new Date(setting.scheduled_start_at).getTime();
  const end = setting.scheduled_end_at ? new Date(setting.scheduled_end_at).getTime() : null;
  if (Number.isNaN(start)) return { canStart: false, text: "Schedule unavailable", detail: "Ask the teacher to review the schedule." };
  if (now < start) {
    const seconds = Math.max(0, Math.floor((start - now) / 1000));
    const days = Math.floor(seconds / 86400), hours = Math.floor((seconds % 86400) / 3600), minutes = Math.floor((seconds % 3600) / 60), secs = seconds % 60;
    const countdown = days > 0 ? `${days}d ${hours}h ${minutes}m` : hours > 0 ? `${hours}h ${minutes}m ${secs}s` : `${minutes}m ${secs}s`;
    return { canStart: false, text: `Starts in ${countdown}`, detail: `Scheduled for ${stamp(setting.scheduled_start_at)}.` };
  }
  if (end !== null && now >= end) return { canStart: false, text: "Start window closed", detail: `New attempts closed at ${stamp(setting.scheduled_end_at || undefined)}.` };
  return { canStart: true, text: "Scheduled test is open", detail: end ? `You can start before ${stamp(setting.scheduled_end_at || undefined)}.` : "The teacher has scheduled this assessment to open now." };
}

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!getToken()) { router.replace("/"); return; }
    if (getRole() === "admin") { router.replace("/admin"); return; }
    api<Dashboard>("/api/student/dashboard").then(setData).catch(e => {
      setError(e instanceof ApiError ? e.message : "Could not load your dashboard.");
      if (e instanceof ApiError && e.status === 401) router.replace("/");
    }).finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    if (!getToken() || getRole() !== "student") return;
    let cancelled = false;
    const refreshSettings = async () => {
      try {
        const latest = await api<{ settings: Setting[] }>("/api/student/exam-settings");
        if (!cancelled) setData(current => current ? { ...current, settings: latest.settings } : current);
      } catch (e) {
        if (!cancelled && e instanceof ApiError && e.status === 401) router.replace("/");
      }
    };
    const interval = window.setInterval(() => void refreshSettings(), 30000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [router]);

  async function begin(category: string) {
    setStarting(category); setError("");
    try {
      const response = await api<{ attempt: { id: string; status: string } }>(`/api/attempts/start?category=${encodeURIComponent(category)}`, { method: "POST", body: "{}" });
      router.push(`/exam/${response.attempt.id}`);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Unable to start this test."); }
    finally { setStarting(""); }
  }
  function logout() { clearSession(); router.replace("/"); }
  if (loading) return <div className="loading-page"><span className="spinner" style={{borderColor:"#cfdfd5",borderTopColor:"#176b53"}}/> Loading your dashboard…</div>;
  if (!data) return <main className="app-page"><Header title="Student Portal" onLogout={logout}/><div className="container"><div className="alert error">{error || "Could not load profile."}</div><button className="button secondary" onClick={() => router.replace("/")}>Back to login</button></div></main>;

  const completed = data.attempts.filter(a => a.status !== "in_progress");
  const active = data.attempts.filter(a => a.status === "in_progress");
  return <main className="app-page">
    <Header title="Student Portal" name={data.student.full_name} onLogout={logout}/>
    <div className="container">
      <div className="page-heading"><div><p className="eyebrow">STUDENT DASHBOARD</p><h1>Welcome, {data.student.full_name.split(" ")[0]}.</h1><p>Choose an assessment. Scheduled tests show a countdown, and manually released tests appear when your teacher opens them.</p></div><span className="badge green">Roll no. {data.student.roll_number}</span></div>
      {error && <div className="alert error" style={{marginBottom:18}}>{error}</div>}
      {active.length > 0 && <section className="panel" style={{marginTop:0,marginBottom:20}}><div className="section-head"><div><h2 className="section-title">Continue your test</h2><p className="section-subtitle">You have an exam that is still in progress.</p></div></div><div className="question-list">{active.map(a => <div className="question-row" key={a.id}><div><span className="badge amber">In progress</span><h4>{label(a.category)}</h4><p>Started {stamp(a.started_at)} · Deadline {stamp(a.deadline_at)}</p></div><button className="button primary" onClick={() => router.push(`/exam/${a.id}`)}>Resume test →</button></div>)}</div></section>}
      <div className="grid-two">
        {(["aptitude", "programming"] as const).map(category => {
          const setting = data.settings.find(s => s.category === category);
          const state = availability(setting, now);
          const count = setting?.questions_per_attempt ?? "—";
          return <section className="test-card" key={category}>
            <div className="test-icon">{category === "aptitude" ? "✳" : "⌘"}</div>
            <h2>{setting?.title || label(category)}</h2>
            <p>{category === "aptitude" ? "Reasoning, quantitative aptitude, SQL, MCQs and short answers." : "Programming prompts with code and output fields; selected answers may be reviewed by your teacher."}</p>
            <div className="test-meta"><span>{setting?.duration_minutes ?? "—"} minutes</span><span>{count} questions</span><span>{category === "aptitude" ? "MCQ + short answer" : "Code + output"}</span></div>
            <div className={`availability-note ${state.canStart ? "open" : "closed"}`}><strong>{state.text}</strong><span>{state.detail}</span></div>
            <button className="button primary" disabled={!state.canStart || starting === category} onClick={() => begin(category)}>{starting === category ? "Preparing test…" : state.canStart ? "Start assessment" : state.text} <span>→</span></button>
          </section>;
        })}
      </div>
      <section className="panel"><div className="section-head"><div><h2 className="section-title">Previous results</h2><p className="section-subtitle">Your completed assessments and scores.</p></div><span className="badge">{completed.length} completed</span></div>
        {completed.length === 0 ? <div className="empty">No completed tests yet.<br/>Your results will appear here after you submit an assessment.</div> : <div className="table-wrap"><table><thead><tr><th>Assessment</th><th>Submitted</th><th>Status</th><th>Score</th></tr></thead><tbody>{completed.map(a => <tr key={a.id}><td><strong>{label(a.category)}</strong></td><td>{stamp(a.submitted_at || a.started_at)}</td><td><span className={`badge ${a.status === "submitted" ? "green" : "amber"}`}>{a.status}</span></td><td><strong>{Number(a.score || 0).toFixed(2)} / {Number(a.max_score || 0).toFixed(2)}</strong></td></tr>)}</tbody></table></div>}
      </section>
      <p className="small-note" style={{marginTop:22}}>Programming code is stored for review and is not executed on the web server. Your final submission is saved by the database before a success confirmation is shown.</p>
    </div>
  </main>;
}

function Header({ title, name, onLogout }: { title: string; name?: string; onLogout: () => void }) {
  return <header className="topbar"><a className="brand" href="/dashboard"><span className="brand-mark">CT</span><span>Class Test Portal<small>{title.toUpperCase()}</small></span></a><div className="top-actions">{name && <div className="user-chip"><span className="avatar">{name.slice(0,1).toUpperCase()}</span><span>{name}</span></div>}<button className="button secondary small" onClick={onLogout}>Sign out</button></div></header>;
}
