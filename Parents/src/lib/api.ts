// Talking to the Musabe system (backend /api/parent).
// - Address: EXPO_PUBLIC_API_URL (e.g. https://musabe.example.com) when set. While developing with Expo Go, the phone
//   reuses the computer address from the exp:// link and talks to the backend on port 4310 directly.
// - Sign-in token: kept in the phone's secure storage (Keychain / Keystore), sent as "Authorization: Bearer ...".
// - Every request says the app language (X-Lang), so messages from the server come back in that language.
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

import type { Lang } from './i18n';

const DEV_PORT = 4310;
export function apiBase() {
  const env = process.env.EXPO_PUBLIC_API_URL;
  if (env) return `${env.replace(/\/$/, '')}/api/parent`;
  const host = Constants.expoConfig?.hostUri?.split(':')[0] || 'localhost';
  return `http://${host}:${DEV_PORT}/api/parent`;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const TOKEN = 'musabe_parent_token';
let token: string | null = null;
let lang: Lang = 'sw';
let onSignedOut: (() => void) | null = null;

export const setApiLang = (l: Lang) => { lang = l; };
export const setSignedOutHandler = (fn: (() => void) | null) => { onSignedOut = fn; };
export async function loadToken() {
  try { token = await SecureStore.getItemAsync(TOKEN); } catch { token = null; }
  return token;
}
export async function saveToken(t: string | null) {
  token = t;
  try { if (t) await SecureStore.setItemAsync(TOKEN, t); else await SecureStore.deleteItemAsync(TOKEN); } catch { /* keeps working this session */ }
}
export const authHeaders = (): Record<string, string> => (token ? { Authorization: `Bearer ${token}`, 'X-Lang': lang } : { 'X-Lang': lang });

export async function api<T = unknown>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: object, netMessage = 'Network error'): Promise<T> {
  let res: Response;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20000);
    res = await fetch(`${apiBase()}${path}`, {
      method,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...authHeaders() },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
    clearTimeout(timer);
  } catch {
    throw new ApiError(0, netMessage);
  }
  let data: { error?: string } = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    if (res.status === 401 && token && !path.startsWith('/auth/')) { await saveToken(null); onSignedOut?.(); }
    throw new ApiError(res.status, data.error || `Error ${res.status}`);
  }
  return data as T;
}

// ---------- What the server sends ----------
export type Parent = { id: number; phone: string; fullName: string; locale: Lang };
export type School = { id: number; name: string; shortName: string; code: string };
export type Child = {
  id: number; fullName: string; firstName: string; admissionNo: string; sex: 'M' | 'F'; status: 'active' | 'left';
  class: string; classFull: string; school: School; photo: number | null;
  itemsWaiting: number; bills: number; billsTotal: number; unread: number; borrowed: number;
  idCard: string | { no: number; issuedAt: string } | null;
};
export type Me = { parent: Parent; children: Child[]; requestsPending: number };
export type Receipt = {
  id: number; number: string; total: number; method: 'cash' | 'bank' | 'mobile' | 'control'; reference: string | null;
  status: 'waiting' | 'part' | 'given'; soldAt: string; givenAt: string | null; class: string; payer: string | null;
  lines: { item: string; qty: number; price: number; amount: number; given: number; waitingStock: boolean }[];
};
export type Bill = {
  id: number; controlNo: string; total: number; createdAt: string; expiresAt: string; paidAt: string | null;
  claimRef: string | null; claimNetwork: string | null; claimAt: string | null; lipa: { network: string; number: string; name: string }[];
  status: 'pending' | 'paid' | 'cancelled' | 'expired'; lines: { item: string; qty: number; amount: number }[];
};
export type Issued = { id: number; number: string; at: string; item: string; unit: string; qty: number; comesBack: boolean; returned: 'good' | 'damaged' | 'lost' | null; returnedAt: string | null };
export type Notice = { id: number; childId: number; child: string; childFull: string; school: string; kind: 'given' | 'issued' | 'returned' | 'receipt'; title: string; body: string; ref: string | null; at: string; unread: boolean };
export type Request = { id: number; childName: string; admissionNo: string | null; className: string | null; relation: string; status: 'pending' | 'done' | 'rejected'; answer: string | null; school: string; at: string };
