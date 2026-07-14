!ifndef BUILD_UNINSTALLER
!define MUI_CUSTOMFUNCTION_ABORT myOnUserAbort

!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "WinMessages.nsh"

; ============================================================================
; 强制预设，阻断多用户/目录选择原生界面的加载
; ============================================================================
!define INSTALL_MODE_PER_ALL_USERS

; ============================================================================
; 变量声明
; ============================================================================
Var WelcomeDialog
Var WelcomeImageCtrl
Var WelcomeTitleCtrl
Var WelcomeDescCtrl
Var WelcomeFontTitle
Var WelcomeFontDesc
Var PathEditCtrl

; ============================================================================
; 欢迎页面及各控件句柄/位图句柄声明
; ============================================================================
Var WelcomeBmpHandle_0
Var WelcomeBmpHandle_1
Var WelcomeBmpHandle_2
Var WelcomeBmpHandle_3
Var WelcomeBmpHandle_4
Var WelcomeBmpHandle_5
Var WelcomeCloseCtrl
Var WelcomeLogoCtrl
Var WelcomeInputBgCtrl
Var WelcomeBrowseCtrl
Var WelcomeInstallCtrl

; ============================================================================
; 欢迎页面自定义退出弹窗变量声明
; ============================================================================
Var WelcomeBmpHandle_6
Var WelcomeBmpHandle_7
Var WelcomeBmpHandle_8
Var WelcomeBmpHandle_9
Var PopupBlockerCtrl
Var PopupBgCtrl
Var PopupTitleCtrl
Var PopupTextCtrl
Var PopupCancelCtrl
Var PopupContinueCtrl
Var PopupCloseCtrl
Var PopupFontTitle
Var PopupFontText

Var ExitWithoutConfirm

; ============================================================================
; 进度条自定义变量
; ============================================================================
Var CustomProgressParent
Var DefaultProgressHWND

; ============================================================================
; 进度条位图缓存句柄与进度页控件声明
; ============================================================================
Var ProgressBmpLogo
Var ProgressStatusCtrl
Var ProgressTitleCtrl
Var ActiveDialog
Var ProgressCloseCtrl
Var ProgressCloseBmp
Var ProgressBgCtrl
Var ProgressBgBmp

; ============================================================================
; 初始化钩子：释放 BMP 图素
; ============================================================================
!macro customInit
  InitPluginsDir
  ; ============================================================================
  ; 基础窗口图素
  ; ============================================================================
  File "/oname=$PLUGINSDIR\bg_main.bmp" "${PROJECT_DIR}\build\installer_assets\bg_main.bmp"
  File "/oname=$PLUGINSDIR\welcome_logo.bmp" "${PROJECT_DIR}\build\installer_assets\welcome_logo.bmp"
  File "/oname=$PLUGINSDIR\btn_install.bmp" "${PROJECT_DIR}\build\installer_assets\btn_install.bmp"
  File "/oname=$PLUGINSDIR\btn_launch.bmp" "${PROJECT_DIR}\build\installer_assets\btn_launch.bmp"
  File "/oname=$PLUGINSDIR\btn_close.bmp" "${PROJECT_DIR}\build\installer_assets\btn_close.bmp"
  File "/oname=$PLUGINSDIR\btn_folder.bmp" "${PROJECT_DIR}\build\installer_assets\btn_folder.bmp"
  File "/oname=$PLUGINSDIR\input_bg.bmp" "${PROJECT_DIR}\build\installer_assets\input_bg.bmp"
  
  ; ============================================================================
  ; 弹出确认框图素
  ; ============================================================================
  File "/oname=$PLUGINSDIR\bg_blocker.bmp" "${PROJECT_DIR}\build\installer_assets\bg_blocker.bmp"
  File "/oname=$PLUGINSDIR\popup_bg.bmp" "${PROJECT_DIR}\build\installer_assets\popup_bg.bmp"
  File "/oname=$PLUGINSDIR\btn_dialog_cancel.bmp" "${PROJECT_DIR}\build\installer_assets\btn_dialog_cancel.bmp"
  File "/oname=$PLUGINSDIR\btn_dialog_continue.bmp" "${PROJECT_DIR}\build\installer_assets\btn_dialog_continue.bmp"
  
  ; ============================================================================
  ; 进度条图素
  ; ============================================================================
  File "/oname=$PLUGINSDIR\pb_bg.bmp" "${PROJECT_DIR}\build\installer_assets\pb_bg.bmp"
  File "/oname=$PLUGINSDIR\pb_fill.bmp" "${PROJECT_DIR}\build\installer_assets\pb_fill.bmp"
  File "/oname=$PLUGINSDIR\pb_halo.bmp" "${PROJECT_DIR}\build\installer_assets\pb_halo.bmp"
!macroend

; ============================================================================
; 常用 Win32 API 辅助逻辑
; ============================================================================
!ifndef WM_NCLBUTTONDOWN
  !define WM_NCLBUTTONDOWN 0x00A1
!endif
!ifndef HTCAPTION
  !define HTCAPTION 2
!endif

; 拖拽回调函数：允许在点击背景图片时移动无边框窗口
Function OnBackgroundDrag
  Pop $0
  System::Call "user32::ReleaseCapture()"
  SendMessage $HWNDPARENT ${WM_NCLBUTTONDOWN} ${HTCAPTION} 0
FunctionEnd

; 退出确认框回调逻辑
Function OnBlockerClick
  Pop $0 ; 只是消耗掉点击事件，防止穿透
FunctionEnd

Function OnPopupClose
  Pop $0
  System::Call "user32::SetWindowPos(i $PopupBlockerCtrl, i 1, i 3000, i 3000, i 540, i 380, i 0x0080)"
  System::Call "user32::SetWindowPos(i $PopupBgCtrl, i 1, i 3000, i 3000, i 360, i 180, i 0x0080)"
  System::Call "user32::SetWindowPos(i $PopupTitleCtrl, i 1, i 3000, i 3000, i 200, i 20, i 0x0080)"
  System::Call "user32::SetWindowPos(i $PopupCloseCtrl, i 1, i 3000, i 3000, i 24, i 24, i 0x0080)"
  System::Call "user32::SetWindowPos(i $PopupTextCtrl, i 1, i 3000, i 3000, i 320, i 40, i 0x0080)"
  System::Call "user32::SetWindowPos(i $PopupCancelCtrl, i 1, i 3000, i 3000, i 100, i 32, i 0x0080)"
  System::Call "user32::SetWindowPos(i $PopupContinueCtrl, i 1, i 3000, i 3000, i 100, i 32, i 0x0080)"
  System::Call "user32::InvalidateRect(i $WelcomeDialog, i 0, i 1)"
FunctionEnd

Function OnPopupExit
  Pop $0
  StrCpy $ExitWithoutConfirm "1"
  System::Call `user32::PostMessage(i $HWNDPARENT, i 0x0111, i 2, i 0)`
FunctionEnd

; 关闭按钮回调函数：点击时展示自定义深色退出确认框
Function OnCloseClick
  Pop $0
  System::Call "user32::SetWindowPos(i $PopupBlockerCtrl, i 0, i 0, i 0, i 540, i 380, i 0x0040)"
  System::Call "user32::SetWindowPos(i $PopupBgCtrl, i 0, i 90, i 100, i 360, i 180, i 0x0040)"
  System::Call "user32::SetWindowPos(i $PopupTitleCtrl, i 0, i 106, i 110, i 200, i 20, i 0x0040)"
  System::Call "user32::SetWindowPos(i $PopupCloseCtrl, i 0, i 416, i 108, i 24, i 24, i 0x0040)"
  System::Call "user32::SetWindowPos(i $PopupTextCtrl, i 0, i 110, i 160, i 320, i 40, i 0x0040)"
  System::Call "user32::SetWindowPos(i $PopupCancelCtrl, i 0, i 225, i 228, i 100, i 32, i 0x0040)"
  System::Call "user32::SetWindowPos(i $PopupContinueCtrl, i 0, i 335, i 228, i 100, i 32, i 0x0040)"
  System::Call "user32::InvalidateRect(i $WelcomeDialog, i 0, i 1)"
FunctionEnd

; 无边框窗口样式和大小预设 (540x380) 并添加 Windows 窗体原生软阴影 (Drop Shadow)
Function MakeWindowBorderless
  ; 1. 查找子窗口对齐器句柄 (#32770) 并重置大小贴合 client
  FindWindow $0 "#32770" "" $HWNDPARENT
  System::Call "user32::MoveWindow(i $0, i 0, i 0, i 540, i 380, i 1)"

  ; 2. 修改窗口样式为无标题栏边框 (WS_POPUP | WS_VISIBLE = 0x90000000)
  System::Call "user32::SetWindowLong(i $HWNDPARENT, i -16, i 0x90000000)"

  ; 3. 动态计算屏幕中央坐标并居中显示 (DPI 感知)
  System::Call "user32::GetSystemMetrics(i 0) i .r1" ; 宽
  System::Call "user32::GetSystemMetrics(i 1) i .r2" ; 高
  IntOp $3 $1 - 540
  IntOp $3 $3 / 2
  IntOp $4 $2 - 380
  IntOp $4 $4 / 2
  
  ; 0x0040 = SWP_SHOWWINDOW
  System::Call "user32::SetWindowPos(i $HWNDPARENT, i 0, i $3, i $4, i 540, i 380, i 0x0040)"

  ; 4. 添加原生的窗口阴影 (CS_DROPSHADOW = 0x00020000, GCL_STYLE = -26)
  System::Call "user32::GetClassLong(i $HWNDPARENT, i -26) i .r0"
  IntOp $0 $0 | 0x00020000
  System::Call "user32::SetClassLong(i $HWNDPARENT, i -26, i $0)"

  ; 5. 设置圆角窗口区域 (椭圆宽 16, 高 16, 相当于 border-radius 为 8px)
  System::Call "gdi32::CreateRoundRectRgn(i 0, i 0, i 540, i 380, i 16, i 16) i .r0"
  System::Call "user32::SetWindowRgn(i $HWNDPARENT, i $0, i 1)"
FunctionEnd

; 将默认控件（按钮和分割线）移动到屏幕外，彻底杜绝其显示和干扰
Function HideDefaultButtons
  ; 1 = 下一步/安装, 2 = 取消, 3 = 返回, 1026 = 分割线
  ; 0x0014 = SWP_NOZORDER | SWP_NOSIZE
  GetDlgItem $1 $HWNDPARENT 1
  System::Call "user32::SetWindowPos(i $1, i 0, i -1000, i -1000, i 0, i 0, i 0x0014)"
  GetDlgItem $1 $HWNDPARENT 2
  System::Call "user32::SetWindowPos(i $1, i 0, i -1000, i -1000, i 0, i 0, i 0x0014)"
  GetDlgItem $1 $HWNDPARENT 3
  System::Call "user32::SetWindowPos(i $1, i 0, i -1000, i -1000, i 0, i 0, i 0x0014)"
  GetDlgItem $1 $HWNDPARENT 1026
  System::Call "user32::SetWindowPos(i $1, i 0, i -1000, i -1000, i 0, i 0, i 0x0014)"

  ; 隐藏 Modern UI 头部控件 (1037=标题, 1038=描述, 1039=图标)
  GetDlgItem $1 $HWNDPARENT 1037
  ShowWindow $1 0
  GetDlgItem $1 $HWNDPARENT 1038
  ShowWindow $1 0
  GetDlgItem $1 $HWNDPARENT 1039
  ShowWindow $1 0
FunctionEnd

; ============================================================================
; 自定义主页面 (欢迎/路径选择二合一)
; ============================================================================
!macro customWelcomePage
  Page custom customWelcomePageCreate customWelcomePageLeave
!macroend

; 路径选择回调
Function OnBrowseClick
  Pop $0 ; 弹出 NSD_OnClick 压入的控件句柄

  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7 ; 用于记录系统是否支持现代对话框

  ; 获取输入框当前路径
  System::Call "user32::GetWindowText(i $PathEditCtrl, t .r1, i 1024)"
  StrCpy $6 "error"
  StrCpy $7 "no" ; 默认不支持

  ; 1. 尝试使用现代 Vista+ 的 IFileOpenDialog
  !define CLSID_FileOpenDialog  {DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7}
  !define IID_IFileDialog       {42F85136-DB7E-439C-85F1-E4075D135FC8}
  !define IID_IShellItem        {43826D1E-E718-42EE-BC55-A1E261C37BFE}
  !define CLSCTX_INPROC_SERVER  1
  !define FOS_PICKFOLDERS       32
  !define FOS_FORCEFILESYSTEM   64
  !define SIGDN_FILESYSPATH     2147844096

  System::Call "ole32::CoCreateInstance(g '${CLSID_FileOpenDialog}', i 0, i ${CLSCTX_INPROC_SERVER}, g '${IID_IFileDialog}', *i .r2) i.r3"
  ${If} $3 == 0
    StrCpy $7 "yes" ; 成功实例化，标记为支持
    
    ; 1.1 设置选项为选择文件夹且强制文件系统
    System::Call "$2->9(i ${FOS_PICKFOLDERS}|${FOS_FORCEFILESYSTEM}) i.r3" ; IFileDialog::SetOptions
    ${If} $3 == 0
      ; 1.2 尝试获取并设置输入框中的初始目录
      ${If} $1 != ""
        System::Call "shell32::SHCreateItemFromParsingName(w '$1', i 0, g '${IID_IShellItem}', *i .r4) i.r5"
        ${If} $5 == 0
          System::Call "$2->12(i $4) i" ; IFileDialog::SetFolder
          System::Call "$4->2()" ; IShellItem::Release
        ${EndIf}
      ${EndIf}
      
      ; 1.3 显示对话框
      System::Call "$2->3(i $HWNDPARENT) i.r3" ; IFileDialog::Show
      ${If} $3 == 0
        ; 1.4 获取结果
        System::Call "$2->20(*i .r4) i.r3" ; IFileDialog::GetResult
        ${If} $3 == 0
          ; 1.5 获取路径显示名称
          System::Call "$4->5(i ${SIGDN_FILESYSPATH}, *i .r5) i.r3" ; IShellItem::GetDisplayName
          ${If} $3 == 0
            System::Call "*$5(&w${NSIS_MAX_STRLEN} .r1)"
            StrCpy $6 $1
            System::Call "ole32::CoTaskMemFree(i $5)"
          ${EndIf}
          System::Call "$4->2()" ; IShellItem::Release
        ${EndIf}
      ${EndIf}
    ${EndIf}
    System::Call "$2->2()" ; IFileDialog::Release
  ${EndIf}

  ; 2. 只有当系统不支持现代对话框时，才回退到 legacy 的 nsDialogs 树形弹窗
  ${If} $7 == "no"
    nsDialogs::SelectFolderDialog "请选择安装目录" $1
    Pop $6
  ${EndIf}

  ; 3. 更新输入框的文本
  ${If} $6 != "error"
  ${AndIf} $6 != ""
    System::Call "user32::SetWindowText(i $PathEditCtrl, t '$6')"
  ${EndIf}

  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
FunctionEnd

; 点击安装回调
Function OnInstallClick
  Pop $0
  System::Call "user32::GetWindowText(i $PathEditCtrl, t .r1, i 1024)"
  ${If} $1 == ""
    MessageBox MB_OK|MB_ICONEXCLAMATION "请选择有效的安装目录！"
    Return
  ${EndIf}
  
  StrCpy $INSTDIR $1
  
  ; 触发下一步动作 (进入安装页)
  System::Call "user32::PostMessage(i $HWNDPARENT, i 0x0111, i 1, i 0)"
FunctionEnd

; 创建自定义 Home 主页面
Function customWelcomePageCreate
  Call MakeWindowBorderless
  Call HideDefaultButtons

  nsDialogs::Create 1018
  Pop $WelcomeDialog
  
  ${If} $WelcomeDialog == error
    Abort
  ${EndIf}

  StrCpy $ActiveDialog $WelcomeDialog
  SetCtlColors $WelcomeDialog "" 0x0E131F
  System::Call "user32::MoveWindow(i $WelcomeDialog, i 0, i 0, i 540, i 380, i 1)"

  ; 1. 背景图图层 (最底层) - 使用 NSD_CreateBitmap，并注入 WS_CLIPSIBLINGS (0x04000000)
  ${NSD_CreateBitmap} 0 0 540 380 ""
  Pop $WelcomeImageCtrl
  ${NSD_SetImage} $WelcomeImageCtrl "$PLUGINSDIR\bg_main.bmp" $WelcomeBmpHandle_0
  System::Call "user32::GetWindowLong(i $WelcomeImageCtrl, i -16) i .r0"
  IntOp $0 $0 | 0x04000000 ; WS_CLIPSIBLINGS
  System::Call "user32::SetWindowLong(i $WelcomeImageCtrl, i -16, i $0)"
  ${NSD_OnClick} $WelcomeImageCtrl OnBackgroundDrag

  ; 2. 右上角关闭按钮
  ${NSD_CreateBitmap} 506 10 24 24 ""
  Pop $WelcomeCloseCtrl
  ${NSD_SetImage} $WelcomeCloseCtrl "$PLUGINSDIR\btn_close.bmp" $WelcomeBmpHandle_1
  System::Call "user32::GetWindowLong(i $WelcomeCloseCtrl, i -16) i .r0"
  IntOp $0 $0 | 0x0100 ; SS_NOTIFY
  System::Call "user32::SetWindowLong(i $WelcomeCloseCtrl, i -16, i $0)"
  ${NSD_OnClick} $WelcomeCloseCtrl OnCloseClick

  ; 3. App Logo
  ${NSD_CreateBitmap} 155 70 64 64 ""
  Pop $WelcomeLogoCtrl
  ${NSD_SetImage} $WelcomeLogoCtrl "$PLUGINSDIR\welcome_logo.bmp" $WelcomeBmpHandle_2

  ; 4. 主标题 "Net Tools" - 使用 NSD_CreateLabel 使得 SetCtlColors 的 transparent 生效
  ${NSD_CreateLabel} 235 85 180 40 "Net Tools"
  Pop $WelcomeTitleCtrl
  SetCtlColors $WelcomeTitleCtrl 0xFFFFFF transparent
  CreateFont $WelcomeFontTitle "Microsoft YaHei" 20 700
  SendMessage $WelcomeTitleCtrl ${WM_SETFONT} $WelcomeFontTitle 1

  ; 5. 输入框提示 "安装位置"
  ${NSD_CreateLabel} 90 165 100 20 "安装位置"
  Pop $WelcomeDescCtrl
  SetCtlColors $WelcomeDescCtrl 0x94A3B8 transparent
  CreateFont $WelcomeFontDesc "Microsoft YaHei" 9 400
  SendMessage $WelcomeDescCtrl ${WM_SETFONT} $WelcomeFontDesc 1

  ; 6. 路径输入框圆角外框背景
  ${NSD_CreateBitmap} 90 188 360 32 ""
  Pop $WelcomeInputBgCtrl
  ${NSD_SetImage} $WelcomeInputBgCtrl "$PLUGINSDIR\input_bg.bmp" $WelcomeBmpHandle_3
  System::Call "user32::GetWindowLong(i $WelcomeInputBgCtrl, i -16) i .r0"
  IntOp $0 $0 | 0x04000000 ; WS_CLIPSIBLINGS
  System::Call "user32::SetWindowLong(i $WelcomeInputBgCtrl, i -16, i $0)"

  ; 7. 无边框 Edit 输入框 - 直接通过 CreateControl 创建以避免运行时修改样式导致的渲染错误
  nsDialogs::CreateControl "EDIT" 0x54010080 0 98 194 316 20 "$INSTDIR"
  Pop $PathEditCtrl
  SetCtlColors $PathEditCtrl "FFFFFF" "202228" ; 文字白色，背景色为 #202228
  SendMessage $PathEditCtrl ${WM_SETFONT} $WelcomeFontDesc 1

  ; 8. 文件夹浏览图标按钮 (叠加在输入框外框右端)
  ${NSD_CreateBitmap} 418 192 24 24 ""
  Pop $WelcomeBrowseCtrl
  ${NSD_SetImage} $WelcomeBrowseCtrl "$PLUGINSDIR\btn_folder.bmp" $WelcomeBmpHandle_4
  System::Call "user32::GetWindowLong(i $WelcomeBrowseCtrl, i -16) i .r0"
  IntOp $0 $0 | 0x0100 ; SS_NOTIFY
  System::Call "user32::SetWindowLong(i $WelcomeBrowseCtrl, i -16, i $0)"
  ${NSD_OnClick} $WelcomeBrowseCtrl OnBrowseClick

  ; 9. 黄色圆角“安装”图片按钮
  ${NSD_CreateBitmap} 170 255 200 36 ""
  Pop $WelcomeInstallCtrl
  ${NSD_SetImage} $WelcomeInstallCtrl "$PLUGINSDIR\btn_install.bmp" $WelcomeBmpHandle_5
  System::Call "user32::GetWindowLong(i $WelcomeInstallCtrl, i -16) i .r0"
  IntOp $0 $0 | 0x0100 ; SS_NOTIFY
  System::Call "user32::SetWindowLong(i $WelcomeInstallCtrl, i -16, i $0)"
  ${NSD_OnClick} $WelcomeInstallCtrl OnInstallClick

  ; 显式进行 Z-Order 调整：先将输入框背景移到最底层，再将主背景图移到最底层，确保主背景图最垫底，输入框背景在主背景之上、其它控件之下
  System::Call "user32::SetWindowPos(i $WelcomeInputBgCtrl, i 1, i 0, i 0, i 0, i 0, i 0x0013)"
  System::Call "user32::SetWindowPos(i $WelcomeImageCtrl, i 1, i 0, i 0, i 0, i 0, i 0x0013)"

  ; 10. 创建自定义退出确认框的遮罩层和弹窗控件 (使用 positive off-screen 初始位置以绕过 nsDialogs::Show 的显示接管，确保不遮挡主页面且 OnClick 能正确绑定)
  ; 10.1 变暗背景遮罩
  ${NSD_CreateBitmap} 3000 3000 540 380 ""
  Pop $PopupBlockerCtrl
  ${NSD_SetImage} $PopupBlockerCtrl "$PLUGINSDIR\bg_blocker.bmp" $WelcomeBmpHandle_6
  System::Call "user32::GetWindowLong(i $PopupBlockerCtrl, i -16) i .r0"
  IntOp $0 $0 | 0x0100 ; SS_NOTIFY
  System::Call "user32::SetWindowLong(i $PopupBlockerCtrl, i -16, i $0)"
  ${NSD_OnClick} $PopupBlockerCtrl OnBlockerClick

  ; 10.2 弹出框背景卡片
  ${NSD_CreateBitmap} 3000 3000 360 180 ""
  Pop $PopupBgCtrl
  ${NSD_SetImage} $PopupBgCtrl "$PLUGINSDIR\popup_bg.bmp" $WelcomeBmpHandle_7

  ; 10.3 弹出框标题 "您即将取消安装"
  ${NSD_CreateLabel} 3000 3000 200 20 "您即将取消安装"
  Pop $PopupTitleCtrl
  SetCtlColors $PopupTitleCtrl 0xFFFFFF transparent
  CreateFont $PopupFontTitle "Microsoft YaHei" 10 700
  SendMessage $PopupTitleCtrl ${WM_SETFONT} $PopupFontTitle 1

  ; 10.4 弹出框右上角关闭按钮
  ${NSD_CreateBitmap} 3000 3000 24 24 ""
  Pop $PopupCloseCtrl
  ${NSD_SetImage} $PopupCloseCtrl "$PLUGINSDIR\btn_close.bmp" $WelcomeBmpHandle_1
  System::Call "user32::GetWindowLong(i $PopupCloseCtrl, i -16) i .r0"
  IntOp $0 $0 | 0x0100 ; SS_NOTIFY
  System::Call "user32::SetWindowLong(i $PopupCloseCtrl, i -16, i $0)"
  ${NSD_OnClick} $PopupCloseCtrl OnPopupClose

  ; 10.5 弹出框文本内容
  ${NSD_CreateLabel} 3000 3000 320 40 "Net Tools 将不会安装到您的电脑上。$\r$\n确定要退出吗？"
  Pop $PopupTextCtrl
  SetCtlColors $PopupTextCtrl 0x94A3B8 transparent
  CreateFont $PopupFontText "Microsoft YaHei" 9 400
  SendMessage $PopupTextCtrl ${WM_SETFONT} $PopupFontText 1

  ; 10.6 “取消安装”按钮 (深灰)
  ${NSD_CreateBitmap} 3000 3000 100 32 ""
  Pop $PopupCancelCtrl
  ${NSD_SetImage} $PopupCancelCtrl "$PLUGINSDIR\btn_dialog_cancel.bmp" $WelcomeBmpHandle_8
  System::Call "user32::GetWindowLong(i $PopupCancelCtrl, i -16) i .r0"
  IntOp $0 $0 | 0x0100 ; SS_NOTIFY
  System::Call "user32::SetWindowLong(i $PopupCancelCtrl, i -16, i $0)"
  ${NSD_OnClick} $PopupCancelCtrl OnPopupExit

  ; 10.7 “继续安装”按钮 (黄)
  ${NSD_CreateBitmap} 3000 3000 100 32 ""
  Pop $PopupContinueCtrl
  ${NSD_SetImage} $PopupContinueCtrl "$PLUGINSDIR\btn_dialog_continue.bmp" $WelcomeBmpHandle_9
  System::Call "user32::GetWindowLong(i $PopupContinueCtrl, i -16) i .r0"
  IntOp $0 $0 | 0x0100 ; SS_NOTIFY
  System::Call "user32::SetWindowLong(i $PopupContinueCtrl, i -16, i $0)"
  ${NSD_OnClick} $PopupContinueCtrl OnPopupClose

  nsDialogs::Show
FunctionEnd

; 主页离开，回收字体与位图 GDI 对象
Function customWelcomePageLeave
  System::Call "gdi32::DeleteObject(i $WelcomeFontTitle)"
  System::Call "gdi32::DeleteObject(i $WelcomeFontDesc)"
  
  System::Call "gdi32::DeleteObject(i $WelcomeBmpHandle_0)"
  System::Call "gdi32::DeleteObject(i $WelcomeBmpHandle_2)"
  System::Call "gdi32::DeleteObject(i $WelcomeBmpHandle_3)"
  System::Call "gdi32::DeleteObject(i $WelcomeBmpHandle_4)"
  System::Call "gdi32::DeleteObject(i $WelcomeBmpHandle_5)"
FunctionEnd

; ============================================================================
; 安装进度页面 (instfiles) 重构
; ============================================================================
!macro customPageAfterChangeDir
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW instFilesShow
!macroend

Function instFilesShow
  SetAutoClose true
  Call HideDefaultButtons
  FindWindow $0 "#32770" "" $HWNDPARENT
  StrCpy $CustomProgressParent $0
  StrCpy $ActiveDialog $CustomProgressParent

  ; 循环隐藏并移走子窗口中所有可能的默认文本与进度控件 (ID: 1000 - 1050，排除进度条 1004)
  Push $1
  Push $2
  StrCpy $1 1000
  HideLoop:
    ${If} $1 != 1004
      GetDlgItem $2 $CustomProgressParent $1
      ${If} $2 != 0
        ShowWindow $2 0
        System::Call `user32::SetWindowPos(i $2, i 0, i -1000, i -1000, i 0, i 0, i 0x0014)`
      ${EndIf}
    ${EndIf}
    IntOp $1 $1 + 1
    ${If} $1 <= 1050
      Goto HideLoop
    ${EndIf}
  Pop $2
  Pop $1

  ; 将进度子页面对齐容器设置为整个无边框区域
  System::Call `user32::MoveWindow(i $CustomProgressParent, i 0, i 0, i 540, i 380, i 1)`

  ; 获取默认进度条句柄
  GetDlgItem $DefaultProgressHWND $CustomProgressParent 1004
  ${If} $DefaultProgressHWND == 0
    Return
  ${EndIf}

  ; 移动并调整默认进度条的大小和位置 (放置在 x=80, y=220, w=380, h=8 的设计坐标)
  System::Call `user32::MoveWindow(i $DefaultProgressHWND, i 80, i 220, i 380, i 8, i 1)`

  ; 移除默认进度条的 Windows 视觉样式，使其可以直接自定义平铺颜色
  System::Call `UxTheme::SetWindowTheme(i $DefaultProgressHWND, i 0, i 0)`
  ; 设置前景色为 PixCake 金黄色 (BGR: 0x002DC0FB)
  SendMessage $DefaultProgressHWND 0x0409 0 0x002DC0FB
  ; 设置背景色为深灰色 #202228 (BGR: 0x00282220)
  SendMessage $DefaultProgressHWND 0x2001 0 0x00282220
  
  ; 显示默认进度条
  ShowWindow $DefaultProgressHWND 1

  ; 加载背景和 Logo 图素
  System::Call `user32::LoadImage(i 0, t "$PLUGINSDIR\bg_main.bmp", i 0, i 0, i 0, i 0x10) i .r1`
  StrCpy $ProgressBgBmp $1
  System::Call `user32::LoadImage(i 0, t "$PLUGINSDIR\welcome_logo.bmp", i 0, i 0, i 0, i 0x10) i .r2`
  StrCpy $ProgressBmpLogo $2
  System::Call `user32::LoadImage(i 0, t "$PLUGINSDIR\btn_close.bmp", i 0, i 0, i 0, i 0x10) i .r3`
  StrCpy $ProgressCloseBmp $3

  ; 1. 创建背景底图覆盖全屏 (使用 0x5000000E 样式，无 SS_NOTIFY)
  System::Call `user32::CreateWindowEx(i 0, t "STATIC", t "", i 0x5000000E, i 0, i 0, i 540, i 380, i $CustomProgressParent, i 2001, i 0, i 0) i .r0`
  StrCpy $ProgressBgCtrl $0
  SendMessage $ProgressBgCtrl 0x0172 0 $ProgressBgBmp

  ; 由于 NSIS System 插件底层非重入限制，子类化拖拽会引发高频重绘/消息处理重入导致的不可避免崩溃，故在此去除进度页的子类化拖拽逻辑以保障绝对稳定。

  ; 2. 创建右上角关闭按钮 (类型为 STATIC，SS_NOTIFY 允许点击，绑定控制 ID 为 2)
  System::Call `user32::CreateWindowEx(i 0, t "STATIC", t "", i 0x5000010E, i 506, i 10, i 24, i 24, i $CustomProgressParent, i 2, i 0, i 0) i .r0`
  StrCpy $ProgressCloseCtrl $0
  SendMessage $ProgressCloseCtrl 0x0172 0 $ProgressCloseBmp

  ; 3. 创建 App Logo (y=70)
  System::Call `user32::CreateWindowEx(i 0, t "STATIC", t "", i 0x5000000E, i 155, i 70, i 64, i 64, i $CustomProgressParent, i 0, i 0, i 0) i .r8`
  SendMessage $8 0x0172 0 $ProgressBmpLogo

  ; 4. 创建主标题 (x=235, y=85, 左对齐 0x50000000)
  System::Call `user32::CreateWindowEx(i 0, t "STATIC", t "Net Tools", i 0x50000000, i 235, i 85, i 180, i 40, i $CustomProgressParent, i 0, i 0, i 0) i .r0`
  StrCpy $ProgressTitleCtrl $0
  SetCtlColors $ProgressTitleCtrl 0xFFFFFF transparent
  CreateFont $5 "Microsoft YaHei" 20 700
  SendMessage $ProgressTitleCtrl 0x0030 $5 1 ; WM_SETFONT = 0x0030

  ; 5. 创建 "正在安装，请稍候..." 提示字 (y=165)
  System::Call `user32::CreateWindowEx(i 0, t "STATIC", t "正在安装，请稍候...", i 0x50000001, i 80, i 165, i 380, i 30, i $CustomProgressParent, i 0, i 0, i 0) i .r7`
  StrCpy $ProgressStatusCtrl $7
  SetCtlColors $ProgressStatusCtrl 0xFFFFFF transparent
  CreateFont $6 "Microsoft YaHei" 10 400
  SendMessage $ProgressStatusCtrl 0x0030 $6 1

  ; 6. 显式调整默认进度条的 Z-Order 至最顶层，避免被背景图遮挡
  System::Call `user32::SetWindowPos(i $DefaultProgressHWND, i 0, i 0, i 0, i 0, i 0, i 0x0013)` ; HWND_TOP = 0, SWP_NOMOVE | SWP_NOSIZE = 0x0013
FunctionEnd

; ============================================================================
; 自定义安装完成页面 (Finish Page)
; ============================================================================
!macro customFinishPage
  Page custom customFinishPageCreate customFinishPageLeave
!macroend

Var FinishBgCtrl
Var FinishBgBmp
Var FinishCloseCtrl
Var FinishCloseBmp
Var FinishLogoCtrl
Var FinishLogoBmp
Var FinishTitleCtrl
Var FinishLaunchCtrl
Var FinishLaunchBmp

; 点击立即体验回调
Function OnLaunchClick
  Pop $0
  Exec '"$INSTDIR\${PRODUCT_FILENAME}.exe"'
  System::Call `user32::PostMessage(i $HWNDPARENT, i 0x0111, i 1, i 0)`
FunctionEnd

; 完成页面关闭回调
Function OnFinishClose
  Pop $0
  System::Call `user32::PostMessage(i $HWNDPARENT, i 0x0111, i 1, i 0)`
FunctionEnd

; 创建完成页面
Function customFinishPageCreate
  Call HideDefaultButtons
  nsDialogs::Create 1018
  Pop $WelcomeDialog
  StrCpy $ActiveDialog $WelcomeDialog
  
  ${If} $WelcomeDialog == error
    Abort
  ${EndIf}

  SetCtlColors $WelcomeDialog "" 0x0E131F
  System::Call "user32::MoveWindow(i $WelcomeDialog, i 0, i 0, i 540, i 380, i 1)"

  ; 1. 背景网格底图
  ${NSD_CreateBitmap} 0 0 540 380 ""
  Pop $FinishBgCtrl
  ${NSD_SetImage} $FinishBgCtrl "$PLUGINSDIR\bg_main.bmp" $FinishBgBmp
  System::Call "user32::GetWindowLong(i $FinishBgCtrl, i -16) i .r0"
  IntOp $0 $0 | 0x04000000 ; WS_CLIPSIBLINGS
  System::Call "user32::SetWindowLong(i $FinishBgCtrl, i -16, i $0)"
  ${NSD_OnClick} $FinishBgCtrl OnBackgroundDrag

  ; 2. 右上角关闭按钮
  ${NSD_CreateBitmap} 506 10 24 24 ""
  Pop $FinishCloseCtrl
  ${NSD_SetImage} $FinishCloseCtrl "$PLUGINSDIR\btn_close.bmp" $FinishCloseBmp
  System::Call "user32::GetWindowLong(i $FinishCloseCtrl, i -16) i .r0"
  IntOp $0 $0 | 0x0100 ; SS_NOTIFY
  System::Call "user32::SetWindowLong(i $FinishCloseCtrl, i -16, i $0)"
  ${NSD_OnClick} $FinishCloseCtrl OnFinishClose

  ; 3. App Logo
  ${NSD_CreateBitmap} 155 70 64 64 ""
  Pop $FinishLogoCtrl
  ${NSD_SetImage} $FinishLogoCtrl "$PLUGINSDIR\welcome_logo.bmp" $FinishLogoBmp

  ; 4. "安装完成" 标题
  ${NSD_CreateLabel} 235 85 180 40 "安装完成"
  Pop $FinishTitleCtrl
  SetCtlColors $FinishTitleCtrl 0xFFFFFF transparent
  CreateFont $5 "Microsoft YaHei" 20 700
  SendMessage $FinishTitleCtrl ${WM_SETFONT} $5 1

  ; 5. 黄色圆角“立即体验”图片按钮
  ${NSD_CreateBitmap} 170 220 200 36 ""
  Pop $FinishLaunchCtrl
  ${NSD_SetImage} $FinishLaunchCtrl "$PLUGINSDIR\btn_launch.bmp" $FinishLaunchBmp
  System::Call "user32::GetWindowLong(i $FinishLaunchCtrl, i -16) i .r0"
  IntOp $0 $0 | 0x0100 ; SS_NOTIFY
  System::Call "user32::SetWindowLong(i $FinishLaunchCtrl, i -16, i $0)"
  ${NSD_OnClick} $FinishLaunchCtrl OnLaunchClick

  ; 关键修复：显式将背景图控件移至 Z-Order 最底层 (HWND_BOTTOM = 1)
  System::Call "user32::SetWindowPos(i $FinishBgCtrl, i 1, i 0, i 0, i 0, i 0, i 0x0013)"

  nsDialogs::Show
FunctionEnd

Function customFinishPageLeave
  System::Call "gdi32::DeleteObject(i $FinishBgBmp)"
  System::Call "gdi32::DeleteObject(i $FinishCloseBmp)"
  System::Call "gdi32::DeleteObject(i $FinishLogoBmp)"
  System::Call "gdi32::DeleteObject(i $FinishLaunchBmp)"
  
  System::Call "gdi32::DeleteObject(i $PopupFontTitle)"
  System::Call "gdi32::DeleteObject(i $PopupFontText)"
  
  System::Call "gdi32::DeleteObject(i $WelcomeBmpHandle_1)"
  System::Call "gdi32::DeleteObject(i $WelcomeBmpHandle_6)"
  System::Call "gdi32::DeleteObject(i $WelcomeBmpHandle_7)"
  System::Call "gdi32::DeleteObject(i $WelcomeBmpHandle_8)"
  System::Call "gdi32::DeleteObject(i $WelcomeBmpHandle_9)"
  
  System::Call "gdi32::DeleteObject(i $ProgressCloseBmp)"
  System::Call "gdi32::DeleteObject(i $ProgressBmpLogo)"
FunctionEnd

Function myOnUserAbort
  ${If} $ExitWithoutConfirm == "1"
    Return
  ${EndIf}
  MessageBox MB_YESNO|MB_ICONQUESTION "您确定要取消 Net Tools 的安装并退出吗？" IDYES +2
  Abort
FunctionEnd

!endif
