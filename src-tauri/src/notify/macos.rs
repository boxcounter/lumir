//! macOS 实现（change add-cron-notification-relaunch，design §2 方案 A / §3）。
//!
//! 本文件是全仓**唯一**直接触碰 `UNUserNotificationCenter` 的地方：delegate（安装 + 保活 +
//! `willPresent` + 响应路由）、投递（`addNotificationRequest`）、投递后自查
//! （`getDeliveredNotifications`）与授权查询 / 申请。对外只暴露安全接口，`unsafe` 面不出模块。
//!
//! **为什么自持**：`mac-usernotifications 0.3.1` 的响应映射是库内私有的进程内表、delegate 只在
//! 首次投递时懒装，外部无法补挂「无主响应」的接收者——而「应用退出期间投递的通知被点击」恰恰
//! 要求响应先落到一个不依赖投递请求的落点。方案 B（先触发依赖库安装、再抢回 delegate）依赖它的
//! 私有实现时序，升级即静默失效；方案 C（vendor 上游）是把约 2000 行副本搬进仓长期跟踪。
//!
//! **线程模型**：`didReceive` / `willPresent` 由系统在主线程 run loop 上回调（Apple 合同），
//! 因此它们只做「取 id、归一化、入缓冲、叫醒守护线程」四件极轻的事，绝不做 IO、聚焦或 emit。
//! 投递 / 自查 / 授权都是「发起请求 + 在一个内部队列上接收完成回调」，调用方（`lumir-cron`
//! 线程）用有界等待取结果——不在主线程上阻塞。

use std::ptr::NonNull;
use std::sync::mpsc;
use std::sync::OnceLock;
use std::time::Duration;

use block2::RcBlock;
use objc2::runtime::ProtocolObject;
use objc2::{define_class, AnyThread};
use objc2_foundation::{NSArray, NSBundle, NSError, NSObject, NSObjectProtocol, NSString};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent, UNNotification,
    UNNotificationPresentationOptions, UNNotificationRequest, UNNotificationResponse,
    UNNotificationSettings, UNNotificationSound, UNUserNotificationCenter,
    UNUserNotificationCenterDelegate,
};

/// 单次 UN 调用的等待上限：投递 / 自查 / 授权都是异步完成回调，超时一律当失败上抛
/// （调用方决定重试或降级）——本模块不把「没回音」伪装成成功。
const CALL_TIMEOUT: Duration = Duration::from_secs(5);

/// 认证状态快照（`UNAuthorizationStatus` 的窄化：本仓只关心这三档）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Authorization {
    /// 系统里还没有本客户端的授权记录（没弹过窗，或系统不认这个身份）。
    NotDetermined,
    /// 用户拒绝 / 系统拒绝投递。
    Denied,
    /// 已授权（含 provisional / ephemeral 这类「可投递」档）。
    Authorized,
}

/// UN 只服务有 bundle 身份的打包实例。`custom-protocol` 只决定前端资源加载方式：
/// perf 直接启动的裸 release 二进制同样是非 dev，但没有 bundle 身份。
pub fn user_notifications_enabled(is_dev: bool) -> bool {
    user_notifications_enabled_for(is_dev, has_bundle_identity())
}

fn user_notifications_enabled_for(is_dev: bool, has_bundle_identity: bool) -> bool {
    !is_dev && has_bundle_identity
}

pub fn has_bundle_identity() -> bool {
    NSBundle::mainBundle().bundleIdentifier().is_some()
}

define_class!(
    /// 常驻 delegate：进程生命周期内一直持有（delegate 属性是 `weak`，谁装谁负责保活）。
    #[unsafe(super(NSObject))]
    #[name = "LumirNotificationDelegate"]
    struct Delegate;

    unsafe impl NSObjectProtocol for Delegate {}

    unsafe impl UNUserNotificationCenterDelegate for Delegate {
        /// 应用在前台时也照常上屏（缺这个方法时 macOS 会把前台通知静默丢掉）。
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &UNNotification,
            completion_handler: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            completion_handler.call((UNNotificationPresentationOptions::Banner
                | UNNotificationPresentationOptions::Sound,));
        }

        /// 点击响应：取 id → 归一化动作 → 立刻交还完成处理器 → 入缓冲并唤醒守护线程。
        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            completion_handler: &block2::DynBlock<dyn Fn()>,
        ) {
            let request_id = response.notification().request().identifier().to_string();
            let raw_action = response.actionIdentifier().to_string();
            let action = crate::cron::normalize_action(&raw_action);
            // 先交还完成处理器：系统不该等我们的业务判定（回调在主线程 run loop 上）。
            completion_handler.call(());
            crate::notify::report_response(request_id, action);
        }
    }
);

impl Delegate {
    fn new() -> objc2::rc::Retained<Self> {
        let this = Self::alloc().set_ivars(());
        unsafe { objc2::msg_send![super(this), init] }
    }
}

/// 已装的 delegate（强引用保活到进程退出；`setDelegate` 传的是协议对象，属性本身是 weak）。
static DELEGATE: OnceLock<objc2::rc::Retained<Delegate>> = OnceLock::new();

/// 装 delegate（应用完成启动**之前**调用才满足 Apple 合同）。
///
/// 零 IO、零跨进程查询：只查一次 bundle 身份（内存读 `NSBundle`）并做一次 `setDelegate`。
/// 失败只降级为 warning——MUST NOT 阻断启动与投递（design §3「降级」）。
pub fn install_delegate() -> Result<(), String> {
    if DELEGATE.get().is_some() {
        return Ok(());
    }
    // 无 bundle 身份的进程调用 UN 会直接 abort（M608 真机现场）：先查，别赌。
    if !has_bundle_identity() {
        return Err("进程没有 bundle 身份，通知 delegate 不安装".to_string());
    }
    let delegate = Delegate::new();
    let center = UNUserNotificationCenter::currentNotificationCenter();
    center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
    let _ = DELEGATE.set(delegate);
    Ok(())
}

/// 投递一条通知（标题 = 任务 id，正文 = 通用文案）。成功判据由调用方用
/// [`delivered_ids`] 自查——本函数只回答「请求被系统接受了吗」。
pub fn deliver(request_id: &str, title: &str, body: &str) -> Result<(), String> {
    if !has_bundle_identity() {
        return Err("进程没有 bundle 身份，无法投递通知".to_string());
    }
    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str(title));
    content.setBody(&NSString::from_str(body));
    content.setSound(Some(&UNNotificationSound::defaultSound()));
    let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
        &NSString::from_str(request_id),
        &content,
        None,
    );
    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    let completion = RcBlock::new(move |error: *mut NSError| {
        let result = match unsafe { error.as_ref() } {
            None => Ok(()),
            Some(error) => Err(error.localizedDescription().to_string()),
        };
        let _ = tx.send(result);
    });
    UNUserNotificationCenter::currentNotificationCenter()
        .addNotificationRequest_withCompletionHandler(&request, Some(&completion));
    match rx.recv_timeout(CALL_TIMEOUT) {
        Ok(result) => result,
        Err(_) => Err("投递请求在 5s 内没有完成回调".to_string()),
    }
}

/// 通知中心里当前在场的已投递通知 id（投递后自查的唯一依据，M620 语义）。
///
/// 查不到（超时 / 回调失败）返回空表——调用方按「没送达」处理，不把未知当成功。
pub fn delivered_ids() -> Vec<String> {
    if !has_bundle_identity() {
        return Vec::new();
    }
    let (tx, rx) = mpsc::channel::<Vec<String>>();
    let completion = RcBlock::new(move |list: NonNull<NSArray<UNNotification>>| {
        let ids: Vec<String> = unsafe { list.as_ref() }
            .iter()
            .map(|notification| notification.request().identifier().to_string())
            .collect();
        let _ = tx.send(ids);
    });
    UNUserNotificationCenter::currentNotificationCenter()
        .getDeliveredNotificationsWithCompletionHandler(&completion);
    rx.recv_timeout(CALL_TIMEOUT).unwrap_or_default()
}

/// 读当前授权状态（**不弹窗**）：`requestAuthorization` 已在别处做过时用它把「用户拒绝」与
/// 「系统不认这个身份」分开（M636 定论）。
pub fn authorization() -> Result<Authorization, String> {
    if !has_bundle_identity() {
        return Err("进程没有 bundle 身份，无法读取通知授权状态".to_string());
    }
    let (tx, rx) = mpsc::channel::<UNAuthorizationStatus>();
    let completion = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
        let status = unsafe { settings.as_ref() }.authorizationStatus();
        let _ = tx.send(status);
    });
    UNUserNotificationCenter::currentNotificationCenter()
        .getNotificationSettingsWithCompletionHandler(&completion);
    let status = rx
        .recv_timeout(CALL_TIMEOUT)
        .map_err(|_| "读取通知授权状态在 5s 内没有完成回调".to_string())?;
    Ok(match status {
        UNAuthorizationStatus::NotDetermined => Authorization::NotDetermined,
        UNAuthorizationStatus::Authorized
        | UNAuthorizationStatus::Provisional
        | UNAuthorizationStatus::Ephemeral => Authorization::Authorized,
        // Denied 与将来可能新增的档：一律按「送不出去」处理，不编原因。
        _ => Authorization::Denied,
    })
}

/// 申请一次通知授权（已决定时不弹窗、按现状返回）。
pub fn request_authorization() -> Result<bool, String> {
    if !has_bundle_identity() {
        return Err("进程没有 bundle 身份，无法申请通知授权".to_string());
    }
    let (tx, rx) = mpsc::channel::<Result<bool, String>>();
    let completion = RcBlock::new(move |granted: objc2::runtime::Bool, error: *mut NSError| {
        let result = match unsafe { error.as_ref() } {
            None => Ok(granted.as_bool()),
            Some(error) => Err(error.localizedDescription().to_string()),
        };
        let _ = tx.send(result);
    });
    UNUserNotificationCenter::currentNotificationCenter()
        .requestAuthorizationWithOptions_completionHandler(
            UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
            &completion,
        );
    match rx.recv_timeout(CALL_TIMEOUT) {
        Ok(result) => result,
        Err(_) => Err("通知授权申请在 5s 内没有完成回调".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_notifications_require_a_packaged_bundle_identity() {
        assert!(!user_notifications_enabled_for(true, true));
        assert!(!user_notifications_enabled_for(true, false));
        assert!(!user_notifications_enabled_for(false, false));
        assert!(user_notifications_enabled_for(false, true));
    }

    /// cargo 的测试二进制与 dev / perf 裸二进制一样没有 bundle 身份。旧实现会在第一个
    /// `currentNotificationCenter` 抛 ObjC 异常并 abort；本测试因此直接守住全部公开 UN 入口。
    #[test]
    fn un_entry_points_fail_closed_without_a_bundle_identity() {
        assert!(!has_bundle_identity(), "cargo 测试二进制不应有 bundle 身份");
        assert!(request_authorization().is_err());
        assert!(authorization().is_err());
        assert!(deliver("request", "title", "body").is_err());
        assert!(delivered_ids().is_empty());
        assert!(install_delegate().is_err());
    }
}
