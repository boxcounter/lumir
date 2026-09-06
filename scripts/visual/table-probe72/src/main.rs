#[tauri::command]
fn diagnostic(value: String) { eprintln!("probe diagnostic {value}"); }

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![diagnostic])
        .on_page_load(|webview, payload| {
            eprintln!("probe page {:?} {}", payload.event(), payload.url());
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                let _ = webview.eval("setTimeout(()=>window.__TAURI_INTERNALS__.invoke('diagnostic',{value:JSON.stringify({url:location.href,title:document.title,body:document.body.innerText.slice(0,1000),width:innerWidth,height:innerHeight,rect:document.body.getBoundingClientRect().toJSON(),visibility:document.visibilityState,focus:document.hasFocus(),scripts:[...document.scripts].map(s=>s.src)})}),2000)");
            }
        })
        .run(tauri::generate_context!())
        .expect("isolated table probe failed");
}
