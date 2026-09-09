/* Korean UX copy for SC-01.
 *
 * SOURCE OF TRUTH: JuQode-Private docs/current/18_KOREAN_UX_COPY.md.
 * Every string below is TRANSCRIBED from that dictionary by key. Do not edit here —
 * edit 18 first. Keys not yet needed by SC-01 are deliberately absent.
 */
export const C = {
  app: {
    name: 'JuQode',
  },
  sc01: {
    title:      '프로젝트 열기',
    lead:       '내 컴퓨터에 있는 프로젝트 폴더를 열면, JuQode가 먼저 이 프로젝트가 무엇인지 읽어 드려요.',
    open:       '프로젝트 폴더 열기',
    openHint:   '이미 있는 폴더를 고르면 돼요. 새로 만들지는 않아요.',
    opening:    '폴더를 읽고 있어요…',
    recent:     '최근에 연 프로젝트',
    recentNote: '최근에 연 폴더만 보여요.',
    noHistory:  '아직 기록이 없어요 — 처음 열기',
    failTitle:  '이 폴더는 열 수 없어요',
    other:      '▸ 다른 폴더 고르기',
  },
  /* Not in Canon 18 yet: SC-01 has no "folder open is not built" state, because in the
   * finished product it always is. These are DEV-ONLY strings for the WBS-01 shell and are
   * marked as such so they cannot be mistaken for approved copy. They use the Canon
   * `unavailable.chip` vocabulary (18:145) rather than inventing a failure voice. */
  dev: {
    notReadyTitle: '아직 준비되지 않았어요',
    notReadyChip:  '지금 안 됨 · 실패 아님',   // 18 `unavailable.chip` — verbatim
  },

  theme: {
    label:  '테마',
    light:  '밝게',
    dark:   '어둡게',
    system: '시스템',
  },
};
