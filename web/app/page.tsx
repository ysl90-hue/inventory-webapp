"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { VersionHistory } from "@/components/version-history";
import {
  canUseCurrentSession,
  clearCurrentSessionMarker,
  CURRENT_SESSION_KEY,
  getShouldKeepLogin,
  KEEP_LOGIN_KEY,
  markCurrentSessionActive,
} from "@/lib/auth-session";

export default function LoginPage() {
  const SAVED_EMAIL_KEY = "inventory_saved_login_email";
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [session, setSession] = useState<Session | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authCheckTimedOut, setAuthCheckTimedOut] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rememberEmail, setRememberEmail] = useState(false);
  const [keepLogin, setKeepLogin] = useState(true);

  useEffect(() => {
    let mounted = true;
    const timer = setTimeout(() => {
      if (!mounted) return;
      setAuthCheckTimedOut(true);
      setAuthChecked(true);
    }, 2000);

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      clearTimeout(timer);
      try {
        const shouldKeepLogin = getShouldKeepLogin();
        setKeepLogin(shouldKeepLogin);
        const allowCurrentSession = canUseCurrentSession();
        if (!shouldKeepLogin && data.session && !allowCurrentSession) {
          void supabase.auth.signOut({ scope: "local" });
          clearCurrentSessionMarker();
          setSession(null);
        } else {
          setSession(data.session ?? null);
        }
      } catch {
        setSession(data.session ?? null);
      }
      setAuthChecked(true);
      setAuthCheckTimedOut(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      clearTimeout(timer);
      if (nextSession) {
        markCurrentSessionActive();
      } else {
        clearCurrentSessionMarker();
      }
      setSession(nextSession);
      setAuthChecked(true);
      setAuthCheckTimedOut(false);
    });

    return () => {
      mounted = false;
      clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (authChecked && session) {
      router.replace("/management");
    }
  }, [authChecked, session, router]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SAVED_EMAIL_KEY);
      if (saved) {
        setEmail(saved);
        setRememberEmail(true);
      }
    } catch {
      // ignore localStorage errors
    }
  }, []);

  async function readJsonOrText(res: Response) {
    const text = await res.text();
    try {
      return { json: JSON.parse(text) as Record<string, unknown>, raw: text };
    } catch {
      return { json: null, raw: text };
    }
  }

  async function signIn() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      });
      const { json, raw } = await readJsonOrText(res);
      const data = (json || {}) as {
        access_token?: string;
        refresh_token?: string;
        error?: string;
        msg?: string;
      };

      if (!res.ok) {
        setError(`로그인 실패: ${data.error || data.msg || raw.slice(0, 120) || `HTTP ${res.status}`}`);
      } else if (data.access_token && data.refresh_token) {
        try {
          window.localStorage.setItem(KEEP_LOGIN_KEY, keepLogin ? "true" : "false");
          if (keepLogin) {
            window.sessionStorage.removeItem(CURRENT_SESSION_KEY);
          }
          if (rememberEmail && email.trim()) {
            window.localStorage.setItem(SAVED_EMAIL_KEY, email.trim());
          } else {
            window.localStorage.removeItem(SAVED_EMAIL_KEY);
          }
        } catch {
          // ignore localStorage errors
        }
        const { error: setSessionError } = await supabase.auth.setSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
        });
        if (setSessionError) {
          setError(`세션 저장 실패: ${setSessionError.message}`);
        } else {
          markCurrentSessionActive();
          router.replace("/management");
        }
      } else {
        setError("로그인 응답에 세션 정보가 없습니다.");
      }
    } catch (e) {
      setError(`로그인 실패: ${e instanceof Error ? e.message : "Network error"}`);
    }
    setLoading(false);
  }

  async function signUp() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          displayName: displayName.trim(),
        }),
      });
      const { json, raw } = await readJsonOrText(res);
      const data = (json || {}) as {
        session?: { access_token: string; refresh_token: string } | null;
        error?: string;
        msg?: string;
      };

      if (!res.ok) {
        setError(`아이디 만들기 실패: ${data.error || data.msg || raw.slice(0, 120) || `HTTP ${res.status}`}`);
      } else if (data.session?.access_token && data.session?.refresh_token) {
        try {
          window.localStorage.setItem(KEEP_LOGIN_KEY, keepLogin ? "true" : "false");
          if (keepLogin) {
            window.sessionStorage.removeItem(CURRENT_SESSION_KEY);
          }
        } catch {
          // ignore localStorage errors
        }
        const { error: setSessionError } = await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
        if (setSessionError) {
          setError(`회원가입 후 세션 저장 실패: ${setSessionError.message}`);
        } else {
          markCurrentSessionActive();
          alert("아이디 생성이 완료되었습니다.");
          router.replace("/management");
        }
      } else {
        alert("이메일 인증 해주세요.");
      }
    } catch (e) {
      setError(`아이디 만들기 실패: ${e instanceof Error ? e.message : "Network error"}`);
    }
    setLoading(false);
  }

  async function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await signIn();
  }

  if (!authChecked || session) {
    return (
      <main className="page">
        <section className="panel">
          <h2>로그인 확인 중...</h2>
          <p className="meta">
            {authCheckTimedOut
              ? "세션 확인이 지연되어 로그인 화면을 준비합니다."
              : "세션을 확인하고 있습니다."}
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="header">
        <div>
          <h1 className="title">6호기 파트 관리 프로그램</h1>
        </div>
        <VersionHistory />
      </header>

      {error ? (
        <section className="panel" style={{ marginBottom: 16, borderColor: "#e7b4b4" }}>
          <strong>Error:</strong> {error}
        </section>
      ) : null}

      <section className="panel" style={{ maxWidth: 680, margin: "0 auto" }}>
        <h2>계정</h2>
        <form className="authStack" onSubmit={handleLoginSubmit}>
          <div className="authRow">
            <input
              className="input"
              type="text"
              placeholder="성명"
              value={displayName}
              autoComplete="off"
              name="inventory-display-name-field"
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="authRow">
            <input
              className="input"
              type="email"
              placeholder="아이디 (이메일)"
              value={email}
              autoComplete="off"
              name="inventory-email-field"
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className="input"
              type="password"
              placeholder="비밀번호"
              value={password}
              autoComplete="off"
              name="inventory-password-field"
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              spellCheck={false}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <label className="checkRow">
            <input
              type="checkbox"
              checked={rememberEmail}
              onChange={(e) => setRememberEmail(e.target.checked)}
            />
            <span>아이디 저장</span>
          </label>
          <label className="checkRow">
            <input
              type="checkbox"
              checked={keepLogin}
              onChange={(e) => setKeepLogin(e.target.checked)}
            />
            <span>로그인 유지</span>
          </label>
          <div className="actions">
            <button className="btn" type="submit" disabled={loading}>
              로그인
            </button>
            <button className="btn secondary" type="button" disabled={loading} onClick={() => void signUp()}>
              아이디 만들기
            </button>
          </div>
          <div className="meta">
            인증가능한 메일로 가입하고, 로그인 시 아이디(이메일), 비밀번호만 입력하면 로그인 가능합니다.
          </div>
        </form>
      </section>
    </main>
  );
}
