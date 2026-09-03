"use client";

import { FormEvent, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { VersionHistory } from "@/components/version-history";
import { APP_VERSION, RELEASE_NOTES_FORCE_OPEN_KEY } from "@/lib/app-version";
import { canUseCurrentSession, clearCurrentSessionMarker, getShouldKeepLogin } from "@/lib/auth-session";
import { normalizeCategory, normalizeUnit, UNIT_OPTIONS } from "@/lib/inventory";
import type { Part, PartCategory, PartLocation, StockTransaction } from "@/lib/types";

type ActiveTab = "inventory" | "admin";
type TxHistoryFilter = "ALL" | "IN" | "OUT" | "ADJUST";
type TxHistoryGradeFilter = "ALL" | "NORMAL" | "B_GRADE";
type TxHistoryPeriod = "TODAY" | "7D" | "30D" | "3M" | "ALL" | "CUSTOM";

type TxForm = {
  partId: string | null;
  itemNumber: string;
  txType: "IN" | "OUT";
  qty: string;
  memo: string;
  txDate: string;
  isBGrade: boolean;
};

type PartForm = {
  id: string | null;
  itemNumber: string;
  designation: string;
  memo: string;
  unitOfQuantity: string;
  currentStock: string;
  minimumStock: string;
  category: string;
  position: string;
  isBGrade: boolean;
};

type PartSearchField = "all" | "category" | "designation" | "itemNumber" | "position";

type CategoryManagerForm = {
  id: string | null;
  name: string;
};

type LocationManagerForm = {
  id: string | null;
  code: string;
  description: string;
  imageUrl: string | null;
};

type TxEditForm = {
  id: string;
  itemNumber: string;
  designation: string;
  txType: "IN" | "OUT";
  qty: string;
  txDate: string;
  memo: string;
  isBGrade: boolean;
};

type TxActionConfirm =
  | {
      kind: "edit";
      form: TxEditForm;
    }
  | {
      kind: "delete";
      tx: StockTransaction;
    };

type TxActionResult = {
  title: string;
  message: string;
};

type TxBasketItem = {
  id: string;
  part: Part;
  txType: "IN" | "OUT";
  qty: string;
  memo: string;
  isBGrade: boolean;
  reclassifyToBGrade: boolean;
};

type StockSubmitPayload = {
  part: Part;
  txType: "IN" | "OUT";
  qty: number;
  memo: string;
  createdAt: string;
  isBGrade: boolean;
  reclassifyToBGrade: boolean;
};

type StockSubmitResponse =
  | { ok: true; reclassifiedToBGrade: boolean }
  | { ok: false; error: string };

type TxBasketResultItem = {
  item: TxBasketItem;
  status: "success" | "failed" | "skipped";
  message: string;
};

type TxBasketResult = {
  txType: "IN" | "OUT";
  results: TxBasketResultItem[];
};

const TX_HISTORY_PAGE_SIZE = 100;

const HELP_SECTIONS = [
  {
    title: "시작하기",
    items: [
      "처음 사용하는 파트가 있다면 먼저 관리자 권한이 있는 계정으로 로그인합니다.",
      "품종등록 화면에서 구분 관리와 위치 관리를 열고, 사용할 구분과 위치를 먼저 등록합니다.",
      "그 다음 품종등록에서 품목번호, 품명, 수량, 단위, B급 여부, 메모를 입력하고 구분과 파트 위치를 지정한 뒤 품종등록을 진행합니다.",
      "처음 등록하는 파트는 품종등록을 먼저 하지 않으면 입고/사용처리에서 저장되지 않습니다.",
      "품종등록이 되어 있지 않은 품목을 입고/사용처리하려 하면 '품종등록을 진행해 주세요.' 문구가 표시됩니다.",
    ],
  },
  {
    title: "메뉴 안내",
    items: [
      "재고관리: 등록된 품목을 검색하고, 선택한 품목을 입고 또는 사용 처리하며 작업 바구니에 담는 화면입니다.",
      "입고/사용 이력: 최근 입고/사용 내역을 검색하고 수정 또는 삭제할 수 있는 큰 팝업입니다.",
      "상단 입고 등록된 품목 수치를 누르면 품종등록된 전체 품목을 팝업으로 확인하고 검색하거나 정렬할 수 있습니다.",
      "품종등록: 신규 품목 등록, 기존 품목 수정, 구분 관리, 위치 관리를 진행하는 화면입니다.",
    ],
  },
  {
    title: "처음 등록하는 방법",
    items: [
      "1. 관리자 계정으로 로그인합니다.",
      "2. 품종등록 화면으로 이동합니다.",
      "3. 아직 없는 구분이 있다면 구분 관리에서 먼저 추가합니다.",
      "4. 아직 없는 위치가 있다면 위치 관리에서 위치코드, 설명, 사진을 등록합니다.",
      "5. 품종등록 화면에서 품목번호, 품명, 메모, 현재 재고, 단위, 구분, 파트 위치, B급 여부를 입력합니다.",
      "6. 마지막으로 품종 등록 버튼을 눌러 저장합니다.",
    ],
  },
  {
    title: "검색 사용법",
    items: [
      "검색창 앞에서 전체, 품목명, 파트번호 중 하나를 선택한 뒤 검색어를 입력합니다.",
      "검색창에서도 바코드/QR 스캔이 가능하며, 스캔값이 바로 검색어로 입력됩니다.",
      "검색 결과에는 품목번호, 품명, 메모, 재고, 단위, 위치가 표시됩니다.",
      "검색 결과에서 선택 버튼을 누르면 해당 품목이 작업 바구니에 바로 담깁니다.",
      "검색 결과에서 재고 수량을 누르면 선택 품목 최근 이력 팝업이 열립니다.",
      "검색 결과가 없으면 검색 조건을 전체로 바꿔 다시 검색해 보는 것이 좋습니다.",
    ],
  },
  {
    title: "입출고 처리",
    items: [
      "입출고 처리는 재고관리 화면의 작업 바구니 기준으로 진행합니다.",
      "재고관리 검색 결과에서 선택 버튼을 눌러 품목을 작업 바구니에 담은 뒤 수량과 재고 등급을 조정합니다.",
      "작업 바구니가 비어 있을 때 입고 또는 사용 작업 유형을 먼저 선택할 수 있습니다.",
      "작업 날짜와 공통 메모는 바구니 상단에서 한 번만 입력하고, 품목별 메모는 각 행에서 추가할 수 있습니다.",
      "입고일 때 B급을 선택하면 해당 수량이 B급 재고로 바로 입고됩니다.",
      "일반 사용 처리 중 필요한 경우 최종 확인 화면에서 B급 재분류를 선택해 같은 수량을 B급 입고로 자동 전환할 수 있습니다.",
      "사용 수량이 현재 재고보다 많으면 저장되지 않습니다.",
    ],
  },
  {
    title: "입고/사용 이력",
    items: [
      "최근 이력에서는 입고/사용 내역의 구분, 품목번호, 품명, 메모, 날짜, 사용자명을 확인할 수 있습니다.",
      "재고관리 화면에서는 재고 수량을 눌러 선택 품목 최근 이력을 따로 볼 수 있습니다.",
      "최근 이력 수정에서는 수량, 메모, B급 여부뿐 아니라 날짜도 변경할 수 있습니다.",
      "수정은 로그인한 사용자도 가능하지만, 삭제는 관리자만 가능합니다.",
      "보정 이력(ADJUST)은 수정하거나 삭제할 수 없습니다.",
    ],
  },
  {
    title: "품종등록과 관리 기능",
    items: [
      "품종등록에서는 품목번호, 품명, 메모, 현재 재고, 단위, 구분, 파트 위치, B급 여부를 관리합니다.",
      "구분과 파트 위치는 목록 버튼으로 선택할 수 있고, 직접 입력도 가능합니다.",
      "파트 위치 목록에서는 위치코드와 설명이 함께 표시되며, 선택 후에는 설명이 입력창 아래에 나타납니다.",
      "기준정보 바로가기에서는 구분 수와 위치 수를 함께 보면서 구분 관리와 위치 관리를 열 수 있습니다.",
      "구분 관리 팝업에서는 구분 추가, 수정, 삭제가 가능합니다.",
      "위치 관리 팝업에서는 위치코드, 설명, 사진 추가/수정/삭제가 가능합니다.",
      "입고 등록 파트 팝업의 수정 버튼을 누르면 팝업이 닫히고 품종등록 화면으로 이동합니다.",
      "입고 등록된 전체 품목 팝업에서는 현재 목록을 QR 또는 바코드 A4 라벨로 인쇄할 수 있습니다.",
    ],
  },
  {
    title: "자주 확인할 점",
    items: [
      "변경사항이 보이지 않으면 브라우저 새로고침 또는 서버 재시작을 먼저 확인합니다.",
      "바코드/QR 스캔이 안 될 경우 브라우저의 카메라 권한 허용 여부와 초점 거리를 확인합니다.",
      "품종등록이 되지 않은 품목은 입고/사용처리 저장이 되지 않습니다.",
      "같은 품목번호가 여러 개 등록된 경우에는 입고/사용처리 전에 정확한 품목을 선택해야 합니다.",
    ],
  },
] as const;

function formatDateInput(value?: string | Date) {
  const date = value ? new Date(value) : new Date();
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return adjusted.toISOString().slice(0, 10);
}

function formatDisplayDate(value?: string | Date) {
  return new Date(value || new Date()).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });
}

function formatKstDateInput(value?: string | Date) {
  const date = new Date(value || new Date());
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function createEmptyTxForm(): TxForm {
  return {
    partId: null,
    itemNumber: "",
    txType: "IN",
    qty: "",
    memo: "",
    txDate: formatDateInput(),
    isBGrade: false,
  };
}

const EMPTY_PART_FORM: PartForm = {
  id: null,
  itemNumber: "",
  designation: "",
  memo: "",
  unitOfQuantity: "EA",
  currentStock: "0",
  minimumStock: "0",
  category: "",
  position: "",
  isBGrade: false,
};

const EMPTY_CATEGORY_MANAGER_FORM: CategoryManagerForm = {
  id: null,
  name: "",
};

const EMPTY_LOCATION_MANAGER_FORM: LocationManagerForm = {
  id: null,
  code: "",
  description: "",
  imageUrl: null,
};

function buildPartPosition(position: string) {
  const normalized = position.trim().toUpperCase();
  return normalized || null;
}

function isPartLow(part: Part, minimumStockValue: number) {
  return Number(part.current_stock) <= minimumStockValue;
}

function formatSplitStock(part: Part) {
  const normal = Number(part.normal_stock ?? part.current_stock ?? 0);
  const bGrade = Number(part.b_grade_stock ?? 0);
  return `${normal} (B급 ${bGrade})`;
}

function formatTxTypeLabel(txType: "IN" | "OUT" | "ADJUST") {
  if (txType === "IN") return "입고";
  if (txType === "OUT") return "사용";
  return "수정내역";
}

function formatTxModeLabel(txType: "IN" | "OUT") {
  return txType === "IN" ? "입고" : "사용";
}

function matchesPartSearch(part: Part, keyword: string, field: PartSearchField) {
  if (!keyword) return false;

  const normalized = keyword.toLowerCase();
  const checks =
    field === "all"
      ? [
          part.item_number,
          part.designation,
          part.location || "",
          part.position || "",
          part.spare_parts_identifier || "",
        ]
      : field === "category"
        ? [part.location || ""]
        : field === "designation"
          ? [part.designation, part.spare_parts_identifier || ""]
          : field === "itemNumber"
            ? [part.item_number]
            : [part.position || ""];

  return checks.some((value) => value.toLowerCase().includes(normalized));
}

function LocationPreview({
  position,
  description,
  imageUrl,
}: {
  position: string | null | undefined;
  description?: string | null;
  imageUrl?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const normalized = (position || "").trim().toUpperCase();

  if (!normalized) {
    return <span>-</span>;
  }

  return (
    <span
      className="locationPreview"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button className="locationButton" type="button" onClick={() => setOpen((value) => !value)}>
        {normalized}
      </button>
      {open ? (
        <span className="locationPopover">
          <strong>{normalized}</strong>
          <span className="meta">{description || "설명 없음"}</span>
          {imageUrl ? <img src={imageUrl} alt={`${normalized} 위치`} className="locationImage" /> : <span className="meta">위치 이미지는 아직 등록되지 않았습니다.</span>}
        </span>
      ) : null}
    </span>
  );
}

const CODE39_PATTERNS: Record<string, string> = {
  "0": "nnnwwnwnn",
  "1": "wnnwnnnnw",
  "2": "nnwwnnnnw",
  "3": "wnwwnnnnn",
  "4": "nnnwwnnnw",
  "5": "wnnwwnnnn",
  "6": "nnwwwnnnn",
  "7": "nnnwnnwnw",
  "8": "wnnwnnwnn",
  "9": "nnwwnnwnn",
  A: "wnnnnwnnw",
  B: "nnwnnwnnw",
  C: "wnwnnwnnn",
  D: "nnnnwwnnw",
  E: "wnnnwwnnn",
  F: "nnwnwwnnn",
  G: "nnnnnwwnw",
  H: "wnnnnwwnn",
  I: "nnwnnwwnn",
  J: "nnnnwwwnn",
  K: "wnnnnnnww",
  L: "nnwnnnnww",
  M: "wnwnnnnwn",
  N: "nnnnwnnww",
  O: "wnnnwnnwn",
  P: "nnwnwnnwn",
  Q: "nnnnnnwww",
  R: "wnnnnnwwn",
  S: "nnwnnnwwn",
  T: "nnnnwnwwn",
  U: "wwnnnnnnw",
  V: "nwwnnnnnw",
  W: "wwwnnnnnn",
  X: "nwnnwnnnw",
  Y: "wwnnwnnnn",
  Z: "nwwnwnnnn",
  "-": "nwnnnnwnw",
  ".": "wwnnnnwnn",
  " ": "nwwnnnwnn",
  "$": "nwnwnwnnn",
  "/": "nwnwnnnwn",
  "+": "nwnnnwnwn",
  "%": "nnnwnwnwn",
  "*": "nwnnwnwnn",
};

function getCode39Value(value: string) {
  const normalized = value.trim().toUpperCase();
  return /^[0-9A-Z .$/+%-]+$/.test(normalized) ? normalized : null;
}

function Code39Barcode({ value }: { value: string }) {
  const codeValue = getCode39Value(value);
  if (!codeValue) {
    return <div className="barcodeUnsupported">CODE39 지원 문자가 아닙니다.</div>;
  }

  return (
    <div className="code39Barcode" aria-label={`바코드 ${codeValue}`}>
      {`*${codeValue}*`.split("").map((char, charIndex) => (
        <span key={`${char}-${charIndex}`} className="code39Char">
          {CODE39_PATTERNS[char].split("").map((unit, unitIndex) => (
            <span
              key={`${char}-${charIndex}-${unitIndex}`}
              className={`code39Unit ${unit === "w" ? "wide" : "narrow"} ${unitIndex % 2 === 0 ? "bar" : "space"}`}
            />
          ))}
          <span className="code39Gap" />
        </span>
      ))}
    </div>
  );
}

function QrCodeImage({ value }: { value: string }) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function buildQrCode() {
      const qrcode = await import("qrcode");
      const dataUrl = await qrcode.toDataURL(value, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 128,
      });
      if (!cancelled) {
        setSrc(dataUrl);
      }
    }

    void buildQrCode().catch(() => {
      if (!cancelled) {
        setSrc("");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [value]);

  return src ? <img className="qrCodeImage" src={src} alt={`${value} QR`} /> : <div className="qrCodeFallback">QR 생성 중</div>;
}

export default function ManagementPage() {
  const GLOBAL_MIN_STOCK_KEY = "inventory_global_min_stock";
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [parts, setParts] = useState<Part[]>([]);
  const [categories, setCategories] = useState<PartCategory[]>([]);
  const [locations, setLocations] = useState<PartLocation[]>([]);
  const [txHistory, setTxHistory] = useState<StockTransaction[]>([]);
  const [txHistorySummary, setTxHistorySummary] = useState<StockTransaction[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [searchField, setSearchField] = useState<PartSearchField>("all");
  const [searchCategoryFilter, setSearchCategoryFilter] = useState<string>("ALL");
  const [searchPositionFilter, setSearchPositionFilter] = useState<string>("ALL");
  const [searchGroupBy, setSearchGroupBy] = useState<"flat" | "category" | "position">("flat");
  const [searchAssistOpen, setSearchAssistOpen] = useState(true);
  const [searchAssistMode, setSearchAssistMode] = useState<"category" | "position">("category");
  const [quickSearchOpen, setQuickSearchOpen] = useState(false);
  const [showLowOnly, setShowLowOnly] = useState(false);
  const [partsSort, setPartsSort] = useState<"item" | "stockAsc" | "stockDesc" | "designation">("item");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("inventory");
  const [stockModalOpen, setStockModalOpen] = useState(false);
  const [lowStockModalOpen, setLowStockModalOpen] = useState(false);
  const [stockModalSearch, setStockModalSearch] = useState("");
  const [stockModalSearchField, setStockModalSearchField] = useState<PartSearchField>("all");
  const [stockModalSort, setStockModalSort] = useState<"category" | "item" | "designation" | "stockDesc" | "stockAsc">("category");
  const [versionNotice, setVersionNotice] = useState<{ version: string } | null>(null);

  const [txForm, setTxForm] = useState<TxForm>(createEmptyTxForm);
  const [partForm, setPartForm] = useState<PartForm>(EMPTY_PART_FORM);
  const [savingPart, setSavingPart] = useState(false);
  const [savingTxEdit, setSavingTxEdit] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [locationModalOpen, setLocationModalOpen] = useState(false);
  const [categoryForm, setCategoryForm] = useState<CategoryManagerForm>(EMPTY_CATEGORY_MANAGER_FORM);
  const [locationForm, setLocationForm] = useState<LocationManagerForm>(EMPTY_LOCATION_MANAGER_FORM);
  const [savingCategory, setSavingCategory] = useState(false);
  const [savingLocation, setSavingLocation] = useState(false);
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null);
  const [deletingLocationId, setDeletingLocationId] = useState<string | null>(null);
  const [categoryOptionsOpen, setCategoryOptionsOpen] = useState(false);
  const [locationOptionsOpen, setLocationOptionsOpen] = useState(false);
  const [txActionConfirm, setTxActionConfirm] = useState<TxActionConfirm | null>(null);
  const [txActionResult, setTxActionResult] = useState<TxActionResult | null>(null);
  const [txBasketItems, setTxBasketItems] = useState<TxBasketItem[]>([]);
  const [txBasketWorkType, setTxBasketWorkType] = useState<"IN" | "OUT">("OUT");
  const [txBasketWorkTypeConfirm, setTxBasketWorkTypeConfirm] = useState<"IN" | "OUT" | null>(null);
  const [txBasketDate, setTxBasketDate] = useState(formatDateInput);
  const [txBasketCommonMemo, setTxBasketCommonMemo] = useState("");
  const [txBasketConfirmOpen, setTxBasketConfirmOpen] = useState(false);
  const [txBasketResult, setTxBasketResult] = useState<TxBasketResult | null>(null);
  const [txBasketSubmitting, setTxBasketSubmitting] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [txEditForm, setTxEditForm] = useState<TxEditForm | null>(null);
  const [txHistorySearch, setTxHistorySearch] = useState("");
  const [txHistoryFilter, setTxHistoryFilter] = useState<TxHistoryFilter>("ALL");
  const [txHistoryGradeFilter, setTxHistoryGradeFilter] = useState<TxHistoryGradeFilter>("ALL");
  const [txHistoryModalOpen, setTxHistoryModalOpen] = useState(false);
  const [txHistoryPage, setTxHistoryPage] = useState(1);
  const [txHistoryTotal, setTxHistoryTotal] = useState(0);
  const [txHistoryPeriod, setTxHistoryPeriod] = useState<TxHistoryPeriod>("ALL");
  const [txHistoryStartDate, setTxHistoryStartDate] = useState("");
  const [txHistoryEndDate, setTxHistoryEndDate] = useState("");
  const [partHistoryModalOpen, setPartHistoryModalOpen] = useState(false);
  const [partHistoryPart, setPartHistoryPart] = useState<Part | null>(null);
  const [partHistoryItems, setPartHistoryItems] = useState<StockTransaction[]>([]);
  const [partHistoryLoading, setPartHistoryLoading] = useState(false);
  const [labelPrintParts, setLabelPrintParts] = useState<Part[]>([]);
  const [labelPrintMode, setLabelPrintMode] = useState<"qr" | "barcode">("qr");
  const [selectedLabelPartIds, setSelectedLabelPartIds] = useState<Set<string>>(() => new Set());

  const [session, setSession] = useState<Session | null>(null);
  const [authRole, setAuthRole] = useState<"user" | "admin" | null>(null);
  const [authDisplayName, setAuthDisplayName] = useState<string | null>(null);
  const [globalMinimumStock, setGlobalMinimumStock] = useState("0");
  const [authChecked, setAuthChecked] = useState(false);
  const [authCheckTimedOut, setAuthCheckTimedOut] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerTarget, setScannerTarget] = useState<"search" | "tx" | "part">("search");
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [scannerStatus, setScannerStatus] = useState("카메라를 준비합니다...");
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
  const locationFileInputRef = useRef<HTMLInputElement | null>(null);
  const seenVersionRef = useRef(APP_VERSION);

  const isAdmin = authRole === "admin";
  const deferredSearchInput = useDeferredValue(searchInput);
  const minimumStockValue = Number(globalMinimumStock || 0);
  const minimumStockLabel = minimumStockValue > 0 ? String(minimumStockValue) : null;
  const locationsByCode = useMemo(
    () => new Map(locations.map((location) => [location.code.toUpperCase(), location])),
    [locations],
  );
  const selectedLocationInfo = useMemo(() => {
    const normalized = (partForm.position || "").trim().toUpperCase();
    if (!normalized) return null;
    return locationsByCode.get(normalized) || null;
  }, [locationsByCode, partForm.position]);
  const categorySuggestions = useMemo(() => {
    const keyword = (partForm.category || "").trim().toUpperCase();
    if (!keyword || categories.some((category) => category.name === keyword)) return categories;
    return categories.filter((category) => category.name.includes(keyword));
  }, [categories, partForm.category]);
  const locationSuggestions = useMemo(() => {
    const keyword = (partForm.position || "").trim().toUpperCase();
    const hasExactMatch = locations.some(
      (location) => location.code.toUpperCase() === keyword || (location.description || "").trim().toUpperCase() === keyword,
    );
    if (!keyword || hasExactMatch) {
      return locations;
    }
    return locations.filter((location) => {
      return location.code.toUpperCase().includes(keyword) || (location.description || "").toUpperCase().includes(keyword);
    });
  }, [locations, partForm.position]);
  const normalizedPartItemNumber = partForm.itemNumber.trim().toUpperCase();
  const normalizedPartDesignation = partForm.designation.trim();
  const normalizedPartCategory = partForm.category.trim().toUpperCase();
  const normalizedPartPosition = partForm.position.trim().toUpperCase();
  const matchedAdminParts = useMemo(() => {
    if (!normalizedPartItemNumber) return [];
    return parts.filter(
      (part) => part.item_number === normalizedPartItemNumber && (!partForm.id || part.id !== partForm.id),
    );
  }, [normalizedPartItemNumber, partForm.id, parts]);
  const adminChecklist = useMemo(
    () => [
      { label: "품목번호", done: Boolean(normalizedPartItemNumber) },
      { label: "품명", done: Boolean(normalizedPartDesignation) },
      { label: "현재 재고", done: partForm.currentStock.trim().length > 0 },
      { label: "구분", done: Boolean(normalizedPartCategory) },
      { label: "위치", done: Boolean(normalizedPartPosition) },
    ],
    [normalizedPartCategory, normalizedPartDesignation, normalizedPartItemNumber, normalizedPartPosition, partForm.currentStock],
  );
  const adminCompletedCount = adminChecklist.filter((item) => item.done).length;
  const adminFormTone =
    adminCompletedCount === adminChecklist.length ? "ready" : adminCompletedCount >= 3 ? "pending" : "idle";
  const adminFormMessage =
    adminCompletedCount === adminChecklist.length
      ? partForm.id
        ? "수정 저장 전에 입력값과 기존 품목 중복 여부를 확인하세요."
        : "등록 준비가 거의 끝났습니다. 저장 전 미리보기를 확인하세요."
      : `필수 입력 ${adminCompletedCount}/${adminChecklist.length} 완료. 남은 항목을 채우면 등록 실수를 줄일 수 있습니다.`;
  const partsPerCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const part of parts) {
      const key = (part.location || "미분류").trim();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }, [parts]);
  const partsPerLocation = useMemo(() => {
    const counts = new Map<string, number>();
    for (const part of parts) {
      const key = (part.position || "미지정").trim().toUpperCase() || "미지정";
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }, [parts]);
  const usedCategoryCount = useMemo(
    () => categories.filter((category) => (partsPerCategory.get(category.name) || 0) > 0).length,
    [categories, partsPerCategory],
  );
  const usedLocationCount = useMemo(
    () => locations.filter((location) => (partsPerLocation.get(location.code) || 0) > 0).length,
    [locations, partsPerLocation],
  );

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
      const AudioContextCtor =
        window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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
      const txParams = new URLSearchParams({
        page: String(txHistoryPage),
        limit: String(TX_HISTORY_PAGE_SIZE),
      });
      if (txHistoryFilter !== "ALL") txParams.set("txType", txHistoryFilter);
      if (txHistoryGradeFilter !== "ALL") txParams.set("grade", txHistoryGradeFilter);
      if (txHistoryStartDate) txParams.set("from", txHistoryStartDate);
      if (txHistoryEndDate) txParams.set("to", txHistoryEndDate);
      const txHeaders = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined;
      const [partsRes, txRes, summaryRes, categoriesRes, locationsRes] = await Promise.all([
        fetch("/api/parts", { cache: "no-store" }),
        fetch(`/api/transactions?${txParams.toString()}`, {
          cache: "no-store",
          headers: txHeaders,
        }),
        fetch(`/api/transactions?page=1&limit=${TX_HISTORY_PAGE_SIZE}`, { cache: "no-store", headers: txHeaders }),
        fetch("/api/categories", { cache: "no-store" }),
        fetch("/api/locations", { cache: "no-store" }),
      ]);

      const partsJson = (await partsRes.json()) as { data?: Part[]; error?: string };
      const txJson = (await txRes.json()) as { data?: StockTransaction[]; error?: string; total?: number };
      const summaryJson = (await summaryRes.json()) as { data?: StockTransaction[]; error?: string; total?: number };
      const categoriesJson = (await categoriesRes.json()) as { data?: PartCategory[]; error?: string };
      const locationsJson = (await locationsRes.json()) as { data?: PartLocation[]; error?: string };

      if (!partsRes.ok || !txRes.ok || !summaryRes.ok || !categoriesRes.ok || !locationsRes.ok) {
        setError(partsJson.error || txJson.error || summaryJson.error || categoriesJson.error || locationsJson.error || "Failed to load data");
      } else {
        setParts(partsJson.data || []);
        setTxHistory(txJson.data || []);
        setTxHistoryTotal(txJson.total ?? (txJson.data || []).length);
        setTxHistorySummary(summaryJson.data || []);
        setCategories(categoriesJson.data || []);
        setLocations(locationsJson.data || []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    }

    setLoading(false);
  }

  async function createCategory(name: string) {
    if (!session?.access_token) {
      throw new Error("관리자 로그인 후 사용하세요.");
    }

    const normalized = normalizeCategory(name);
    if (!normalized) {
      throw new Error("구분명을 입력하세요.");
    }

    const exists = categories.some((category) => category.name === normalized);
    if (exists) {
      return normalized;
    }

    const res = await fetch("/api/categories", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ name: normalized }),
    });
    const json = (await res.json()) as { error?: string; data?: PartCategory[] };
    if (!res.ok) {
      throw new Error(json.error || "구분 저장에 실패했습니다.");
    }
    setCategories((prev) => {
      const next = [...prev];
      for (const item of json.data || []) {
        if (!next.some((category) => category.id === item.id || category.name === item.name)) {
          next.push(item);
        }
      }
      next.sort((a, b) => a.name.localeCompare(b.name));
      return next;
    });
    return normalized;
  }

  async function updateCategory(id: string, name: string) {
    if (!session?.access_token) {
      throw new Error("관리자 로그인 후 사용하세요.");
    }

    const normalized = normalizeCategory(name);
    if (!normalized) {
      throw new Error("구분명을 입력하세요.");
    }

    const res = await fetch(`/api/categories/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ name: normalized }),
    });
    const json = (await res.json()) as { error?: string; data?: PartCategory[] };
    if (!res.ok) {
      throw new Error(json.error || "구분 수정에 실패했습니다.");
    }
    setCategories((prev) =>
      prev
        .map((item) => {
          const next = (json.data || []).find((row) => row.id === item.id);
          return next || item;
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
    return normalized;
  }

  async function removeCategory(id: string) {
    if (!session?.access_token) {
      throw new Error("관리자 로그인 후 사용하세요.");
    }

    const res = await fetch(`/api/categories/${id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    const json = (await readJsonOrText(res)) as { json: { error?: string } | null; raw: string };
    if (!res.ok) {
      throw new Error(json.json?.error || json.raw || "구분 삭제에 실패했습니다.");
    }
    setCategories((prev) => prev.filter((item) => item.id !== id));
  }

  async function resizeLocationImage(file: File) {
    if (!file.type.startsWith("image/")) {
      throw new Error("이미지 파일만 업로드할 수 있습니다.");
    }

    const imageUrl = URL.createObjectURL(file);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
        img.src = imageUrl;
      });

      const maxSize = 1200;
      const ratio = Math.min(1, maxSize / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * ratio));
      const height = Math.max(1, Math.round(image.height * ratio));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("이미지 처리에 실패했습니다.");
      }
      ctx.drawImage(image, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
      if (!blob) {
        throw new Error("이미지 압축에 실패했습니다.");
      }
      return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
  }

  async function uploadLocationImage(code: string, file: File) {
    const normalizedCode = normalizeCategory(code);
    if (!normalizedCode) {
      throw new Error("위치 코드를 먼저 입력하세요.");
    }

    const optimizedFile = await resizeLocationImage(file);
    const safeFileName = `${normalizedCode}-${Date.now()}.jpg`;
    const filePath = `locations/${safeFileName}`;
    const { error: uploadError } = await supabase.storage
      .from("part-location-images")
      .upload(filePath, optimizedFile, {
        cacheControl: "3600",
        contentType: "image/jpeg",
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`위치 이미지 업로드 실패: ${uploadError.message}`);
    }

    const { data } = supabase.storage.from("part-location-images").getPublicUrl(filePath);
    return data.publicUrl;
  }

  async function createLocation(input: { code: string; description?: string | null; imageUrl?: string | null }) {
    if (!session?.access_token) {
      throw new Error("관리자 로그인 후 사용하세요.");
    }

    const normalized = normalizeCategory(input.code);
    if (!normalized) {
      throw new Error("위치 코드를 입력하세요.");
    }

    const exists = locations.some((location) => location.code === normalized);
    if (exists) {
      return normalized;
    }

    const res = await fetch("/api/locations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        code: normalized,
        description: input.description?.trim() || null,
        image_url: input.imageUrl?.trim() || null,
      }),
    });
    const json = (await res.json()) as { error?: string; data?: PartLocation[] };
    if (!res.ok) {
      throw new Error(json.error || "위치 저장에 실패했습니다.");
    }
    setLocations((prev) => {
      const next = [...prev];
      for (const item of json.data || []) {
        if (!next.some((location) => location.id === item.id || location.code === item.code)) {
          next.push(item);
        }
      }
      next.sort((a, b) => a.code.localeCompare(b.code));
      return next;
    });
    return normalized;
  }

  async function updateLocation(input: { id: string; code: string; description?: string | null; imageUrl?: string | null }) {
    if (!session?.access_token) {
      throw new Error("관리자 로그인 후 사용하세요.");
    }

    const normalized = normalizeCategory(input.code);
    if (!normalized) {
      throw new Error("위치 코드를 입력하세요.");
    }

    const res = await fetch(`/api/locations/${input.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        code: normalized,
        description: input.description?.trim() || null,
        image_url: input.imageUrl?.trim() || null,
      }),
    });
    const json = (await res.json()) as { error?: string; data?: PartLocation[] };
    if (!res.ok) {
      throw new Error(json.error || "위치 수정에 실패했습니다.");
    }
    setLocations((prev) =>
      prev
        .map((item) => {
          const next = (json.data || []).find((row) => row.id === item.id);
          return next || item;
        })
        .sort((a, b) => a.code.localeCompare(b.code)),
    );
    return normalized;
  }

  async function removeLocation(id: string) {
    if (!session?.access_token) {
      throw new Error("관리자 로그인 후 사용하세요.");
    }

    const res = await fetch(`/api/locations/${id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    const json = (await readJsonOrText(res)) as { json: { error?: string } | null; raw: string };
    if (!res.ok) {
      throw new Error(json.json?.error || json.raw || "위치 삭제에 실패했습니다.");
    }
    setLocations((prev) => prev.filter((item) => item.id !== id));
  }

  useEffect(() => {
    void loadData();
  }, [session?.access_token, txHistoryEndDate, txHistoryFilter, txHistoryGradeFilter, txHistoryPage, txHistoryStartDate]);

  useEffect(() => {
    setTxHistoryPage(1);
  }, [txHistoryEndDate, txHistoryFilter, txHistoryGradeFilter, txHistorySearch, txHistoryStartDate]);

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
        const shouldKeepLogin = getShouldKeepLogin();
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
      const scannerFormats = ["qr_code", "code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e"];
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
              callbackFn: (result: { getText: () => string } | null) => void,
            ) => Promise<{ stop: () => void }>;
          };
        };
        const reader = new zxing.BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints({ video: videoConstraints, audio: false }, video, (result) => {
          if (cancelled || !result) return;
          const raw = result.getText().trim();
          if (!raw) return;
          applyScannedValue(raw);
          scannerControlsRef.current?.stop();
          scannerControlsRef.current = null;
        });
        if (cancelled) {
          controls.stop();
          return;
        }
        scannerControlsRef.current = controls;
        setScannerStatus(isMobile ? "바코드나 QR을 가까이 비추고 화면 중앙에 맞춰주세요." : "바코드나 QR을 화면 중앙에 맞춰주세요.");
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
          setScannerStatus(isMobile ? "바코드나 QR을 가까이 비추고 화면 중앙에 맞춰주세요." : "바코드나 QR을 화면 중앙에 맞춰주세요.");

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
    const hasAssistFilter = searchAssistOpen && (searchCategoryFilter !== "ALL" || searchPositionFilter !== "ALL");
    if (keyword.length === 0 && !hasAssistFilter) {
      return [];
    }
    const filtered = parts.filter((part) => {
      const hit =
        keyword.length === 0
          ? true
          : matchesPartSearch(part, keyword, searchField) || (searchField === "all" && (part.is_b_grade ? "b급" : "").includes(keyword));
      const categoryMatch = !searchAssistOpen || searchCategoryFilter === "ALL" || (part.location || "미분류") === searchCategoryFilter;
      const positionMatch = !searchAssistOpen || searchPositionFilter === "ALL" || ((part.position || "미지정").toUpperCase() || "미지정") === searchPositionFilter;
      return hit && categoryMatch && positionMatch && (!showLowOnly || isPartLow(part, minimumStockValue));
    });

    filtered.sort((a, b) => {
      if (partsSort === "stockAsc") return Number(a.current_stock) - Number(b.current_stock);
      if (partsSort === "stockDesc") return Number(b.current_stock) - Number(a.current_stock);
      if (partsSort === "designation") return a.designation.localeCompare(b.designation);
      return a.item_number.localeCompare(b.item_number);
    });
    return filtered;
  }, [minimumStockValue, parts, partsSort, search, searchAssistOpen, searchCategoryFilter, searchField, searchPositionFilter, showLowOnly]);
  const hasSearchAssistSelection = searchCategoryFilter !== "ALL" || searchPositionFilter !== "ALL";
  const hasActiveSearchAssistSelection = searchAssistOpen && hasSearchAssistSelection;
  const searchCategoryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const part of parts) {
      const key = part.location || "미분류";
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [parts]);
  const searchPositionOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const part of parts) {
      const key = (part.position || "미지정").toUpperCase() || "미지정";
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [parts]);

  const inboundParts = useMemo(() => {
    return [...parts].sort((a, b) => a.item_number.localeCompare(b.item_number));
  }, [parts]);

  const filteredInboundParts = useMemo(() => {
    const keyword = stockModalSearch.trim().toLowerCase();
    const filtered = inboundParts.filter((part) => {
      if (!keyword) return true;
      return matchesPartSearch(part, keyword, stockModalSearchField);
    });

    filtered.sort((a, b) => {
      if (stockModalSort === "item") return a.item_number.localeCompare(b.item_number);
      if (stockModalSort === "designation") return a.designation.localeCompare(b.designation);
      if (stockModalSort === "stockAsc") return Number(a.current_stock) - Number(b.current_stock);
      if (stockModalSort === "stockDesc") return Number(b.current_stock) - Number(a.current_stock);
      return (a.location || "").localeCompare(b.location || "") || a.item_number.localeCompare(b.item_number);
    });

    return filtered;
  }, [inboundParts, stockModalSearch, stockModalSearchField, stockModalSort]);
  const selectedLabelParts = useMemo(
    () => filteredInboundParts.filter((part) => selectedLabelPartIds.has(part.id)),
    [filteredInboundParts, selectedLabelPartIds],
  );
  const allFilteredLabelPartsSelected =
    filteredInboundParts.length > 0 && filteredInboundParts.every((part) => selectedLabelPartIds.has(part.id));
  const recentTouchedPartIds = useMemo(() => {
    const ids = new Set<string>();
    for (const tx of txHistory.slice(0, 12)) {
      if (tx.part_id) ids.add(tx.part_id);
    }
    return ids;
  }, [txHistory]);

  const lowCount = parts.filter((part) => isPartLow(part, minimumStockValue)).length;
  const lowStockParts = useMemo(
    () =>
      [...parts]
        .filter((part) => isPartLow(part, minimumStockValue))
        .sort((a, b) => Number(a.current_stock) - Number(b.current_stock) || a.item_number.localeCompare(b.item_number)),
    [minimumStockValue, parts],
  );
  const inboundRegisteredCount = inboundParts.length;
  const matchedTxParts = useMemo(() => {
    const normalized = txForm.itemNumber.trim().toUpperCase();
    if (!normalized) return [];
    return parts.filter((part) => part.item_number === normalized);
  }, [parts, txForm.itemNumber]);
  const selectedPart =
    (txForm.partId ? parts.find((part) => part.id === txForm.partId) : null) ||
    (matchedTxParts.length === 1 ? matchedTxParts[0] : null);
  const currentEditingTransaction = useMemo(() => {
    if (!txEditForm) return null;
    return txHistory.find((tx) => tx.id === txEditForm.id) || null;
  }, [txEditForm, txHistory]);
  const txBasketType = txBasketItems[0]?.txType ?? txBasketWorkType;
  const txBasketTotalQty = txBasketItems.reduce((sum, item) => {
    const qty = Number(item.qty);
    return sum + (Number.isFinite(qty) ? qty : 0);
  }, 0);
  const txBasketHasInvalidQty = txBasketItems.some((item) => {
    const qty = Number(item.qty);
    return !Number.isFinite(qty) || qty < 1;
  });
  const filteredTxHistory = useMemo(() => {
    const keyword = txHistorySearch.trim().toLowerCase();
    return txHistory.filter((tx) => {
      if (txHistoryFilter === "ALL" && tx.tx_type === "ADJUST") return false;
      if (txHistoryFilter !== "ALL" && tx.tx_type !== txHistoryFilter) return false;
      if (txHistoryGradeFilter === "NORMAL" && tx.is_b_grade) return false;
      if (txHistoryGradeFilter === "B_GRADE" && !tx.is_b_grade) return false;
      if (!keyword) return true;
      const createdAt = new Date(tx.created_at).toLocaleDateString("ko-KR").toLowerCase();
      return (
        (tx.parts?.item_number || "").toLowerCase().includes(keyword) ||
        (tx.parts?.designation || "").toLowerCase().includes(keyword) ||
        (tx.parts?.location || "").toLowerCase().includes(keyword) ||
        (tx.memo || "").toLowerCase().includes(keyword) ||
        (tx.actor_name || "").toLowerCase().includes(keyword) ||
        createdAt.includes(keyword) ||
        (tx.is_b_grade ? "b급" : "정상품").includes(keyword)
      );
    });
  }, [txHistory, txHistoryFilter, txHistoryGradeFilter, txHistorySearch]);
  const txHistoryTotalPages = Math.max(1, Math.ceil(txHistoryTotal / TX_HISTORY_PAGE_SIZE));
  const adjustHistoryCount = useMemo(() => txHistorySummary.filter((tx) => tx.tx_type === "ADJUST").length, [txHistorySummary]);
  const latestHistoryActor = useMemo(() => {
    const latest = txHistorySummary[0];
    if (!latest) return null;
    return {
      actor: latest.actor_name || "알 수 없음",
      createdAt: latest.created_at,
      item: latest.parts?.designation || latest.parts?.item_number || "품목 정보 없음",
    };
  }, [txHistorySummary]);
  const recentDatesByPart = useMemo(() => {
    const dates = new Map<string, { lastIn?: string; lastOut?: string }>();
    for (const tx of txHistory) {
      const partId = tx.part_id || tx.parts?.id;
      if (!partId || (tx.tx_type !== "IN" && tx.tx_type !== "OUT")) continue;
      const current = dates.get(partId) || {};
      if (tx.tx_type === "IN" && !current.lastIn) current.lastIn = tx.created_at;
      if (tx.tx_type === "OUT" && !current.lastOut) current.lastOut = tx.created_at;
      dates.set(partId, current);
    }
    return dates;
  }, [txHistory]);
  const groupedFilteredParts = useMemo(() => {
    if (searchGroupBy === "flat") {
      return [{ key: "flat", label: "전체 결과", parts: filteredParts }];
    }

    const grouped = new Map<string, Part[]>();
    for (const part of filteredParts) {
      const key =
        searchGroupBy === "category"
          ? part.location || "미분류"
          : (part.position || "미지정").toUpperCase() || "미지정";
      grouped.set(key, [...(grouped.get(key) || []), part]);
    }

    return [...grouped.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, groupedParts]) => ({
        key: `${searchGroupBy}-${label}`,
        label,
        parts: groupedParts,
      }));
  }, [filteredParts, searchGroupBy]);
  const todayHistory = useMemo(() => {
    const today = formatKstDateInput();
    return txHistorySummary.filter((tx) => formatKstDateInput(tx.created_at) === today);
  }, [txHistorySummary]);
  useEffect(() => {
    if (search.trim().length > 0) {
      setSearchAssistOpen(true);
    }
  }, [search]);

  useEffect(() => {
    seenVersionRef.current = APP_VERSION;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function checkVersion() {
      try {
        const res = await fetch(`/api/app-version?ts=${Date.now()}`, {
          cache: "no-store",
          headers: {
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
        });
        const json = (await res.json()) as { version?: string };
        if (cancelled || !json.version) return;
        if (json.version !== seenVersionRef.current) {
          setVersionNotice({ version: json.version });
        }
      } catch {
        // ignore version polling errors
      }
    }

    void checkVersion();
    const timer = window.setInterval(() => {
      void checkVersion();
    }, 15000);

    function handleVisibilityCheck() {
      if (document.visibilityState === "visible") {
        void checkVersion();
      }
    }

    function handleFocusCheck() {
      void checkVersion();
    }

    document.addEventListener("visibilitychange", handleVisibilityCheck);
    window.addEventListener("focus", handleFocusCheck);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityCheck);
      window.removeEventListener("focus", handleFocusCheck);
    };
  }, []);

  function submitSearch() {
    setSearch(searchInput.trim());
  }

  function clearSearch() {
    setSearchInput("");
    setSearch("");
    setShowLowOnly(false);
    setSearchCategoryFilter("ALL");
    setSearchPositionFilter("ALL");
  }

  function clearSearchAssistFilters() {
    setSearchCategoryFilter("ALL");
    setSearchPositionFilter("ALL");
    setSearchAssistMode("category");
  }

  function clearTxHistoryFilters() {
    setTxHistorySearch("");
    setTxHistoryFilter("ALL");
    setTxHistoryGradeFilter("ALL");
    setTxHistoryPeriod("ALL");
    setTxHistoryStartDate("");
    setTxHistoryEndDate("");
    setTxHistoryPage(1);
  }

  function selectSearchAssistMode(mode: "category" | "position") {
    setSearchAssistMode(mode);
    if (mode === "category") {
      setSearchPositionFilter("ALL");
    } else {
      setSearchCategoryFilter("ALL");
    }
  }

  function chooseTxPart(part: Part, nextType?: "IN" | "OUT") {
    setTxForm((prev) => ({
      ...prev,
      partId: part.id,
      itemNumber: part.item_number,
      txType: nextType ?? prev.txType,
      isBGrade: nextType === "OUT" ? false : prev.isBGrade,
    }));
    setActiveTab("inventory");
    setError(null);
  }

  function buildBasketItemId(partId: string, txType: "IN" | "OUT", isBGrade: boolean) {
    return `${txType}:${partId}:${isBGrade ? "B" : "N"}`;
  }

  function mergeMemoText(currentMemo: string, nextMemo: string) {
    const current = currentMemo.trim();
    const next = nextMemo.trim();
    if (!current) return next;
    if (!next || current === next) return current;
    return `${current} / ${next}`;
  }

  function buildCombinedMemo(itemMemo: string, commonMemo: string) {
    const item = itemMemo.trim();
    const common = commonMemo.trim();
    if (item && common) return `${item} / ${common}`;
    return item || common;
  }

  function formatStockSubmitError(errorMessage: string | undefined, part: Part, isBGrade: boolean, qty: number) {
    if (errorMessage === "Part not found") {
      return "품종등록이 필요합니다. 검색 또는 품종등록 화면에서 먼저 등록해 주세요.";
    }
    if (errorMessage?.includes("Insufficient stock")) {
      return isBGrade
        ? `B급 재고가 부족합니다. 현재 B급 재고 ${part.b_grade_stock ?? 0} / 요청 ${qty}`
        : `일반 재고가 부족합니다. 현재 일반 재고 ${part.normal_stock ?? part.current_stock ?? 0} / 요청 ${qty}`;
    }
    return errorMessage || "입고/사용처리에 실패했습니다.";
  }

  async function saveStockTransaction(payload: StockSubmitPayload): Promise<StockSubmitResponse> {
    try {
      const res = await fetch("/api/stock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          partId: payload.part.id,
          txType: payload.txType,
          qty: payload.qty,
          memo: payload.memo.trim() || null,
          createdAt: payload.createdAt,
          isBGrade: payload.isBGrade,
          reclassifyToBGrade: payload.reclassifyToBGrade,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; reclassifiedToBGrade?: boolean };
      if (!res.ok) {
        return {
          ok: false,
          error: formatStockSubmitError(json.error, payload.part, payload.isBGrade, payload.qty),
        };
      }
      return { ok: true, reclassifiedToBGrade: Boolean(json.reclassifiedToBGrade) };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? `저장 요청 중 오류가 발생했습니다: ${error.message}` : "저장 요청 중 오류가 발생했습니다.",
      };
    }
  }

  function handleBasketWorkTypeChange(nextType: "IN" | "OUT") {
    setError(null);
    if (nextType === txBasketType) return;
    if (txBasketItems.length > 0) {
      setTxBasketWorkTypeConfirm(nextType);
      return;
    }
    setTxBasketWorkType(nextType);
  }

  function confirmBasketWorkTypeChange() {
    if (!txBasketWorkTypeConfirm) return;
    const nextType = txBasketWorkTypeConfirm;
    setTxBasketItems((prev) =>
      prev.map((item) => ({
        ...item,
        id: buildBasketItemId(item.part.id, nextType, item.isBGrade),
        txType: nextType,
      })),
    );
    setTxBasketWorkType(nextType);
    setTxBasketWorkTypeConfirm(null);
  }

  function addPartToBasket(part: Part, isBGrade = false, nextType: "IN" | "OUT" = txBasketType) {
    setError(null);
    if (txBasketItems.length > 0 && nextType !== txBasketType) {
      setError("현재 작업 품목을 비운 후 작업 유형을 변경할 수 있습니다.");
      return;
    }
    const qty = 1;
    const itemId = buildBasketItemId(part.id, nextType, isBGrade);
    const existingQty = txBasketItems.find((item) => item.id === itemId);
    const nextQty = (existingQty ? Number(existingQty.qty) || 0 : 0) + qty;
    if (nextType === "OUT") {
      const availableStock = isBGrade
        ? Number(part.b_grade_stock ?? 0)
        : Number(part.normal_stock ?? part.current_stock ?? 0);
      if (nextQty > availableStock) {
        setError(
          isBGrade
            ? `B급 재고가 부족합니다. 현재 B급 재고 ${availableStock} / 바구니 합계 ${nextQty}`
            : `일반 재고가 부족합니다. 현재 일반 재고 ${availableStock} / 바구니 합계 ${nextQty}`,
        );
        return;
      }
    }

    setTxBasketItems((prev) => {
      const existingIndex = prev.findIndex((item) => item.id === itemId);
      if (existingIndex === -1) {
        return [
          ...prev,
          {
            id: itemId,
            part,
            txType: nextType,
            qty: String(qty),
            memo: "",
            isBGrade,
            reclassifyToBGrade: false,
          },
        ];
      }
      return prev.map((item, index) =>
        index === existingIndex
          ? {
              ...item,
              qty: String((Number(item.qty) || 0) + qty),
            }
          : item,
      );
    });
    if (txBasketItems.length === 0) {
      setTxBasketWorkType(nextType);
    }
    chooseTxPart(part);
    showSuccessToast(`${part.designation} 바구니 추가`);
  }

  function updateBasketQty(itemId: string, nextQty: string) {
    setTxBasketItems((prev) => prev.map((item) => (item.id === itemId ? { ...item, qty: nextQty } : item)));
  }

  function applyBasketQtyStep(itemId: string, amount: number) {
    setTxBasketItems((prev) =>
      prev.map((item) => {
        if (item.id !== itemId) return item;
        const current = Number(item.qty);
        const baseQty = Number.isFinite(current) && current > 0 ? current : 1;
        return { ...item, qty: String(Math.max(1, baseQty + amount)) };
      }),
    );
  }

  function updateBasketMemo(itemId: string, memo: string) {
    setTxBasketItems((prev) => prev.map((item) => (item.id === itemId ? { ...item, memo } : item)));
  }

  function updateBasketGrade(itemId: string, isBGrade: boolean) {
    setTxBasketItems((prev) => {
      const current = prev.find((item) => item.id === itemId);
      if (!current || current.isBGrade === isBGrade) return prev;
      const nextId = buildBasketItemId(current.part.id, current.txType, isBGrade);
      const existing = prev.find((item) => item.id === nextId);
      if (existing) {
        return prev
          .filter((item) => item.id !== itemId)
          .map((item) =>
            item.id === nextId
              ? {
                  ...item,
                  qty: String((Number(item.qty) || 0) + (Number(current.qty) || 0)),
                  memo: mergeMemoText(item.memo, current.memo),
                  reclassifyToBGrade: false,
                }
              : item,
          );
      }
      return prev.map((item) =>
        item.id === itemId
          ? {
              ...item,
              id: nextId,
              isBGrade,
              reclassifyToBGrade: false,
            }
          : item,
      );
    });
  }

  function updateBasketReclassify(itemId: string, reclassifyToBGrade: boolean) {
    setTxBasketItems((prev) => prev.map((item) => (item.id === itemId ? { ...item, reclassifyToBGrade } : item)));
  }

  function removeBasketItem(itemId: string) {
    setTxBasketItems((prev) => prev.filter((item) => item.id !== itemId));
  }

  function clearTxBasket() {
    setTxBasketItems([]);
    setTxBasketWorkType("OUT");
    setTxBasketCommonMemo("");
    setTxBasketConfirmOpen(false);
    setTxBasketWorkTypeConfirm(null);
  }

  function openTxBasketConfirm() {
    setError(null);
    if (txBasketItems.length === 0) {
      setError("처리할 품목을 작업 바구니에 먼저 담아주세요.");
      return;
    }
    if (txBasketHasInvalidQty) {
      setError("작업 바구니의 모든 수량은 1 이상이어야 합니다.");
      return;
    }
    const createdAt = txBasketDate ? new Date(`${txBasketDate}T00:00:00`) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) {
      setError("작업 날짜를 정확히 입력하세요.");
      return;
    }
    setTxBasketConfirmOpen(true);
  }

  function saveGlobalMinimumStock() {
    try {
      window.localStorage.setItem(GLOBAL_MIN_STOCK_KEY, globalMinimumStock || "0");
      showSuccessToast(`최소 재고 기준 저장 완료 (${globalMinimumStock || "0"})`);
    } catch {
      // ignore localStorage errors
    }
  }

  async function signOut() {
    setError(null);
    await supabase.auth.signOut({ scope: "local" });
    clearCurrentSessionMarker();
    setAuthRole(null);
    setAuthDisplayName(null);
  }

  async function submitTxBasket() {
    if (txBasketItems.length === 0 || txBasketSubmitting) return;
    setError(null);
    setTxBasketSubmitting(true);

    const snapshot = txBasketItems;
    const results: TxBasketResultItem[] = [];
    const successIds = new Set<string>();
    let failed = false;

    for (let index = 0; index < snapshot.length; index += 1) {
      const item = snapshot[index];
      const qty = Number(item.qty);
      const createdAt = txBasketDate ? new Date(`${txBasketDate}T00:00:00`) : null;

      if (!Number.isFinite(qty) || qty < 1 || !createdAt || Number.isNaN(createdAt.getTime())) {
        results.push({
          item,
          status: "failed",
          message: "수량 또는 날짜를 확인해 주세요.",
        });
        for (const skipped of snapshot.slice(index + 1)) {
          results.push({ item: skipped, status: "skipped", message: "앞 품목 실패로 미처리" });
        }
        failed = true;
        break;
      }

      const result = await saveStockTransaction({
        part: item.part,
        txType: item.txType,
        qty,
        memo: buildCombinedMemo(item.memo, txBasketCommonMemo),
        createdAt: createdAt.toISOString(),
        isBGrade: item.isBGrade,
        reclassifyToBGrade: item.reclassifyToBGrade,
      });

      if (!result.ok) {
        results.push({ item, status: "failed", message: result.error });
        for (const skipped of snapshot.slice(index + 1)) {
          results.push({ item: skipped, status: "skipped", message: "앞 품목 실패로 미처리" });
        }
        failed = true;
        break;
      }

      successIds.add(item.id);
      results.push({
        item,
        status: "success",
        message: result.reclassifiedToBGrade ? "사용 후 B급 입고 완료" : "처리 완료",
      });
    }

    setTxBasketItems((prev) => prev.filter((item) => !successIds.has(item.id)));
    if (!failed) {
      setTxBasketCommonMemo("");
      setTxBasketWorkType("OUT");
    }
    setTxBasketConfirmOpen(false);
    setTxBasketResult({ txType: snapshot[0]?.txType ?? txBasketType, results });
    showSuccessToast(failed ? "작업 바구니 일부 처리 완료" : "작업 바구니 전체 처리 완료");
    if (successIds.size > 0) {
      await loadData();
    }
    setTxBasketSubmitting(false);
  }

  function openTxHistoryModal() {
    setTxHistoryPage(1);
    setTxHistoryModalOpen(true);
  }

  function closePartHistory() {
    setPartHistoryModalOpen(false);
    setPartHistoryPart(null);
    setPartHistoryItems([]);
    setPartHistoryLoading(false);
  }

  async function openPartHistory(part: Part) {
    setPartHistoryPart(part);
    setPartHistoryItems([]);
    setPartHistoryLoading(true);
    setPartHistoryModalOpen(true);
    try {
      const params = new URLSearchParams({ page: "1", limit: "20", partId: part.id });
      const res = await fetch(`/api/transactions?${params.toString()}`, {
        cache: "no-store",
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
      });
      const json = (await res.json()) as { data?: StockTransaction[]; error?: string };
      if (!res.ok) {
        setError(json.error || "선택 품목 이력을 불러오지 못했습니다.");
        return;
      }
      setPartHistoryItems(json.data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "선택 품목 이력을 불러오지 못했습니다.");
    } finally {
      setPartHistoryLoading(false);
    }
  }

  function applyTxHistoryPeriod(period: TxHistoryPeriod) {
    const today = new Date();
    const end = formatKstDateInput(today);
    let start = "";

    if (period === "TODAY") {
      start = end;
    } else if (period === "7D") {
      const date = new Date(today);
      date.setDate(date.getDate() - 6);
      start = formatKstDateInput(date);
    } else if (period === "30D") {
      const date = new Date(today);
      date.setDate(date.getDate() - 29);
      start = formatKstDateInput(date);
    } else if (period === "3M") {
      const date = new Date(today);
      date.setMonth(date.getMonth() - 3);
      start = formatKstDateInput(date);
    }

    setTxHistoryPeriod(period);
    setTxHistoryStartDate(period === "ALL" ? "" : start);
    setTxHistoryEndDate(period === "ALL" ? "" : end);
    setTxHistoryPage(1);
  }

  function openScanner(target: "search" | "tx" | "part") {
    setScannerError(null);
    setScannerPendingValue(null);
    setScannerTarget(target);
    setScannerOpen(true);
  }

  function openLabelPrint(partsToPrint: Part[]) {
    setLabelPrintParts(partsToPrint);
  }

  function toggleLabelPart(partId: string) {
    setSelectedLabelPartIds((prev) => {
      const next = new Set(prev);
      if (next.has(partId)) {
        next.delete(partId);
      } else {
        next.add(partId);
      }
      return next;
    });
  }

  function toggleAllFilteredLabelParts() {
    setSelectedLabelPartIds((prev) => {
      const next = new Set(prev);
      if (filteredInboundParts.length > 0 && filteredInboundParts.every((part) => next.has(part.id))) {
        filteredInboundParts.forEach((part) => next.delete(part.id));
      } else {
        filteredInboundParts.forEach((part) => next.add(part.id));
      }
      return next;
    });
  }

  function printLabels() {
    window.print();
  }

  function applyScannerPendingValue() {
    if (!scannerPendingValue) return;
    if (scannerTarget === "search") {
      setSearchInput(scannerPendingValue);
      setSearch(scannerPendingValue.trim());
    } else if (scannerTarget === "tx") {
      const normalized = scannerPendingValue.trim().toUpperCase();
      const matched = parts.filter((part) => part.item_number === normalized);
      setTxForm((v) => ({
        ...v,
        partId: matched.length === 1 ? matched[0].id : null,
        itemNumber: normalized,
      }));
      if (matched.length === 1) {
        setActiveTab("inventory");
        showSuccessToast(`스캔된 품목 선택 완료: ${matched[0].designation}`);
      }
    } else {
      setPartForm((v) => ({ ...v, itemNumber: scannerPendingValue }));
    }
    setScannerOpen(false);
  }

  function rescanScannerValue() {
    setScannerPendingValue(null);
    setScannerError(null);
    setScannerStatus("바코드나 QR을 다시 스캔해주세요.");
    setScannerOpen(false);
    window.setTimeout(() => setScannerOpen(true), 60);
  }

  function editPart(part: Part) {
    setStockModalOpen(false);
    setActiveTab("admin");
    setPartForm({
      id: part.id,
      itemNumber: part.item_number,
      designation: part.designation,
      memo: part.spare_parts_identifier || "",
      unitOfQuantity: normalizeUnit(part.unit_of_quantity) || "EA",
      currentStock: String(part.current_stock ?? 0),
      minimumStock: String(part.minimum_stock ?? 0),
      category: part.location || "",
      position: part.position || "",
      isBGrade: Boolean(part.is_b_grade),
    });
    setError(null);
  }

  function resetPartForm() {
    setPartForm(EMPTY_PART_FORM);
  }

  function handleSearchQuickAction(part: Part, txType: "IN" | "OUT") {
    setStockModalOpen(false);
    setLowStockModalOpen(false);
    setActiveTab("inventory");
    addPartToBasket(part, false, txType);
  }

  function openCategoryManager() {
    setCategoryForm(EMPTY_CATEGORY_MANAGER_FORM);
    setCategoryModalOpen(true);
    setError(null);
  }

  function openLocationManager() {
    setLocationForm(EMPTY_LOCATION_MANAGER_FORM);
    if (locationFileInputRef.current) {
      locationFileInputRef.current.value = "";
    }
    setLocationModalOpen(true);
    setError(null);
  }

  function startEditCategory(category: PartCategory) {
    setCategoryForm({
      id: category.id,
      name: category.name,
    });
  }

  function startEditLocation(location: PartLocation) {
    setLocationForm({
      id: location.id,
      code: location.code,
      description: location.description || "",
      imageUrl: location.image_url,
    });
    if (locationFileInputRef.current) {
      locationFileInputRef.current.value = "";
    }
  }

  function resetCategoryForm() {
    setCategoryForm(EMPTY_CATEGORY_MANAGER_FORM);
  }

  function resetLocationForm() {
    setLocationForm(EMPTY_LOCATION_MANAGER_FORM);
    if (locationFileInputRef.current) {
      locationFileInputRef.current.value = "";
    }
  }

  async function submitCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSavingCategory(true);
    try {
      if (categoryForm.id) {
        const updated = await updateCategory(categoryForm.id, categoryForm.name);
        resetCategoryForm();
        showSuccessToast(`구분 수정 완료: ${updated}`);
      } else {
        const created = await createCategory(categoryForm.name);
        resetCategoryForm();
        showSuccessToast(`구분 저장 완료: ${created}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "구분 저장에 실패했습니다.");
    } finally {
      setSavingCategory(false);
    }
  }

  async function submitLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSavingLocation(true);
    try {
      const file = locationFileInputRef.current?.files?.[0] || null;
      const imageUrl = file ? await uploadLocationImage(locationForm.code, file) : locationForm.imageUrl;
      if (locationForm.id) {
        const updated = await updateLocation({
          id: locationForm.id,
          code: locationForm.code,
          description: locationForm.description,
          imageUrl,
        });
        resetLocationForm();
        showSuccessToast(`위치 수정 완료: ${updated}`);
      } else {
        const created = await createLocation({
          code: locationForm.code,
          description: locationForm.description,
          imageUrl,
        });
        resetLocationForm();
        showSuccessToast(`위치 저장 완료: ${created}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "위치 저장에 실패했습니다.");
    } finally {
      setSavingLocation(false);
    }
  }

  async function deleteCategory(category: PartCategory) {
    const linkedParts = partsPerCategory.get(category.name) || 0;
    if (!window.confirm(`구분 '${category.name}'을(를) 삭제할까요?\n현재 이 구분을 사용하는 파트 ${linkedParts}개`)) return;
    setError(null);
    setDeletingCategoryId(category.id);
    try {
      await removeCategory(category.id);
      if (categoryForm.id === category.id) {
        resetCategoryForm();
      }
      showSuccessToast(`구분 삭제 완료: ${category.name}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "구분 삭제에 실패했습니다.");
    } finally {
      setDeletingCategoryId(null);
    }
  }

  async function deleteLocation(location: PartLocation) {
    const linkedParts = partsPerLocation.get(location.code) || 0;
    if (!window.confirm(`위치 '${location.code}'을(를) 삭제할까요?\n현재 이 위치를 사용하는 파트 ${linkedParts}개`)) return;
    setError(null);
    setDeletingLocationId(location.id);
    try {
      await removeLocation(location.id);
      if (locationForm.id === location.id) {
        resetLocationForm();
      }
      showSuccessToast(`위치 삭제 완료: ${location.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "위치 삭제에 실패했습니다.");
    } finally {
      setDeletingLocationId(null);
    }
  }

  async function submitPart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!session?.access_token) {
      setError("관리자 로그인 후 사용하세요.");
      return;
    }

    const normalizedCategory = normalizeCategory(partForm.category);
    const normalizedPosition = buildPartPosition(partForm.position);
    if (normalizedCategory) {
      try {
        await createCategory(normalizedCategory);
      } catch (e) {
        setError(e instanceof Error ? e.message : "구분 저장에 실패했습니다.");
        return;
      }
    }
    if (normalizedPosition) {
      try {
        await createLocation({ code: normalizedPosition });
      } catch (e) {
        setError(e instanceof Error ? e.message : "위치 저장에 실패했습니다.");
        return;
      }
    }

    setSavingPart(true);

    const payload = {
      item_number: partForm.itemNumber.trim().toUpperCase(),
      designation: partForm.designation.trim(),
      quantity: Number(partForm.currentStock || 0),
      unit_of_quantity: normalizeUnit(partForm.unitOfQuantity),
      spare_parts_identifier: partForm.memo.trim() || null,
      current_stock: Number(partForm.currentStock || 0),
      minimum_stock: Number(globalMinimumStock || partForm.minimumStock || 0),
      location: normalizedCategory,
      position: normalizedPosition,
      is_b_grade: partForm.isBGrade,
    };

    if (!payload.item_number || !payload.designation) {
      setError("품종 등록에는 품목번호와 품명이 필요합니다.");
      setSavingPart(false);
      return;
    }

    if (!payload.unit_of_quantity) {
      setError("단위는 EA 또는 SET 중에서 선택하세요.");
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
        setError(json.error || "품종 저장에 실패했습니다.");
        return;
      }
      resetPartForm();
      showSuccessToast(partForm.id ? "품종 수정 완료" : "품종 등록 완료");
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "품종 저장에 실패했습니다.");
    } finally {
      setSavingPart(false);
    }
  }

  async function deletePart(part: Part) {
    if (!session?.access_token) {
      setError("관리자 로그인 후 사용하세요.");
      return;
    }

    const linkedHistoryCount = txHistory.filter((tx) => tx.part_id === part.id || tx.parts?.id === part.id).length;
    const confirmed = window.confirm(
      `${part.item_number} (${part.designation}) 품종을 삭제하시겠습니까?\n관련 최근 이력 ${linkedHistoryCount}건이 함께 영향을 받을 수 있습니다.`,
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
        setError(json.error || "품종 삭제에 실패했습니다.");
        return;
      }
      if (partForm.id === part.id) {
        resetPartForm();
      }
      showSuccessToast("품종 삭제 완료");
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "품종 삭제에 실패했습니다.");
    }
  }

  function startEditTransaction(tx: StockTransaction) {
    if (!isAdmin || tx.tx_type === "ADJUST") return;
    setTxEditForm({
      id: tx.id,
      itemNumber: tx.parts?.item_number || "-",
      designation: tx.parts?.designation || "-",
      txType: tx.tx_type,
      qty: String(tx.qty),
      txDate: formatDateInput(tx.created_at),
      memo: tx.memo || "",
      isBGrade: Boolean(tx.is_b_grade),
    });
  }

  async function submitTransactionEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!txEditForm || !session?.access_token) return;
    setError(null);
    const createdAt = txEditForm.txDate ? new Date(`${txEditForm.txDate}T00:00:00`) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) {
      setError("수정할 날짜를 정확히 입력하세요.");
      return;
    }

    setTxActionConfirm({
      kind: "edit",
      form: { ...txEditForm },
    });
  }

  async function confirmTransactionEdit(form: TxEditForm) {
    if (!session?.access_token) return;
    setError(null);
    setSavingTxEdit(true);
    setTxActionConfirm(null);

    try {
      const createdAt = form.txDate ? new Date(`${form.txDate}T00:00:00`) : null;
      if (!createdAt || Number.isNaN(createdAt.getTime())) {
        setError("수정할 날짜를 정확히 입력하세요.");
        return;
      }
      const res = await fetch(`/api/transactions/${form.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          txType: form.txType,
          qty: Number(form.qty),
          createdAt: createdAt.toISOString(),
          memo: form.memo.trim() || null,
          isBGrade: form.isBGrade,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error || "최근 이력 수정에 실패했습니다.");
        return;
      }
      setTxEditForm(null);
      await loadData();
      setTxActionResult({
        title: "최근 이력 수정 완료",
        message: `${form.itemNumber} / ${form.designation} 이력이 수정되었습니다.`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "최근 이력 수정에 실패했습니다.");
    } finally {
      setSavingTxEdit(false);
    }
  }

  async function deleteTransaction(tx: StockTransaction) {
    if (!session?.access_token) {
      setError("관리자 로그인 후 사용하세요.");
      return;
    }

    setTxActionConfirm({
      kind: "delete",
      tx,
    });
  }

  async function confirmDeleteTransaction(tx: StockTransaction) {
    if (!session?.access_token) return;
    setError(null);
    setTxActionConfirm(null);
    try {
      const res = await fetch(`/api/transactions/${tx.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error || "최근 이력 삭제에 실패했습니다.");
        return;
      }
      await loadData();
      setTxActionResult({
        title: "최근 이력 삭제 완료",
        message: `${tx.parts?.item_number || "-"} 이력이 삭제되었고 재고도 함께 원복되었습니다.`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "최근 이력 삭제에 실패했습니다.");
    }
  }

  if (!authChecked || !session) {
    return (
      <main className="page">
        <section className="panel">
          <h2>로그인 확인 중...</h2>
          <p className="meta">
            {authCheckTimedOut ? "세션 확인이 지연되어 로그인 화면으로 이동합니다." : "매니지먼트 화면 접근을 확인하고 있습니다."}
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="header heroHeader">
        <div className="heroIntro">
          <div className="heroEyebrow">SAMYANG</div>
          <h1 className="title heroTitle">6호기 파트 관리 프로그램</h1>
        </div>
      </header>

      <section className="statsGrid spotlightStats" aria-label="요약 정보">
        <button className="statCard statCardButton spotlight registered" type="button" onClick={() => setStockModalOpen(true)}>
          <div className="meta">입고 등록된 품목</div>
          <div className="statValue">{inboundRegisteredCount}</div>
          <div className="meta">전체 등록 품목 보기</div>
        </button>
        <button className="statCard statCardButton spotlight lowStock" type="button" onClick={() => setLowStockModalOpen(true)}>
          <div className="meta">부족 재고</div>
          <div className={`statValue ${lowCount > 0 ? "low" : ""}`}>{lowCount}</div>
          <div className="meta">최소재고 이하 품목 확인</div>
        </button>
        <button className="statCard statCardButton spotlight todayFlow" type="button" onClick={() => openTxHistoryModal()}>
          <div className="meta">입고/사용 이력</div>
          <div className="statValue">기록 조회</div>
          <div className="meta">오늘 {todayHistory.length}건 · 전체 기록 조회</div>
        </button>
        <div className="statCard spotlight latestTouch">
          <div className="meta">최근 상태</div>
          <div className="statValue">{latestHistoryActor?.item || "최근 작업 없음"}</div>
          <div className="meta">{latestHistoryActor ? `마지막 수정자 ${latestHistoryActor.actor}` : "마지막 수정자 정보 없음"}</div>
          <div className="meta">{latestHistoryActor ? `수정일 ${formatDisplayDate(latestHistoryActor.createdAt)}` : "수정일 정보 없음"}</div>
        </div>
      </section>

      {versionNotice ? (
        <section className="panel versionAlertPanel" style={{ marginBottom: 14 }}>
          <div className="adminHeaderRow" style={{ marginBottom: 0 }}>
            <div>
              <strong>새 버전 {versionNotice.version} 이 준비되었습니다.</strong>
              <div className="meta">현재 열려 있는 화면은 이전 버전일 수 있습니다. 새로고침하면 최신 변경사항을 바로 반영할 수 있습니다.</div>
            </div>
            <div className="actions">
              <button className="btn secondary small" type="button" onClick={() => setVersionNotice(null)}>
                나중에
              </button>
              <button
                className="btn small"
                type="button"
                onClick={() => {
                  try {
                    window.localStorage.setItem(RELEASE_NOTES_FORCE_OPEN_KEY, versionNotice.version);
                  } catch {
                    // ignore localStorage errors
                  }
                  window.location.reload();
                }}
              >
                새로고침
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="panel" style={{ marginBottom: 14 }}>
        <div className="authRow" style={{ justifyContent: "space-between" }}>
          <div className="authMetaBlock">
            <div className="meta">
              {authDisplayName || session.user.email?.split("@")[0] || "Logged in"} {"·"} <strong>{isAdmin ? "ADMIN" : "USER"}</strong>
            </div>
            <VersionHistory compact autoOpenOnMount />
          </div>
          <div className="actions">
            <button className="btn secondary small" type="button" onClick={() => setHelpOpen(true)}>
              도움말
            </button>
            <button className="btn secondary small" type="button" onClick={() => void loadData()}>
              새로고침
            </button>
            <button className="btn secondary small" type="button" onClick={() => void signOut()}>
              로그아웃
            </button>
          </div>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 14 }}>
        <div className="tabNav" role="tablist" aria-label="관리 탭">
          <button className={`tabButton ${activeTab === "inventory" ? "active" : ""}`} type="button" onClick={() => setActiveTab("inventory")}>
            재고관리
          </button>
          <button className={`tabButton ${activeTab === "admin" ? "active" : ""}`} type="button" onClick={() => setActiveTab("admin")}>
            품종등록
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

      {helpOpen ? (
        <div className="scannerOverlay" role="dialog" aria-modal="true" aria-label="프로그램 도움말">
          <div className="scannerModal helpModal">
            <div className="adminHeaderRow" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>프로그램 도움말</h2>
              <button className="btn secondary small" type="button" onClick={() => setHelpOpen(false)}>
                닫기
              </button>
            </div>
            <div className="helpIntro">
              현재 웹앱 기준으로 자주 사용하는 기능을 빠르게 확인할 수 있는 안내입니다.
            </div>
            <div className="helpSections">
              {HELP_SECTIONS.map((section) => (
                <section key={section.title} className="helpSection">
                  <h3>{section.title}</h3>
                  <ul className="helpList">
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "inventory" ? (
        <>
          <section className="toolbarPanel panel searchCommandPanel" aria-label="검색 및 필터">
            <div className="searchPanelHead">
              <div>
                <h2 style={{ margin: 0 }}>빠른 검색</h2>
                <div className="meta">품목번호와 품명으로 찾을 때만 펼쳐 사용하는 보조 검색입니다.</div>
              </div>
              <div className="actions">
                <button className="btn secondary small" type="button" onClick={() => openScanner("search")}>
                  바코드/QR 스캔
                </button>
                <button className="btn secondary small" type="button" onClick={() => setQuickSearchOpen((value) => !value)}>
                  {quickSearchOpen ? "빠른 검색 접기" : "빠른 검색 펼치기"}
                </button>
              </div>
            </div>
            {quickSearchOpen ? (
              <>
                <div className="toolbarSearch">
                  <select className="select" value={searchField} onChange={(e) => setSearchField(e.target.value as PartSearchField)}>
                    <option value="all">전체</option>
                    <option value="designation">품목명</option>
                    <option value="itemNumber">파트번호</option>
                  </select>
                  <div className="inlineFieldRow">
                    <input
                      className="input"
                      placeholder="검색 조건에 맞는 값을 입력하세요"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          submitSearch();
                        }
                      }}
                    />
                  </div>
                  <button className="btn" type="button" onClick={submitSearch}>
                    검색
                  </button>
                </div>
                <div className="filterChips" aria-label="정렬">
                  <button className={`btn secondary small ${partsSort === "item" ? "activeChoice" : ""}`} type="button" onClick={() => setPartsSort("item")}>
                    품목번호순
                  </button>
                  <button
                    className={`btn secondary small ${partsSort === "designation" ? "activeChoice" : ""}`}
                    type="button"
                    onClick={() => setPartsSort("designation")}
                  >
                    품명순
                  </button>
                  <button className={`btn secondary small ${partsSort === "stockAsc" ? "activeChoice" : ""}`} type="button" onClick={() => setPartsSort("stockAsc")}>
                    재고낮은순
                  </button>
                  <button className={`btn secondary small ${partsSort === "stockDesc" ? "activeChoice" : ""}`} type="button" onClick={() => setPartsSort("stockDesc")}>
                    재고높은순
                  </button>
                </div>
                <div className="toolbarActions">
                  <button className={`btn ${showLowOnly ? "" : "secondary"}`} type="button" onClick={() => setShowLowOnly((v) => !v)}>
                    {showLowOnly ? "부족 재고만" : "전체 보기"}
                  </button>
                  <button className="btn secondary" type="button" onClick={clearSearch}>
                    검색초기화
                  </button>
                </div>
              </>
            ) : (
              <div className="panelNotice">
                기본 탐색은 아래 구분/위치 버튼을 사용합니다. 품목번호나 품명이 필요할 때만 빠른 검색을 펼쳐주세요.
              </div>
            )}
          </section>

          {search.trim().length > 0 || hasActiveSearchAssistSelection ? (
            <section className="panel quickStatsPanel">
              <div className="quickStatCard">
                <div className="meta">{search.trim().length > 0 ? "검색어" : "현재 보기"}</div>
                <strong>
                  {search.trim().length > 0
                    ? search
                    : hasActiveSearchAssistSelection && searchCategoryFilter !== "ALL"
                      ? `구분 ${searchCategoryFilter}`
                      : hasActiveSearchAssistSelection && searchPositionFilter !== "ALL"
                        ? `위치 ${searchPositionFilter}`
                        : "전체"}
                </strong>
              </div>
              <div className="quickStatCard">
                <div className="meta">검색 결과</div>
                <strong>{filteredParts.length}건</strong>
              </div>
              <div className="quickStatCard">
                <div className="meta">빠른 안내</div>
                <div className="meta">검색 결과의 선택 버튼으로 작업 바구니에 품목을 담을 수 있습니다.</div>
              </div>
            </section>
          ) : null}

          <section className="panel" style={{ marginBottom: 14 }}>
            <div className="adminHeaderRow">
              <div>
                <h2 style={{ margin: 0 }}>구분/위치 탐색</h2>
                <div className="meta">
                  {search.trim().length > 0
                    ? "펼친 상태에서만 검색 결과를 구분과 위치로 다시 좁힙니다."
                    : "기본으로 펼쳐져 있으며 구분이나 위치 선택만으로 품목 목록을 볼 수 있습니다."}
                </div>
              </div>
              <div className="actions">
                <button className="btn secondary small" type="button" onClick={clearSearchAssistFilters}>
                  초기화
                </button>
                <button className="btn secondary small" type="button" onClick={() => setSearchAssistOpen((value) => !value)}>
                  {searchAssistOpen ? "접기" : "펼치기"}
                </button>
              </div>
            </div>
            {searchAssistOpen ? (
              <>
                <div className="modeToggle searchAssistModeToggle" aria-label="구분 또는 위치 검색 선택">
                  <button className={`modeToggleButton ${searchAssistMode === "category" ? "active" : ""}`} type="button" onClick={() => selectSearchAssistMode("category")}>
                    구분 검색
                  </button>
                  <button className={`modeToggleButton ${searchAssistMode === "position" ? "active" : ""}`} type="button" onClick={() => selectSearchAssistMode("position")}>
                    위치 검색
                  </button>
                </div>
                <div className="searchAssistGrid">
                  {searchAssistMode === "category" ? (
                    <div>
                    <div className="meta" style={{ marginBottom: 8 }}>구분</div>
                    <div className="filterChips">
                      <button className={`btn secondary small ${searchCategoryFilter === "ALL" ? "activeChoice" : ""}`} type="button" onClick={() => setSearchCategoryFilter("ALL")}>
                        전체
                      </button>
                      {searchCategoryOptions.map(([name, count]) => (
                        <button
                          key={name}
                          className={`btn secondary small ${searchCategoryFilter === name ? "activeChoice" : ""}`}
                          type="button"
                          onClick={() => setSearchCategoryFilter(name)}
                        >
                          {name} {count}
                        </button>
                      ))}
                    </div>
                    </div>
                  ) : (
                    <div>
                      <div className="meta" style={{ marginBottom: 8 }}>위치</div>
                      <div className="filterChips">
                        <button className={`btn secondary small ${searchPositionFilter === "ALL" ? "activeChoice" : ""}`} type="button" onClick={() => setSearchPositionFilter("ALL")}>
                          전체
                        </button>
                        {searchPositionOptions.slice(0, 10).map(([code, count]) => (
                          <button
                            key={code}
                            className={`btn secondary small ${searchPositionFilter === code ? "activeChoice" : ""}`}
                            type="button"
                            onClick={() => setSearchPositionFilter(code)}
                          >
                            {code} {count}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="formRow" style={{ marginTop: 12, marginBottom: 0 }}>
                  <div className="meta">결과 묶음 보기</div>
                  <div className="filterChips">
                    <button className={`btn secondary small ${searchGroupBy === "flat" ? "activeChoice" : ""}`} type="button" onClick={() => setSearchGroupBy("flat")}>
                      일반 목록
                    </button>
                    <button className={`btn secondary small ${searchGroupBy === "category" ? "activeChoice" : ""}`} type="button" onClick={() => setSearchGroupBy("category")}>
                      구분별 묶음
                    </button>
                    <button className={`btn secondary small ${searchGroupBy === "position" ? "activeChoice" : ""}`} type="button" onClick={() => setSearchGroupBy("position")}>
                      위치별 묶음
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="panelNotice" style={{ marginTop: 12 }}>
                접힌 상태에서는 구분/위치 선택값이 검색 결과에 적용되지 않습니다.
              </div>
            )}
          </section>

          <div className="inventoryManagementGrid">
            <div className="inventoryResultsColumn">
          <section className="panel">
            <div className="adminHeaderRow">
              <h2 style={{ margin: 0 }}>검색 결과</h2>
              <div className="meta">{filteredParts.length}건</div>
            </div>
            <div className="badgeRow searchLegendRow">
              <span className="softBadge warn">부족 재고는 빨간 강조로 표시됩니다.</span>
              <span className="softBadge">선택 버튼으로 작업 바구니 추가</span>
              <span className="softBadge">재고 배지를 누르면 최근 이력 확인</span>
            </div>
            {isMobileLayout ? (
              <div className="groupedResults">
                {groupedFilteredParts.map((group) => (
                  <section key={group.key} className="resultGroup">
                    {searchGroupBy !== "flat" ? (
                      <div className="resultGroupHead">
                        <strong>{group.label}</strong>
                        <span className="meta">{group.parts.length}건</span>
                      </div>
                    ) : null}
                    <div className="partsCards">
                {group.parts.map((part) => {
                  const low = isPartLow(part, minimumStockValue);
                  const locationInfo = locationsByCode.get((part.position || "").toUpperCase());
                  return (
                    <article key={part.id} className={`dataCard ${selectedPart?.id === part.id ? "activeSelection" : ""}`}>
                    <div className={`dataCardHead ${low ? "attention" : ""}`}>
                      <strong>{part.location || "구분 없음"}</strong>
                      <span className={low ? "low" : undefined}>재고 {part.current_stock}</span>
                    </div>
                    <div className="meta">{part.item_number}</div>
                      <strong>{part.designation}</strong>
                      {part.spare_parts_identifier ? <div className="meta partMemo">{part.spare_parts_identifier}</div> : null}
                      <div className="badgeRow">
                        <button className="softBadge textTrigger" type="button" onClick={() => openPartHistory(part)}>
                          {formatSplitStock(part)}
                        </button>
                        <span className="softBadge">{part.unit_of_quantity || "-"}</span>
                        {low ? <span className="softBadge warn">부족 재고</span> : null}
                      </div>
                      <div className="kvGrid">
                        <div>
                          <span className="meta">위치</span>
                          <div><LocationPreview position={part.position} description={locationInfo?.description} imageUrl={locationInfo?.image_url} /></div>
                        </div>
                        <div>
                          <span className="meta">최소재고</span>
                          <div>{minimumStockLabel || part.minimum_stock || "-"}</div>
                        </div>
                      </div>
                      <div className="meta" style={{ marginTop: 8 }}>
                        최근 수정 {new Date(part.updated_at).toLocaleDateString("ko-KR")}
                      </div>
                      <div className="actions" style={{ marginTop: 10 }}>
                        <button className="btn small" type="button" onClick={() => addPartToBasket(part)}>
                          선택
                        </button>
                        {isAdmin ? (
                          <button className="btn secondary small" type="button" onClick={() => editPart(part)}>
                            수정
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
                    </div>
                  </section>
                ))}
                {!loading && search.trim().length === 0 && !hasActiveSearchAssistSelection ? (
                  <div className="panelNotice">검색어를 입력하거나 구분/위치를 선택하면 결과가 표시됩니다.</div>
                ) : null}
                {!loading && (search.trim().length > 0 || hasActiveSearchAssistSelection) && filteredParts.length === 0 ? (
                  <div className="panelNotice">검색 결과가 없습니다.</div>
                ) : null}
              </div>
            ) : (
              <div className="groupedResults">
                {groupedFilteredParts.map((group) => (
                  <section key={group.key} className="resultGroup">
                    {searchGroupBy !== "flat" ? (
                      <div className="resultGroupHead">
                        <strong>{group.label}</strong>
                        <span className="meta">{group.parts.length}건</span>
                      </div>
                    ) : null}
                    <div style={{ overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>구분</th>
                      <th>품목번호</th>
                      <th>품명</th>
                      <th>재고</th>
                      <th>단위</th>
                      <th>위치</th>
                      <th>작업</th>
                      {isAdmin ? <th>관리</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {group.parts.map((part) => {
                      const locationInfo = locationsByCode.get((part.position || "").toUpperCase());
                      return (
                      <tr key={part.id} className={selectedPart?.id === part.id ? "activeSelection" : undefined}>
                        <td>{part.location || "-"}</td>
                        <td>{part.item_number}</td>
                        <td>
                          <strong>{part.designation}</strong>
                          {part.spare_parts_identifier ? <div className="meta partMemo">{part.spare_parts_identifier}</div> : null}
                          <div className="meta">최근 수정 {new Date(part.updated_at).toLocaleDateString("ko-KR")}</div>
                        </td>
                        <td className={isPartLow(part, minimumStockValue) ? "low" : undefined}>
                          <button className="textTrigger stockValueButton" type="button" onClick={() => openPartHistory(part)}>
                            {formatSplitStock(part)}
                          </button>
                        </td>
                        <td>{part.unit_of_quantity || "-"}</td>
                        <td><LocationPreview position={part.position} description={locationInfo?.description} imageUrl={locationInfo?.image_url} /></td>
                        <td>
                          <button className="btn small" type="button" onClick={() => addPartToBasket(part)}>
                            선택
                          </button>
                        </td>
                        {isAdmin ? (
                          <td>
                            <div className="actions">
                              <button className="btn secondary small" type="button" onClick={() => editPart(part)}>
                                수정
                              </button>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    )})}
                  </tbody>
                </table>
                    </div>
                  </section>
                ))}
                {!loading && search.trim().length === 0 && !hasActiveSearchAssistSelection ? (
                  <div className="panelNotice">검색어를 입력하거나 구분/위치를 선택하면 결과가 표시됩니다.</div>
                ) : null}
                {!loading && (search.trim().length > 0 || hasActiveSearchAssistSelection) && filteredParts.length === 0 ? (
                  <div className="panelNotice">검색 결과가 없습니다.</div>
                ) : null}
              </div>
            )}
          </section>
            </div>
            <div className="inventoryActionColumn">
          <section className="panel txBasketPanel" style={{ marginBottom: 16 }}>
            <div className="adminHeaderRow">
              <div>
                <h2 style={{ margin: 0 }}>입출고 작업 바구니</h2>
                <div className="meta">
                  {txBasketItems.length > 0
                    ? `${formatTxModeLabel(txBasketType)} ${txBasketItems.length}품목 / 합계 ${txBasketTotalQty}`
                    : "검색 결과에서 선택한 품목을 담아 입출고를 처리합니다."}
                </div>
              </div>
              <div className="actions">
                <button className="btn secondary small" type="button" onClick={clearTxBasket} disabled={txBasketItems.length === 0 || txBasketSubmitting}>
                  전체 비우기
                </button>
              </div>
            </div>

            <div className="basketControlPanel">
              <div className="formRow">
                <label className="label">작업 유형</label>
                <div className={`modeToggle ${txBasketType === "OUT" ? "out" : "in"}`}>
                  <button className={`modeToggleButton ${txBasketType === "IN" ? "active" : ""}`} type="button" onClick={() => handleBasketWorkTypeChange("IN")} disabled={txBasketSubmitting}>입고</button>
                  <button className={`modeToggleButton ${txBasketType === "OUT" ? "active out" : ""}`} type="button" onClick={() => handleBasketWorkTypeChange("OUT")} disabled={txBasketSubmitting}>사용</button>
                </div>
                <div className="meta">
                  {txBasketItems.length > 0 ? "작업 유형을 바꾸면 바구니 품목은 유지됩니다." : "작업 유형을 먼저 선택한 뒤 품목을 담아주세요."}
                </div>
              </div>
              <div className="formRow">
                <label className="label">작업 날짜</label>
                <input
                  className="input"
                  type="date"
                  value={txBasketDate}
                  onChange={(e) => setTxBasketDate(e.target.value)}
                  disabled={txBasketSubmitting}
                />
              </div>
              <div className="formRow">
                <label className="label">공통 메모</label>
                <input
                  className="input"
                  autoComplete="off"
                  value={txBasketCommonMemo}
                  onChange={(e) => setTxBasketCommonMemo(e.target.value)}
                  placeholder="모든 바구니 품목 이력에 함께 남길 메모"
                  disabled={txBasketSubmitting}
                />
              </div>
            </div>

            {txBasketItems.length > 0 ? (
              <>
                <div className="txBasketList">
                  {txBasketItems.map((item) => (
                    <div key={item.id} className="txBasketItem">
                      <div className="txBasketItemHead">
                        <div>
                          <strong>{item.part.designation}</strong>
                          <div className="meta">{item.part.item_number}</div>
                        </div>
                        <div className="badgeRow">
                          <span className={`txBadge ${item.txType === "OUT" ? "out" : "in"}`}>{formatTxModeLabel(item.txType)}</span>
                          <span className={`softBadge ${item.isBGrade ? "warn" : ""}`}>{item.isBGrade ? "B급" : "정상품"}</span>
                        </div>
                      </div>
                      <div className="meta">
                        현재 재고 {item.part.current_stock} / 일반 {item.part.normal_stock ?? item.part.current_stock ?? 0} / B급 {item.part.b_grade_stock ?? 0} / 위치 {item.part.position || "-"}
                      </div>
                      <div className="segmentedToggle">
                        <button
                          className={`segmentButton ${!item.isBGrade ? "active" : ""}`}
                          type="button"
                          onClick={() => updateBasketGrade(item.id, false)}
                          disabled={txBasketSubmitting}
                        >
                          정상품
                        </button>
                        <button
                          className={`segmentButton warn ${item.isBGrade ? "active" : ""}`}
                          type="button"
                          onClick={() => updateBasketGrade(item.id, true)}
                          disabled={txBasketSubmitting}
                        >
                          B급
                        </button>
                      </div>
                      <div className="txBasketControls">
                        <button className="btn secondary quantityStepButton" type="button" onClick={() => applyBasketQtyStep(item.id, -5)} disabled={txBasketSubmitting}>
                          -5
                        </button>
                        <button className="btn secondary quantityStepButton" type="button" onClick={() => applyBasketQtyStep(item.id, -1)} disabled={txBasketSubmitting}>
                          -1
                        </button>
                        <input
                          className="input quantityInput"
                          type="number"
                          inputMode="decimal"
                          min="1"
                          step="0.01"
                          value={item.qty}
                          onChange={(e) => updateBasketQty(item.id, e.target.value)}
                          disabled={txBasketSubmitting}
                        />
                        <button className="btn secondary quantityStepButton" type="button" onClick={() => applyBasketQtyStep(item.id, 1)} disabled={txBasketSubmitting}>
                          +1
                        </button>
                        <button className="btn secondary quantityStepButton" type="button" onClick={() => applyBasketQtyStep(item.id, 5)} disabled={txBasketSubmitting}>
                          +5
                        </button>
                        <button className="btn danger small" type="button" onClick={() => removeBasketItem(item.id)} disabled={txBasketSubmitting}>
                          삭제
                        </button>
                      </div>
                      <input
                        className="input"
                        autoComplete="off"
                        value={item.memo}
                        onChange={(e) => updateBasketMemo(item.id, e.target.value)}
                        placeholder="개별 메모"
                        disabled={txBasketSubmitting}
                      />
                    </div>
                  ))}
                </div>
                <div className="actions txSaveActions">
                  <button className="btn txSaveButton" type="button" onClick={openTxBasketConfirm} disabled={txBasketSubmitting || txBasketHasInvalidQty}>
                    전체 {formatTxModeLabel(txBasketType)}처리
                  </button>
                </div>
              </>
            ) : (
              <div className="panelNotice">검색 결과에서 선택을 눌러 작업 품목을 담아주세요. 초기 수량은 1로 추가됩니다.</div>
            )}
          </section>
            </div>
          </div>
        </>
      ) : null}

      {txHistoryModalOpen ? (
        <div className="scannerOverlay" role="dialog" aria-modal="true" aria-label="입고/사용 이력">
          <div className="scannerModal stockModal txHistoryDialog">
            <div className="adminHeaderRow" style={{ marginBottom: 12 }}>
              <div>
                <h2 style={{ margin: 0 }}>입고/사용 이력</h2>
                <div className="meta">100건씩 최신순으로 조회하며 다음 페이지로 과거 기록을 볼 수 있습니다.</div>
              </div>
              <button className="btn secondary small" type="button" onClick={() => setTxHistoryModalOpen(false)}>
                닫기
              </button>
            </div>
            <section className="panel">
            <div className="adminHeaderRow">
              <h2 style={{ margin: 0 }}>입고/사용 이력</h2>
              <div className="meta">
                {txHistoryPage} / {txHistoryTotalPages} 페이지 · 현재 표시 {filteredTxHistory.length}건
              </div>
            </div>
            <section className="quickStatsPanel" style={{ marginBottom: 12 }}>
              <div className="quickStatCard">
                <div className="meta">오늘 처리 건수</div>
                <strong>{todayHistory.length}건</strong>
              </div>
              <div className="quickStatCard">
                <div className="meta">최근 입고 기록</div>
                <strong>{txHistorySummary.filter((tx) => tx.tx_type === "IN").length}건</strong>
              </div>
              <div className="quickStatCard">
                <div className="meta">최근 사용 기록</div>
                <strong>{txHistorySummary.filter((tx) => tx.tx_type === "OUT").length}건</strong>
              </div>
              <div className="quickStatCard">
                <div className="meta">수정내역 누적</div>
                <strong>{adjustHistoryCount}건</strong>
                {latestHistoryActor ? <div className="meta">최근 작업 {latestHistoryActor.actor}</div> : null}
              </div>
            </section>
            <div className="formRow" style={{ marginBottom: 12 }}>
              <input
                className="input"
                placeholder="품목번호 / 품명 / 파트번호 / 구분 / 메모 / 사용자 / 날짜 검색"
                value={txHistorySearch}
                onChange={(e) => setTxHistorySearch(e.target.value)}
              />
              <button className="btn secondary" type="button" onClick={clearTxHistoryFilters}>
                초기화
              </button>
            </div>
            <div className="filterChips" aria-label="최근 이력 필터" style={{ marginBottom: 12 }}>
              <button className={`btn secondary small ${txHistoryFilter === "ALL" ? "activeChoice" : ""}`} type="button" onClick={() => setTxHistoryFilter("ALL")}>
                전체
              </button>
              <button className={`btn secondary small ${txHistoryFilter === "IN" ? "activeChoice" : ""}`} type="button" onClick={() => setTxHistoryFilter("IN")}>입고</button>
              <button className={`btn secondary small ${txHistoryFilter === "OUT" ? "activeChoice" : ""}`} type="button" onClick={() => setTxHistoryFilter("OUT")}>사용</button>
              <button className={`btn secondary small ${txHistoryFilter === "ADJUST" ? "activeChoice" : ""}`} type="button" onClick={() => setTxHistoryFilter("ADJUST")}>
                수정내역
              </button>
            </div>
            <div className="filterChips" aria-label="최근 이력 등급 필터" style={{ marginBottom: 12 }}>
              <button className={`btn secondary small ${txHistoryGradeFilter === "ALL" ? "activeChoice" : ""}`} type="button" onClick={() => setTxHistoryGradeFilter("ALL")}>
                전체 등급
              </button>
              <button
                className={`btn secondary small ${txHistoryGradeFilter === "NORMAL" ? "activeChoice" : ""}`}
                type="button"
                onClick={() => setTxHistoryGradeFilter("NORMAL")}
              >
                정상품
              </button>
              <button
                className={`btn secondary small ${txHistoryGradeFilter === "B_GRADE" ? "activeChoice" : ""}`}
                type="button"
                onClick={() => setTxHistoryGradeFilter("B_GRADE")}
              >
                B급
              </button>
            </div>
            <div className="filterChips" aria-label="기간 필터" style={{ marginBottom: 12 }}>
              <button className={`btn secondary small ${txHistoryPeriod === "TODAY" ? "activeChoice" : ""}`} type="button" onClick={() => applyTxHistoryPeriod("TODAY")}>
                오늘
              </button>
              <button className={`btn secondary small ${txHistoryPeriod === "7D" ? "activeChoice" : ""}`} type="button" onClick={() => applyTxHistoryPeriod("7D")}>
                최근 7일
              </button>
              <button className={`btn secondary small ${txHistoryPeriod === "30D" ? "activeChoice" : ""}`} type="button" onClick={() => applyTxHistoryPeriod("30D")}>
                최근 30일
              </button>
              <button className={`btn secondary small ${txHistoryPeriod === "3M" ? "activeChoice" : ""}`} type="button" onClick={() => applyTxHistoryPeriod("3M")}>
                최근 3개월
              </button>
              <button className={`btn secondary small ${txHistoryPeriod === "ALL" ? "activeChoice" : ""}`} type="button" onClick={() => applyTxHistoryPeriod("ALL")}>
                전체
              </button>
            </div>
            <div className="historyDateGrid" style={{ marginBottom: 12 }}>
              <label className="fieldStack">
                <span className="meta">시작일</span>
                <input
                  className="input"
                  type="date"
                  value={txHistoryStartDate}
                  onChange={(e) => {
                    setTxHistoryPeriod("CUSTOM");
                    setTxHistoryStartDate(e.target.value);
                  }}
                />
              </label>
              <label className="fieldStack">
                <span className="meta">종료일</span>
                <input
                  className="input"
                  type="date"
                  value={txHistoryEndDate}
                  onChange={(e) => {
                    setTxHistoryPeriod("CUSTOM");
                    setTxHistoryEndDate(e.target.value);
                  }}
                />
              </label>
            </div>
            {isMobileLayout ? (
              <div className="historyCards">
                {filteredTxHistory.map((tx) => (
                  <article key={tx.id} className="dataCard">
                    <div className="dataCardHead">
                      <strong>{tx.parts?.item_number || "-"}</strong>
                      <span className={`txBadge ${tx.tx_type === "OUT" ? "out" : "in"}`}>{formatTxTypeLabel(tx.tx_type)}</span>
                    </div>
                    <div>{tx.parts?.designation || "-"}</div>
                    <div className="badgeRow">
                      <span className="softBadge">{tx.parts?.location || "구분 없음"}</span>
                      <span className={`softBadge ${tx.tx_type === "ADJUST" ? "warn" : ""}`}>{tx.actor_name || "기록자 없음"}</span>
                    </div>
                    <div className="kvGrid">
                      <div>
                        <span className="meta">최근 입고 등록일</span>
                        <div>{recentDatesByPart.get(tx.part_id || tx.parts?.id || "")?.lastIn ? formatDisplayDate(recentDatesByPart.get(tx.part_id || tx.parts?.id || "")?.lastIn) : "-"}</div>
                      </div>
                      <div>
                        <span className="meta">최근 사용일</span>
                        <div>{recentDatesByPart.get(tx.part_id || tx.parts?.id || "")?.lastOut ? formatDisplayDate(recentDatesByPart.get(tx.part_id || tx.parts?.id || "")?.lastOut) : "-"}</div>
                      </div>
                      <div>
                        <span className="meta">메모</span>
                        <div>{tx.memo || "-"}</div>
                      </div>
                      <div>
                        <span className="meta">사용자 / 등급</span>
                        <div>{tx.actor_name || "-"} / {tx.is_b_grade ? "B급" : "정상품"}</div>
                      </div>
                    </div>
                    {tx.tx_type !== "ADJUST" ? (
                      <div className="actions" style={{ marginTop: 10 }}>
                        <button className="btn secondary small" type="button" onClick={() => startEditTransaction(tx)}>
                          수정
                        </button>
                        {isAdmin ? (
                          <button className="btn danger small" type="button" onClick={() => void deleteTransaction(tx)}>
                            삭제
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <div className="historyWrap">
                <table className="historyTable">
                  <thead>
                    <tr>
                      <th>구분</th>
                      <th>품목번호</th>
                      <th>품명</th>
                      <th>카테고리</th>
                      <th>최근 입고 / 사용</th>
                      <th>메모</th>
                      <th>날짜</th>
                      <th>사용자</th>
                      <th>관리</th>
                    </tr>
                  </thead>
                  <tbody>
                {filteredTxHistory.map((tx) => (
                      <tr key={tx.id}>
                        <td>
                          <span className={`txBadge ${tx.tx_type === "OUT" ? "out" : "in"}`}>{formatTxTypeLabel(tx.tx_type)}</span>
                        </td>
                        <td>{tx.parts?.item_number || "-"}</td>
                        <td>{tx.parts?.designation || "-"}</td>
                        <td>{tx.parts?.location || "-"}</td>
                        <td>
                          <div>입고 {recentDatesByPart.get(tx.part_id || tx.parts?.id || "")?.lastIn ? formatDisplayDate(recentDatesByPart.get(tx.part_id || tx.parts?.id || "")?.lastIn) : "-"}</div>
                          <div>사용 {recentDatesByPart.get(tx.part_id || tx.parts?.id || "")?.lastOut ? formatDisplayDate(recentDatesByPart.get(tx.part_id || tx.parts?.id || "")?.lastOut) : "-"}</div>
                        </td>
                        <td>{tx.memo || "-"}</td>
                        <td>{formatDisplayDate(tx.created_at)}</td>
                        <td>{tx.actor_name || "-"} / {tx.is_b_grade ? "B급" : "정상품"}</td>
                        <td>
                          {tx.tx_type === "ADJUST" ? (
                            <span className="meta">수정내역</span>
                          ) : (
                            <div className="actions">
                              <button className="btn secondary small" type="button" onClick={() => startEditTransaction(tx)}>
                                수정
                              </button>
                              {isAdmin ? (
                                <button className="btn danger small" type="button" onClick={() => void deleteTransaction(tx)}>
                                  삭제
                                </button>
                              ) : null}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!loading && filteredTxHistory.length === 0 ? (
                      <tr>
                        <td colSpan={9}>조건에 맞는 최근 이력이 없습니다.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            )}
            <div className="historyPager">
              <button
                className="btn secondary small"
                type="button"
                disabled={txHistoryPage <= 1}
                onClick={() => setTxHistoryPage((page) => Math.max(1, page - 1))}
              >
                이전 100건
              </button>
              <span className="meta">
                {txHistoryPage} / {txHistoryTotalPages} 페이지
              </span>
              <button
                className="btn secondary small"
                type="button"
                disabled={txHistoryPage >= txHistoryTotalPages}
                onClick={() => setTxHistoryPage((page) => Math.min(txHistoryTotalPages, page + 1))}
              >
                다음 100건
              </button>
            </div>
          </section>
          </div>
        </div>
      ) : null}

      {partHistoryModalOpen && partHistoryPart ? (
        <div className="scannerOverlay" role="dialog" aria-modal="true" aria-label="선택 품목 최근 이력">
          <div className="scannerModal stockModal partHistoryModal">
            <div className="adminHeaderRow" style={{ marginBottom: 12 }}>
              <div>
                <h2 style={{ margin: 0 }}>선택 품목 최근 이력</h2>
                <div className="meta">{partHistoryPart.item_number} / {partHistoryPart.designation}</div>
              </div>
              <button className="btn secondary small" type="button" onClick={closePartHistory}>
                닫기
              </button>
            </div>
            <section className="quickStatsPanel" style={{ marginBottom: 12 }}>
              <div className="quickStatCard">
                <div className="meta">최근 입고 등록일</div>
                <strong>{partHistoryItems.find((tx) => tx.tx_type === "IN")?.created_at ? formatDisplayDate(partHistoryItems.find((tx) => tx.tx_type === "IN")?.created_at) : "-"}</strong>
              </div>
              <div className="quickStatCard">
                <div className="meta">최근 사용일</div>
                <strong>{partHistoryItems.find((tx) => tx.tx_type === "OUT")?.created_at ? formatDisplayDate(partHistoryItems.find((tx) => tx.tx_type === "OUT")?.created_at) : "-"}</strong>
              </div>
            </section>
            {partHistoryLoading ? (
              <div className="panelNotice">최근 이력을 불러오는 중입니다.</div>
            ) : (
              <div className="historyMiniList">
                {partHistoryItems.map((tx) => (
                  <div key={tx.id} className="historyMiniItem">
                    <div className="historyMiniHead">
                      <span className={`txBadge ${tx.tx_type === "OUT" ? "out" : "in"}`}>{formatTxTypeLabel(tx.tx_type)}</span>
                      <strong>{formatDisplayDate(tx.created_at)}</strong>
                    </div>
                    <div className="meta">{tx.actor_name || "기록자 없음"} · {tx.is_b_grade ? "B급" : "정상품"}</div>
                    <div className="meta">{tx.memo || "메모 없음"}</div>
                  </div>
                ))}
                {partHistoryItems.length === 0 ? <div className="panelNotice">이 품목의 최근 이력이 없습니다.</div> : null}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {stockModalOpen ? (
        <div className="scannerOverlay" role="dialog" aria-modal="true" aria-label="입고 등록 품목 전체 보기">
          <div className="scannerModal stockModal">
            <div className="adminHeaderRow" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>입고 등록된 전체 품목</h2>
              <div className="actions">
                <div className="meta">{filteredInboundParts.length}건 / 선택 {selectedLabelParts.length}건</div>
                <button className="btn secondary small" type="button" disabled={selectedLabelParts.length === 0} onClick={() => openLabelPrint(selectedLabelParts)}>
                  선택 품목 라벨 인쇄
                </button>
                <button className="btn secondary small" type="button" disabled={selectedLabelPartIds.size === 0} onClick={() => setSelectedLabelPartIds(new Set())}>
                  선택 해제
                </button>
                <button className="btn secondary small" type="button" onClick={() => setStockModalOpen(false)}>
                  닫기
                </button>
              </div>
            </div>
            <div className="modalToolbar">
              <select className="select" value={stockModalSearchField} onChange={(e) => setStockModalSearchField(e.target.value as PartSearchField)}>
                <option value="all">전체</option>
                <option value="category">구분</option>
                <option value="designation">품목명</option>
                <option value="itemNumber">파트번호</option>
                <option value="position">위치</option>
              </select>
              <input
                className="input"
                placeholder="선택한 항목으로 검색"
                value={stockModalSearch}
                onChange={(e) => setStockModalSearch(e.target.value)}
              />
              <select className="select" value={stockModalSort} onChange={(e) => setStockModalSort(e.target.value as typeof stockModalSort)}>
                <option value="category">구분순</option>
                <option value="item">파트번호순</option>
                <option value="designation">품명순</option>
                <option value="stockDesc">재고많은순</option>
                <option value="stockAsc">재고적은순</option>
              </select>
            </div>
            <div className="labelSelectBar">
              <label className="checkRow">
                <input type="checkbox" checked={allFilteredLabelPartsSelected} onChange={toggleAllFilteredLabelParts} />
                현재 목록 전체 선택
              </label>
              <span className="meta">체크한 품목만 QR/바코드 라벨로 인쇄됩니다.</span>
            </div>
            <section className="quickStatsPanel" style={{ marginBottom: 12 }}>
              <div className="quickStatCard">
                <div className="meta">전체 품목</div>
                <strong>{filteredInboundParts.length}건</strong>
              </div>
              <div className="quickStatCard">
                <div className="meta">부족 재고</div>
                <strong>{filteredInboundParts.filter((part) => isPartLow(part, minimumStockValue)).length}건</strong>
              </div>
              <div className="quickStatCard">
                <div className="meta">최근 처리 품목</div>
                <strong>{filteredInboundParts.filter((part) => recentTouchedPartIds.has(part.id)).length}건</strong>
              </div>
            </section>
            {isMobileLayout ? (
              <div className="partsCards">
                {filteredInboundParts.map((part) => {
                  const locationInfo = locationsByCode.get((part.position || "").toUpperCase());
                  const isRecent = recentTouchedPartIds.has(part.id);
                  const isLow = isPartLow(part, minimumStockValue);
                  return (
                  <article key={part.id} className="dataCard">
                    <div className="dataCardHead">
                      <label className="checkRow">
                        <input type="checkbox" checked={selectedLabelPartIds.has(part.id)} onChange={() => toggleLabelPart(part.id)} />
                        <strong>{part.location || "구분 없음"}</strong>
                      </label>
                      <span>{formatSplitStock(part)}</span>
                    </div>
                    <div>{part.item_number}</div>
                    <div>{part.designation}</div>
                    {part.spare_parts_identifier ? <div className="meta partMemo">{part.spare_parts_identifier}</div> : null}
                    <div className="badgeRow">
                      <span className="softBadge">{formatSplitStock(part)}</span>
                      <span className="softBadge">{part.unit_of_quantity || "-"}</span>
                      {isLow ? <span className="softBadge warn">부족 재고</span> : null}
                      {isRecent ? <span className="softBadge">최근 처리</span> : null}
                    </div>
                    <div className="kvGrid">
                      <div>
                        <span className="meta">위치</span>
                        <div><LocationPreview position={part.position} description={locationInfo?.description} imageUrl={locationInfo?.image_url} /></div>
                      </div>
                      <div>
                        <span className="meta">최소재고</span>
                        <div>{minimumStockLabel || part.minimum_stock || "-"}</div>
                      </div>
                    </div>
                    <div className="quickActionRow" style={{ marginTop: 10 }}>
                      <button className="btn small" type="button" onClick={() => handleSearchQuickAction(part, "IN")}>입고 담기</button>
                      <button className="btn danger small" type="button" onClick={() => handleSearchQuickAction(part, "OUT")}>사용 담기</button>
                      <button className="btn secondary small" type="button" onClick={() => void openPartHistory(part)}>최근 이력</button>
                    </div>
                    {isAdmin ? (
                      <div className="actions" style={{ marginTop: 10 }}>
                        <button className="btn secondary small" type="button" onClick={() => editPart(part)}>
                          수정
                        </button>
                      </div>
                    ) : null}
                  </article>
                )})}
                {!loading && filteredInboundParts.length === 0 ? <div className="panelNotice">조건에 맞는 입고 등록 품목이 없습니다.</div> : null}
              </div>
            ) : (
              <div className="historyWrap stockHistoryWrap">
                <table className="historyTable">
                  <thead>
                    <tr>
                      <th>선택</th>
                      <th>구분</th>
                      <th>품목번호</th>
                      <th>품명</th>
                      <th>재고</th>
                      <th>단위</th>
                      <th>위치</th>
                      <th>빠른 작업</th>
                      {isAdmin ? <th>관리</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInboundParts.map((part) => {
                      const locationInfo = locationsByCode.get((part.position || "").toUpperCase());
                      const isRecent = recentTouchedPartIds.has(part.id);
                      const isLow = isPartLow(part, minimumStockValue);
                      return (
                    <tr key={part.id}>
                        <td>
                          <input
                            aria-label={`${part.item_number} 라벨 선택`}
                            type="checkbox"
                            checked={selectedLabelPartIds.has(part.id)}
                            onChange={() => toggleLabelPart(part.id)}
                          />
                        </td>
                        <td>{part.location || "-"}</td>
                        <td>{part.item_number}</td>
                        <td>
                          <div>{part.designation}</div>
                          {part.spare_parts_identifier ? <div className="meta partMemo">{part.spare_parts_identifier}</div> : null}
                          {(isRecent || isLow) ? (
                            <div className="badgeRow" style={{ marginTop: 6 }}>
                              {isLow ? <span className="softBadge warn">부족 재고</span> : null}
                              {isRecent ? <span className="softBadge">최근 처리</span> : null}
                            </div>
                          ) : null}
                        </td>
                        <td className={isLow ? "low" : undefined}>{formatSplitStock(part)}</td>
                        <td>{part.unit_of_quantity || "-"}</td>
                        <td><LocationPreview position={part.position} description={locationInfo?.description} imageUrl={locationInfo?.image_url} /></td>
                        <td>
                          <div className="actions">
                            <button className="btn small" type="button" onClick={() => handleSearchQuickAction(part, "IN")}>입고 담기</button>
                            <button className="btn danger small" type="button" onClick={() => handleSearchQuickAction(part, "OUT")}>사용 담기</button>
                            <button className="btn secondary small" type="button" onClick={() => void openPartHistory(part)}>최근 이력</button>
                          </div>
                        </td>
                        {isAdmin ? (
                          <td>
                            <div className="actions">
                              <button className="btn secondary small" type="button" onClick={() => editPart(part)}>
                                수정
                              </button>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    )})}
                    {!loading && filteredInboundParts.length === 0 ? (
                      <tr>
                        <td colSpan={isAdmin ? 9 : 8}>조건에 맞는 입고 등록 품목이 없습니다.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {lowStockModalOpen ? (
        <div className="scannerOverlay" role="dialog" aria-modal="true" aria-label="부족 재고 품목 보기">
          <div className="scannerModal stockModal">
            <div className="adminHeaderRow" style={{ marginBottom: 8 }}>
              <div>
                <h2 style={{ margin: 0 }}>부족 재고 품목</h2>
                <div className="meta">현재 최소재고 기준 {minimumStockLabel || "0"} 이하인 품목만 모아봤습니다.</div>
              </div>
              <div className="actions">
                <div className="meta">{lowStockParts.length}건</div>
                <button className="btn secondary small" type="button" onClick={() => setLowStockModalOpen(false)}>
                  닫기
                </button>
              </div>
            </div>
            {isMobileLayout ? (
              <div className="partsCards">
                {lowStockParts.map((part) => {
                  const locationInfo = locationsByCode.get((part.position || "").toUpperCase());
                  return (
                    <article key={part.id} className="dataCard">
                      <div className="dataCardHead">
                        <strong>{part.location || "구분 없음"}</strong>
                        <span className="softBadge warn">부족 재고</span>
                      </div>
                      <div>{part.item_number}</div>
                      <div>{part.designation}</div>
                      <div className="badgeRow">
                        <span className="softBadge warn">현재 {formatSplitStock(part)}</span>
                        <span className="softBadge">기준 {minimumStockLabel || part.minimum_stock || "0"}</span>
                      </div>
                      <div className="kvGrid">
                        <div>
                          <span className="meta">위치</span>
                          <div>
                            <LocationPreview position={part.position} description={locationInfo?.description} imageUrl={locationInfo?.image_url} />
                          </div>
                        </div>
                        <div>
                          <span className="meta">단위</span>
                          <div>{part.unit_of_quantity || "-"}</div>
                        </div>
                      </div>
                      <div className="quickActionRow" style={{ marginTop: 10 }}>
                        <button className="btn small" type="button" onClick={() => handleSearchQuickAction(part, "IN")}>입고 담기</button>
                        <button className="btn danger small" type="button" onClick={() => handleSearchQuickAction(part, "OUT")}>사용 담기</button>
                        <button className="btn secondary small" type="button" onClick={() => void openPartHistory(part)}>최근 이력</button>
                      </div>
                    </article>
                  );
                })}
                {!loading && lowStockParts.length === 0 ? <div className="panelNotice">현재 부족 재고 품목이 없습니다.</div> : null}
              </div>
            ) : (
              <div className="historyWrap stockHistoryWrap">
                <table className="historyTable">
                  <thead>
                    <tr>
                      <th>구분</th>
                      <th>품목번호</th>
                      <th>품명</th>
                      <th>현재 재고</th>
                      <th>기준 재고</th>
                      <th>위치</th>
                      <th>빠른 작업</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lowStockParts.map((part) => {
                      const locationInfo = locationsByCode.get((part.position || "").toUpperCase());
                      return (
                        <tr key={part.id}>
                          <td>{part.location || "-"}</td>
                          <td>{part.item_number}</td>
                          <td>
                            <div>{part.designation}</div>
                            {part.spare_parts_identifier ? <div className="meta partMemo">{part.spare_parts_identifier}</div> : null}
                          </td>
                          <td className="low">{formatSplitStock(part)}</td>
                          <td>{minimumStockLabel || part.minimum_stock || "0"}</td>
                          <td>
                            <LocationPreview position={part.position} description={locationInfo?.description} imageUrl={locationInfo?.image_url} />
                          </td>
                          <td>
                            <div className="actions">
                              <button className="btn small" type="button" onClick={() => handleSearchQuickAction(part, "IN")}>입고 담기</button>
                              <button className="btn danger small" type="button" onClick={() => handleSearchQuickAction(part, "OUT")}>사용 담기</button>
                              <button className="btn secondary small" type="button" onClick={() => void openPartHistory(part)}>최근 이력</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {!loading && lowStockParts.length === 0 ? (
                      <tr>
                        <td colSpan={7}>현재 부족 재고 품목이 없습니다.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {labelPrintParts.length > 0 ? (
        <div className="scannerOverlay labelPrintOverlay" role="dialog" aria-modal="true" aria-label="A4 라벨 인쇄">
          <div className="scannerModal labelPrintModal">
            <div className="adminHeaderRow" style={{ marginBottom: 12 }}>
              <div>
                <h2 style={{ margin: 0 }}>A4 라벨 인쇄</h2>
                <div className="meta">현재 선택된 {labelPrintParts.length}개 품목을 {labelPrintMode === "qr" ? "QR" : "바코드"} 라벨로 출력합니다.</div>
              </div>
              <div className="actions noPrint">
                <button className={`btn secondary small ${labelPrintMode === "qr" ? "activeChoice" : ""}`} type="button" onClick={() => setLabelPrintMode("qr")}>
                  QR
                </button>
                <button className={`btn secondary small ${labelPrintMode === "barcode" ? "activeChoice" : ""}`} type="button" onClick={() => setLabelPrintMode("barcode")}>
                  바코드
                </button>
                <button className="btn" type="button" onClick={printLabels}>
                  인쇄
                </button>
                <button className="btn secondary small" type="button" onClick={() => setLabelPrintParts([])}>
                  닫기
                </button>
              </div>
            </div>
            <div className="labelPrintArea">
              <div className="labelSheet">
                {labelPrintParts.map((part) => (
                  <section key={part.id} className="labelCard">
                    {labelPrintMode === "qr" ? <QrCodeImage value={part.item_number} /> : <Code39Barcode value={part.item_number} />}
                    <strong className="labelItemNumber">{part.item_number}</strong>
                    <div className="labelDesignation">{part.designation}</div>
                  </section>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "admin" ? (
        isAdmin ? (
          <div className="grid adminLayout">
            <section className="panel adminMainPanel">
              <div className="adminPanelHead">
                <div>
                  <h2>{partForm.id ? "품종 수정" : "품종 등록"}</h2>
                  <p className="subtleNote">주요 등록 항목을 한 곳에서 바로 입력하고, 필요할 때만 구분/위치 관리를 열 수 있습니다.</p>
                </div>
              </div>
              <div className={`selectionSummaryCard ${adminFormTone}`} style={{ marginBottom: 16 }}>
                <div className="selectionSummaryHead">
                  <div>
                    <div className="meta">입력 진행 상태</div>
                    <strong>{adminFormMessage}</strong>
                  </div>
                  <span className={`statusPill ${adminFormTone}`}>{adminCompletedCount}/{adminChecklist.length} 완료</span>
                </div>
                <div className="selectionMetaRow">
                  {adminChecklist.map((item) => (
                    <span key={item.label} className={`softBadge ${item.done ? "" : "warn"}`}>
                      {item.done ? "완료" : "대기"} · {item.label}
                    </span>
                  ))}
                </div>
              </div>
              <form onSubmit={submitPart}>
                <div className="adminFormSections">
                  <section className="adminFormSection">
                    <div className="adminSectionHead">
                      <h3>기본 정보</h3>
                      <span className="meta">먼저 품목번호와 품명을 입력하세요.</span>
                    </div>
                    <div className="formGrid formGridWide">
                      <div className="formRow">
                        <label className="label">품목번호</label>
                        <div className="inlineFieldRow">
                          <input
                            className="input"
                            autoComplete="off"
                            value={partForm.itemNumber}
                            onChange={(e) => setPartForm((v) => ({ ...v, itemNumber: e.target.value.toUpperCase() }))}
                            placeholder="item number"
                          />
                          <button className="btn secondary small" type="button" onClick={() => openScanner("part")}>
                            바코드/QR 스캔
                          </button>
                        </div>
                        {matchedAdminParts.length > 0 ? (
                          <div className="fieldHint pending">
                            같은 품목번호가 이미 {matchedAdminParts.length}건 등록되어 있습니다. 아래 후보를 확인해 주세요.
                          </div>
                        ) : null}
                      </div>

                      <div className="formRow">
                        <label className="label">품명</label>
                        <input
                          className="input"
                          autoComplete="off"
                          value={partForm.designation}
                          onChange={(e) => setPartForm((v) => ({ ...v, designation: e.target.value }))}
                          placeholder="designation"
                        />
                      </div>

                      <div className="formRow">
                        <label className="label">메모</label>
                        <input className="input" autoComplete="off" value={partForm.memo} onChange={(e) => setPartForm((v) => ({ ...v, memo: e.target.value }))} placeholder="비고 / 설명 메모" />
                      </div>
                    </div>
                    {matchedAdminParts.length > 0 ? (
                      <div className="candidateList">
                        {matchedAdminParts.slice(0, 4).map((part) => (
                          <button key={part.id} className="candidateItem" type="button" onClick={() => editPart(part)}>
                            <strong>{part.item_number}</strong>
                            <span>{part.designation}</span>
                            <span className="meta">구분 {part.location || "-"} / 위치 {part.position || "-"} / 재고 {part.current_stock}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </section>

                  <section className="adminFormSection">
                    <div className="adminSectionHead">
                      <h3>재고 정보</h3>
                      <span className="meta">초기 재고, 단위, 등급을 정합니다.</span>
                    </div>
                    <div className="formGrid formGridWide">
                      <div className="formRow">
                        <label className="label">현재 재고</label>
                        <input
                          className="input"
                          type="number"
                          inputMode="decimal"
                          autoComplete="off"
                          step="0.01"
                          value={partForm.currentStock}
                          onChange={(e) => setPartForm((v) => ({ ...v, currentStock: e.target.value }))}
                        />
                      </div>

                      <div className="formRow">
                        <label className="label">단위</label>
                        <select className="select" value={partForm.unitOfQuantity} onChange={(e) => setPartForm((v) => ({ ...v, unitOfQuantity: e.target.value }))}>
                          {UNIT_OPTIONS.map((unit) => (
                            <option key={unit} value={unit}>
                              {unit.toLowerCase()}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="formRow">
                        <label className="label">B급 여부</label>
                        <label className="checkRow">
                          <input type="checkbox" checked={partForm.isBGrade} onChange={(e) => setPartForm((v) => ({ ...v, isBGrade: e.target.checked }))} />
                          B급
                        </label>
                        <div className="meta">초기 등록 자체를 B급 품목으로 시작해야 할 때만 체크하세요.</div>
                      </div>

                      <div className="formRow">
                        <label className="label">적용 최소재고</label>
                        <div className="panelNotice">
                          현재 저장 기준은 전 제품 공통 최소재고 <strong>{globalMinimumStock || "0"}</strong> 입니다.
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="adminFormSection">
                    <div className="adminSectionHead">
                      <h3>구분 및 위치</h3>
                      <span className="meta">목록 선택 또는 직접 입력 후, 필요하면 기준정보 관리를 여세요.</span>
                    </div>
                    <div className="formGrid formGridWide">
                      <div className="formRow">
                        <div className="inlineLabelRow">
                          <label className="label">구분</label>
                          <button className="btn secondary small" type="button" onClick={() => setCategoryOptionsOpen((value) => !value)}>
                            목록
                          </button>
                        </div>
                        <div
                          className="autocompleteWrap"
                          onBlur={() => window.setTimeout(() => setCategoryOptionsOpen(false), 100)}
                        >
                          <input
                            className="input"
                            autoComplete="off"
                            value={partForm.category}
                            onFocus={() => setCategoryOptionsOpen(true)}
                            onChange={(e) => {
                              setCategoryOptionsOpen(true);
                              setPartForm((v) => ({ ...v, category: e.target.value.toUpperCase() }));
                            }}
                            placeholder="목록 선택 또는 직접입력"
                          />
                          {categoryOptionsOpen && categorySuggestions.length > 0 ? (
                            <div className="autocompleteDropdown">
                              {categorySuggestions.map((category) => (
                                <button
                                  key={category.id}
                                  className={`autocompleteOption${category.name === partForm.category.trim().toUpperCase() ? " active" : ""}`}
                                  type="button"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => {
                                    setPartForm((v) => ({ ...v, category: category.name }));
                                    setCategoryOptionsOpen(false);
                                  }}
                                >
                                  <span>{category.name}</span>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="formRow">
                        <div className="inlineLabelRow">
                          <label className="label">파트 위치</label>
                          <button className="btn secondary small" type="button" onClick={() => setLocationOptionsOpen((value) => !value)}>
                            목록
                          </button>
                        </div>
                        <div
                          className="autocompleteWrap"
                          onBlur={() => window.setTimeout(() => setLocationOptionsOpen(false), 100)}
                        >
                          <input
                            className="input"
                            autoComplete="off"
                            value={partForm.position}
                            onFocus={() => setLocationOptionsOpen(true)}
                            onChange={(e) => {
                              setLocationOptionsOpen(true);
                              setPartForm((v) => ({ ...v, position: e.target.value.toUpperCase() }));
                            }}
                            placeholder="목록 선택 또는 직접입력"
                          />
                          {locationOptionsOpen && locationSuggestions.length > 0 ? (
                            <div className="autocompleteDropdown">
                              {locationSuggestions.map((location) => (
                                <button
                                  key={location.id}
                                  className={`autocompleteOption${location.code === partForm.position.trim().toUpperCase() ? " active" : ""}`}
                                  type="button"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => {
                                    setPartForm((v) => ({ ...v, position: location.code }));
                                    setLocationOptionsOpen(false);
                                  }}
                                >
                                  <span>{location.code}</span>
                                  <span className="meta">{location.description || "설명 없음"}</span>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        {partForm.position.trim() ? (
                          selectedLocationInfo ? (
                            <div className="locationFieldHint">
                              <span className="softBadge">{selectedLocationInfo.code}</span>
                              <span className="meta">{selectedLocationInfo.description || "설명 없음"}</span>
                            </div>
                          ) : (
                            <div className="meta">등록된 위치 설명이 없는 직접입력 코드입니다.</div>
                          )
                        ) : null}
                      </div>
                    </div>
                  </section>
                </div>

                <div className={`actions ${isMobileLayout ? "stickyActionBar" : ""}`}>
                  <button className="btn" type="submit" disabled={savingPart}>
                    {savingPart ? "저장 중..." : partForm.id ? "수정 저장" : "품종 등록"}
                  </button>
                  {partForm.id ? (
                    <button
                      className="btn danger"
                      type="button"
                      onClick={() => {
                        const editingPart = parts.find((part) => part.id === partForm.id);
                        if (editingPart) void deletePart(editingPart);
                      }}
                    >
                      품목 삭제
                    </button>
                  ) : null}
                  <button className="btn secondary" type="button" onClick={resetPartForm}>
                    폼 초기화
                  </button>
                </div>
              </form>
            </section>

            <section className="panel adminSidePanel">
              <div className="adminBlock">
                <div className="adminSectionHead" style={{ marginBottom: 10 }}>
                  <h3>등록 미리보기</h3>
                  <span className={`statusPill ${adminFormTone}`}>{partForm.id ? "수정 모드" : "신규 등록"}</span>
                </div>
                <div className="historyMiniList">
                  <div className="historyMiniItem">
                    <div className="meta">품목</div>
                    <strong>{normalizedPartItemNumber || "품목번호 입력 전"}{normalizedPartDesignation ? ` / ${normalizedPartDesignation}` : ""}</strong>
                  </div>
                  <div className="historyMiniItem">
                    <div className="meta">구분 / 위치</div>
                    <strong>{normalizedPartCategory || "-" } / {normalizedPartPosition || "-"}</strong>
                  </div>
                  <div className="historyMiniItem">
                    <div className="meta">재고 / 단위 / 등급</div>
                    <strong>{partForm.currentStock || "0"} / {partForm.unitOfQuantity} / {partForm.isBGrade ? "B급" : "정상품"}</strong>
                  </div>
                </div>
              </div>

              <div className="adminBlock">
                <div className="adminSectionHead" style={{ marginBottom: 10 }}>
                  <h3>빠른 점검</h3>
                  <span className="meta">저장 전 확인</span>
                </div>
                <div className="adminChecklist">
                  {adminChecklist.map((item) => (
                    <div key={item.label} className={`adminChecklistItem ${item.done ? "done" : ""}`}>
                      <span>{item.label}</span>
                      <strong>{item.done ? "완료" : "대기"}</strong>
                    </div>
                  ))}
                </div>
                {matchedAdminParts.length > 0 ? (
                  <div className="fieldHint pending" style={{ marginTop: 10 }}>
                    같은 품목번호가 이미 등록되어 있어 신규 등록보다 수정이 더 적절할 수 있습니다.
                  </div>
                ) : null}
              </div>

              <div className="adminBlock">
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
                  <div className="meta">현재 품종 등록 시 이 기준값이 최소재고로 적용됩니다.</div>
                </div>
              </div>

              <div className="adminBlock">
                <div className="adminSectionHead" style={{ marginBottom: 10 }}>
                  <h3>기준정보 바로가기</h3>
                  <span className="meta">입력 중 필요한 경우</span>
                </div>
                <div className="adminChecklist" style={{ marginBottom: 10 }}>
                  <div className="adminChecklistItem">
                    <span>구분 사용 현황</span>
                    <strong>{usedCategoryCount} 사용 / {categories.length - usedCategoryCount} 미사용</strong>
                  </div>
                  <div className="adminChecklistItem">
                    <span>위치 사용 현황</span>
                    <strong>{usedLocationCount} 사용 / {locations.length - usedLocationCount} 미사용</strong>
                  </div>
                </div>
                <div className="badgeRow" style={{ marginTop: 0, marginBottom: 10 }}>
                  <span className="softBadge">구분 {categories.length}개</span>
                  <span className="softBadge">위치 {locations.length}개</span>
                </div>
                <div className="actions">
                  <button className="btn secondary small" type="button" onClick={openCategoryManager}>
                    구분 관리 열기
                  </button>
                  <button className="btn secondary small" type="button" onClick={openLocationManager}>
                    위치 관리 열기
                  </button>
                </div>
              </div>
            </section>
          </div>
        ) : (
          <section className="panel">
            <div className="panelNotice">품종등록은 관리자 계정만 사용할 수 있습니다.</div>
          </section>
        )
      ) : null}

      {categoryModalOpen ? (
        <div className="scannerOverlay" role="dialog" aria-modal="true" aria-label="구분 관리">
          <div className="scannerModal manageModal">
            <div className="adminHeaderRow" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>구분 관리</h2>
              <button className="btn secondary small" type="button" onClick={() => setCategoryModalOpen(false)}>
                닫기
              </button>
            </div>
            <form onSubmit={submitCategory}>
              <div className="formRow">
                <label className="label">{categoryForm.id ? "구분 수정" : "새 구분 추가"}</label>
                <input
                  className="input"
                  autoComplete="off"
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm((prev) => ({ ...prev, name: e.target.value.toUpperCase() }))}
                  placeholder="예: FILLER / BLOWER / CAP"
                />
              </div>
              <div className="actions">
                <button className="btn secondary" type="submit" disabled={savingCategory}>
                  {savingCategory ? "저장 중..." : categoryForm.id ? "구분 수정" : "구분 저장"}
                </button>
                {categoryForm.id ? (
                  <button className="btn secondary" type="button" onClick={resetCategoryForm}>
                    새로 등록
                  </button>
                ) : null}
              </div>
            </form>
            <div className="manageList">
              {categories.map((category) => (
                <div key={category.id} className="manageRow">
                  <div className="manageRowBody">
                    <strong>{category.name}</strong>
                    <div className="badgeRow" style={{ marginTop: 0 }}>
                      <span className={`softBadge ${(partsPerCategory.get(category.name) || 0) === 0 ? "warn" : ""}`}>
                        등록된 파트 {partsPerCategory.get(category.name) || 0}개
                      </span>
                      <span className={`softBadge ${(partsPerCategory.get(category.name) || 0) === 0 ? "warn" : ""}`}>
                        {(partsPerCategory.get(category.name) || 0) > 0 ? "사용 중" : "미사용"}
                      </span>
                    </div>
                  </div>
                  <div className="actions">
                    <button className="btn secondary small" type="button" onClick={() => startEditCategory(category)}>
                      수정
                    </button>
                    <button
                      className="btn danger small"
                      type="button"
                      disabled={deletingCategoryId === category.id}
                      onClick={() => void deleteCategory(category)}
                    >
                      {deletingCategoryId === category.id ? "삭제 중..." : "삭제"}
                    </button>
                  </div>
                </div>
              ))}
              {categories.length === 0 ? <div className="panelNotice">등록된 구분이 없습니다.</div> : null}
            </div>
          </div>
        </div>
      ) : null}

      {locationModalOpen ? (
        <div className="scannerOverlay" role="dialog" aria-modal="true" aria-label="위치 관리">
          <div className="scannerModal manageModal">
            <div className="adminHeaderRow" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>위치 관리</h2>
              <button className="btn secondary small" type="button" onClick={() => setLocationModalOpen(false)}>
                닫기
              </button>
            </div>
            <form onSubmit={submitLocation}>
              <div className="formRow">
                <label className="label">{locationForm.id ? "위치 수정" : "새 위치 코드 추가"}</label>
                <input
                  className="input"
                  autoComplete="off"
                  value={locationForm.code}
                  onChange={(e) => setLocationForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
                  placeholder="예: F1 / R2 / A-03"
                />
              </div>
              <div className="formRow">
                <label className="label">위치 설명</label>
                <input
                  className="input"
                  autoComplete="off"
                  value={locationForm.description}
                  onChange={(e) => setLocationForm((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="예: 전면 좌측 상단"
                />
              </div>
              <div className="formRow">
                <label className="label">위치 사진</label>
                <input ref={locationFileInputRef} className="input fileInput" type="file" accept="image/*" />
                <div className="meta">이미지는 업로드 시 자동으로 줄여서 저장합니다.</div>
                {locationForm.imageUrl ? (
                  <div className="manageImagePreview">
                    <img src={locationForm.imageUrl} alt={`${locationForm.code || "위치"} 미리보기`} className="locationImage" />
                  </div>
                ) : null}
              </div>
              <div className="actions">
                <button className="btn secondary" type="submit" disabled={savingLocation}>
                  {savingLocation ? "저장 중..." : locationForm.id ? "위치 수정" : "위치 저장"}
                </button>
                {locationForm.id ? (
                  <button className="btn secondary" type="button" onClick={resetLocationForm}>
                    새로 등록
                  </button>
                ) : null}
              </div>
            </form>
            <div className="manageList">
              {locations.map((location) => (
                <div key={location.id} className="manageRow">
                  <div className="manageRowBody">
                    <strong>{location.code}</strong>
                    <span className="meta">{location.description || "설명 없음"}</span>
                    <div className="badgeRow" style={{ marginTop: 0 }}>
                      <span className={`softBadge ${(partsPerLocation.get(location.code) || 0) === 0 ? "warn" : ""}`}>
                        등록된 파트 {partsPerLocation.get(location.code) || 0}개
                      </span>
                      <span className={`softBadge ${(partsPerLocation.get(location.code) || 0) === 0 ? "warn" : ""}`}>
                        {(partsPerLocation.get(location.code) || 0) > 0 ? "사용 중" : "미사용"}
                      </span>
                    </div>
                    {location.image_url ? (
                      <div className="manageImagePreview">
                        <img src={location.image_url} alt={`${location.code} 위치`} className="locationImage" />
                      </div>
                    ) : null}
                  </div>
                  <div className="actions">
                    <button className="btn secondary small" type="button" onClick={() => startEditLocation(location)}>
                      수정
                    </button>
                    <button
                      className="btn danger small"
                      type="button"
                      disabled={deletingLocationId === location.id}
                      onClick={() => void deleteLocation(location)}
                    >
                      {deletingLocationId === location.id ? "삭제 중..." : "삭제"}
                    </button>
                  </div>
                </div>
              ))}
              {locations.length === 0 ? <div className="panelNotice">등록된 위치가 없습니다.</div> : null}
            </div>
          </div>
        </div>
      ) : null}

      {txBasketWorkTypeConfirm ? (
        <div className="scannerOverlay" role="dialog" aria-modal="true" aria-label="작업 유형 변경 확인">
          <div className="scannerModal">
            <div className="adminHeaderRow" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>작업 유형 변경</h2>
              <button className="btn secondary small" type="button" onClick={() => setTxBasketWorkTypeConfirm(null)}>
                닫기
              </button>
            </div>
            <div className="scannerGuide">
              현재 바구니의 작업 유형을 {formatTxModeLabel(txBasketWorkTypeConfirm)}로 변경하시겠습니까?
            </div>
            <div className="meta" style={{ marginTop: 8 }}>
              품목, 수량, 메모, 정상/B급 설정은 그대로 유지됩니다.
            </div>
            <div className="actions" style={{ marginTop: 14 }}>
              <button className="btn" type="button" onClick={confirmBasketWorkTypeChange}>
                확인
              </button>
              <button className="btn secondary" type="button" onClick={() => setTxBasketWorkTypeConfirm(null)}>
                취소
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {txBasketConfirmOpen ? (
        <div className="scannerOverlay" role="dialog" aria-modal="true" aria-label="작업 바구니 저장 확인">
          <div className="scannerModal stockModal">
            <div className="adminHeaderRow" style={{ marginBottom: 8 }}>
              <div>
                <h2 style={{ margin: 0 }}>작업 바구니 {formatTxModeLabel(txBasketType)} 확인</h2>
                <div className="meta">{txBasketItems.length}품목 / 합계 {txBasketTotalQty} / 작업 날짜 {txBasketDate}</div>
              </div>
              <button className="btn secondary small" type="button" onClick={() => setTxBasketConfirmOpen(false)} disabled={txBasketSubmitting}>
                닫기
              </button>
            </div>
            <div className="scannerGuide">
              아래 순서대로 저장합니다. 중간에 실패하면 그 품목에서 멈추고 뒤 품목은 미처리로 남습니다.
            </div>
            <div className="txBasketConfirmList">
              {txBasketItems.map((item) => (
                <div key={item.id} className="txBasketConfirmItem">
                  <div>
                    <strong>{item.part.item_number} / {item.part.designation}</strong>
                    <div className="meta">
                      {formatTxModeLabel(item.txType)} / 수량 {item.qty} / 날짜 {txBasketDate} / {item.isBGrade ? "B급" : "정상품"}
                    </div>
                    <div className="meta">
                      메모 {buildCombinedMemo(item.memo, txBasketCommonMemo) || "-"}
                    </div>
                  </div>
                  {item.txType === "OUT" && !item.isBGrade ? (
                    <label className="checkboxLine">
                      <input
                        type="checkbox"
                        checked={item.reclassifyToBGrade}
                        onChange={(e) => updateBasketReclassify(item.id, e.target.checked)}
                        disabled={txBasketSubmitting}
                      />
                      B급으로 재분류
                    </label>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="actions" style={{ marginTop: 12 }}>
              <button className="btn txSaveButton" type="button" onClick={() => void submitTxBasket()} disabled={txBasketSubmitting}>
                {txBasketSubmitting ? "처리 중..." : `전체 ${formatTxModeLabel(txBasketType)}처리`}
              </button>
              <button className="btn secondary" type="button" onClick={() => setTxBasketConfirmOpen(false)} disabled={txBasketSubmitting}>
                다시 확인
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {txBasketResult ? (
        <div className="scannerOverlay" role="dialog" aria-modal="true" aria-label="작업 바구니 처리 결과">
          <div className="scannerModal stockModal">
            <div className="adminHeaderRow" style={{ marginBottom: 8 }}>
              <div>
                <h2 style={{ margin: 0 }}>작업 바구니 처리 결과</h2>
                <div className="meta">
                  {formatTxModeLabel(txBasketResult.txType)} / 성공 {txBasketResult.results.filter((result) => result.status === "success").length}건
                </div>
              </div>
              <button className="btn secondary small" type="button" onClick={() => setTxBasketResult(null)}>
                닫기
              </button>
            </div>
            <div className="txBasketResultList">
              {txBasketResult.results.map((result) => (
                <div key={`${result.item.id}-${result.status}`} className={`txBasketResultItem ${result.status}`}>
                  <span className={`statusPill ${result.status === "success" ? "ready" : result.status === "failed" ? "warn" : "idle"}`}>
                    {result.status === "success" ? "성공" : result.status === "failed" ? "실패" : "미처리"}
                  </span>
                  <div>
                    <strong>{result.item.part.item_number} / {result.item.part.designation}</strong>
                    <div className="meta">
                      수량 {result.item.qty} / {result.item.isBGrade ? "B급" : "정상품"} / {result.message}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {txBasketItems.length > 0 ? (
              <div className="fieldHint pending" style={{ marginTop: 12 }}>
                성공한 품목은 바구니에서 제거했고, 실패 또는 미처리 품목은 다시 시도할 수 있도록 남겨두었습니다.
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {txActionConfirm ? (
        <div className="scannerOverlay" role="dialog" aria-modal="true" aria-label="최근 이력 작업 확인">
          <div className="scannerModal">
            <div className="adminHeaderRow" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>{txActionConfirm.kind === "edit" ? "최근 이력 수정 확인" : "최근 이력 삭제 확인"}</h2>
              <button className="btn secondary small" type="button" onClick={() => setTxActionConfirm(null)}>
                닫기
              </button>
            </div>
            {txActionConfirm.kind === "edit" ? (
              <>
                <div className="scannerGuide">
                  최근 이력을 수정하시겠습니까?
                </div>
                <div className="scannerConfirmBox">
                  <div><strong>{txActionConfirm.form.itemNumber} / {txActionConfirm.form.designation}</strong></div>
                  {currentEditingTransaction ? (
                    <>
                      <div className="meta" style={{ marginTop: 4 }}>
                        변경 전: {currentEditingTransaction.tx_type === "IN" ? "입고" : "사용"} / 수량 {currentEditingTransaction.qty} / 날짜 {formatDateInput(currentEditingTransaction.created_at)} / {currentEditingTransaction.is_b_grade ? "B급" : "정상품"}
                      </div>
                      <div className="meta" style={{ marginTop: 4 }}>
                        변경 후: {txActionConfirm.form.txType === "IN" ? "입고" : "사용"} / 수량 {txActionConfirm.form.qty} / 날짜 {txActionConfirm.form.txDate} / {txActionConfirm.form.isBGrade ? "B급" : "정상품"}
                      </div>
                    </>
                  ) : null}
                  <div className="meta" style={{ marginTop: 4 }}>
                    메모 {txActionConfirm.form.memo || "-"}
                  </div>
                  <div className="meta" style={{ marginTop: 6 }}>
                    수정이 완료되면 재고도 변경된 내용 기준으로 다시 계산됩니다.
                  </div>
                </div>
                <div className="actions" style={{ marginTop: 12 }}>
                  <button className="btn" type="button" onClick={() => void confirmTransactionEdit(txActionConfirm.form)}>
                    수정 진행
                  </button>
                  <button className="btn secondary" type="button" onClick={() => setTxActionConfirm(null)}>
                    취소
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="scannerGuide">
                  최근 이력을 삭제하시겠습니까?
                </div>
                <div className="scannerConfirmBox">
                  <div><strong>{txActionConfirm.tx.parts?.item_number || "-"} / {txActionConfirm.tx.parts?.designation || "-"}</strong></div>
                  <div className="meta" style={{ marginTop: 4 }}>
                    {formatTxTypeLabel(txActionConfirm.tx.tx_type)} / 수량 {txActionConfirm.tx.qty} / {txActionConfirm.tx.is_b_grade ? "B급" : "정상품"}
                  </div>
                  <div className="meta" style={{ marginTop: 4 }}>
                    기록 {formatDisplayDate(txActionConfirm.tx.created_at)} / {txActionConfirm.tx.actor_name || "기록자 없음"}
                  </div>
                  <div className="meta" style={{ marginTop: 6 }}>
                    삭제가 완료되면 이력 기록이 지워지고, 재고 수량도 원래 상태로 함께 원복됩니다.
                  </div>
                </div>
                <div className="actions" style={{ marginTop: 12 }}>
                  <button className="btn danger" type="button" onClick={() => void confirmDeleteTransaction(txActionConfirm.tx)}>
                    삭제 진행
                  </button>
                  <button className="btn secondary" type="button" onClick={() => setTxActionConfirm(null)}>
                    취소
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {txActionResult ? (
        <div className="scannerOverlay" role="dialog" aria-modal="true" aria-label="최근 이력 작업 완료">
          <div className="scannerModal">
            <div className="adminHeaderRow" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>{txActionResult.title}</h2>
              <button className="btn secondary small" type="button" onClick={() => setTxActionResult(null)}>
                닫기
              </button>
            </div>
            <div className="scannerConfirmBox">
              <div>{txActionResult.message}</div>
            </div>
            <div className="actions" style={{ marginTop: 12 }}>
              <button className="btn" type="button" onClick={() => setTxActionResult(null)}>
                확인
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {txEditForm ? (
        <div className="scannerOverlay" role="dialog" aria-modal="true" aria-label="최근 이력 수정">
          <div className="scannerModal">
            <div className="adminHeaderRow" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>최근 이력 수정</h2>
              <button className="btn secondary small" type="button" onClick={() => setTxEditForm(null)}>
                닫기
              </button>
            </div>
            <form onSubmit={submitTransactionEdit}>
              <div className="formRow">
                <label className="label">품목</label>
                <div className="panelNotice">
                  {txEditForm.itemNumber} / {txEditForm.designation}
                </div>
              </div>
              <div className="formRow">
                <label className="label">구분</label>
                <select className="select" value={txEditForm.txType} onChange={(e) => setTxEditForm((prev) => (prev ? { ...prev, txType: e.target.value as "IN" | "OUT" } : prev))}>
                  <option value="IN">입고 (IN)</option>
                  <option value="OUT">사용 (OUT)</option>
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
                  value={txEditForm.qty}
                  onChange={(e) => setTxEditForm((prev) => (prev ? { ...prev, qty: e.target.value } : prev))}
                />
              </div>
              <div className="formRow">
                <label className="label">날짜</label>
                <input
                  className="input"
                  type="date"
                  value={txEditForm.txDate}
                  onChange={(e) => setTxEditForm((prev) => (prev ? { ...prev, txDate: e.target.value } : prev))}
                />
              </div>
              <div className="formRow">
                <label className="label">메모</label>
                <input className="input" autoComplete="off" value={txEditForm.memo} onChange={(e) => setTxEditForm((prev) => (prev ? { ...prev, memo: e.target.value } : prev))} />
              </div>
              <label className="checkRow" style={{ marginBottom: 12 }}>
                <input
                  type="checkbox"
                  checked={txEditForm.isBGrade}
                  onChange={(e) => setTxEditForm((prev) => (prev ? { ...prev, isBGrade: e.target.checked } : prev))}
                />
                B급
              </label>
              <div className="actions">
                <button className="btn" type="submit" disabled={savingTxEdit}>
                  {savingTxEdit ? "저장 중..." : "수정 저장"}
                </button>
                <button className="btn secondary" type="button" onClick={() => setTxEditForm(null)}>
                  취소
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {scannerOpen ? (
        <div className="scannerOverlay" role="dialog" aria-modal="true" aria-label="바코드/QR 스캔">
          <div className="scannerModal">
            <div className="adminHeaderRow" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>바코드/QR 스캔</h2>
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
              {isMobileLayout ? "모바일: 바코드나 QR을 10~20cm 거리에서 천천히 맞춰주세요." : "PC: 카메라 앞 바코드나 QR을 중앙에 고정해주세요."}
            </div>
            <div className="scannerFrame">
              <video ref={scannerVideoRef} className="scannerVideo" muted playsInline />
              <div className="scannerAim" aria-hidden="true" />
            </div>
            <div className="meta" style={{ marginTop: 8 }}>
              {(scannerTarget === "search" ? "[검색] " : scannerTarget === "part" ? "[품종 등록] " : "[입고/사용처리] ") + (scannerError || scannerStatus)}
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
          </div>
        </div>
      ) : null}
    </main>
  );
}
