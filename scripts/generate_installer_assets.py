import os
import math
from PIL import Image, ImageDraw, ImageFont

def make_assets():
    proj_dir = r"c:\Users\31830\Desktop\electron-Net-V1.1\开发中项目及备份\electron-Ne"
    out_dir = os.path.join(proj_dir, "build", "installer_assets")
    os.makedirs(out_dir, exist_ok=True)
    print(f"Generating optimized borderless assets in {out_dir}...")

    # 颜色配置 (贴合像素蛋糕的暗黑&金黄风格)
    center_color = (28, 30, 34)    # 中心略微亮一点的深炭灰
    edge_color = (15, 16, 18)      # 边缘极深的炭灰 (近黑)
    bg_theme = (18, 19, 22)        # 基础底色
    grid_color = (55, 60, 68)      # 极淡的网格点色
    btn_color = (253, 204, 76)     # #fdcc4c 像素蛋糕经典的暖金黄按钮色
    btn_text_color = (18, 19, 22)  # 按钮文字色 (深色以高对比度显示)
    input_bg_color = (32, 34, 40)  # 输入框背景色 #202228
    input_border_color = (55, 58, 66) # 输入框边框色 #373a42

    # 尝试加载微软雅黑字体
    font_btn = None
    try:
        font_btn = ImageFont.truetype("C:\\Windows\\Fonts\\msyh.ttc", 14)
    except:
        font_btn = ImageFont.load_default()

    # -------------------------------------------------------------
    # 1. 窗口主背景图: bg_main.bmp (540x380) - 径向渐变 + 几何点阵网格
    # -------------------------------------------------------------
    w, h = 540, 380
    bg_img = Image.new("RGB", (w, h))
    pixels = bg_img.load()
    
    # 绘制径向渐变
    for y in range(h):
        for x in range(w):
            dx = x - w / 2
            dy = y - h / 2
            dist = math.sqrt(dx*dx + dy*dy)
            max_dist = math.sqrt((w/2)**2 + (h/2)**2)
            t = min(1.0, dist / max_dist)
            # 使用二次缓动使渐变过渡更平滑
            t = t * t
            r = int(center_color[0] + (edge_color[0] - center_color[0]) * t)
            g = int(center_color[1] + (edge_color[1] - center_color[1]) * t)
            b = int(center_color[2] + (edge_color[2] - center_color[2]) * t)
            pixels[x, y] = (r, g, b)
            
    draw = ImageDraw.Draw(bg_img)
    
    # 绘制点状几何网格 (20px 间隔)
    for x in range(20, w, 20):
        for y in range(20, h, 20):
            draw.rectangle([x, y, x + 1, y + 1], fill=grid_color)
            
    # 绘制外边缘 1px 细边框，让窗口在桌面上边界分明
    draw.rectangle([0, 0, w - 1, h - 1], outline=(40, 42, 48), width=1)
    bg_img.save(os.path.join(out_dir, "bg_main.bmp"), "BMP")

    # -------------------------------------------------------------
    # 2. 提取应用官方 Logo 并转换为 BMP
    # -------------------------------------------------------------
    logo_size = 64
    logo_bmp = Image.new("RGB", (logo_size, logo_size), bg_theme)
    icon_path = os.path.join(proj_dir, "assets", "icon.png")
    
    if os.path.exists(icon_path):
        try:
            icon_img = Image.open(icon_path).convert("RGBA")
            icon_resized = icon_img.resize((logo_size, logo_size), Image.Resampling.LANCZOS)
            
            # 使用径向渐变的中心色作为 Logo 背景以融合
            logo_bg = Image.new("RGB", (logo_size, logo_size), center_color)
            logo_bg.paste(icon_resized, (0, 0), icon_resized)
            logo_bmp = logo_bg
            print("Successfully extracted app logo.")
        except Exception as e:
            print(f"Failed to process icon.png: {e}.")
            draw_logo = ImageDraw.Draw(logo_bmp)
            draw_logo.rectangle([8, 8, logo_size - 9, logo_size - 9], fill=btn_color, outline=(255, 255, 255), width=2)
    else:
        draw_logo = ImageDraw.Draw(logo_bmp)
        draw_logo.rectangle([8, 8, logo_size - 9, logo_size - 9], fill=btn_color, outline=(255, 255, 255), width=2)

    logo_bmp.save(os.path.join(out_dir, "welcome_logo.bmp"), "BMP")

    # -------------------------------------------------------------
    # 3. 黄色圆角“安装”按钮: btn_install.bmp (200x36)
    # -------------------------------------------------------------
    btn_w, btn_h = 200, 36
    # 按钮的底层背景应该与它所在的页面背景融为一体 (径向渐变的底部区域颜色大约是 edge_color)
    btn_img = Image.new("RGB", (btn_w, btn_h), edge_color)
    draw = ImageDraw.Draw(btn_img)
    draw.rounded_rectangle([0, 0, btn_w - 1, btn_h - 1], radius=6, fill=btn_color)
    text = "安装"
    if font_btn:
        text_bbox = draw.textbbox((0, 0), text, font=font_btn)
        tw = text_bbox[2] - text_bbox[0]
        th = text_bbox[3] - text_bbox[1]
        tx = (btn_w - tw) // 2
        ty = (btn_h - th) // 2 - 2
        draw.text((tx, ty), text, fill=btn_text_color, font=font_btn)
    btn_img.save(os.path.join(out_dir, "btn_install.bmp"), "BMP")

    # -------------------------------------------------------------
    # 4. 黄色圆角“立即体验”按钮: btn_launch.bmp (200x36)
    # -------------------------------------------------------------
    launch_img = Image.new("RGB", (btn_w, btn_h), edge_color)
    draw = ImageDraw.Draw(launch_img)
    draw.rounded_rectangle([0, 0, btn_w - 1, btn_h - 1], radius=6, fill=btn_color)
    text = "立即体验"
    if font_btn:
        text_bbox = draw.textbbox((0, 0), text, font=font_btn)
        tw = text_bbox[2] - text_bbox[0]
        th = text_bbox[3] - text_bbox[1]
        tx = (btn_w - tw) // 2
        ty = (btn_h - th) // 2 - 2
        draw.text((tx, ty), text, fill=btn_text_color, font=font_btn)
    launch_img.save(os.path.join(out_dir, "btn_launch.bmp"), "BMP")

    # -------------------------------------------------------------
    # 5. 右上角“✕”关闭按钮: btn_close.bmp (24x24)
    # -------------------------------------------------------------
    close_size = 24
    # 右上角的背景大约是 edge_color
    close_img = Image.new("RGB", (close_size, close_size), edge_color)
    draw = ImageDraw.Draw(close_img)
    draw.line([6, 6, close_size - 7, close_size - 7], fill=(156, 163, 175), width=2)
    draw.line([close_size - 7, 6, 6, close_size - 7], fill=(156, 163, 175), width=2)
    close_img.save(os.path.join(out_dir, "btn_close.bmp"), "BMP")

    # -------------------------------------------------------------
    # 6. 路径选择按钮: btn_folder.bmp (24x24)
    # -------------------------------------------------------------
    folder_size = 24
    folder_img = Image.new("RGB", (folder_size, folder_size), input_bg_color)
    draw = ImageDraw.Draw(folder_img)
    draw.polygon([(4, 9), (9, 9), (11, 7), (19, 7), (19, 17), (4, 17)], fill=(148, 163, 184))
    draw.polygon([(4, 9), (19, 9), (19, 17), (4, 17)], fill=(203, 213, 225))
    folder_img.save(os.path.join(out_dir, "btn_folder.bmp"), "BMP")

    # -------------------------------------------------------------
    # 7. 输入框圆角背景图: input_bg.bmp (360x32)
    # -------------------------------------------------------------
    in_w, in_h = 360, 32
    # 输入框所在位置大约是渐变中心偏下的位置，用混合色作为背景
    input_parent_bg = (22, 24, 27)
    in_img = Image.new("RGB", (in_w, in_h), input_parent_bg)
    draw = ImageDraw.Draw(in_img)
    draw.rounded_rectangle([0, 0, in_w - 1, in_h - 1], radius=4, fill=input_bg_color, outline=input_border_color, width=1)
    in_img.save(os.path.join(out_dir, "input_bg.bmp"), "BMP")

    # -------------------------------------------------------------
    # 8. 发光进度条组件 (380x8)
    # -------------------------------------------------------------
    pb_w, pb_h = 380, 8
    pb_bg = Image.new("RGB", (pb_w, pb_h), edge_color)
    draw = ImageDraw.Draw(pb_bg)
    draw.rounded_rectangle([0, 0, pb_w - 1, pb_h - 1], radius=3, fill=input_bg_color, outline=input_border_color, width=1)
    pb_bg.save(os.path.join(out_dir, "pb_bg.bmp"), "BMP")

    # 填充颜色使用暖金黄色以契合主色调
    fill_color = btn_color
    pb_fill = Image.new("RGB", (pb_w, pb_h), fill_color)
    draw = ImageDraw.Draw(pb_fill)
    draw.line([0, 0, pb_w - 1, 0], fill=(255, 224, 130))
    pb_fill.save(os.path.join(out_dir, "pb_fill.bmp"), "BMP")

    halo_w = 30
    pb_halo = Image.new("RGB", (halo_w, pb_h), fill_color)
    draw = ImageDraw.Draw(pb_halo)
    white = (255, 255, 255)
    for x in range(halo_w):
        dist = x - (halo_w // 2)
        sigma = 5.0
        g = math.exp(-((dist / sigma) ** 2))
        r = int(fill_color[0] + (white[0] - fill_color[0]) * g)
        g_val = int(fill_color[1] + (white[1] - fill_color[1]) * g)
        b = int(fill_color[2] + (white[2] - fill_color[2]) * g)
        draw.line([x, 0, x, pb_h - 1], fill=(r, g_val, b))
    pb_halo.save(os.path.join(out_dir, "pb_halo.bmp"), "BMP")

    # -------------------------------------------------------------
    # 9. 弹出式对话框的半透明变暗背景: bg_blocker.bmp (540x380)
    # -------------------------------------------------------------
    # 将原来的 bg_main 变暗 (乘以 0.45)
    bg_blocker = bg_img.copy()
    blocker_pixels = bg_blocker.load()
    for y in range(h):
        for x in range(w):
            r, g, b = blocker_pixels[x, y]
            blocker_pixels[x, y] = (int(r * 0.45), int(g * 0.45), int(b * 0.45))
    bg_blocker.save(os.path.join(out_dir, "bg_blocker.bmp"), "BMP")

    # -------------------------------------------------------------
    # 10. 弹出式对话框背景卡片: popup_bg.bmp (360x180)
    # -------------------------------------------------------------
    pop_w, pop_h = 360, 180
    pop_bg = Image.new("RGB", (pop_w, pop_h), (8, 9, 10)) # Blends with the dimmed background
    pop_draw = ImageDraw.Draw(pop_bg)
    # 填充深灰色圆角矩形
    pop_draw.rounded_rectangle([0, 0, pop_w - 1, pop_h - 1], radius=8, fill=(39, 41, 45), outline=(63, 66, 72), width=1)
    # 绘制顶部分割线
    pop_draw.line([0, 40, pop_w - 1, 40], fill=(55, 58, 64), width=1)
    pop_bg.save(os.path.join(out_dir, "popup_bg.bmp"), "BMP")

    # -------------------------------------------------------------
    # 11. 弹出框“取消安装”按钮 (深灰): btn_dialog_cancel.bmp (100x32)
    # -------------------------------------------------------------
    btn_dlg_w, btn_dlg_h = 100, 32
    cancel_btn = Image.new("RGB", (btn_dlg_w, btn_dlg_h), (39, 41, 45))
    cancel_draw = ImageDraw.Draw(cancel_btn)
    cancel_draw.rounded_rectangle([0, 0, btn_dlg_w - 1, btn_dlg_h - 1], radius=4, fill=(55, 58, 64))
    text = "取消安装"
    if font_btn:
        text_bbox = cancel_draw.textbbox((0, 0), text, font=font_btn)
        tw = text_bbox[2] - text_bbox[0]
        th = text_bbox[3] - text_bbox[1]
        tx = (btn_dlg_w - tw) // 2
        ty = (btn_dlg_h - th) // 2 - 2
        cancel_draw.text((tx, ty), text, fill=(229, 231, 235), font=font_btn) # 浅灰/白字
    cancel_btn.save(os.path.join(out_dir, "btn_dialog_cancel.bmp"), "BMP")

    # -------------------------------------------------------------
    # 12. 弹出框“继续安装”按钮 (黄): btn_dialog_continue.bmp (100x32)
    # -------------------------------------------------------------
    continue_btn = Image.new("RGB", (btn_dlg_w, btn_dlg_h), (39, 41, 45))
    continue_draw = ImageDraw.Draw(continue_btn)
    continue_draw.rounded_rectangle([0, 0, btn_dlg_w - 1, btn_dlg_h - 1], radius=4, fill=btn_color)
    text = "继续安装"
    if font_btn:
        text_bbox = continue_draw.textbbox((0, 0), text, font=font_btn)
        tw = text_bbox[2] - text_bbox[0]
        th = text_bbox[3] - text_bbox[1]
        tx = (btn_dlg_w - tw) // 2
        ty = (btn_dlg_h - th) // 2 - 2
        continue_draw.text((tx, ty), text, fill=btn_text_color, font=font_btn)
    continue_btn.save(os.path.join(out_dir, "btn_dialog_continue.bmp"), "BMP")

    print("Successfully generated all optimized borderless assets!")

if __name__ == "__main__":
    make_assets()
