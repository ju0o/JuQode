# Client Review Hub

고객에게 GitHub Pages 링크 하나를 보내고, 최종 피드백은 Supabase DB로 직접 받는 재사용 구조입니다.

## URL 규칙

- 허브: `https://ju0o.github.io/JuQode/client-review/`
- 프로젝트: `https://ju0o.github.io/JuQode/client-review/<project-slug>/`
- 현재 보험 CRM: `https://ju0o.github.io/JuQode/client-review/insurance-crm/`

## 구조

```text
GitHub Pages (UI / Prototype)
  client-review/<project-slug>/index.html
          |
          | POST JSON
          v
Supabase Edge Function
  submit-prototype-feedback
          |
          v
PostgreSQL
  prototype_projects
  prototype_feedback
```

## 피드백 API

Endpoint:

`https://dkfgldzwsmnqucdudkoj.supabase.co/functions/v1/submit-prototype-feedback`

고객 브라우저에는 Supabase service-role key를 절대 넣지 않습니다. 공개 페이지는 Edge Function에만 POST하고, Edge Function이 서버 측 service role로 DB에 저장합니다.

## 신규 고객 프로젝트 추가 절차

1. `prototype_projects`에 새 `slug`, `name`, `current_version`, `public_path` 등록.
2. `gh-pages/client-review/<slug>/index.html` 생성.
3. 페이지 설정값의 `projectSlug`, `prototypeVersion`, `reviewRound` 지정.
4. 최종 피드백 폼에서 `submit-prototype-feedback` 호출.
5. 고객에게 GitHub Pages URL 하나만 전달.
6. 피드백은 `prototype_feedback`에서 `project_slug` 기준으로 조회.

## 보안 원칙

- DB 테이블 RLS 활성화.
- 공개 anon DB insert policy를 만들지 않음.
- service role은 Edge Function 안에서만 사용.
- 고객 페이지에는 실제 고객 개인정보를 넣지 않고 예시 데이터만 사용.
- 제출 API는 허용 프로젝트 slug 검증, 입력 길이 제한, honeypot 필드 사용.

## 승인 반복

`검토 링크 -> 고객 피드백 -> DB 저장 -> 다음 버전 반영 -> 같은 URL 업데이트 -> 최종 승인`

고객은 매번 새 파일을 받을 필요가 없고 같은 프로젝트 URL만 다시 열면 됩니다.
