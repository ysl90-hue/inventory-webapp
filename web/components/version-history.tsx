"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { APP_VERSION, RELEASE_NOTES, RELEASE_NOTES_FORCE_OPEN_KEY } from "@/lib/app-version";

type VersionHistoryProps = {
  compact?: boolean;
  autoOpenOnMount?: boolean;
  showTrigger?: boolean;
};

const RELEASE_NOTES_DISMISS_KEY = "inventory_release_notes_dismissed_date";

function getTodayKey() {
  const date = new Date();
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return adjusted.toISOString().slice(0, 10);
}

export function VersionHistory({
  compact = false,
  autoOpenOnMount = false,
  showTrigger = true,
}: VersionHistoryProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !autoOpenOnMount) return;

    try {
      const forcedVersion = window.localStorage.getItem(RELEASE_NOTES_FORCE_OPEN_KEY);
      if (forcedVersion === APP_VERSION) {
        setOpen(true);
        return;
      }
      const dismissedDate = window.localStorage.getItem(RELEASE_NOTES_DISMISS_KEY);
      if (dismissedDate === getTodayKey()) return;
    } catch {
      // ignore localStorage errors
    }

    setOpen(true);
  }, [autoOpenOnMount, mounted]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeModal();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  function dismissForToday() {
    try {
      window.localStorage.setItem(RELEASE_NOTES_DISMISS_KEY, getTodayKey());
      window.localStorage.removeItem(RELEASE_NOTES_FORCE_OPEN_KEY);
    } catch {
      // ignore localStorage errors
    }
    setOpen(false);
  }

  function closeModal() {
    try {
      window.localStorage.removeItem(RELEASE_NOTES_FORCE_OPEN_KEY);
    } catch {
      // ignore localStorage errors
    }
    setOpen(false);
  }

  return (
    <>
      <div className={`versionInfo ${compact ? "compact" : ""}`}>
        <span className="versionBadge">버전 {APP_VERSION}</span>
        {showTrigger ? (
          <button className="versionLink" type="button" onClick={() => setOpen(true)}>
            업데이트 내역
          </button>
        ) : null}
      </div>

      {mounted && open
        ? createPortal(
            <div
              className="scannerOverlay releaseOverlay"
              role="dialog"
              aria-modal="true"
              aria-label="업데이트 내역"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  closeModal();
                }
              }}
            >
              <div className="scannerModal releaseModal">
                <div className="adminHeaderRow" style={{ marginBottom: 8 }}>
                  <div>
                    <h2 style={{ margin: 0 }}>업데이트 내역</h2>
                    <div className="meta" style={{ marginTop: 4 }}>
                      현재 버전 {APP_VERSION}
                    </div>
                  </div>
                  <div className="actions">
                    <button className="btn secondary small" type="button" onClick={dismissForToday}>
                      오늘은 보지 않기
                    </button>
                    <button className="btn secondary small" type="button" onClick={closeModal}>
                      닫기
                    </button>
                  </div>
                </div>
                <div className="helpIntro">
                  최근 반영된 변경사항을 간단히 확인할 수 있습니다.
                </div>
                <div className="releaseList">
                  {RELEASE_NOTES.map((note) => (
                    <section key={note.version} className="releaseCard">
                      <div className="releaseHead">
                        <div>
                          <h3>{note.version}</h3>
                          <div className="meta">{note.date}</div>
                        </div>
                        <span className="statusPill ready">적용됨</span>
                      </div>
                      <p className="releaseSummary">{note.summary}</p>
                      <ul className="helpList">
                        {note.items.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
