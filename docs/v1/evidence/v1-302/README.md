# V1-302 화면 증거 — 없어진 최근 폴더

**상태:** `EVIDENCE / NOT_A_CODE_CHANGE`
**기능 커밋:** `47dc43ecc3a7fee30b556bbdd26e736aa3532904`. 이 디렉터리는 그 화면을 다시 만들지 않는다.
**캡처:** `aa1ad60` 트리의 `npm test` 안 `tests/e2e/visual.mjs`. 원본은 gitignore `tmp-visual/` 이고, 여기 파일은 그 실행에서 복사했다. `--update-golden` 은 쓰지 않았다. `DESIGN_BASELINE.md` 는 그대로다.

프로젝트 이름은 임시 시드 `juqode-seed-*` 다. 집 경로와 비밀값은 없다. e2e Claude 는 fixture `9.9.9-fixture` 다.

| 파일 | 화면 |
| --- | --- |
| `sc01-absent-light.png` | 밝은 테마. 폴더가 있는 줄은 마지막 작업과 결과 칩을 보이고, 없는 줄은 `이 폴더는 지금 없어요` 만 보인다. |
| `sc01-absent-dark.png` | 같은 상태의 어두운 테마. |
