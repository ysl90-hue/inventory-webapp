export const KEEP_LOGIN_KEY = "inventory_keep_login";
export const CURRENT_SESSION_KEY = "inventory_current_session";

export function getShouldKeepLogin() {
  try {
    return window.localStorage.getItem(KEEP_LOGIN_KEY) !== "false";
  } catch {
    return true;
  }
}

export function markCurrentSessionActive() {
  try {
    window.sessionStorage.setItem(CURRENT_SESSION_KEY, "true");
  } catch {
    // ignore storage errors
  }
}

export function clearCurrentSessionMarker() {
  try {
    window.sessionStorage.removeItem(CURRENT_SESSION_KEY);
  } catch {
    // ignore storage errors
  }
}

export function canUseCurrentSession() {
  try {
    return window.sessionStorage.getItem(CURRENT_SESSION_KEY) === "true";
  } catch {
    return false;
  }
}
