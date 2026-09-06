// A1b Tauri 벤치 셸 — DISPOSABLE. 제품이 아니다.
fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
