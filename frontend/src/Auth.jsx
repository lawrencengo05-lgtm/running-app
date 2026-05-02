import { useState } from "react";
import { signUp, confirmSignUp, signIn, resendSignUpCode } from "aws-amplify/auth";

function Auth({ onAuthSuccess }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmationCode, setConfirmationCode] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSignUp(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signUp({
        username: email,
        password,
        options: {
          userAttributes: { email }
        }
      });
      setPendingEmail(email);
      setMode("confirm");
    } catch (err) {
      setError(err.message || "Sign up failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await confirmSignUp({
        username: pendingEmail,
        confirmationCode
      });
      // Auto-login after confirmation
      await signIn({ username: pendingEmail, password });
      onAuthSuccess();
    } catch (err) {
      setError(err.message || "Confirmation failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signIn({ username: email, password });
      onAuthSuccess();
    } catch (err) {
      if (err.name === "UserNotConfirmedException") {
        setPendingEmail(email);
        setMode("confirm");
        setError("Please verify your email first. Check for the code.");
      } else {
        setError(err.message || "Login failed");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResendCode() {
    setError("");
    try {
      await resendSignUpCode({ username: pendingEmail });
      setError("New code sent — check your email.");
    } catch (err) {
      setError(err.message || "Could not resend code");
    }
  }

  if (mode === "confirm") {
    return (
      <div className="auth-container">
        <div className="auth-box">
          <h1>Verify Your Email</h1>
          <p className="auth-subtitle">We sent a code to {pendingEmail}</p>
          <form onSubmit={handleConfirm}>
            <label>
              Confirmation code
              <input
                type="text"
                value={confirmationCode}
                onChange={e => setConfirmationCode(e.target.value)}
                required
                autoFocus
              />
            </label>
            {error && <div className="auth-error">{error}</div>}
            <button type="submit" disabled={loading}>
              {loading ? "Verifying..." : "Verify"}
            </button>
          </form>
          <p className="auth-link">
            Didn't get a code? <button type="button" className="link-button" onClick={handleResendCode}>Resend</button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-box">
        <h1>{mode === "login" ? "Sign In" : "Create Account"}</h1>
        <p className="auth-subtitle">My Running Log</p>
        <form onSubmit={mode === "login" ? handleLogin : handleSignUp}>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </label>
          {mode === "signup" && (
            <p className="auth-hint">Password must be at least 8 characters with uppercase, lowercase, and a number.</p>
          )}
          {error && <div className="auth-error">{error}</div>}
          <button type="submit" disabled={loading}>
            {loading ? "Loading..." : mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>
        <p className="auth-link">
          {mode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
          <button
            type="button"
            className="link-button"
            onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}
          >
            {mode === "login" ? "Sign up" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}

export default Auth;