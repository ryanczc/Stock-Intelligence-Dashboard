import { supabase } from "../data/store";

export default function Login() {
  const signIn = () =>
    supabase!.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + window.location.pathname } });
  return (
    <main style={{ maxWidth: 420, marginTop: "12vh" }}>
      <div className="card stack" style={{ textAlign: "center" }}>
        <div className="brand" style={{ fontSize: 24 }}>
          Stock<span style={{ color: "var(--accent)" }}>Intel</span>
        </div>
        <p className="muted">Private portfolio terminal. Sign in with the Google account listed as the owner.</p>
        <button className="primary" onClick={signIn}>Sign in with Google</button>
      </div>
    </main>
  );
}
