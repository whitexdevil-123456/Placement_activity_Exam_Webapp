"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, clearSession, getRole, getToken } from "@/lib/api";

type Question = { id: number; grading_rubric?: string | null; category: "aptitude" | "programming"; question_type: "mcq" | "short" | "coding"; prompt: string; options: string[]; correct_answer: string | null; expected_output: string | null; topic: string | null; difficulty: "Easy" | "Medium" | "Hard"; marks: number; is_active: boolean };
type Setting = { category: "aptitude" | "programming"; title: string; duration_minutes: number; questions_per_attempt: number; is_active: boolean; release_mode: "manual" | "scheduled"; manual_open: boolean; scheduled_start_at: string | null; scheduled_end_at: string | null };
type Student = { id: string; roll_number: string; full_name: string; email?: string | null; is_active: boolean; registration_pending?: boolean; created_at?: string };
type Attempt = { id: string; student_id: string; roll_number: string; full_name: string; category: string; status: string; started_at: string; submitted_at?: string; deadline_at: string; score: number; max_score: number };
type AttemptQuestion = Question & { display_order: number; answer: { question_id: number; answer_text?: string; code_answer?: string; output_answer?: string; awarded_marks?: number; is_correct?: boolean | null; graded_at?: string | null; ai_feedback?: string | null; ai_suggested_marks?: number | null; ai_confidence?: number | null; grading_source?: string | null }; marks: number };
type AttemptDetail = { attempt: { id: string; category: string; status: string; score: number; max_score: number; started_at: string; submitted_at?: string }; student: { roll_number?: string; full_name?: string }; questions: AttemptQuestion[] };
const dateText = (v?: string) => v ? new Date(v).toLocaleString() : "—";
const defaultQuestion = (): Partial<Question> => ({ category: "aptitude", question_type: "mcq", prompt: "", options: [], correct_answer: "", expected_output: "", grading_rubric: "", topic: "", difficulty: "Medium", marks: 1, is_active: true });

export default function AdminPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"questions" | "settings" | "students" | "results">("questions");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [questionCategory, setQuestionCategory] = useState<"all" | "aptitude" | "programming">("all");
  const [form, setForm] = useState<Partial<Question>>(defaultQuestion());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [studentForm, setStudentForm] = useState({ roll_number: "", full_name: "", email: "", password: "" });
  const [studentEmails, setStudentEmails] = useState<Record<string, string>>({});
  const [selectedDetail, setSelectedDetail] = useState<AttemptDetail | null>(null);
  const [gradeValues, setGradeValues] = useState<Record<number, string>>({});
  const [csvName, setCsvName] = useState("");
  const [questionFileName, setQuestionFileName] = useState("");
  const [questionImportCategory, setQuestionImportCategory] = useState<"aptitude" | "programming">("aptitude");
  const [aiWorkingQuestion, setAiWorkingQuestion] = useState<number | null>(null);

  const loadAll = useCallback(async () => {
    setError("");
    const [q, s, st, a] = await Promise.all([
      api<{questions: Question[]}>("/api/admin/questions"),
      api<{settings: Setting[]}>("/api/admin/settings"),
      api<{students: Student[]}>("/api/admin/students"),
      api<{attempts: Attempt[]}>("/api/admin/attempts"),
    ]);
    setQuestions(q.questions); setSettings(s.settings); setStudents(st.students); setStudentEmails(Object.fromEntries(st.students.map(student => [student.id, student.email || ""]))); setAttempts(a.attempts);
  }, []);
  useEffect(() => {
    if (!getToken()) { router.replace("/"); return; }
    if (getRole() !== "admin") { router.replace("/dashboard"); return; }
    loadAll().catch(e => { setError(e instanceof ApiError ? e.message : "Could not load admin data."); if (e instanceof ApiError && e.status === 401) router.replace("/"); }).finally(() => setLoading(false));
  }, [loadAll, router]);

  function logout() { clearSession(); router.replace("/"); }
  function resetQuestionForm() { setForm(defaultQuestion()); setEditingId(null); }
  function beginEdit(q: Question) { setEditingId(q.id); setForm({ ...q }); window.scrollTo({ top: 0, behavior: "smooth" }); }
  const filteredQuestions = questions.filter(q => questionCategory === "all" || q.category === questionCategory);

  async function saveQuestion(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const category = form.category || "aptitude";
      const body = {
        category,
        question_type: category === "programming" ? "coding" : (form.question_type === "short" ? "short" : "mcq"),
        prompt: (form.prompt || "").trim(),
        options: category === "programming" || form.question_type === "short" ? [] : (Array.isArray(form.options) ? form.options : []),
        correct_answer: category === "aptitude" ? ((form.correct_answer || "").trim() || null) : null,
        expected_output: category === "programming" ? ((form.expected_output || "").trim() || null) : null,
        grading_rubric: category === "programming" ? ((form.grading_rubric || "").trim() || null) : null,
        topic: (form.topic || "").trim() || null,
        difficulty: form.difficulty || "Medium",
        marks: Number(form.marks || 1),
        is_active: Boolean(form.is_active ?? true),
      };
      if (editingId) await api(`/api/admin/questions/${editingId}`, { method: "PATCH", body: JSON.stringify(body) });
      else await api("/api/admin/questions", { method: "POST", body: JSON.stringify(body) });
      await loadAll(); setNotice(editingId ? "Question updated." : "Question added to the bank."); resetQuestionForm();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Could not save question."); }
    finally { setBusy(false); }
  }

  async function deactivateQuestion(q: Question) {
    if (!window.confirm(`Deactivate this question? It remains in historical attempts.`)) return;
    try { await api(`/api/admin/questions/${q.id}`, { method: "DELETE" }); await loadAll(); setNotice("Question deactivated."); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Could not deactivate question."); }
  }

  async function saveSetting(setting: Setting) {
    setBusy(true); setError(""); setNotice("");
    try { await api("/api/admin/settings", { method: "PUT", body: JSON.stringify(setting) }); await loadAll(); setNotice(`${setting.title} settings saved.`); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Could not save settings."); }
    finally { setBusy(false); }
  }

  async function addStudent(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try { await api("/api/admin/students", { method: "POST", body: JSON.stringify(studentForm) }); setStudentForm({ roll_number: "", full_name: "", email: "", password: "" }); await loadAll(); setNotice("Student created or updated."); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Could not save student."); }
    finally { setBusy(false); }
  }

  async function saveStudentEmail(student: Student) {
    const email = (studentEmails[student.id] || "").trim();
    if (!email) { setError("Enter the student's recovery email address."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/api/admin/students/${student.id}/email`, { method: "PATCH", body: JSON.stringify({ email }) });
      await loadAll(); setNotice(`Recovery email updated for ${student.roll_number}.`);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Could not update recovery email."); }
    finally { setBusy(false); }
  }

  async function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setCsvName(file.name); setBusy(true); setError(""); setNotice("");
    try {
      const text = await file.text();
      const records = parseCsv(text);
      if (!records.length) throw new Error("CSV is empty or has no data rows.");
      const first = records[0].map(v => v.trim().toLowerCase());
      const rollIndex = first.indexOf("roll_number"), nameIndex = first.indexOf("full_name"), passwordIndex = first.indexOf("password") >= 0 ? first.indexOf("password") : first.indexOf("pin"), emailIndex = first.indexOf("email");
      if (rollIndex < 0 || nameIndex < 0 || passwordIndex < 0) throw new Error("CSV headers must include roll_number,full_name,password. A legacy pin column is also accepted. Add an optional email column to enable password recovery.");
      const students = records.slice(1).filter(row => row.some(v => v.trim())).map(row => ({ roll_number: row[rollIndex] || "", full_name: row[nameIndex] || "", email: emailIndex >= 0 ? (row[emailIndex] || "") : "", password: row[passwordIndex] || "" }));
      if (!students.length) throw new Error("CSV has no student rows.");
      const result = await api<{imported: number; message: string}>("/api/admin/students/import", { method: "POST", body: JSON.stringify({ students }) });
      await loadAll(); setNotice(result.message);
    } catch (e) { setError(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : "CSV import failed.")); }
    finally { setBusy(false); event.target.value = ""; }
  }

  async function importQuestions(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setQuestionFileName(file.name); setBusy(true); setError(""); setNotice("");
    try {
      const formData = new FormData(); formData.append("file", file);
      const result = await api<{ imported: number; message: string; by_category: Record<string, number> }>(`/api/admin/questions/import?default_category=${questionImportCategory}`, { method: "POST", body: formData });
      await loadAll(); setNotice(`${result.message} ${Object.entries(result.by_category || {}).map(([key, value]) => `${key}: ${value}`).join(", ")}`); setQuestionFileName("");
    } catch (e) { setError(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : "Question import failed.")); }
    finally { setBusy(false); event.target.value = ""; }
  }

  async function toggleStudent(student: Student) {
    try { await api(`/api/admin/students/${student.id}/active?active=${!student.is_active}`, { method: "PATCH" }); await loadAll(); setNotice(`${student.roll_number} account updated.`); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Could not update student."); }
  }

  async function inspectAttempt(id: string) {
    setError(""); setSelectedDetail(null);
    try {
      const d = await api<AttemptDetail>(`/api/admin/attempts/${id}`); setSelectedDetail(d);
      const grades: Record<number, string> = {};
      d.questions.forEach(q => { grades[q.id] = String(q.answer?.awarded_marks ?? 0); });
      setGradeValues(grades);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Could not load attempt details."); }
  }

  async function gradeQuestion(attemptId: string, questionId: number) {
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/api/admin/attempts/${attemptId}/grade`, { method: "POST", body: JSON.stringify({ question_id: questionId, awarded_marks: Number(gradeValues[questionId] || 0) }) });
      const d = await api<AttemptDetail>(`/api/admin/attempts/${attemptId}`); setSelectedDetail(d); await loadAll(); setNotice("Grade saved and total recalculated.");
    } catch (e) { setError(e instanceof ApiError ? e.message : "Could not save grade."); }
    finally { setBusy(false); }
  }

  async function aiGradeQuestion(attemptId: string, questionId: number) {
    setAiWorkingQuestion(questionId); setError(""); setNotice("");
    try {
      const result = await api<{ awarded_marks: number; ai_feedback: string; ai_confidence: number; grading_source: string }>(`/api/admin/attempts/${attemptId}/ai-grade`, { method: "POST", body: JSON.stringify({ question_id: questionId }) });
      const d = await api<AttemptDetail>(`/api/admin/attempts/${attemptId}`); setSelectedDetail(d); await loadAll();
      setGradeValues(v => ({ ...v, [questionId]: String(result.awarded_marks) }));
      setNotice(`AI suggested ${result.awarded_marks} marks with ${Math.round(result.ai_confidence * 100)}% confidence. Review the feedback before finalizing the grade.`);
    } catch (e) { setError(e instanceof ApiError ? e.message : "AI grading failed. Check OPENAI_API_KEY and backend logs."); }
    finally { setAiWorkingQuestion(null); }
  }

  if (loading) return <div className="loading-page"><span className="spinner" style={{borderColor:"#cfdfd5",borderTopColor:"#176b53"}}/> Loading admin workspace…</div>;
  const submittedCount = attempts.filter(a => a.status !== "in_progress").length;
  const inProgressCount = attempts.filter(a => a.status === "in_progress").length;
  return <main className="app-page"><header className="topbar"><a className="brand" href="/admin"><span className="brand-mark">CT</span><span>Class Test Portal<small>ADMIN WORKSPACE</small></span></a><div className="top-actions"><span className="badge green">Teacher access</span><button className="button secondary small" onClick={logout}>Sign out</button></div></header>
    <div className="container">
      <div className="page-heading"><div><p className="eyebrow">CONTROL CENTRE</p><h1>Manage assessments.</h1><p>Maintain the question bank, configure exam rules, manage the roster and review submissions.</p></div><button className="button secondary" onClick={() => loadAll().catch(e => setError(e.message))}>↻ Refresh data</button></div>
      <div className="stats-grid"><Stat label="Active students" value={students.filter(s => s.is_active).length}/><Stat label="In-progress attempts" value={inProgressCount}/><Stat label="Completed attempts" value={submittedCount}/></div>
      {error && <div className="alert error" style={{marginBottom:12}}>{error}</div>}{notice && <div className="alert success" style={{marginBottom:12}}>{notice}</div>}
      <section className="panel" style={{marginTop:0}}>
        <nav className="admin-tabs" aria-label="Admin sections">{([['questions','Question bank'],['settings','Exam settings'],['students','Students'],['results','Results & grading']] as const).map(([key,title]) => <button key={key} className={tab === key ? "selected" : ""} onClick={() => { setTab(key); setError(""); setNotice(""); }}>{title}</button>)}</nav>

        {tab === "questions" && <div>
          <section className="panel question-import-panel" style={{marginTop:18,marginBottom:22,padding:18}}>
            <div className="section-head"><div><h2 className="section-title">Bulk import questions</h2><p className="section-subtitle">Import a large question bank instead of typing hundreds of questions manually.</p></div><span className="badge">CSV · Excel · Word</span></div>
            <div className="form-grid" style={{alignItems:"end"}}>
              <label>Default section for rows without a category<select value={questionImportCategory} onChange={e=>setQuestionImportCategory(e.target.value as "aptitude"|"programming")}><option value="aptitude">Aptitude</option><option value="programming">Programming</option></select></label>
              <label>Choose question file<input type="file" accept=".csv,.xlsx,.docx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={importQuestions}/><span className="small-note">{questionFileName || "Up to 1,500 questions per file; file size under 3.8 MB."}</span></label>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",paddingBottom:8}}><a className="button secondary small" href="/templates/question-bank-template.xlsx" download>Download Excel template</a><a className="button secondary small" href="/templates/question-bank-template.docx" download>Download Word template</a></div>
            </div>
            <p className="small-note" style={{marginBottom:0}}>Supported formats: .xlsx, .csv, and .docx (Word tables). Required columns: question / prompt; MCQs also need options and correct_answer. Use <code>|</code> between MCQ options and between acceptable short answers. AI grading rubric is optional for programming questions.</p>
          </section>
          <div className="grid-two" style={{alignItems:"start"}}>
          <form className="form-stack" onSubmit={saveQuestion}>
            <div><h2 className="section-title">{editingId ? `Edit question #${editingId}` : "Add a question"}</h2><p className="section-subtitle">Changes apply to future attempts. Existing attempts retain their assigned question list.</p></div>
            <label>Section<select value={form.category || "aptitude"} onChange={e => setForm(v => ({...v, category: e.target.value as "aptitude" | "programming", question_type: e.target.value === "programming" ? "coding" : (v.question_type === "coding" ? "mcq" : v.question_type)}))}><option value="aptitude">Aptitude test</option><option value="programming">Programming test</option></select></label>
            {form.category === "aptitude" && <label>Question type<select value={form.question_type === "short" ? "short" : "mcq"} onChange={e => setForm(v => ({...v, question_type: e.target.value as "mcq" | "short"}))}><option value="mcq">Multiple choice (MCQ)</option><option value="short">One-line / short answer</option></select></label>}
            <label>Question prompt<textarea value={form.prompt || ""} onChange={e => setForm(v => ({...v, prompt:e.target.value}))} rows={4} required/></label>
            {form.category === "aptitude" && form.question_type !== "short" && <label>Options (one per line)<textarea value={(form.options || []).join("\n")} onChange={e => setForm(v => ({...v, options:e.target.value.split("\n").map(x => x.trim()).filter(Boolean)}))} rows={4} placeholder={'Option A\nOption B\nOption C\nOption D'} required/></label>}
            {form.category === "aptitude" ? <label>Correct answer{form.question_type === "short" ? " (use | for alternatives)" : " (must match an option)"}<input value={form.correct_answer || ""} onChange={e => setForm(v => ({...v, correct_answer:e.target.value}))} required/></label> : <><label>Expected output (optional; exact text match for basic auto-scoring)<textarea value={form.expected_output || ""} onChange={e => setForm(v => ({...v, expected_output:e.target.value}))} rows={3}/></label><label>AI grading rubric (optional)<textarea value={form.grading_rubric || ""} onChange={e => setForm(v => ({...v, grading_rubric:e.target.value}))} rows={3} placeholder="What should earn full credit? Consider logic, correctness, efficiency, edge cases and code clarity."/></label></>}
            <div className="form-grid"><label>Topic<input value={form.topic || ""} onChange={e => setForm(v => ({...v, topic:e.target.value}))} placeholder="e.g. SQL"/></label><label>Difficulty<select value={form.difficulty || "Medium"} onChange={e => setForm(v => ({...v, difficulty:e.target.value as "Easy"|"Medium"|"Hard"}))}><option>Easy</option><option>Medium</option><option>Hard</option></select></label><label>Marks<input type="number" min="0.25" max="1000" step="0.25" value={form.marks ?? 1} onChange={e => setForm(v => ({...v, marks:Number(e.target.value)}))} required/></label><label className="checkline" style={{alignSelf:"end",paddingBottom:12}}><input type="checkbox" checked={Boolean(form.is_active ?? true)} onChange={e => setForm(v => ({...v, is_active:e.target.checked}))}/> Active for new tests</label></div>
            <div className="inline-form"><button className="button primary" type="submit" disabled={busy}>{busy ? "Saving…" : editingId ? "Save changes" : "Add to question bank"}</button>{editingId && <button className="button secondary" type="button" onClick={resetQuestionForm}>Cancel edit</button>}</div>
          </form>
          <div><div className="section-head"><div><h2 className="section-title">Question bank</h2><p className="section-subtitle">{questions.length} questions in total</p></div><select className="control" style={{width:150}} value={questionCategory} onChange={e => setQuestionCategory(e.target.value as typeof questionCategory)}><option value="all">All sections</option><option value="aptitude">Aptitude</option><option value="programming">Programming</option></select></div>
            <div className="question-list">{filteredQuestions.length === 0 ? <div className="empty">No questions match this filter.</div> : filteredQuestions.map(q => <div className="question-row" key={q.id}><div style={{minWidth:0}}><div style={{display:"flex",gap:7,flexWrap:"wrap"}}><span className="badge">#{q.id} · {q.category}</span><span className={`badge ${q.is_active ? "green" : "red"}`}>{q.is_active ? "Active" : "Inactive"}</span></div><h4>{q.prompt.length > 170 ? q.prompt.slice(0,170)+"…" : q.prompt}</h4><p>{q.question_type.toUpperCase()} · {q.topic || "General"} · {q.marks} marks</p></div><div className="row-actions"><button className="button secondary small" onClick={() => beginEdit(q)}>Edit</button>{q.is_active && <button className="button danger small" onClick={() => void deactivateQuestion(q)}>Deactivate</button>}</div></div>)}</div>
          </div>
          </div>
        </div>}

        {tab === "settings" && <div><div className="section-head"><div><h2 className="section-title">Exam configuration</h2><p className="section-subtitle">Set timing and question counts for new attempts.</p></div></div>{settings.map(setting => <SettingsEditor key={setting.category} initial={setting} busy={busy} onSave={saveSetting}/>)}</div>}

        {tab === "students" && <div className="grid-two" style={{alignItems:"start"}}>
          <div><h2 className="section-title">Add or update a student</h2><p className="section-subtitle" style={{marginBottom:16}}>Passwords are hashed before being stored in Supabase.</p><form className="form-stack" onSubmit={addStudent}><label>Roll number<input value={studentForm.roll_number} onChange={e => setStudentForm(v => ({...v,roll_number:e.target.value}))} required placeholder="DS001"/></label><label>Full name<input value={studentForm.full_name} onChange={e => setStudentForm(v => ({...v,full_name:e.target.value}))} required/></label><label>Recovery email (recommended)<input type="email" autoComplete="email" value={studentForm.email} onChange={e => setStudentForm(v => ({...v,email:e.target.value}))} placeholder="student@example.com"/></label><label>Temporary password (minimum 8 characters)<input type="password" autoComplete="new-password" value={studentForm.password} onChange={e => setStudentForm(v => ({...v,password:e.target.value}))} minLength={8} maxLength={128} required/></label><button className="button primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save student"}</button></form>
            <div className="panel" style={{marginTop:22,padding:16}}><h3 className="section-title">Import roster CSV</h3><p className="small-note">Required headers: <code>roll_number,full_name,password</code>; legacy <code>pin</code> headers are also accepted. An <code>email</code> column enables password recovery. Importing an existing roll number resets its name and password.</p><label className="field-label">{csvName || "Choose CSV file"}<input type="file" accept=".csv,text/csv" onChange={importCsv}/></label><a className="button secondary small" href="/templates/student-roster-template.csv" download>Download roster template</a>{busy && <p className="small-note">Processing…</p>}</div>
          </div>
          <div><div className="section-head"><div><h2 className="section-title">Student roster</h2><p className="section-subtitle">{students.length} students</p></div></div><div className="table-wrap"><table><thead><tr><th>Roll no.</th><th>Name</th><th>Recovery email</th><th>Account</th><th>Actions</th></tr></thead><tbody>{students.map(s => <tr key={s.id}><td><strong>{s.roll_number}</strong></td><td>{s.full_name}</td><td><div style={{display:"flex",gap:6,minWidth:240}}><input className="control" type="email" aria-label={`Recovery email for ${s.roll_number}`} value={studentEmails[s.id] ?? ""} onChange={e => setStudentEmails(v => ({...v,[s.id]:e.target.value}))} placeholder="student@example.com"/><button className="button secondary small" disabled={busy} onClick={() => void saveStudentEmail(s)}>Save</button></div></td><td><span className={`badge ${s.is_active ? "green" : s.registration_pending ? "amber" : "red"}`}>{s.is_active ? "Active" : s.registration_pending ? "Pending approval" : "Disabled"}</span></td><td><button className="button secondary small" onClick={() => void toggleStudent(s)}>{s.is_active ? "Disable" : s.registration_pending ? "Approve" : "Enable"}</button></td></tr>)}</tbody></table></div></div>
        </div>}

        {tab === "results" && <div><div className="section-head"><div><h2 className="section-title">Exam attempts</h2><p className="section-subtitle">Inspect submissions and award marks for coding responses that need manual review.</p></div></div>
          {selectedDetail && <section className="settings-card" style={{marginBottom:22}}><div className="section-head"><div><h3>{selectedDetail.student.full_name || "Student"} · {selectedDetail.student.roll_number || ""}</h3><p className="section-subtitle">{selectedDetail.attempt.category} · Status: {selectedDetail.attempt.status} · Score {Number(selectedDetail.attempt.score).toFixed(2)} / {Number(selectedDetail.attempt.max_score).toFixed(2)}</p></div><button className="button secondary small" onClick={() => setSelectedDetail(null)}>Close review</button></div>
              {selectedDetail.questions.map((q, i) => <article className="detail-answer" key={q.id}><div className="question-overline"><span>Q{i+1} · {q.question_type.toUpperCase()}</span><span>{q.answer.awarded_marks ?? 0} / {q.marks} marks</span></div><h4 style={{lineHeight:1.5}}>{q.prompt}</h4><p className="small-note">Student answer: {q.answer.answer_text || "(no text answer)"}</p>{q.question_type === "coding" && <><p className="small-note">Code submitted:</p><pre>{q.answer.code_answer || "(no code)"}</pre><p className="small-note">Output submitted:</p><pre>{q.answer.output_answer || "(no output)"}</pre><p className="small-note">Expected output: <code>{q.expected_output || "Manual review"}</code></p></>}{q.question_type !== "coding" && <p className="small-note">Expected answer: <code>{q.correct_answer}</code></p>}
                {q.question_type === "coding" && q.answer.ai_feedback && <div className="ai-feedback"><strong>AI suggestion: {q.answer.ai_suggested_marks === null || q.answer.ai_suggested_marks === undefined ? "—" : Number(q.answer.ai_suggested_marks).toFixed(2)} / {q.marks} marks{q.answer.ai_confidence !== null && q.answer.ai_confidence !== undefined ? ` · ${Math.round(Number(q.answer.ai_confidence)*100)}% confidence` : ""}</strong><p>{q.answer.ai_feedback}</p><span className="small-note">This is a recommendation only and has not changed the official score. Review it, then click Save grade to accept or adjust the marks.</span></div>}
                <div className="inline-form"><label className="field-label" style={{maxWidth:180}}>Award marks (max {q.marks})<input className="control" type="number" min="0" max={q.marks} step="0.25" value={gradeValues[q.id] ?? String(q.answer.awarded_marks ?? 0)} onChange={e => setGradeValues(v => ({...v,[q.id]:e.target.value}))}/></label>{q.question_type === "coding" && <button className="button secondary small" disabled={Boolean(aiWorkingQuestion) || busy || selectedDetail.attempt.status === "in_progress"} onClick={() => void aiGradeQuestion(selectedDetail.attempt.id,q.id)}>{aiWorkingQuestion === q.id ? "Assessing with AI…" : "AI assess"}</button>}<button className="button secondary small" disabled={busy || Boolean(aiWorkingQuestion) || selectedDetail.attempt.status === "in_progress"} onClick={() => void gradeQuestion(selectedDetail.attempt.id,q.id)}>Save grade</button></div>
              </article>)}
            </section>}
          <div className="table-wrap"><table><thead><tr><th>Student</th><th>Assessment</th><th>Started</th><th>Status</th><th>Score</th><th>Review</th></tr></thead><tbody>{attempts.map(a => <tr key={a.id}><td><strong>{a.full_name || "Student"}</strong><div className="small-note">{a.roll_number}</div></td><td>{a.category === "aptitude" ? "Aptitude" : "Programming"}</td><td>{dateText(a.started_at)}</td><td><span className={`badge ${a.status === "submitted" ? "green" : a.status === "in_progress" ? "amber" : "red"}`}>{a.status}</span></td><td>{Number(a.score||0).toFixed(2)} / {Number(a.max_score||0).toFixed(2)}</td><td><button className="button secondary small" onClick={() => void inspectAttempt(a.id)}>Review</button></td></tr>)}</tbody></table></div>
        </div>}
      </section>
      <p className="small-note" style={{marginTop:20}}>API build: FastAPI + PostgreSQL RPCs. Never put the Supabase service-role key in frontend environment variables.</p>
    </div>
  </main>;
}

function Stat({label,value}:{label:string;value:number}) { return <div className="stat-card"><div className="stat-label">{label}</div><div className="stat-value">{value}</div></div>; }
function toLocalDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function SettingsEditor({initial,busy,onSave}:{initial:Setting;busy:boolean;onSave:(s:Setting)=>Promise<void>}) {
  const [value,setValue]=useState<Setting>(initial);
  const [startInput,setStartInput]=useState(toLocalDateTime(initial.scheduled_start_at));
  const [endInput,setEndInput]=useState(toLocalDateTime(initial.scheduled_end_at));
  useEffect(()=>{setValue(initial);setStartInput(toLocalDateTime(initial.scheduled_start_at));setEndInput(toLocalDateTime(initial.scheduled_end_at));},[initial.category,initial.title,initial.duration_minutes,initial.questions_per_attempt,initial.is_active,initial.release_mode,initial.manual_open,initial.scheduled_start_at,initial.scheduled_end_at]);
  function submit(event: FormEvent) {
    event.preventDefault();
    const scheduled_start_at = startInput ? new Date(startInput).toISOString() : null;
    const scheduled_end_at = endInput ? new Date(endInput).toISOString() : null;
    void onSave({...value,scheduled_start_at,scheduled_end_at});
  }
  return <form className="settings-card" onSubmit={submit}>
    <h3>{value.category === "aptitude" ? "Aptitude test" : "Programming test"}</h3>
    <div className="form-grid">
      <label>Title<input value={value.title} onChange={e=>setValue(v=>({...v,title:e.target.value}))} required/></label>
      <label>Duration (minutes)<input type="number" min="1" max="300" value={value.duration_minutes} onChange={e=>setValue(v=>({...v,duration_minutes:Number(e.target.value)}))} required/></label>
      <label>Questions per attempt<input type="number" min="1" max="500" value={value.questions_per_attempt} onChange={e=>setValue(v=>({...v,questions_per_attempt:Number(e.target.value)}))} required/></label>
      <label>Release mode<select value={value.release_mode || "manual"} onChange={e=>setValue(v=>({...v,release_mode:e.target.value as "manual"|"scheduled"}))}><option value="manual">Manual — teacher opens it</option><option value="scheduled">Scheduled — opens at a set time</option></select></label>
      <label className="checkline" style={{alignSelf:"end",paddingBottom:12}}><input type="checkbox" checked={value.is_active} onChange={e=>setValue(v=>({...v,is_active:e.target.checked}))}/> Assessment enabled</label>
      {value.release_mode === "manual" ? <label className="checkline" style={{alignSelf:"end",paddingBottom:12}}><input type="checkbox" checked={Boolean(value.manual_open)} onChange={e=>setValue(v=>({...v,manual_open:e.target.checked}))}/> Open for students now</label> : <>
        <label>Scheduled start time<input type="datetime-local" value={startInput} onChange={e=>setStartInput(e.target.value)} required/></label>
        <label>Stop accepting new attempts at (optional)<input type="datetime-local" value={endInput} onChange={e=>setEndInput(e.target.value)} min={startInput || undefined}/></label>
      </>}
    </div>
    <p className="small-note">Manual mode: students cannot start until “Open for students now” is enabled. Scheduled mode: students see a countdown before the start time and a closed message after the optional start deadline. All times are interpreted in your browser's local time and saved in UTC.</p>
    <button className="button primary" type="submit" disabled={busy}>{busy ? "Saving…" : value.release_mode === "manual" && value.manual_open ? "Save & open test" : "Save exam settings"}</button>
  </form>;
}
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let i=0;i<text.length;i++) { const char=text[i]; if (char==='"') { if (quoted && text[i+1]==='"') { cell+='"'; i++; } else quoted=!quoted; } else if (char===',' && !quoted) { row.push(cell); cell=""; } else if ((char==='\n' || char==='\r') && !quoted) { if (char==='\r' && text[i+1]==='\n') i++; row.push(cell); if (row.some(v=>v.trim())) rows.push(row); row=[]; cell=""; } else cell+=char; }
  row.push(cell); if(row.some(v=>v.trim())) rows.push(row); return rows;
}
