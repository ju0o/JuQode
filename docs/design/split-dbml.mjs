/* erd.dbml 하나에서 dbdiagram.io 에 올릴 조각들을 만든다.
 *
 * 왜 나누는가: dbdiagram 은 다이어그램 하나에 파일 하나다. 그리고 이 ERD 는 사실
 * **데이터베이스가 둘**이다 — 지금 있는 로컬 SQLite 와, 아직 없는 서버 Postgres.
 * 한 장에 그리면 보는 사람이 "지금 저게 다 있나" 를 구분할 수 없다.
 *
 * 나누는 기준은 TableGroup 이다. 표를 손으로 고르지 않으므로 원본이 바뀌면 조각도 따라간다.
 * 관계선은 **양끝이 모두 그 조각 안에 있을 때만** 옮긴다 — 한쪽만 있는 선을 옮기면
 * dbdiagram 이 없는 표를 참조한다고 거절한다.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = new URL('./erd.dbml', import.meta.url);
const src = readFileSync(SRC, 'utf8');

const PARTS = [
  {
    out: 'erd-1-mvp-local.dbml',
    title: 'JuQode_MVP_Local',
    groups: ['MVP · 룩업', 'MVP · 프로젝트와 해석', 'MVP · Work 와 증거', 'MVP · 변경', 'MVP · Quick Command'],
    head: [
      '// JuQode — MVP 로컬 데이터베이스',
      '//',
      '// **지금 실제로 있는 것.** app/main/db/schema.sql 의 26개 표 + MIGRATIONS.',
      '// 엔진은 로컬 임베디드 SQLite 다 (D-129). database_type 이 PostgreSQL 인 것은',
      '// DDL 이 양쪽에서 도는 방언으로 쓰여 있기 때문이고, dbdiagram 이 엔진을 하나만',
      '// 받기 때문이다.',
      '//',
      '// 로그인도 구독도 서버도 없다. 이 단계에서 확인하는 것은 하나다 —',
      '// Claude Code 가 이 도구와 실제로 연동되는가.',
      '//',
      '// 표기: note \'MVP/미사용\' = 컬럼은 있으나 아무도 값을 넣지 않는다.',
      '//      note \'V1\'        = V1 부터 생긴다. 지금 스키마에는 없다.',
      '//      Note (표 단위)    = DBML 로 표현할 수 없는 것만 — CHECK · 부분 인덱스 · 알려진 구멍.',
    ],
  },
  {
    out: 'erd-2-v1-server.dbml',
    title: 'JuQode_V1_Server',
    groups: ['V1 · 룩업', 'V1 · 계정', 'V1 · 구독', 'V1 · 권한과 사용량'],
    head: [
      '// JuQode — V1 서버 데이터베이스',
      '//',
      '// **아직 없는 것.** 배포(V1)부터 생긴다. Supabase Postgres.',
      '//',
      '// 로컬과 이어지는 유일한 지점은 project.owner_id -> profile.id 인데,',
      '// 데이터베이스가 달라 외래키로 강제되지 않는다. 그래서 이 그림에 그 선은 없다.',
      '// 서버는 클라이언트가 보낸 사용자 ID 를 읽지 않는다 — 로그인 토큰에서 서버가',
      '// 직접 꺼낸 값만 쓴다.',
      '//',
      '// 표기: Note (표 단위) = 시드가 필요한 곳, 신뢰 경계, 부분 인덱스.',
    ],
  },
  {
    out: 'erd-3-proposed.dbml',
    title: 'JuQode_Proposed',
    groups: ['제안 · 아직 없음'],
    head: [
      '// JuQode — 제안된 표',
      '//',
      '// **아직 schema.sql 에 없다.** 마이그레이션이 필요하고 아직 쓰지 않았다.',
      '// 재시작 뒤에 "이전 실행이 남긴 것" 과 "지금 실행이 만든 것" 을 가르기 위한 것이다.',
      '//',
      '// 함께 제안된 컬럼(전체 그림에서 note \'제안\' 으로 표시):',
      '//   work.runner_session_id · runner_pid · runner_started_at',
      '//   quick_command_run.runner_session_id · runner_pid · runner_started_at',
    ],
  },
];

/* 원본에서 조각을 뜯어낸다. */
const tables = new Map([...src.matchAll(/(Table (\w+) \{.*?\n\})/gs)].map((m) => [m[2], m[1]]));
const groups = new Map([...src.matchAll(/TableGroup "([^"]+)" \{\n((?:  \w+\n)+)\}/g)]
  .map((m) => [m[1], m[2].trim().split('\n').map((l) => l.trim())]));
const refs = [...src.matchAll(/^Ref: ([\w.]+) ([<>-]) ([\w.]+)(?: \[[^\]]*\])?$/gm)].map((m) => m[0]);
const tableOf = (endpoint) => endpoint.split('.')[0];

let report = [];
for (const part of PARTS) {
  const names = part.groups.flatMap((g) => {
    const got = groups.get(g);
    if (!got) throw new Error(`TableGroup 이 원본에 없다: ${g}`);
    return got;
  });
  const set = new Set(names);

  const kept = [];
  const dropped = [];
  for (const r of refs) {
    const m = /^Ref: ([\w.]+) [<>-] ([\w.]+)/.exec(r);
    const a = tableOf(m[1]), b = tableOf(m[2]);
    if (set.has(a) && set.has(b)) kept.push(r);
    else if (set.has(a) || set.has(b)) dropped.push(`${r}   // 반대쪽(${set.has(a) ? b : a})이 이 그림에 없다`);
  }

  const body = [
    ...part.head,
    '',
    /* 따옴표 없는 식별자. dbdiagram 은 Project 이름에 공백·괄호를 받지 않는다. */
    `Project ${part.title} {`,
    "  database_type: 'PostgreSQL'",
    '}',
    '',
    ...names.map((n) => (tables.get(n) ?? (() => { throw new Error(`표가 없다: ${n}`); })()) + '\n'),
    '',
    '// ── 관계 ──',
    ...kept,
    ...(dropped.length ? ['', '// ── 이 그림 밖으로 나가는 연결 (선을 긋지 않는다) ──', ...dropped.map((d) => `// ${d}`)] : []),
    '',
    ...part.groups.map((g) => `TableGroup "${g}" {\n${groups.get(g).map((n) => `  ${n}`).join('\n')}\n}`),
    '',
  ].join('\n');

  writeFileSync(new URL(`./${part.out}`, import.meta.url), body);
  report.push(`${part.out} — 표 ${names.length}개 · 관계 ${kept.length}개${dropped.length ? ` · 밖으로 나가는 연결 ${dropped.length}개` : ''}`);
}

/* 어느 조각에도 안 들어간 표가 있으면 원본이 그룹을 빠뜨린 것이다. */
const covered = new Set(PARTS.flatMap((p) => p.groups.flatMap((g) => groups.get(g))));
const orphan = [...tables.keys()].filter((t) => !covered.has(t));
if (orphan.length) throw new Error(`어느 조각에도 없는 표: ${orphan.join(', ')}`);

console.log(report.join('\n'));
console.log(`원본 erd.dbml — 표 ${tables.size}개 · 관계 ${refs.length}개 (전체를 한 장에)`);
