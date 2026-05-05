import { useState, useEffect, useRef } from "react";
import { getCurrentUser, fetchAuthSession, signOut } from "aws-amplify/auth";
import "./App.css";
import Dashboard from "./Dashboard";
import Auth from "./Auth";
import StravaCallback from "./StravaCallback";

const API_URL = "https://hktnpan365.execute-api.us-east-1.amazonaws.com";
const KM_TO_MI = 0.621371;

function parseDistanceKm(distanceStr) {
  if (!distanceStr) return 0;
  const match = distanceStr.match(/[\d.]+/);
  return match ? parseFloat(match[0]) : 0;
}

function parseDurationToMinutes(durationStr) {
  if (!durationStr) return 0;
  const parts = durationStr.split(":").map(p => parseInt(p, 10));
  if (parts.length === 2) return parts[0] + parts[1] / 60;
  if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60;
  return 0;
}

function formatPace(paceMinPerUnit) {
  if (!paceMinPerUnit || isNaN(paceMinPerUnit) || !isFinite(paceMinPerUnit)) return "-";
  const min = Math.floor(paceMinPerUnit);
  const sec = Math.round((paceMinPerUnit - min) * 60);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

async function authedFetch(url, options = {}) {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`
    }
  });
}

function App() {
  const [authState, setAuthState] = useState("checking");
  const [userEmail, setUserEmail] = useState("");

  const [runs, setRuns] = useState([]);
  const [form, setForm] = useState({ title: "", date: "", distance: "", duration: "", notes: "" });
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [editingRunId, setEditingRunId] = useState(null);
  const [editForm, setEditForm] = useState({ title: "", date: "", distance: "", duration: "", notes: "" });

  const [plan, setPlan] = useState(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generateForm, setGenerateForm] = useState({ goal: "", weeks: 4, daysPerWeek: 3, currentFitness: "" });

  const [messages, setMessages] = useState([
    { role: "coach", text: "Hi! I'm your running coach. Ask me anything — about training, pacing, recovery, or just how you're feeling about your runs." }
  ]);
  const [coachInput, setCoachInput] = useState("");
  const [coachLoading, setCoachLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("theme");
    if (saved) return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [unit, setUnit] = useState(() => localStorage.getItem("unit") || "km");
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem("activeTab") || "dashboard");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stravaStatus, setStravaStatus] = useState({ connected: false });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("unit", unit);
  }, [unit]);

  useEffect(() => {
    localStorage.setItem("activeTab", activeTab);
  }, [activeTab]);

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (authState === "authenticated") {
      fetchRuns();
      fetchPlan();
      fetchStravaStatus();
    }
  }, [authState]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, coachLoading]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (settingsOpen && !e.target.closest(".settings-wrapper")) {
        setSettingsOpen(false);
      }
    }
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [settingsOpen]);

  async function checkAuth() {
    try {
      const user = await getCurrentUser();
      setUserEmail(user.signInDetails?.loginId || user.username);
      setAuthState("authenticated");
    } catch {
      setAuthState("unauthenticated");
    }
  }

  async function handleLogout() {
    await signOut();
    setAuthState("unauthenticated");
    setUserEmail("");
    setRuns([]);
    setPlan(null);
    setMessages([{ role: "coach", text: "Hi! I'm your running coach. Ask me anything — about training, pacing, recovery, or just how you're feeling about your runs." }]);
    setSettingsOpen(false);
  }

  async function fetchRuns() {
    try {
      const res = await authedFetch(`${API_URL}/runs`);
      const data = await res.json();
      setRuns(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Error fetching runs:", err);
    }
  }

  async function fetchPlan() {
    try {
      const res = await authedFetch(`${API_URL}/plan`);
      const data = await res.json();
      setPlan(data);
    } catch (err) {
      console.error("Error fetching plan:", err);
    }
  }

  async function fetchStravaStatus() {
    try {
      const res = await authedFetch(`${API_URL}/strava/status`);
      if (res.ok) {
        const data = await res.json();
        setStravaStatus(data);
      }
    } catch (err) {
      console.error("Error fetching Strava status:", err);
    }
  }

  async function connectStrava() {
    try {
      const res = await authedFetch(`${API_URL}/strava/auth-url`);
      if (res.ok) {
        const data = await res.json();
        window.location.href = data.authUrl;
      } else {
        alert("Could not start Strava connection. Try again.");
      }
    } catch (err) {
      console.error("Error starting Strava connection:", err);
      alert("Error starting Strava connection.");
    }
  }

  async function syncStrava() {
    try {
      const res = await authedFetch(`${API_URL}/strava/sync`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        alert(data.message);
        fetchRuns();
      } else {
        alert("Sync failed. Try again.");
      }
    } catch (err) {
      console.error("Error syncing Strava:", err);
      alert("Sync error.");
    }
  }

  async function handleGeneratePlan(e) {
    e.preventDefault();
    setPlanLoading(true);
    try {
      const res = await authedFetch(`${API_URL}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...generateForm, unit })
      });
      if (res.ok) {
        setPlan(await res.json());
        setGenerateOpen(false);
        setGenerateForm({ goal: "", weeks: 4, daysPerWeek: 3, currentFitness: "" });
      } else {
        alert("Could not generate plan. Try again.");
      }
    } catch (err) {
      console.error("Error generating plan:", err);
      alert("Error generating plan.");
    } finally {
      setPlanLoading(false);
    }
  }

  async function toggleWorkout(workoutId, currentCompleted) {
    try {
      const res = await authedFetch(`${API_URL}/plan/workout`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: plan.planId, workoutId, completed: !currentCompleted })
      });
      if (res.ok) setPlan(await res.json());
    } catch (err) {
      console.error("Error toggling workout:", err);
    }
  }

  async function deletePlan() {
    if (!confirm("Delete your training plan? This cannot be undone.")) return;
    try {
      const res = await authedFetch(`${API_URL}/plan`, { method: "DELETE" });
      if (res.ok) setPlan(null);
    } catch (err) {
      console.error("Error deleting plan:", err);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setStatus("Saving...");
    try {
      const distanceNum = parseFloat(form.distance);
      const distanceInKm = unit === "mi" ? distanceNum / KM_TO_MI : distanceNum;
      const submitData = {
        ...form,
        distance: `${distanceInKm.toFixed(2)} km`
      };
      const res = await authedFetch(`${API_URL}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submitData)
      });
      if (res.ok) {
        setStatus("Run saved!");
        setForm({ title: "", date: "", distance: "", duration: "", notes: "" });
        fetchRuns();
      } else {
        setStatus("Error saving run.");
      }
    } catch (err) {
      console.error("Error saving run:", err);
      setStatus("Error saving run.");
    } finally {
      setLoading(false);
    }
  }

  function startEdit(run) {
    setEditingRunId(run.runId);
    const distanceKm = parseDistanceKm(run.distance);
    const distanceDisplay = unit === "mi" ? (distanceKm * KM_TO_MI).toFixed(2) : distanceKm.toFixed(2);
    setEditForm({
      title: run.title || "", date: run.date, distance: distanceDisplay, duration: run.duration, notes: run.notes || ""
    });
  }

  function cancelEdit() {
    setEditingRunId(null);
    setEditForm({ title: "", date: "", distance: "", duration: "", notes: "" });
  }

  async function saveEdit(runId) {
    try {
      const distanceNum = parseFloat(editForm.distance);
      const distanceInKm = unit === "mi" ? distanceNum / KM_TO_MI : distanceNum;
      const submitData = {
        ...editForm,
        distance: `${distanceInKm.toFixed(2)} km`
      };
      const res = await authedFetch(`${API_URL}/runs/${encodeURIComponent(runId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submitData)
      });
      if (res.ok) {
        setEditingRunId(null);
        fetchRuns();
      } else {
        alert("Could not save changes.");
      }
    } catch (err) {
      console.error("Error updating run:", err);
      alert("Error updating run.");
    }
  }

  async function deleteRun(runId) {
    if (!confirm("Delete this run? This cannot be undone.")) return;
    try {
      const res = await authedFetch(`${API_URL}/runs/${encodeURIComponent(runId)}`, { method: "DELETE" });
      if (res.ok) fetchRuns();
      else alert("Could not delete run.");
    } catch (err) {
      console.error("Error deleting run:", err);
      alert("Error deleting run.");
    }
  }

  async function handleCoachSubmit(e) {
    e.preventDefault();
    if (!coachInput.trim() || coachLoading) return;
    const userMessage = { role: "user", text: coachInput };
    setMessages(prev => [...prev, userMessage]);
    setCoachInput("");
    setCoachLoading(true);
    try {
      const res = await authedFetch(`${API_URL}/coach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage.text })
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(prev => [...prev, { role: "coach", text: data.reply }]);
      } else {
        setMessages(prev => [...prev, { role: "coach", text: "Sorry, I couldn't respond right now. Try again in a moment." }]);
      }
    } catch (err) {
      console.error("Coach error:", err);
      setMessages(prev => [...prev, { role: "coach", text: "Connection error. Check your internet and try again." }]);
    } finally {
      setCoachLoading(false);
    }
  }

  function toggleTheme() {
    setTheme(theme === "dark" ? "light" : "dark");
  }

  if (window.location.pathname === "/strava-callback") {
    return <StravaCallback />;
  }

  if (authState === "checking") {
    return <div className="auth-container"><div className="spinner"></div></div>;
  }

  if (authState === "unauthenticated") {
    return <Auth onAuthSuccess={() => checkAuth()} />;
  }

  const sortedRuns = [...runs].sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return b.runId.localeCompare(a.runId);
  });

  function renderRunCard(run) {
    if (editingRunId === run.runId) {
      return (
        <div key={run.runId} className="run-card editing">
          <form onSubmit={(e) => { e.preventDefault(); saveEdit(run.runId); }} className="run-form">
            <label>Title<input type="text" value={editForm.title} onChange={e => setEditForm({ ...editForm, title: e.target.value })} /></label>
            <label>Date<input type="date" required value={editForm.date} onChange={e => setEditForm({ ...editForm, date: e.target.value })} /></label>
            <label>Distance ({unit})<input type="text" required value={editForm.distance} onChange={e => setEditForm({ ...editForm, distance: e.target.value })} /></label>
            <label>Duration<input type="text" required value={editForm.duration} onChange={e => setEditForm({ ...editForm, duration: e.target.value })} /></label>
            <label>Notes<textarea rows={3} value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} /></label>
            <div className="edit-buttons">
              <button type="button" className="btn-secondary" onClick={cancelEdit}>Cancel</button>
              <button type="submit">Save</button>
            </div>
          </form>
        </div>
      );
    }

    const distanceKm = parseDistanceKm(run.distance);
    const minutes = parseDurationToMinutes(run.duration);
    const distanceDisplay = unit === "mi" ? distanceKm * KM_TO_MI : distanceKm;
    const paceMinPerUnit = distanceDisplay > 0 ? minutes / distanceDisplay : 0;

    return (
      <div key={run.runId} className="run-card">
        <div className="run-card-header">
          <div className="run-title">
            {run.title || "Untitled run"}
            {run.source === "strava" && <span className="strava-badge">Strava</span>}
          </div>
          <div className="run-card-actions">
            <button className="run-action" onClick={() => startEdit(run)}>Edit</button>
            <button className="run-action delete" onClick={() => deleteRun(run.runId)}>Delete</button>
          </div>
        </div>
        <div className="run-date-row">{run.date}</div>
        <div className="run-stats">
          <div className="run-stat"><div className="run-stat-label">Distance</div><div className="run-stat-value">{distanceDisplay.toFixed(2)} {unit}</div></div>
          <div className="run-stat"><div className="run-stat-label">Pace</div><div className="run-stat-value">{formatPace(paceMinPerUnit)}/{unit}</div></div>
          <div className="run-stat"><div className="run-stat-label">Time</div><div className="run-stat-value">{run.duration || "-"}</div></div>
        </div>
        {run.notes && <p className="run-notes">{run.notes}</p>}
      </div>
    );
  }

  function renderPlanPanel() {
    if (planLoading) {
      return (
        <section className="panel plan-panel">
          <h2>Training Plan</h2>
          <div className="plan-loading">
            <div className="spinner"></div>
            <p>Generating your plan… this can take 10-15 seconds.</p>
          </div>
        </section>
      );
    }

    if (generateOpen) {
      const distances = runs
        .map(r => parseDistanceKm(r.distance))
        .filter(d => d > 0);
      const avgDistance = distances.length > 0
        ? (distances.reduce((a, b) => a + b, 0) / distances.length)
        : 0;
      const longestDistance = distances.length > 0 ? Math.max(...distances) : 0;
      const avgDisplay = unit === "mi" ? (avgDistance * KM_TO_MI).toFixed(1) : avgDistance.toFixed(1);
      const longestDisplay = unit === "mi" ? (longestDistance * KM_TO_MI).toFixed(1) : longestDistance.toFixed(1);

      return (
        <section className="panel plan-panel">
          <h2>Generate Training Plan</h2>
          {runs.length > 0 ? (
            <div className="plan-context">
              <strong>Personalized for you:</strong> Based on your {runs.length} logged run{runs.length !== 1 ? "s" : ""} (avg {avgDisplay} {unit}, longest {longestDisplay} {unit}). Claude will calibrate the plan to your current ability.
            </div>
          ) : (
            <div className="plan-context plan-context-empty">
              <strong>No run history yet.</strong> Without logged runs, Claude will generate a beginner-friendly plan. For better personalization, log a few runs first.
            </div>
          )}
          <form onSubmit={handleGeneratePlan} className="run-form">
            <label>Goal<input type="text" placeholder="e.g. Run my first 5K" required value={generateForm.goal} onChange={e => setGenerateForm({ ...generateForm, goal: e.target.value })} /></label>
            <div className="plan-form-row">
              <label>Weeks<input type="number" min="2" max="12" required value={generateForm.weeks} onChange={e => setGenerateForm({ ...generateForm, weeks: parseInt(e.target.value) || 4 })} /></label>
              <label>Days per week<input type="number" min="2" max="6" required value={generateForm.daysPerWeek} onChange={e => setGenerateForm({ ...generateForm, daysPerWeek: parseInt(e.target.value) || 3 })} /></label>
            </div>
            <label>Current fitness (optional)<textarea placeholder="e.g. Beginner, can run 1km without stopping" rows={2} value={generateForm.currentFitness} onChange={e => setGenerateForm({ ...generateForm, currentFitness: e.target.value })} /></label>
            <div className="edit-buttons">
              <button type="button" className="btn-secondary" onClick={() => setGenerateOpen(false)}>Cancel</button>
              <button type="submit">Generate</button>
            </div>
          </form>
        </section>
      );
    }

    if (!plan) {
      return (
        <section className="panel plan-panel">
          <h2>Training Plan</h2>
          <p className="empty">No active plan. Let your AI coach build one tailored to your goal.</p>
          <button className="btn-primary" onClick={() => setGenerateOpen(true)}>Generate Plan</button>
        </section>
      );
    }

    const totalWorkouts = plan.weeks.reduce((sum, w) => sum + w.workouts.length, 0);
    const completedCount = plan.weeks.reduce((sum, w) => sum + w.workouts.filter(wk => wk.completed).length, 0);
    const progressPct = totalWorkouts > 0 ? Math.round((completedCount / totalWorkouts) * 100) : 0;

    return (
      <section className="panel plan-panel">
        <div className="plan-header">
          <div>
            <h2>{plan.title}</h2>
            <p className="plan-goal">{plan.goal}</p>
          </div>
          <button className="run-action delete" onClick={deletePlan}>Delete plan</button>
        </div>
        <div className="plan-progress">
          <div className="plan-progress-bar"><div className="plan-progress-fill" style={{ width: `${progressPct}%` }}></div></div>
          <div className="plan-progress-text">{completedCount} of {totalWorkouts} workouts complete ({progressPct}%)</div>
        </div>
        {plan.weeks.map(week => (
          <div key={week.week} className="plan-week">
            <h3>Week {week.week}</h3>
            <div className="plan-workouts">
              {week.workouts.map(workout => (
                <div key={workout.workoutId} className={`plan-workout type-${workout.type} ${workout.completed ? "completed" : ""}`}>
                  <input type="checkbox" checked={workout.completed} onChange={() => toggleWorkout(workout.workoutId, workout.completed)} className="workout-checkbox" />
                  <div className="workout-content">
                    <div className="workout-meta">
                      <span className="workout-day">{workout.day}</span>
                      <span className={`workout-type-badge type-${workout.type}`}>{workout.type}</span>
                    </div>
                    <div className="workout-description">{workout.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
    );
  }

  return (
    <div className="app">
      <div className="header">
        <h1>DailyGrit</h1>
        <div className="settings-wrapper">
          <button className="theme-toggle" onClick={() => setSettingsOpen(!settingsOpen)}>⚙ Settings</button>
          {settingsOpen && (
            <div className="settings-dropdown">
              <div className="settings-row">
                <span>Signed in as</span>
                <span className="settings-email">{userEmail}</span>
              </div>
              <div className="settings-row">
                <span>Theme</span>
                <button className="setting-pill" onClick={toggleTheme}>{theme === "dark" ? "☾ Dark" : "☀ Light"}</button>
              </div>
              <div className="settings-row">
                <span>Units</span>
                <div className="unit-toggle">
                  <button className={`unit-option ${unit === "km" ? "active" : ""}`} onClick={() => setUnit("km")}>km</button>
                  <button className={`unit-option ${unit === "mi" ? "active" : ""}`} onClick={() => setUnit("mi")}>mi</button>
                </div>
              </div>
              <div className="settings-row">
                <span>Strava</span>
                {stravaStatus.connected ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "flex-end" }}>
                    <span className="strava-connected">Connected as {stravaStatus.athleteName}</span>
                    <button className="setting-pill" onClick={syncStrava}>Sync now</button>
                  </div>
                ) : (
                  <button className="setting-pill" onClick={connectStrava}>Connect</button>
                )}
              </div>
              <div className="settings-row">
                <button className="logout-button" onClick={handleLogout}>Log out</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${activeTab === "dashboard" ? "active" : ""}`} onClick={() => setActiveTab("dashboard")}>Dashboard</button>
        <button className={`tab ${activeTab === "stats" ? "active" : ""}`} onClick={() => setActiveTab("stats")}>Stats</button>
        <button className={`tab ${activeTab === "pr" ? "active" : ""}`} onClick={() => setActiveTab("pr")}>Personal Best</button>
        <button className={`tab ${activeTab === "runs" ? "active" : ""}`} onClick={() => setActiveTab("runs")}>Runs</button>
        <button className={`tab ${activeTab === "coach" ? "active" : ""}`} onClick={() => setActiveTab("coach")}>Coach</button>
      </div>

      {activeTab === "dashboard" && renderPlanPanel()}

      {activeTab === "stats" && <Dashboard runs={runs} unit={unit} view="stats" />}

      {activeTab === "pr" && <Dashboard runs={runs} unit={unit} view="pr" />}

      {activeTab === "runs" && (
        <div className="layout single">
          <section className="panel">
            <h2>Log a Run</h2>
            <form onSubmit={handleSubmit} className="run-form">
              <label>Title (optional)<input type="text" placeholder="e.g. Morning recovery jog" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
              <label>Date<input type="date" required value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></label>
              <label>Distance ({unit})<input type="text" placeholder="e.g. 3.2" required value={form.distance} onChange={e => setForm({ ...form, distance: e.target.value })} /></label>
              <label>Duration<input type="text" placeholder="e.g. 28:45" required value={form.duration} onChange={e => setForm({ ...form, duration: e.target.value })} /></label>
              <label>Notes<textarea placeholder="How did it feel?" rows={3} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
              <button type="submit" disabled={loading}>{loading ? "Saving..." : "Log Run"}</button>
            </form>
            {status && <p className="status">{status}</p>}
            <h2>Past Runs ({runs.length})</h2>
            {runs.length === 0 ? <p className="empty">No runs yet. Log your first one above!</p> : <div className="runs-list">{sortedRuns.map(renderRunCard)}</div>}
          </section>
        </div>
      )}

      {activeTab === "coach" && (
        <div className="layout single">
          <section className="panel coach-panel">
            <h2>Coach</h2>
            <div className="coach-messages">
              {messages.map((m, i) => (
                <div key={i} className={`message ${m.role}`}>
                  <div className="message-bubble">{m.text}</div>
                </div>
              ))}
              {coachLoading && (
                <div className="message coach"><div className="message-bubble typing"><span></span><span></span><span></span></div></div>
              )}
              <div ref={messagesEndRef} />
            </div>
            <form onSubmit={handleCoachSubmit} className="coach-input-form">
              <input type="text" placeholder="Ask your coach..." value={coachInput} onChange={e => setCoachInput(e.target.value)} disabled={coachLoading} />
              <button type="submit" disabled={coachLoading || !coachInput.trim()}>Send</button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;