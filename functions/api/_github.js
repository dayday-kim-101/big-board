// GitHub Contents API 래퍼 — Pages Function과 스냅샷 스크립트가 공유.
// 파일명이 '_'로 시작하므로 라우트로 노출되지 않는다.
// crypto.subtle / btoa / atob / fetch 는 Workers·Node20 양쪽에서 전역 제공.

const API = 'https://api.github.com';
const UA = 'stock-bigboard';

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// 이메일 → 파일 키(sha256 hex). 정규화된 이메일 기준.
export async function emailKey(email) {
  const norm = normalizeEmail(email);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(norm));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function userPath(hash) {
  return `data/users/${hash}.json`;
}

// --- base64 (UTF-8 안전) ---
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function fromBase64(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function cfg(env) {
  const [owner, repo] = String(env.GITHUB_REPO || '').split('/');
  return {
    owner,
    repo,
    branch: env.GITHUB_BRANCH || 'main',
    token: env.GITHUB_TOKEN,
  };
}

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': UA,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

// 파일 읽기 → { data: <파싱된 JSON | null>, sha: <문자열 | null> }
// 404면 data:null, sha:null.
export async function readJson(env, path) {
  const { owner, repo, branch, token } = cfg(env);
  const url = `${API}/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, { headers: headers(token) });
  if (res.status === 404) return { data: null, sha: null };
  if (!res.ok) throw new Error(`GitHub read ${res.status}: ${await res.text()}`);
  const body = await res.json();
  return { data: JSON.parse(fromBase64(body.content)), sha: body.sha };
}

// 파일 쓰기(생성/갱신). SHA 충돌(409/422) 시 최신 SHA로 1회 재시도.
export async function writeJson(env, path, obj, message) {
  const { owner, repo, branch, token } = cfg(env);
  const url = `${API}/repos/${owner}/${repo}/contents/${path}`;
  const content = toBase64(JSON.stringify(obj, null, 2));

  const put = (sha) =>
    fetch(url, {
      method: 'PUT',
      headers: { ...headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content, branch, ...(sha ? { sha } : {}) }),
    });

  let { sha } = await readJson(env, path);
  let res = await put(sha);
  if (res.status === 409 || res.status === 422) {
    // 동시 수정으로 SHA가 어긋남 — 최신 SHA로 1회 재시도
    ({ sha } = await readJson(env, path));
    res = await put(sha);
  }
  if (!res.ok) throw new Error(`GitHub write ${res.status}: ${await res.text()}`);
  return res.json();
}
