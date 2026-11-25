// Book Técnico — app desktop.
// A janela começa no launcher (desktop/launcher/index.html), que pergunta o endereço do servidor
// na primeira vez e depois abre o site. Nenhum comando nativo é exposto ao site (sem IPC).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Book Técnico");
}
