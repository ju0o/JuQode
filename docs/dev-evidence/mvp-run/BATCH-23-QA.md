# 배치 23 — 테스트가 사용자의 실제 앱 데이터에 쓰고 있었다

502 tests · e2e 3종. Canon 발견 없음.

| 심각도 | 수 |
|---|---|
| BLOCKER | 0 |
| **HIGH** | **1** |

---

## HIGH · e2e 가 매 실행마다 `~/.config/juqode/evidence` 에 저장소를 남기고 있었다

`JUQODE_DB` 가 저장소 파일을 임시 디렉터리로 옮긴다. 그런데 **증거 저장소는 옮기지 않았다** —
`main.js` 가 그것을 `app.getPath('userData')` 에서 파생하기 때문이다:

```js
const evidenceRoot = () => path.join(app.getPath('userData'), 'evidence');
```

그래서 e2e 가 프로젝트마다 만드는 bare git 저장소가 전부 **개발자 본인의
`~/.config/juqode/evidence`** 로 갔다. 세어 보니 **201개**였고, 상한도 정리하는 것도 없다.

이 런이 명시적으로 지키기로 한 제약과 정면으로 어긋난다 — **테스트는 일회용 스크래치를 쓰고
실제 사용자 데이터를 건드리지 않는다.** 그리고 이 실패는 **보이지 않는다**: 테스트는 어느 쪽이든
통과하고, 증상은 누군가의 홈 디렉터리가 조용히 커지는 것뿐이다.

### 고친 방식 — 변수 하나가 전부를 옮긴다

경로마다 환경 변수를 하나씩 더하면, 다음에 추가되는 경로가 똑같이 잊힌다. `userData` 자체를
옮긴다:

```js
if (process.env.JUQODE_USER_DATA) app.setPath('userData', process.env.JUQODE_USER_DATA);
```

저장소 · 증거 · Chromium 프로필까지 **전부** 따라온다. `app.whenReady()` 보다 **먼저** 일어나야
해서 파일의 첫 줄이다.

세 하네스(`visual` · `boot` · `offline-shutdown`)가 각자 새 임시 디렉터리를 만들어 넘긴다.

### 검사 셋 — 전부 다른 것을 본다

1. **관측.** `visual.mjs` 가 실행이 끝난 뒤 **자기** `USER_DATA/evidence` 안에 실제로 쓰인
   저장소가 있는지 본다. 변수를 넘겼는지가 아니라 **이전이 실제로 일어났는지**를 잰다.
2. **순서.** `setPath` 가 `requestSingleInstanceLock` 보다, 그리고 어떤 `getPath('userData')`
   보다 앞서는지. 나중에 옮기면 아무 소용이 없다.
3. **누락.** 각 하네스에서 **앱을 띄우는 횟수와 옮기는 횟수가 같은지.** 하나만 빠져도 그
   실행은 실제 디렉터리에 쓰고, 다른 모든 검사를 통과한다.

돌연변이 둘로 확인했다: `setPath` 제거 · 하네스 하나에서만 누락 — 둘 다 죽었다.

### 남아 있는 201개는 지우지 않았다

`~/.config/juqode/evidence` 의 기존 디렉터리들은 **그대로 두었다.** 어느 것이 이 런의 테스트
잔여물이고 어느 것이 사용자가 앱을 직접 돌려서 생긴 것인지 구별할 방법이 없고, 사용자의 홈
아래를 지우는 것은 사용자의 결정이다. 크기는 `~/.config/juqode` 전체 33MB 이고, 정리하려면
`~/.config/juqode/evidence` 를 통째로 지우면 된다 — 앱은 다음 Work 에서 다시 만든다.

### 이번 라운드에서 세 번째로 걸린 함정

`main.js` 의 순서 검사가 **자기 주석에 걸려 실패했다** — 수정 위의 주석이 설명하느라
`app.getPath('userData')` 를 적어 두었기 때문이다. 이번 런에서 문자열 검사가 "파일이 자기가
하지 않는 일을 서술한 것" 에 속은 것이 이걸로 세 번째다(`presence.js` 의 `setInterval`,
`nextaction.js` 의 `declared`, 그리고 이것).

**규칙으로 적어 둔다: 소스를 문자열로 검사할 때는 언제나 주석을 먼저 벗긴다.**
