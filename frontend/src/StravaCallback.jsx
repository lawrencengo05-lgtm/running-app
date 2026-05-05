import { useEffect, useState } from "react";
import { fetchAuthSession } from "aws-amplify/auth";

const API_URL = "https://hktnpan365.execute-api.us-east-1.amazonaws.com";

function StravaCallback() {
  const [status, setStatus] = useState("processing");
  const [message, setMessage] = useState("Connecting to Strava...");

  async function handleCallback() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const error = params.get("error");

    if (error) {
      setStatus("error");
      setMessage(`Strava authorization was denied or cancelled.`);
      return;
    }

    if (!code) {
      setStatus("error");
      setMessage("No authorization code received from Strava.");
      return;
    }

    try {
      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString();

      const res = await fetch(`${API_URL}/strava/exchange`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ code })
      });

      if (res.ok) {
        const data = await res.json();
        setStatus("success");
        setMessage(`Successfully connected as ${data.athleteName}!`);
        setTimeout(() => {
          window.location.href = "/";
        }, 2000);
      } else {
        const errData = await res.json();
        setStatus("error");
        setMessage(`Connection failed: ${errData.error || "Unknown error"}`);
      }
    } catch (err) {
      console.error("Callback error:", err);
      setStatus("error");
      setMessage("Connection failed. Please try again.");
    }
  }
// eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    handleCallback();
  }, []);

  return (
    <div className="auth-container">
      <div className="auth-box">
        <h1>Strava Connection</h1>
        {status === "processing" && (
          <>
            <div className="spinner"></div>
            <p className="auth-subtitle">{message}</p>
          </>
        )}
        {status === "success" && (
          <>
            <p className="auth-subtitle" style={{ color: "var(--accent)" }}>{message}</p>
            <p className="auth-subtitle">Redirecting back to your app...</p>
          </>
        )}
        {status === "error" && (
          <>
            <p className="auth-subtitle">{message}</p>
            <button className="btn-primary" onClick={() => window.location.href = "/"}>
              Back to app
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default StravaCallback;