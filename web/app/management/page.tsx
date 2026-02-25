"use client";

import { FormEvent, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { Part, StockTransaction } from "@/lib/types";

type TxForm = {
  itemNumber: string;
  txType: "IN" | "OUT";
  qty: string;
  memo: string;
};

type PartForm = {
  id: string | null;
  itemNumber: string;
  designation: string;
  quantity: string;
  unitOfQuantity: string;
  currentStock: string;
  minimumStock: string;
  location: string;
};

const EMPTY_PART_FORM: PartForm = {
  id: null,
  itemNumber: "",
  designation: "",
  quantity: "0",
  unitOfQuantity: "",
  currentStock: "0",
  minimumStock: "0",
  location: "",
};

function parseLocation(location: string | null | undefined) {
  const raw = (location || "").trim();
  if (!raw) return "";
  if (raw.toUpperCase().includes("BLOWER")) return "BLOWER";
  if (raw.toUpperCase().includes("FILLER")) return "FILLER";
  return raw.toUpperCase();
}

function buildLocation(location: string) {
  const normalized = location.trim().toUpperCase();
  if (normalized === "FILLER" || normalized === "BLOWER") {
    return normalized;
  }
  return normalized || null;
}

export default function HomePage() {
  const KEEP_LOGIN_KEY = "inventory_keep_login";
  const GLOBAL_MIN_STOCK_KEY = "inventory_global_min_stock";
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [parts, setParts] = useState<Part[]>([]);
  const [txHistory, setTxHistory] = useState<StockTransaction[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [showLowOnly, setShowLowOnly] = useState(false);
  const [partsSort, setPartsSort] = useState<"item" | "stockAsc" | "stockDesc" | "designation">("item");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  const [txForm, setTxForm] = useState<TxForm>({
    itemNumber: "",
    txType: "IN",
    qty: "",
    memo: "",
  });
  const [partForm, setPartForm] = useState<PartForm>(EMPTY_PART_FORM);
  const [savingPart, setSavingPart] = useState(false);

  const [session, setSession] = useState<Session | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authDisplayNameInput, setAuthDisplayNameInput] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authRole, setAuthRole] = useState<"user" | "admin" | null>(null);
  const [authDisplayName, setAuthDisplayName] = useState<string | null>(null);
  const [adminToolsOpen, setAdminToolsOpen] = useState(false);
  const [txToolsOpen, setTxToolsOpen] = useState(true);
  const [globalMinimumStock, setGlobalMinimumStock] = useState("0");
  const [authChecked, setAuthChecked] = useState(false);
  const [authCheckTimedOut, setAuthCheckTimedOut] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerTarget, setScannerTarget] = useState<"tx" | "part">("tx");
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [scannerStatus, setScannerStatus] = useState<string>("카메라를 준비합니다...");
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const [scannerPendingValue, setScannerPendingValue] = useState<string | null>(null);
  const [scannerTorchSupported, setScannerTorchSupported] = useState(false);
  const [scannerTorchOn, setScannerTorchOn] = useState(false);
  const scannerVideoRef = useRef<HTMLVideoElement | null>(null);
  const scannerStreamRef = useRef<MediaStream | null>(null);
  const scannerControlsRef = useRef<{ stop: () => void } | null>(null);
  const scannerCloseTimerRef = useRef<number | null>(null);
  const scannerLastAcceptedRef = useRef<{ value: string; at: number } | null>(null);
  const scannerPendingValueRef = useRef<string | null>(null);

  const isAdmin = authRole === "admin";
  const deferredSearchInput = useDeferredValue(searchInput);

  function stopScannerResources() {
    if (scannerCloseTimerRef.current) {
      window.clearTimeout(scannerCloseTimerRef.current);
      scannerCloseTimerRef.current = null;
    }
    if (scannerControlsRef.current) {
      scannerControlsRef.current.stop();
      scannerControlsRef.current = null;
    }
    if (scannerStreamRef.current) {
      scannerStreamRef.current.getTracks().forEach((track) => track.stop());
      scannerStreamRef.current = null;
    }
    const video = scannerVideoRef.current;
    if (video?.srcObject && "getTracks" in video.srcObject) {
      (video.srcObject as MediaStream).getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    }
    setScannerTorchOn(false);
    setScannerTorchSupported(false);
  }

  function showSuccessToast(message: string) {
    setSuccessToast(message);
  }

  function triggerScannerSuccessFeedback() {
    try {
      if (navigator.vibrate) {
        navigator.vibrate(40);
      }
    } catch {
      // ignore vibration errors
    }

    try {
      const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return;
      const ctx = new AudioContextCtor();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 1046;
      gain.gain.value = 0.03;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.06);
      window.setTimeout(() => void ctx.close().catch(() => undefined), 120);
    } catch {
      // ignore audio feedback errors
    }
  }

  function detectTorchSupportFromVideo() {
    const video = scannerVideoRef.current;
    const stream = (video?.srcObject as MediaStream | null) ?? scannerStreamRef.current;
    const track = stream?.getVideoTracks()?.[0];
    if (!track || typeof track.getCapabilities !== "function") {
      setScannerTorchSupported(false);
      return;
    }
    const caps = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean };
    setScannerTorchSupported(Boolean(caps.torch));
  }

  async function toggleScannerTorch() {
    if (!scannerTorchSupported) {
      setScannerError("이 기기/브라우저는 손전등 제어를 지원하지 않습니다.");
      return;
    }
    const next = !scannerTorchOn;
    const video = scannerVideoRef.current;
    const stream = (video?.srcObject as MediaStream | null) ?? scannerStreamRef.current;
    const track = stream?.getVideoTracks()?.[0];
    if (!track) return;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet & { torch?: boolean }],
      });
      setScannerTorchOn(next);
      setScannerStatus(next ? "손전등 켜짐" : "손전등 꺼짐");
    } catch {
      setScannerError("손전등 제어를 지원하지 않는 카메라입니다.");
      setScannerTorchSupported(false);
    }
  }

  async function readJsonOrText(res: Response) {
    const text = await res.text();
    try {
      return { json: JSON.parse(text) as Record<string, unknown>, raw: text };
    } catch {
      return { json: null, raw: text };
    }
  }

  async function loadData() {
    setLoading(true);
    setError(null);

    try {
      const [partsRes, txRes] = await Promise.all([
        fetch("/api/parts", { cache: "no-store" }),
        fetch("/api/transactions", {
          cache: "no-store",
          headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
        }),
      ]);

      const partsJson = (await partsRes.json()) as { data?: Part[]; error?: string };
      const txJson = (await txRes.json()) as { data?: StockTransaction[]; error?: string };

      if (!partsRes.ok || !txRes.ok) {
        setError(partsJson.error || txJson.error || "Failed to load data");
      } else {
        setParts(partsJson.data || []);
        setTxHistory(txJson.data || []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadData();
  }, [session?.access_token]);

  useEffect(() => {
    let mounted = true;
    const timer = setTimeout(() => {
      if (!mounted) return;
      setAuthCheckTimedOut(true);
      setAuthChecked(true);
      setSession(null);
      window.location.replace("/");
    }, 2000);

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      clearTimeout(timer);
      try {
        const shouldKeepLogin = window.localStorage.getItem(KEEP_LOGIN_KEY) !== "false";
        if (!shouldKeepLogin && data.session) {
          void supabase.auth.signOut({ scope: "local" });
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
    if (authChecked && !session) {
      router.replace("/");
    }
  }, [authChecked, session, router]);

  useEffect(() => {
    if (authChecked && !session) {
      const forceRedirect = setTimeout(() => {
        window.location.replace("/");
      }, 800);
      return () => clearTimeout(forceRedirect);
    }
  }, [authChecked, session]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const apply = () => setIsMobileLayout(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(deferredSearchInput.trim());
    }, 180);
    return () => window.clearTimeout(timer);
  }, [deferredSearchInput]);

  useEffect(() => {
    scannerPendingValueRef.current = scannerPendingValue;
  }, [scannerPendingValue]);

  useEffect(() => {
    if (!successToast) return;
    const timer = window.setTimeout(() => setSuccessToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [successToast]);

  useEffect(() => {
    if (!isMobileLayout) {
      setTxToolsOpen(true);
    }
  }, [isMobileLayout]);

  useEffect(() => {
    async function loadMe() {
      if (!session?.access_token) {
        setAuthRole(null);
        setAuthDisplayName(null);
        return;
      }

      try {
        const res = await fetch("/api/me", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const json = (await res.json()) as {
          data?: { role: "user" | "admin"; email: string | null; displayName?: string | null };
          error?: string;
        };

        if (!res.ok) {
          setAuthRole("user");
          setAuthDisplayName(session.user.email?.split("@")[0] ?? null);
          return;
        }

        setAuthRole(json.data?.role ?? "user");
        setAuthDisplayName(
          json.data?.displayName || json.data?.email?.split("@")[0] || session.user.email?.split("@")[0] || null,
        );
      } catch {
        setAuthRole("user");
        setAuthDisplayName(session.user.email?.split("@")[0] ?? null);
      }
    }

    void loadMe();
  }, [session]);

  useEffect(() => {
    if (!scannerOpen) {
      setScannerError(null);
      setScannerStatus("카메라를 준비합니다...");
      setScannerPendingValue(null);
      stopScannerResources();
      return;
    }

    let cancelled = false;
    let scanTimerId = 0;

    async function startScanner() {
      const video = scannerVideoRef.current;
      const BarcodeDetectorCtor = (window as unknown as {
        BarcodeDetector?: new (opts?: { formats?: string[] }) => {
          detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
        };
      }).BarcodeDetector;
      const scannerFormats = ["code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e"];
      const isMobile = window.matchMedia("(max-width: 900px)").matches;
      const videoConstraints: MediaTrackConstraints = {
        facingMode: { ideal: "environment" },
        width: { ideal: isMobile ? 960 : 1280 },
        height: { ideal: isMobile ? 540 : 720 },
        frameRate: { ideal: isMobile ? 24 : 30, max: isMobile ? 30 : 60 },
      };
      const nativeScanIntervalMs = isMobile ? 220 : 160;
      const duplicateCooldownMs = 1400;

      if (!video) {
        setScannerError("카메라 미리보기 초기화에 실패했습니다.");
        return;
      }

      const applyScannedValue = (raw: string) => {
        const scanned = raw.toUpperCase();
        const now = Date.now();
        const last = scannerLastAcceptedRef.current;
        if (last && last.value === scanned && now - last.at < duplicateCooldownMs) {
          return;
        }
        scannerLastAcceptedRef.current = { value: scanned, at: now };
        triggerScannerSuccessFeedback();
        setScannerPendingValue(scanned);
        setScannerStatus(`인식됨(확인 필요): ${raw}`);
        stopScannerResources();
      };

      const startZxingFallback = async (status = "호환 모드로 카메라를 시작합니다...") => {
        setScannerError(null);
        setScannerStatus(status);
        const zxing = (await import("@zxing/browser")) as {
          BrowserMultiFormatReader: new () => {
            decodeFromConstraints: (
              constraints: MediaStreamConstraints,
              previewElem: HTMLVideoElement,
              callbackFn: (result: { getText: () => string } | null, error?: unknown) => void,
            ) => Promise<{ stop: () => void }>;
          };
        };
        const reader = new zxing.BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints(
          { video: videoConstraints, audio: false },
          video,
          (result) => {
            if (cancelled || !result) return;
            const raw = result.getText().trim();
            if (!raw) return;
            applyScannedValue(raw);
            scannerControlsRef.current?.stop();
            scannerControlsRef.current = null;
          },
        );
        if (cancelled) {
          controls.stop();
          return;
        }
        scannerControlsRef.current = controls;
        setScannerStatus(isMobile ? "바코드를 가까이 비추고 화면 중앙에 맞춰주세요." : "바코드를 화면 중앙에 맞춰주세요.");
        window.setTimeout(detectTorchSupportFromVideo, 400);
      };

      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("이 브라우저는 카메라 접근을 지원하지 않습니다.");
        }

        if (BarcodeDetectorCtor) {
          const detector = new BarcodeDetectorCtor({ formats: scannerFormats });
          const stream = await navigator.mediaDevices.getUserMedia({
            video: videoConstraints,
            audio: false,
          });
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          scannerStreamRef.current = stream;
          video.srcObject = stream;
          await video.play();
          detectTorchSupportFromVideo();
          setScannerStatus(isMobile ? "바코드를 가까이 비추고 화면 중앙에 맞춰주세요." : "바코드를 화면 중앙에 맞춰주세요.");

          let lastScanAt = 0;
          const scanLoop = async () => {
            if (cancelled || !scannerOpen) return;
            if (scannerPendingValueRef.current) return;

            if (document.visibilityState === "hidden" || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
              scanTimerId = window.setTimeout(scanLoop, nativeScanIntervalMs);
              return;
            }

            const now = performance.now();
            if (now - lastScanAt < nativeScanIntervalMs) {
              scanTimerId = window.setTimeout(scanLoop, nativeScanIntervalMs - (now - lastScanAt));
              return;
            }
            lastScanAt = now;

            try {
              const barcodes = await detector.detect(video);
              if (barcodes.length > 0) {
                const raw = (barcodes[0].rawValue || "").trim();
                if (raw) {
                  applyScannedValue(raw);
                  return;
                }
              }
            } catch {
              // ignore intermittent detection errors
            }
            scanTimerId = window.setTimeout(scanLoop, nativeScanIntervalMs);
          };
          scanTimerId = window.setTimeout(scanLoop, nativeScanIntervalMs);
          return;
        }

        await startZxingFallback();
      } catch (e) {
        if (BarcodeDetectorCtor) {
          try {
            await startZxingFallback("기본 스캐너가 불안정하여 호환 모드로 전환합니다...");
            return;
          } catch {
            // keep original error below
          }
        }
        const message = e instanceof Error ? e.message : "스캔 초기화 실패";
        if (/permission|denied|NotAllowed/i.test(message)) {
          setScannerError("카메라 권한이 필요합니다. 브라우저 권한 설정에서 허용해주세요.");
        } else {
          setScannerError(message);
        }
      }
    }

    void startScanner();

    return () => {
      cancelled = true;
      if (scanTimerId) window.clearTimeout(scanTimerId);
      stopScannerResources();
    };
  }, [scannerOpen, scannerTarget]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(GLOBAL_MIN_STOCK_KEY);
      if (saved !== null) {
        setGlobalMinimumStock(saved);
      }
    } catch {
      // ignore localStorage errors
    }
  }, []);

  const filteredParts = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (keyword.length === 0) {
      return [];
    }
    const globalMin = Number(globalMinimumStock || 0);
    const filtered = parts.filter((part) => {
      const hit =
        part.item_number.toLowerCase().includes(keyword) ||
        part.designation.toLowerCase().includes(keyword);
      const low = Number(part.current_stock) <= globalMin;
      return hit && (!showLowOnly || low);
    });
    filtered.sort((a, b) => {
      if (partsSort === "stockAsc") {
        return Number(a.current_stock) - Number(b.current_stock);
      }
      if (partsSort === "stockDesc") {
        return Number(b.current_stock) - Number(a.current_stock);
      }
      if (partsSort === "designation") {
        return a.designation.localeCompare(b.designation);
      }
      return a.item_number.localeCompare(b.item_number);
    });
    return filtered;
  }, [parts, search, showLowOnly, globalMinimumStock, partsSort]);

  function submitSearch() {
    setSearch(searchInput.trim());
  }

  function clearSearch() {
    setSearchInput("");
    setSearch("");
  }

  function saveGlobalMinimumStock() {
    try {
      window.localStorage.setItem(GLOBAL_MIN_STOCK_KEY, globalMinimumStock || "0");
      showSuccessToast(`최소 재고 기준 저장 완료 (${globalMinimumStock || "0"})`);
    } catch {
      // ignore localStorage errors
    }
  }

  async function signIn() {
    setError(null);
    setAuthLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: authEmail.trim(),
          password: authPassword,
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
        setError(
          `로그인 실패: ${data.error || data.msg || raw.slice(0, 120) || `HTTP ${res.status}`}`,
        );
      } else if (data.access_token && data.refresh_token) {
        const { error: setSessionError } = await supabase.auth.setSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
        });
        if (setSessionError) {
          setError(`세션 저장 실패: ${setSessionError.message}`);
        }
      } else {
        setError("로그인 응답에 세션 정보가 없습니다.");
      }
    } catch (e) {
      setError(`로그인 실패: ${e instanceof Error ? e.message : "Network error"}`);
    }
    setAuthLoading(false);
  }

  async function signUp() {
    setError(null);
    setAuthLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: authEmail.trim(),
          password: authPassword,
          displayName: authDisplayNameInput.trim(),
        }),
      });
      const { json, raw } = await readJsonOrText(res);
      const data = (json || {}) as {
        user?: { id: string; email?: string | null } | null;
        session?: { access_token: string; refresh_token: string } | null;
        error?: string;
        msg?: string;
      };
      if (!res.ok) {
        setError(
          `회원가입 실패: ${data.error || data.msg || raw.slice(0, 120) || `HTTP ${res.status}`}`,
        );
      } else if (data.session?.access_token && data.session?.refresh_token) {
        const { error: setSessionError } = await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
        if (setSessionError) {
          setError(`회원가입 후 세션 저장 실패: ${setSessionError.message}`);
        }
        alert("아이디 생성이 완료되었습니다.");
      } else {
        alert("이메일 인증 해주세요.");
      }
    } catch (e) {
      setError(`회원가입 실패: ${e instanceof Error ? e.message : "Network error"}`);
    }
    setAuthLoading(false);
  }

  async function signOut() {
    setError(null);
    await supabase.auth.signOut({ scope: "local" });
    setAuthRole(null);
    setAuthDisplayName(null);
  }

  async function submitTx(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const qty = Number(txForm.qty);
    const normalizedItemNumber = txForm.itemNumber.trim().toUpperCase();
    if (!normalizedItemNumber || !Number.isFinite(qty) || qty <= 0) {
      setError("품목번호와 수량을 정확히 입력하세요.");
      return;
    }

    const res = await fetch("/api/stock", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({
        itemNumber: normalizedItemNumber,
        txType: txForm.txType,
        qty,
        memo: txForm.memo.trim() || null,
      }),
    });

    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok) {
      setError(json.error || "입출고 처리에 실패했습니다.");
      return;
    }

    setTxForm({ itemNumber: "", txType: "IN", qty: "", memo: "" });
    showSuccessToast(`${txForm.txType === "IN" ? "입고" : "출고"} 처리 완료`);
    await loadData();
  }

  function openScanner(target: "tx" | "part") {
    setScannerError(null);
    setScannerPendingValue(null);
    setScannerTarget(target);
    setScannerOpen(true);
  }

  function applyScannerPendingValue() {
    if (!scannerPendingValue) return;
    if (scannerTarget === "tx") {
      setTxForm((v) => ({ ...v, itemNumber: scannerPendingValue }));
    } else {
      setPartForm((v) => ({ ...v, itemNumber: scannerPendingValue }));
    }
    setScannerOpen(false);
  }

  function rescanScannerValue() {
    setScannerPendingValue(null);
    setScannerError(null);
    setScannerStatus("바코드를 다시 스캔해주세요.");
    setScannerOpen(false);
    window.setTimeout(() => setScannerOpen(true), 60);
  }

  function editPart(part: Part) {
    setPartForm({
      id: part.id,
      itemNumber: part.item_number,
      designation: part.designation,
      quantity: String(part.quantity ?? 0),
      unitOfQuantity: part.unit_of_quantity || "",
      currentStock: String(part.current_stock ?? 0),
      minimumStock: String(part.minimum_stock ?? 0),
      location: parseLocation(part.location),
    });
    setError(null);
  }

  function resetPartForm() {
    setPartForm(EMPTY_PART_FORM);
  }

  async function submitPart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!session?.access_token) {
      setError("관리자 로그인 후 사용하세요.");
      return;
    }

    setSavingPart(true);

    const payload = {
      item_number: partForm.itemNumber.trim().toUpperCase(),
      designation: partForm.designation.trim(),
      quantity: Number(partForm.quantity || 0),
      unit_of_quantity: partForm.unitOfQuantity || null,
      current_stock: Number(partForm.currentStock || 0),
      minimum_stock: Number(globalMinimumStock || 0),
      location: buildLocation(partForm.location),
    };

    if (!payload.item_number || !payload.designation) {
      setError("품목 등록/수정에는 품목번호와 품명이 필요합니다.");
      setSavingPart(false);
      return;
    }

    const target = partForm.id ? `/api/parts/${partForm.id}` : "/api/parts";
    const method = partForm.id ? "PATCH" : "POST";

    try {
      const res = await fetch(target, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error || "품목 저장에 실패했습니다.");
        return;
      }
      resetPartForm();
      showSuccessToast(partForm.id ? "품목 수정 완료" : "품목 등록 완료");
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "품목 저장에 실패했습니다.");
    } finally {
      setSavingPart(false);
    }
  }

  async function deletePart(part: Part) {
    if (!session?.access_token) {
      setError("관리자 로그인 후 사용하세요.");
      return;
    }

    const confirmed = window.confirm(
      `${part.item_number} (${part.designation}) 품목을 삭제하시겠습니까?\n관련 이력도 함께 삭제될 수 있습니다.`,
    );
    if (!confirmed) return;

    setError(null);
    try {
      const res = await fetch(`/api/parts/${part.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error || "품목 삭제에 실패했습니다.");
        return;
      }
      if (partForm.id === part.id) {
        resetPartForm();
      }
      showSuccessToast("품목 삭제 완료");
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "품목 삭제에 실패했습니다.");
    }
  }

  const lowCount = parts.filter(
    (part) => Number(part.current_stock) <= Number(globalMinimumStock || 0),
  ).length;

  if (!authChecked || !session) {
    return (
      <main className="page">
        <section className="panel">
          <h2>로그인 확인 중...</h2>
          <p className="meta">
            {authCheckTimedOut
              ? "세션 확인이 지연되어 로그인 화면으로 이동합니다."
              : "매니지먼트 화면 접근을 확인하고 있습니다."}
          </p>
          <div className="actions" style={{ marginTop: 10 }}>
            <button className="btn secondary" type="button" onClick={() => window.location.replace("/")}>
              로그인 화면으로 이동
            </button>
          </div>
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
        <div className="meta">
          {loading ? "Loading..." : `Total ${parts.length} / Low stock ${lowCount}`}
        </div>
      </header>

      <section className="statsGrid" aria-label="요약 정보">
        <div className="statCard">
          <div className="meta">전체 품목</div>
          <div className="statValue">{parts.length}</div>
        </div>
        <div className="statCard">
          <div className="meta">부족 재고</div>
          <div className={`statValue ${lowCount > 0 ? "low" : ""}`}>{lowCount}</div>
        </div>
        <div className="statCard">
          <div className="meta">레이아웃</div>
          <div className="statValue">{isMobileLayout ? "Mobile" : "Desktop"}</div>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 14 }}>
        <h2>계정</h2>
        <div className="authBox" style={{ border: "none", padding: 0, background: "transparent" }}>
          <div className="authRow">
            <div className="meta">
              {authDisplayName || session.user.email?.split("@")[0] || "Logged in"} {"·"}{" "}
              <strong>{isAdmin ? "ADMIN" : "USER"}</strong>
            </div>
            <button className="btn secondary small" type="button" onClick={() => void signOut()}>
              로그아웃
            </button>
          </div>
        </div>
      </section>

      <section className="toolbarPanel panel" aria-label="검색 및 필터">
        <div className="toolbarSearch">
          <input
            className="input"
            placeholder="Search item_number / designation"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitSearch();
              }
            }}
          />
          <button className="btn" type="button" onClick={submitSearch}>
            검색
          </button>
        </div>
        <div className="filterChips" aria-label="정렬">
          <button
            className={`btn secondary small ${partsSort === "item" ? "activeChoice" : ""}`}
            type="button"
            onClick={() => setPartsSort("item")}
          >
            품목번호순
          </button>
          <button
            className={`btn secondary small ${partsSort === "designation" ? "activeChoice" : ""}`}
            type="button"
            onClick={() => setPartsSort("designation")}
          >
            품명순
          </button>
          <button
            className={`btn secondary small ${partsSort === "stockAsc" ? "activeChoice" : ""}`}
            type="button"
            onClick={() => setPartsSort("stockAsc")}
          >
            재고낮은순
          </button>
          <button
            className={`btn secondary small ${partsSort === "stockDesc" ? "activeChoice" : ""}`}
            type="button"
            onClick={() => setPartsSort("stockDesc")}
          >
            재고높은순
          </button>
        </div>
        <div className="toolbarActions">
          <button
            className={`btn ${showLowOnly ? "" : "secondary"}`}
            type="button"
            onClick={() => setShowLowOnly((v) => !v)}
          >
            {showLowOnly ? "Low Stock Only" : "Show All"}
          </button>
          <button className="btn secondary" type="button" onClick={clearSearch}>
            검색초기화
          </button>
          <button className="btn secondary" type="button" onClick={() => void loadData()}>
            Refresh
          </button>
        </div>
      </section>

      {error ? (
        <section className="panel" style={{ marginBottom: 16, borderColor: "#e7b4b4" }}>
          <strong>Error:</strong> {error}
        </section>
      ) : null}

      {successToast ? (
        <div className="toast success" role="status" aria-live="polite">
          {successToast}
        </div>
      ) : null}

      <div className="grid">
        <section className="panel">
          <h2>Parts</h2>
          {isMobileLayout ? (
            <div className="partsCards">
              {filteredParts.map((part) => {
                const isLow = Number(part.current_stock) <= Number(globalMinimumStock || 0);
                return (
                  <article key={part.id} className="dataCard">
                    <div className="dataCardHead">
                      <strong>{part.item_number}</strong>
                      <span className={isLow ? "low" : undefined}>
                        재고 {part.current_stock} / 최소 {globalMinimumStock || "0"}
                      </span>
                    </div>
                    <div className="meta">{part.designation}</div>
                    <div className="kvGrid">
                      <div>
                        <span className="meta">단위</span>
                        <div>{part.unit_of_quantity || "-"}</div>
                      </div>
                      <div>
                        <span className="meta">위치</span>
                        <div>{part.location || "-"}</div>
                      </div>
                    </div>
                    {isAdmin ? (
                      <div className="actions" style={{ marginTop: 10 }}>
                        <button className="btn secondary small" type="button" onClick={() => editPart(part)}>
                          Edit
                        </button>
                        <button className="btn danger small" type="button" onClick={() => void deletePart(part)}>
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </article>
                );
              })}
              {!loading && filteredParts.length === 0 ? (
                <div className="panelNotice">
                  {search.trim() ? "No data" : "검색어를 입력하면 품목 목록이 표시됩니다."}
                </div>
              ) : null}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Item No</th>
                    <th>Designation</th>
                    <th>Stock</th>
                    <th>Min</th>
                    <th>Unit</th>
                    <th>Location</th>
                    {isAdmin ? <th>Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {filteredParts.map((part) => {
                    const isLow = Number(part.current_stock) <= Number(globalMinimumStock || 0);
                    return (
                      <tr key={part.id}>
                        <td>{part.item_number}</td>
                        <td>{part.designation}</td>
                        <td className={isLow ? "low" : undefined}>{part.current_stock}</td>
                        <td>{globalMinimumStock || "0"}</td>
                        <td>{part.unit_of_quantity || "-"}</td>
                        <td>{part.location || "-"}</td>
                        {isAdmin ? (
                          <td>
                            <div className="actions">
                              <button
                                className="btn secondary small"
                                type="button"
                                onClick={() => editPart(part)}
                              >
                                Edit
                              </button>
                              <button
                                className="btn danger small"
                                type="button"
                                onClick={() => void deletePart(part)}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                  {!loading && filteredParts.length === 0 ? (
                    <tr>
                      <td colSpan={isAdmin ? 7 : 6}>
                        {search.trim() ? "No data" : "검색어를 입력하면 품목 목록이 표시됩니다."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel">
          {isAdmin ? (
            <>
              <div className="adminHeaderRow">
                <h2 style={{ margin: 0 }}>관리자 도구</h2>
                <button
                  className="btn secondary small"
                  type="button"
                  onClick={() => setAdminToolsOpen((v) => !v)}
                >
                  {adminToolsOpen ? "접기" : "열기"}
                </button>
              </div>
              {adminToolsOpen ? (
                <div className="adminBlock">
                  <div className="meta" style={{ marginBottom: 10 }}>
                    품목 등록/수정/삭제 관리
                  </div>
                  <div className="formRow" style={{ marginBottom: 14 }}>
                    <label className="label">global minimum stock (전 제품 공통)</label>
                    <div className="actions">
                      <input
                        className="input"
                        type="number"
                        inputMode="decimal"
                        autoComplete="off"
                        step="0.01"
                        value={globalMinimumStock}
                        onChange={(e) => setGlobalMinimumStock(e.target.value)}
                        style={{ width: isMobileLayout ? "100%" : 180 }}
                      />
                      <button className="btn secondary small" type="button" onClick={saveGlobalMinimumStock}>
                        기준 저장
                      </button>
                    </div>
                  </div>
                  <h2>{partForm.id ? "품목 수정" : "품목 등록"}</h2>
                  <form onSubmit={submitPart}>
                    <div className="formGrid">
                      <div className="formRow">
                        <label className="label">item number</label>
                        <input
                          className="input"
                          autoComplete="off"
                          value={partForm.itemNumber}
                          onChange={(e) =>
                            setPartForm((v) => ({ ...v, itemNumber: e.target.value.toUpperCase() }))
                          }
                          placeholder="item number"
                        />
                        <div className="actions" style={{ marginTop: 8 }}>
                          <button
                            className="btn secondary small"
                            type="button"
                            onClick={() => openScanner("part")}
                          >
                            바코드 스캔
                          </button>
                        </div>
                      </div>
                      <div className="formRow">
                        <label className="label">designation</label>
                        <input
                          className="input"
                          autoComplete="off"
                          value={partForm.designation}
                          onChange={(e) =>
                            setPartForm((v) => ({ ...v, designation: e.target.value }))
                          }
                          placeholder="designation"
                        />
                      </div>
                      <div className="formRow">
                        <label className="label">current stock</label>
                        <input
                          className="input"
                          type="number"
                          inputMode="decimal"
                          autoComplete="off"
                          step="0.01"
                          value={partForm.currentStock}
                          onChange={(e) =>
                            setPartForm((v) => ({ ...v, currentStock: e.target.value }))
                          }
                        />
                      </div>
                      <div className="formRow">
                        <label className="label">unit of quantity</label>
                        <input
                          className="input"
                          autoComplete="off"
                          value={partForm.unitOfQuantity}
                          onChange={(e) =>
                            setPartForm((v) => ({ ...v, unitOfQuantity: e.target.value }))
                          }
                          placeholder="EA"
                        />
                      </div>
                      <div className="formRow">
                        <label className="label">quantity</label>
                        <input
                          className="input"
                          type="number"
                          inputMode="decimal"
                          autoComplete="off"
                          step="0.01"
                          value={partForm.quantity}
                          onChange={(e) => setPartForm((v) => ({ ...v, quantity: e.target.value }))}
                        />
                      </div>
                    </div>

                    <div className={`actions ${isMobileLayout ? "stickyActionBar" : ""}`}>
                      <button className="btn" type="submit" disabled={savingPart}>
                        {savingPart ? "저장 중..." : partForm.id ? "수정 저장" : "품목 등록"}
                      </button>
                      <button className="btn secondary" type="button" onClick={resetPartForm}>
                        폼 초기화
                      </button>
                    </div>
                  </form>
                </div>
              ) : (
                <div className="panelNotice">관리자 도구가 접혀 있습니다. 열기를 눌러 품목 관리를 사용하세요.</div>
              )}
            </>
          ) : (
            <div className="panelNotice">품목 등록/수정/삭제는 관리자 로그인 후 사용할 수 있습니다.</div>
          )}

          <div className="adminHeaderRow" style={{ marginTop: 20 }}>
            <h2 style={{ margin: 0 }}>입출고 처리</h2>
            {isMobileLayout ? (
              <button
                className="btn secondary small"
                type="button"
                onClick={() => setTxToolsOpen((v) => !v)}
              >
                {txToolsOpen ? "접기" : "열기"}
              </button>
            ) : null}
          </div>
          {txToolsOpen ? (
          <form onSubmit={submitTx}>
            <div className="formRow">
              <label className="label">품목번호 (item_number)</label>
              <input
                className="input"
                autoComplete="off"
                value={txForm.itemNumber}
                onChange={(e) =>
                  setTxForm((v) => ({ ...v, itemNumber: e.target.value.toUpperCase() }))
                }
                placeholder="파트 번호"
              />
              <div className="actions" style={{ marginTop: 8 }}>
                <button
                  className="btn secondary small"
                  type="button"
                  onClick={() => openScanner("tx")}
                >
                  바코드 스캔
                </button>
              </div>
            </div>

            <div className="formRow">
              <label className="label">구분</label>
              <select
                className="select"
                value={txForm.txType}
                onChange={(e) =>
                  setTxForm((v) => ({ ...v, txType: e.target.value as "IN" | "OUT" }))
                }
              >
                <option value="IN">입고 (IN)</option>
                <option value="OUT">출고 (OUT)</option>
              </select>
            </div>

            <div className="formRow">
              <label className="label">수량</label>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                autoComplete="off"
                value={txForm.qty}
                onChange={(e) => setTxForm((v) => ({ ...v, qty: e.target.value }))}
              />
            </div>

            <div className="formRow">
              <label className="label">메모</label>
              <input
                className="input"
                autoComplete="off"
                value={txForm.memo}
                onChange={(e) => setTxForm((v) => ({ ...v, memo: e.target.value }))}
                placeholder="optional"
              />
            </div>

            <div className={`actions ${isMobileLayout ? "stickyActionBar" : ""}`}>
              <button className="btn" type="submit">
                저장
              </button>
              <button
                className="btn secondary"
                type="button"
                onClick={() => setTxForm({ itemNumber: "", txType: "IN", qty: "", memo: "" })}
              >
                초기화
              </button>
            </div>
          </form>
          ) : (
            <div className="panelNotice">입출고 처리 폼이 접혀 있습니다. 열기를 눌러 사용하세요.</div>
          )}

        </section>
      </div>

      <section className="panel">
        <h2>최근 이력</h2>
        {isMobileLayout ? (
          <div className="historyCards">
            {txHistory.map((tx) => (
              <article key={tx.id} className="dataCard">
                <div className="dataCardHead">
                  <strong>{tx.parts?.item_number || "-"}</strong>
                  <span className={`txBadge ${tx.tx_type === "OUT" ? "out" : "in"}`}>{tx.tx_type}</span>
                </div>
                <div>{tx.parts?.designation || "-"}</div>
                <div className="kvGrid">
                  <div>
                    <span className="meta">수량</span>
                    <div>{tx.qty}</div>
                  </div>
                  <div>
                    <span className="meta">날짜</span>
                    <div>{new Date(tx.created_at).toLocaleString("ko-KR")}</div>
                  </div>
                  <div>
                    <span className="meta">메모</span>
                    <div>{tx.memo || "-"}</div>
                  </div>
                  <div>
                    <span className="meta">사용자</span>
                    <div>{tx.actor_name || "-"}</div>
                  </div>
                </div>
              </article>
            ))}
            {!loading && txHistory.length === 0 ? <div className="panelNotice">No transactions</div> : null}
          </div>
        ) : (
          <div className="historyWrap">
            <table className="historyTable">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Item No</th>
                  <th>Designation</th>
                  <th>Qty</th>
                  <th>Memo</th>
                  <th>Date</th>
                  <th>사용자</th>
                </tr>
              </thead>
              <tbody>
                {txHistory.map((tx) => (
                  <tr key={tx.id}>
                    <td><span className={`txBadge ${tx.tx_type === "OUT" ? "out" : "in"}`}>{tx.tx_type}</span></td>
                    <td>{tx.parts?.item_number || "-"}</td>
                    <td>{tx.parts?.designation || "-"}</td>
                    <td>{tx.qty}</td>
                    <td>{tx.memo || "-"}</td>
                    <td>{new Date(tx.created_at).toLocaleString("ko-KR")}</td>
                    <td>{tx.actor_name || "-"}</td>
                  </tr>
                ))}
                {!loading && txHistory.length === 0 ? (
                  <tr>
                    <td colSpan={7}>No transactions</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {scannerOpen ? (
        <div className="scannerOverlay" role="dialog" aria-modal="true" aria-label="바코드 스캔">
          <div className="scannerModal">
            <div className="adminHeaderRow" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>바코드 스캔</h2>
              <div className="actions">
                <button className="btn secondary small" type="button" onClick={() => void toggleScannerTorch()}>
                  {scannerTorchSupported ? (scannerTorchOn ? "손전등 끄기" : "손전등 켜기") : "손전등(미지원)"}
                </button>
                <button className="btn secondary small" type="button" onClick={() => setScannerOpen(false)}>
                  닫기
                </button>
              </div>
            </div>
            <div className="scannerGuide">
              {isMobileLayout ? "모바일: 바코드를 10~20cm 거리에서 천천히 맞춰주세요." : "PC: 카메라 앞 바코드를 중앙에 고정해주세요."}
            </div>
            <div className="scannerFrame">
              <video ref={scannerVideoRef} className="scannerVideo" muted playsInline />
              <div className="scannerAim" aria-hidden="true" />
            </div>
            <div className="meta" style={{ marginTop: 8 }}>
              {(scannerTarget === "part" ? "[품목 등록] " : "[입출고] ") + (scannerError || scannerStatus)}
            </div>
            <div className="meta" style={{ marginTop: 4 }}>
              손전등: {scannerTorchSupported ? "지원됨" : "미지원/확인중"}
            </div>
            {scannerPendingValue ? (
              <div className="scannerConfirmBox" role="group" aria-label="스캔 결과 확인">
                <div className="meta">인식값 확인</div>
                <div className="scannerConfirmValue">{scannerPendingValue}</div>
                <div className="actions">
                  <button className="btn" type="button" onClick={applyScannerPendingValue}>
                    적용
                  </button>
                  <button className="btn secondary" type="button" onClick={rescanScannerValue}>
                    재스캔
                  </button>
                </div>
              </div>
            ) : null}
            {scannerError ? (
              <div className="meta" style={{ marginTop: 6 }}>
                지원 브라우저에서 사용하거나 파트 번호를 직접 입력하세요.
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}
