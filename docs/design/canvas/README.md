# ScreenSpec 캔버스

JuQode 다섯 화면의 **모든 상태**와 디자인 토큰. 25장 · 6페이지.

공개된 캔버스: https://claude.ai/code/artifact/2bfc1ff5-dfaa-492b-a1b0-3c17a421e03f

## 고치는 곳

```
shell.mjs      아트보드 공용 셸 — 토큰 CSS 와 프리미티브. 값은 app/renderer/design/ 의 사본이다.
ui.mjs         마크업 조각 (spec · card · chip · btn · nextacts …)
bodies/*.mjs   화면별 아트보드 정의. **여기만 고친다.**
build.mjs      위 셋에서 *.dc.html 과 canvas.json 을 만든다
```

`*.dc.html` · `canvas.json` · `juqode-screenspec.html` 은 전부 결과물이라 저장소에 두지 않는다.

## 다시 만들기

```sh
node build.mjs
B=<design 스킬의 base directory>
ARGS=""; for f in *.dc.html; do ARGS="$ARGS --artboard $f"; done
node "$B/seed-canvas.mjs" --template "$B/payload.template.html" \
  --out juqode-screenspec.html --title "JuQode ScreenSpec" $ARGS --canvas canvas.json
node "$B/seed-canvas.mjs" --check juqode-screenspec.html
```

그리고 같은 URL 로 다시 게시한다.

## 값의 출처

색·치수·글꼴은 `app/renderer/design/tokens.css` 와 `base.css` 에서, 문구는 `app/renderer/copy.js` 에서
그대로 옮겼다. **여기서 값을 만들지 않는다** — 앱이 원본이고 이 폴더는 사본이다. 앱이 바뀌면
`shell.mjs` 와 해당 body 를 고친 뒤 다시 만든다.

Canon 과 갈라진 지점은 `../ERD.md` §5 가 적고 있다.
