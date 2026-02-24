"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
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
  position: string;
  itemNumber: string;
  designation: string;
  quantity: string;
  unitOfQuantity: string;
  sparePartsIdentifier: string;
  currentStock: string;
  minimumStock: string;
  location: string;
};

const EMPTY_PART_FORM: PartForm = {
  id: null,
  position: "",
  itemNumber: "",
  designation: "",
  quantity: "0",
  unitOfQuantity: "",
  sparePartsIdentifier: "",
  currentStock: "0",
  minimumStock: "0",
  location: "",
};

export default function HomePage() {
  const [supabase] = useState(() => createClient());
  const [parts, setParts] = useState<Part[]>([]);
  const [txHistory, setTxHistory] = useState<StockTransaction[]>([]);
  const [search, setSearch] = useState("");
  const [showLowOnly, setShowLowOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const isAdmin = authRole === "admin";

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
        fetch("/api/transactions", { cache: "no-store" }),
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
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

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

  const filteredParts = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return parts.filter((part) => {
      const hit =
        keyword.length === 0 ||
        part.item_number.toLowerCase().includes(keyword) ||
        part.designation.toLowerCase().includes(keyword);
      const low = Number(part.current_stock) <= Number(part.minimum_stock);
      return hit && (!showLowOnly || low);
    });
  }, [parts, search, showLowOnly]);

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
    await loadData();
  }

  function editPart(part: Part) {
    setPartForm({
      id: part.id,
      position: part.position || "",
      itemNumber: part.item_number,
      designation: part.designation,
      quantity: String(part.quantity ?? 0),
      unitOfQuantity: part.unit_of_quantity || "",
      sparePartsIdentifier: part.spare_parts_identifier || "",
      currentStock: String(part.current_stock ?? 0),
      minimumStock: String(part.minimum_stock ?? 0),
      location: part.location || "",
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
      position: partForm.position || null,
      item_number: partForm.itemNumber.trim().toUpperCase(),
      designation: partForm.designation.trim(),
      quantity: Number(partForm.quantity || 0),
      unit_of_quantity: partForm.unitOfQuantity || null,
      spare_parts_identifier: partForm.sparePartsIdentifier || null,
      current_stock: Number(partForm.currentStock || 0),
      minimum_stock: Number(partForm.minimumStock || 0),
      location: partForm.location || null,
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
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "품목 삭제에 실패했습니다.");
    }
  }

  const lowCount = parts.filter(
    (part) => Number(part.current_stock) <= Number(part.minimum_stock),
  ).length;

  return (
    <main className="page">
      <header className="header">
        <div>
          <h1 className="title">Inventory Manager</h1>
          <p className="sub">Supabase-based spare parts stock control</p>
        </div>
        <div className="meta">
          {loading ? "Loading..." : `Total ${parts.length} / Low stock ${lowCount}`}
        </div>
      </header>

      <section className="panel" style={{ marginBottom: 14 }}>
        <h2>계정</h2>
        <div className="authBox" style={{ border: "none", padding: 0, background: "transparent" }}>
          {session ? (
            <div className="authRow">
              <div className="meta">
                {authDisplayName || session.user.email?.split("@")[0] || "Logged in"} {"·"}{" "}
                <strong>{isAdmin ? "ADMIN" : "USER"}</strong>
              </div>
              <button className="btn secondary small" type="button" onClick={() => void signOut()}>
                로그아웃
              </button>
            </div>
          ) : (
            <div className="authStack">
              <div className="authRow">
                <input
                  className="input"
                  type="text"
                  placeholder="유저 네임"
                  value={authDisplayNameInput}
                  autoComplete="off"
                  name="inventory-display-name"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  onChange={(e) => setAuthDisplayNameInput(e.target.value)}
                />
              </div>
              <div className="authRow">
                <input
                  className="input"
                  type="email"
                  placeholder="이메일"
                  value={authEmail}
                  autoComplete="off"
                  name="inventory-login-id"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  onChange={(e) => setAuthEmail(e.target.value)}
                />
                <input
                  className="input"
                  type="password"
                  placeholder="비밀번호"
                  value={authPassword}
                  autoComplete="new-password"
                  name="inventory-login-password"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  onChange={(e) => setAuthPassword(e.target.value)}
                />
              </div>
              <div className="actions">
                <button className="btn small" type="button" disabled={authLoading} onClick={() => void signIn()}>
                  로그인
                </button>
                <button
                  className="btn secondary small"
                  type="button"
                  disabled={authLoading}
                  onClick={() => void signUp()}
                >
                  아이디 만들기
                </button>
              </div>
              <div className="meta">가입 시 회사메일 + 비밀번호 + 유저 네임을 사용합니다.</div>
            </div>
          )}
        </div>
      </section>

      <section className="toolbar">
        <input
          className="input"
          placeholder="Search item_number / designation"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          className={`btn ${showLowOnly ? "" : "secondary"}`}
          type="button"
          onClick={() => setShowLowOnly((v) => !v)}
        >
          {showLowOnly ? "Low Stock Only" : "Show All"}
        </button>
        <button className="btn secondary" type="button" onClick={() => void loadData()}>
          Refresh
        </button>
      </section>

      {error ? (
        <section className="panel" style={{ marginBottom: 16, borderColor: "#e7b4b4" }}>
          <strong>Error:</strong> {error}
        </section>
      ) : null}

      <div className="grid">
        <section className="panel">
          <h2>Parts</h2>
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
                  const isLow = Number(part.current_stock) <= Number(part.minimum_stock);
                  return (
                    <tr key={part.id}>
                      <td>{part.item_number}</td>
                      <td>{part.designation}</td>
                      <td className={isLow ? "low" : undefined}>{part.current_stock}</td>
                      <td>{part.minimum_stock}</td>
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
                    <td colSpan={isAdmin ? 7 : 6}>No data</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
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
                  <h2>{partForm.id ? "품목 수정" : "품목 등록"}</h2>
                  <form onSubmit={submitPart}>
                    <div className="formGrid">
                      <div className="formRow">
                        <label className="label">품목번호</label>
                        <input
                          className="input"
                          autoComplete="off"
                          value={partForm.itemNumber}
                          onChange={(e) =>
                            setPartForm((v) => ({ ...v, itemNumber: e.target.value.toUpperCase() }))
                          }
                          placeholder="P-004"
                        />
                      </div>
                      <div className="formRow">
                        <label className="label">품명</label>
                        <input
                          className="input"
                          autoComplete="off"
                          value={partForm.designation}
                          onChange={(e) =>
                            setPartForm((v) => ({ ...v, designation: e.target.value }))
                          }
                          placeholder="New part"
                        />
                      </div>
                      <div className="formRow">
                        <label className="label">현재고</label>
                        <input
                          className="input"
                          type="number"
                          autoComplete="off"
                          step="0.01"
                          value={partForm.currentStock}
                          onChange={(e) =>
                            setPartForm((v) => ({ ...v, currentStock: e.target.value }))
                          }
                        />
                      </div>
                      <div className="formRow">
                        <label className="label">안전재고</label>
                        <input
                          className="input"
                          type="number"
                          autoComplete="off"
                          step="0.01"
                          value={partForm.minimumStock}
                          onChange={(e) =>
                            setPartForm((v) => ({ ...v, minimumStock: e.target.value }))
                          }
                        />
                      </div>
                      <div className="formRow">
                        <label className="label">단위</label>
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
                        <label className="label">위치</label>
                        <input
                          className="input"
                          autoComplete="off"
                          value={partForm.location}
                          onChange={(e) => setPartForm((v) => ({ ...v, location: e.target.value }))}
                          placeholder="A-01"
                        />
                      </div>
                      <div className="formRow">
                        <label className="label">BOM 수량(quantity)</label>
                        <input
                          className="input"
                          type="number"
                          autoComplete="off"
                          step="0.01"
                          value={partForm.quantity}
                          onChange={(e) => setPartForm((v) => ({ ...v, quantity: e.target.value }))}
                        />
                      </div>
                      <div className="formRow">
                        <label className="label">스페어 식별자</label>
                        <input
                          className="input"
                          autoComplete="off"
                          value={partForm.sparePartsIdentifier}
                          onChange={(e) =>
                            setPartForm((v) => ({ ...v, sparePartsIdentifier: e.target.value }))
                          }
                          placeholder="SPARE"
                        />
                      </div>
                      <div className="formRow">
                        <label className="label">Position</label>
                        <input
                          className="input"
                          autoComplete="off"
                          value={partForm.position}
                          onChange={(e) => setPartForm((v) => ({ ...v, position: e.target.value }))}
                          placeholder="1"
                        />
                      </div>
                    </div>

                    <div className="actions">
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

          <h2 style={{ marginTop: 20 }}>입출고 처리</h2>
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
                placeholder="P-001"
              />
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

            <div className="actions">
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

          <h2 style={{ marginTop: 20 }}>최근 이력</h2>
          <div style={{ maxHeight: 320, overflow: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Item No</th>
                  <th>Designation</th>
                  <th>Qty</th>
                  <th>Memo</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {txHistory.map((tx) => (
                  <tr key={tx.id}>
                    <td>{tx.tx_type}</td>
                    <td>{tx.parts?.item_number || "-"}</td>
                    <td>{tx.parts?.designation || "-"}</td>
                    <td>{tx.qty}</td>
                    <td>{tx.memo || "-"}</td>
                    <td>{new Date(tx.created_at).toLocaleString()}</td>
                  </tr>
                ))}
                {!loading && txHistory.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No transactions</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
