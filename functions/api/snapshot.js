// GET /api/snapshot
// GitHub에서 가격 스냅샷을 직접 읽어 반환한다.
// 스냅샷 Action 커밋은 [skip ci]라 Pages 재배포를 건너뛰지만,
// 이 함수는 요청 시점에 저장소에서 직접 읽으므로 재배포 없이 항상 최신이다.
// 실패 시 비-200을 반환해, 프론트가 정적 파일(/data/prices/latest.json)로 폴백하게 한다.
import { readJson } from './_github.js';

const SNAPSHOT_PATH = 'public/data/prices/latest.json';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  // 스냅샷은 10분 주기로 갱신되므로 짧게 캐시해 GitHub API 호출을 줄인다.
  'Cache-Control': 'public, max-age=60',
};

export async function onRequestGet({ env }) {
  if (!env || !env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    // 환경변수 미설정 → 폴백 유도
    return new Response(JSON.stringify({ error: '서버 환경변수(GITHUB_*) 미설정' }), {
      status: 500,
      headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' },
    });
  }
  try {
    const { data } = await readJson(env, SNAPSHOT_PATH);
    if (!data) throw new Error('스냅샷 파일 없음');
    return new Response(JSON.stringify(data), { headers: JSON_HEADERS });
  } catch (e) {
    return new Response(JSON.stringify({ error: `스냅샷 읽기 실패: ${e.message}` }), {
      status: 502,
      headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' },
    });
  }
}
