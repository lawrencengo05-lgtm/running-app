import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

function parseDistance(distanceStr) {
  if (!distanceStr) return 0;
  const match = distanceStr.match(/[\d.]+/);
  return match ? parseFloat(match[0]) : 0;
}

function parseDurationToMinutes(durationStr) {
  if (!durationStr) return 0;
  const parts = durationStr.split(":").map(p => parseInt(p, 10));
  if (parts.length === 2) {
    return parts[0] + parts[1] / 60;
  }
  if (parts.length === 3) {
    return parts[0] * 60 + parts[1] + parts[2] / 60;
  }
  return 0;
}

function formatPace(paceMinPerUnit) {
  if (!paceMinPerUnit || isNaN(paceMinPerUnit) || !isFinite(paceMinPerUnit)) return "-";
  const min = Math.floor(paceMinPerUnit);
  const sec = Math.round((paceMinPerUnit - min) * 60);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function isWithinLastWeek(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return date >= oneWeekAgo;
}

const PR_BUCKETS = [
  { label: "Under 1K", min: 0, max: 1 },
  { label: "1-2K", min: 1, max: 2 },
  { label: "2-5K", min: 2, max: 5 },
  { label: "5-10K", min: 5, max: 10 },
  { label: "10K+", min: 10, max: Infinity }
];

function Dashboard({ runs, unit, view = "all" }) {
  if (!runs || runs.length === 0) {
    return (
      <section className="panel">
        <h2>{view === "pr" ? "Personal Bests" : "Stats"}</h2>
        <p className="empty">Log a run to see your data here.</p>
      </section>
    );
  }

  const KM_TO_MI = 0.621371;
  const unitLabel = unit === "mi" ? "mi" : "km";
  const conversion = unit === "mi" ? KM_TO_MI : 1;

  const enriched = runs.map(r => {
    const distanceKm = parseDistance(r.distance);
    const minutes = parseDurationToMinutes(r.duration);
    const distanceDisplay = distanceKm * conversion;
    const paceMinPerUnit = distanceDisplay > 0 ? minutes / distanceDisplay : 0;
    return {
      date: r.date,
      distanceKm,
      distanceDisplay,
      minutes,
      paceMinPerUnit
    };
  });

  const sorted = [...enriched].sort((a, b) => a.date.localeCompare(b.date));

  const totalRuns = enriched.length;
  const totalDistance = enriched.reduce((sum, r) => sum + r.distanceDisplay, 0);
  const longestRun = Math.max(...enriched.map(r => r.distanceDisplay));
  const thisWeekDistance = enriched
    .filter(r => isWithinLastWeek(r.date))
    .reduce((sum, r) => sum + r.distanceDisplay, 0);

  const prsByBucket = PR_BUCKETS.map(bucket => {
    const runsInBucket = enriched.filter(r =>
      r.distanceKm >= bucket.min && r.distanceKm < bucket.max
    );
    if (runsInBucket.length === 0) return { label: bucket.label, pr: null };
    const fastest = runsInBucket.reduce((best, r) =>
      r.paceMinPerUnit < best.paceMinPerUnit ? r : best
    );
    return { label: bucket.label, pr: fastest };
  }).filter(b => b.pr !== null);

  if (view === "pr") {
    return (
      <section className="panel dashboard">
        <h2>Personal Bests</h2>
        {prsByBucket.length === 0 ? (
          <p className="empty">Log more runs to see your PRs.</p>
        ) : (
          <div className="pr-list">
            {prsByBucket.map(b => (
              <div key={b.label} className="pr-row">
                <div className="pr-bucket">{b.label}</div>
                <div className="pr-pace">{formatPace(b.pr.paceMinPerUnit)}/{unitLabel}</div>
                <div className="pr-date">{b.pr.date}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="panel dashboard">
      <h2>Stats</h2>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Total runs</div>
          <div className="stat-value">{totalRuns}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">This week</div>
          <div className="stat-value">{thisWeekDistance.toFixed(1)} {unitLabel}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total distance</div>
          <div className="stat-value">{totalDistance.toFixed(1)} {unitLabel}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Longest run</div>
          <div className="stat-value">{longestRun.toFixed(1)} {unitLabel}</div>
        </div>
      </div>

      <div className="chart-section">
        <h3>Distance over time</h3>
        <div className="chart-wrapper">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={sorted} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--text-secondary)" }} unit={` ${unitLabel}`} />
              <Tooltip
                formatter={(value) => `${value.toFixed(2)} ${unitLabel}`}
                contentStyle={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: "6px", fontSize: "12px" }}
              />
              <Line type="monotone" dataKey="distanceDisplay" stroke="var(--accent)" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="chart-section">
        <h3>Pace trend (lower is faster)</h3>
        <div className="chart-wrapper">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={sorted} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--text-secondary)" }} tickFormatter={v => formatPace(v)} width={70} />
              <Tooltip
                formatter={(value) => `${formatPace(value)}/${unitLabel}`}
                contentStyle={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: "6px", fontSize: "12px" }}
              />
              <Line type="monotone" dataKey="paceMinPerUnit" stroke="var(--accent)" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}

export default Dashboard;