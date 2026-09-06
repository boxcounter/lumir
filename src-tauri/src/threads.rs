use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use ts_rs::TS;
use crate::{commands::CommandError, config};

#[derive(Debug,Clone,Serialize,Deserialize,TS,PartialEq)]
#[ts(export, export_to="../../src/bindings/")]
#[serde(rename_all="lowercase")]
pub enum ThreadStatus { Active, Paused, Completed, Archived }
#[derive(Debug,Clone,Serialize,Deserialize,TS)]
#[ts(export, export_to="../../src/bindings/")]
pub struct ThreadFile { pub vault_id:String, pub path:String, pub role:String }
#[derive(Debug,Clone,Serialize,Deserialize,TS)]
#[ts(export, export_to="../../src/bindings/")]
pub struct VaultWorkspace { pub id:String, pub path:String }
#[derive(Debug,Clone,Serialize,Deserialize,TS)]
#[ts(export, export_to="../../src/bindings/")]
pub struct Thread { pub id:String, pub title:String, pub status:ThreadStatus, pub files:Vec<ThreadFile>, pub recent_activity:String, pub brief:Option<String> }
fn dir()->Result<PathBuf,CommandError>{Ok(config::config_dir()?.join("threads"))}
fn workspaces()->Result<PathBuf,CommandError>{Ok(config::config_dir()?.join("workspaces"))}
#[tauri::command] pub fn vault_register(id:String,path:String)->Result<VaultWorkspace,CommandError>{let d=workspaces()?;fs::create_dir_all(&d).map_err(|e|CommandError::new("workspace_write",e.to_string()))?;let v=VaultWorkspace{id,path};fs::write(d.join(format!("{}.json",v.id)),serde_json::to_vec_pretty(&v).unwrap()).map_err(|e|CommandError::new("workspace_write",e.to_string()))?;Ok(v)}
#[tauri::command] pub fn vault_remap(id:String,path:String)->Result<VaultWorkspace,CommandError>{let v=vault_register(id,path.clone())?;let p=config::config_dir()?.join("config.json");let mut x=serde_json::json!({});if let Ok(s)=fs::read_to_string(&p){x=serde_json::from_str(&s).unwrap_or(x)};x["last_vault"]=serde_json::Value::String(path);fs::create_dir_all(config::config_dir()?).ok();fs::write(p,serde_json::to_vec_pretty(&x).unwrap()).map_err(|e|CommandError::new("config_write",e.to_string()))?;Ok(v)}
fn read_all()->Result<Vec<Thread>,CommandError>{let d=dir()?; let _=fs::create_dir_all(&d); let mut out=vec![]; for e in fs::read_dir(d).map_err(|e|CommandError::new("thread_read",e.to_string()))? {let p=e.map_err(|e|CommandError::new("thread_read",e.to_string()))?.path(); if p.extension().and_then(|x|x.to_str())!=Some("json"){continue} match fs::read_to_string(&p).ok().and_then(|s|serde_json::from_str(&s).ok()){Some(t)=>out.push(t),None=>{let _=fs::rename(&p,p.with_extension("json.corrupt"));}}} Ok(out)}
fn save(t:&Thread)->Result<(),CommandError>{let d=dir()?;fs::create_dir_all(&d).map_err(|e|CommandError::new("thread_write",e.to_string()))?;let p=d.join(format!("{}.json",t.id));let tmp=p.with_extension("tmp");fs::write(&tmp,serde_json::to_vec_pretty(t).unwrap()).map_err(|e|CommandError::new("thread_write",e.to_string()))?;fs::rename(tmp,p).map_err(|e|CommandError::new("thread_write",e.to_string()))}
#[tauri::command] pub fn thread_list()->Result<Vec<Thread>,CommandError>{read_all()}
#[tauri::command] pub fn thread_create(title:String)->Result<Thread,CommandError>{let now=format!("{}",std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs());let t=Thread{id:format!("{}-{}",now.replace(':',""),std::process::id()),title,status:ThreadStatus::Active,files:vec![],recent_activity:now,brief:None};save(&t)?;Ok(t)}
#[tauri::command] pub fn thread_update(thread:Thread)->Result<Thread,CommandError>{save(&thread)?;Ok(thread)}
#[tauri::command] pub fn thread_current()->Result<Option<Thread>,CommandError>{Ok(read_all()?.into_iter().next())}
#[tauri::command] pub fn thread_switch(id:String)->Result<Thread,CommandError>{read_all()?.into_iter().find(|t|t.id==id).ok_or_else(||CommandError::new("thread_not_found","找不到 Thread"))}
