#!/usr/bin/env python3
"""
AdvocateAI logo generator — v2 refined.
Outputs: icon.png, adaptive-icon.png, splash.png, notification-icon.png
"""

import os, math
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')

# ── Brand colours ─────────────────────────────────────────────────────────────
BG         = (10, 10, 10)
DARK_NAVY  = (8, 18, 42)
MID_NAVY   = (14, 30, 70)
PRIMARY    = (74, 144, 226)
PRIMARY_L  = (130, 190, 255)
PRIMARY_D  = (40, 90, 170)
GOLD       = (255, 190, 50)
WHITE      = (255, 255, 255)
OFF_WHITE  = (220, 230, 245)

FONT_BOLD = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'
FONT_REG  = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'


def load_font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()


def text_center(draw, cx, y, text, font, fill):
    bbox = draw.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    draw.text((cx - w // 2 - bbox[0], y - bbox[1]), text, fill=fill, font=font)
    return h


def shield_pts(cx, cy, w, h):
    """Pentagon shield (flat top, pointed bottom)."""
    hw = w / 2
    curve_y = cy + h * 0.14   # where sides start to taper
    return [
        (cx - hw,  cy - h * 0.5),   # TL
        (cx + hw,  cy - h * 0.5),   # TR
        (cx + hw,  curve_y),         # BR shoulder
        (cx,       cy + h * 0.5),   # bottom point
        (cx - hw,  curve_y),         # BL shoulder
    ]


def draw_scales(draw, cx, cy, sz, colour):
    """Stylised balance scale — arm at top, chains hang down, pans at bottom."""
    lw    = max(3, int(sz / 34))
    arm   = sz * 0.58    # total arm span
    pole  = sz * 0.42    # pole height (arm to base)
    pw    = sz * 0.24    # pan diameter
    ph    = sz * 0.06    # pan height (ellipse)
    chain = sz * 0.24    # chain length from arm to pan

    arm_y = cy - sz * 0.16   # arm sits in upper portion of shield

    # horizontal arm
    draw.rectangle([cx - arm/2, arm_y - lw, cx + arm/2, arm_y + lw], fill=colour)
    # fulcrum dot at centre
    draw.ellipse([cx - lw*2, arm_y - lw*2, cx + lw*2, arm_y + lw*2], fill=colour)
    # pole — hangs from arm centre down to base
    draw.rectangle([cx - lw, arm_y, cx + lw, arm_y + pole], fill=colour)
    # base
    bw = sz * 0.30
    draw.rectangle([cx - bw/2, arm_y + pole - lw, cx + bw/2, arm_y + pole + lw*2], fill=colour)

    # left chain + pan (level)
    lx = cx - arm/2
    draw.rectangle([lx - lw, arm_y + lw, lx + lw, arm_y + lw + chain], fill=colour)
    draw.ellipse([lx - pw/2, arm_y + lw + chain - ph/2,
                  lx + pw/2, arm_y + lw + chain + ph/2], fill=colour)

    # right chain + pan (slightly lower — "justice in use")
    rx   = cx + arm/2
    drop = sz * 0.08
    draw.rectangle([rx - lw, arm_y + lw, rx + lw, arm_y + lw + chain + drop], fill=colour)
    draw.ellipse([rx - pw/2, arm_y + lw + chain + drop - ph/2,
                  rx + pw/2, arm_y + lw + chain + drop + ph/2], fill=colour)


def ai_badge(img, draw, bx, by, r, font_size):
    # gold glow
    g = Image.new('RGBA', img.size, (0,0,0,0))
    gd = ImageDraw.Draw(g)
    gd.ellipse([bx - r*2.2, by - r*2.2, bx + r*2.2, by + r*2.2], fill=(*GOLD, 55))
    img = Image.alpha_composite(img, g.filter(ImageFilter.GaussianBlur(r * 0.9)))
    draw = ImageDraw.Draw(img)

    # badge circle
    draw.ellipse([bx - r, by - r, bx + r, by + r],
                  fill=GOLD, outline=WHITE, width=max(2, int(r/14)))
    font = load_font(FONT_BOLD, int(font_size))
    bbox = draw.textbbox((0,0), 'AI', font=font)
    tw, th = bbox[2]-bbox[0], bbox[3]-bbox[1]
    draw.text((bx - tw//2 - bbox[0], by - th//2 - bbox[1]), 'AI',
               fill=(20, 12, 4), font=font)
    return img


def radial_gradient(img, cx, cy, r_inner, r_outer, colour, alpha_inner, alpha_outer):
    """Paint a soft radial glow onto img (RGBA)."""
    steps = 28
    layer = Image.new('RGBA', img.size, (0,0,0,0))
    ld = ImageDraw.Draw(layer)
    for i in range(steps, 0, -1):
        t   = i / steps
        r   = r_inner + (r_outer - r_inner) * (1 - t)
        a   = int(alpha_inner + (alpha_outer - alpha_inner) * (1 - t))
        ld.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(*colour, a))
    return Image.alpha_composite(img, layer)


# ════════════════════════════════════════════════════════════════════════════════
# APP ICON  1024 × 1024
# ════════════════════════════════════════════════════════════════════════════════
def make_icon(S=1024) -> Image.Image:
    img = Image.new('RGBA', (S, S), (0,0,0,0))
    draw = ImageDraw.Draw(img)
    cx, cy = S//2, S//2

    # ── Background: rounded square with gradient ─────────────────────────────
    rr = int(S * 0.23)
    # dark navy base
    draw.rounded_rectangle([0, 0, S, S], radius=rr, fill=(*DARK_NAVY, 255))
    # diagonal highlight overlay (top-left lighter)
    hl = Image.new('RGBA', (S, S), (0,0,0,0))
    hd = ImageDraw.Draw(hl)
    hd.rounded_rectangle([0, 0, S, S], radius=rr, fill=(40, 70, 140, 55))
    hl = hl.filter(ImageFilter.GaussianBlur(S * 0.25))
    # shift to top-left
    img = Image.alpha_composite(img, hl.transform(img.size, Image.AFFINE, (1,0,-S*0.3,0,1,-S*0.3)))

    # ── Subtle blue ambient glow ─────────────────────────────────────────────
    img = radial_gradient(img, cx, cy, S*0.05, S*0.48, PRIMARY, 35, 0)

    draw = ImageDraw.Draw(img)

    # ── Shield ───────────────────────────────────────────────────────────────
    sw, sh = S * 0.60, S * 0.66
    pts    = shield_pts(cx, cy - S*0.02, sw, sh)

    # drop shadow
    sha = Image.new('RGBA', (S,S), (0,0,0,0))
    sd  = ImageDraw.Draw(sha)
    sd.polygon(shield_pts(cx+S*0.015, cy+S*0.02, sw, sh), fill=(0,0,0,160))
    img = Image.alpha_composite(img, sha.filter(ImageFilter.GaussianBlur(S*0.028)))
    draw = ImageDraw.Draw(img)

    # shield fill — rich dark blue
    draw.polygon(pts, fill=(*MID_NAVY, 255))

    # inner gradient lift (lighter at top)
    lift = Image.new('RGBA', (S,S), (0,0,0,0))
    ld   = ImageDraw.Draw(lift)
    ld.polygon(shield_pts(cx, cy - S*0.02, sw*0.88, sh*0.55), fill=(*PRIMARY_D, 80))
    img  = Image.alpha_composite(img, lift.filter(ImageFilter.GaussianBlur(S*0.04)))
    draw = ImageDraw.Draw(img)

    # shield border — bright blue outline with inner glow pass
    for bw, alpha, col in [(10, 255, PRIMARY_L), (6, 200, PRIMARY_L), (3, 140, WHITE)]:
        draw.polygon(pts, outline=(*col, alpha), width=bw)

    # top-edge shine (specular highlight)
    shine_pts = [
        (cx - sw*0.30, cy - sh*0.50),
        (cx + sw*0.30, cy - sh*0.50),
        (cx + sw*0.22, cy - sh*0.20),
        (cx - sw*0.22, cy - sh*0.20),
    ]
    shine = Image.new('RGBA', (S,S), (0,0,0,0))
    ImageDraw.Draw(shine).polygon(shine_pts, fill=(255,255,255,28))
    img = Image.alpha_composite(img, shine.filter(ImageFilter.GaussianBlur(S*0.018)))
    draw = ImageDraw.Draw(img)

    # ── Scales of justice ────────────────────────────────────────────────────
    scale_y = cy - S*0.02 + S*0.02
    draw_scales(draw, cx, scale_y, S*0.40, OFF_WHITE)

    # ── AI badge ─────────────────────────────────────────────────────────────
    br   = S * 0.098
    bx   = cx + sw * 0.285
    by_s = cy - S*0.02
    by   = by_s + sh * 0.265
    img  = ai_badge(img, draw, bx, by, br, br * 0.88)

    return img


# ════════════════════════════════════════════════════════════════════════════════
# ADAPTIVE ICON  foreground 1024 × 1024  (transparent bg)
# ════════════════════════════════════════════════════════════════════════════════
def make_adaptive(S=1024) -> Image.Image:
    img  = Image.new('RGBA', (S,S), (0,0,0,0))
    cx, cy = S//2, S//2

    # Glow
    img = radial_gradient(img, cx, cy, S*0.05, S*0.50, PRIMARY, 50, 0)
    draw = ImageDraw.Draw(img)

    sw, sh = S * 0.62, S * 0.68
    pts    = shield_pts(cx, cy, sw, sh)

    sha = Image.new('RGBA', (S,S), (0,0,0,0))
    ImageDraw.Draw(sha).polygon(shield_pts(cx+12, cy+14, sw, sh), fill=(0,0,0,130))
    img = Image.alpha_composite(img, sha.filter(ImageFilter.GaussianBlur(26)))
    draw = ImageDraw.Draw(img)

    draw.polygon(pts, fill=(*MID_NAVY, 255))
    for bw, alpha, col in [(9, 255, PRIMARY_L), (5, 200, PRIMARY), (2, 120, WHITE)]:
        draw.polygon(pts, outline=(*col, alpha), width=bw)

    draw_scales(draw, cx, cy + S*0.02, S*0.42, OFF_WHITE)

    br  = S * 0.10
    bx  = cx + sw * 0.285
    by  = cy + sh * 0.26
    img = ai_badge(img, draw, bx, by, br, br * 0.88)

    return img


# ════════════════════════════════════════════════════════════════════════════════
# SPLASH  1284 × 2778
# ════════════════════════════════════════════════════════════════════════════════
def make_splash(W=1284, H=2778) -> Image.Image:
    img  = Image.new('RGBA', (W, H), (*BG, 255))
    draw = ImageDraw.Draw(img)
    cx   = W // 2
    # Vertical centre slightly above middle for visual balance
    cy   = int(H * 0.44)

    # Ambient glow — tighter than before
    img = radial_gradient(img, cx, cy, W*0.05, W*0.58, PRIMARY, 28, 0)
    draw = ImageDraw.Draw(img)

    # Shield
    sw, sh = W * 0.50, W * 0.56
    pts    = shield_pts(cx, cy, sw, sh)

    sha = Image.new('RGBA', (W, H), (0,0,0,0))
    ImageDraw.Draw(sha).polygon(shield_pts(cx+10, cy+14, sw, sh), fill=(0,0,0,120))
    img = Image.alpha_composite(img, sha.filter(ImageFilter.GaussianBlur(20)))
    draw = ImageDraw.Draw(img)

    draw.polygon(pts, fill=(*MID_NAVY, 255))
    # gradient lift
    lift = Image.new('RGBA', (W,H), (0,0,0,0))
    ImageDraw.Draw(lift).polygon(shield_pts(cx, cy, sw*0.86, sh*0.52), fill=(*PRIMARY_D, 70))
    img = Image.alpha_composite(img, lift.filter(ImageFilter.GaussianBlur(W*0.04)))
    draw = ImageDraw.Draw(img)

    for bw, alpha, col in [(8, 255, PRIMARY_L), (5, 190, PRIMARY), (2, 110, WHITE)]:
        draw.polygon(pts, outline=(*col, alpha), width=bw)

    draw_scales(draw, cx, cy + W*0.022, W*0.34, OFF_WHITE)

    br   = W * 0.082
    bx   = cx + sw * 0.285
    by   = cy + sh * 0.265
    img  = ai_badge(img, draw, bx, by, br, br * 0.88)
    draw = ImageDraw.Draw(img)

    # App name
    text_top = int(cy + sh * 0.54 + W * 0.04)
    fn  = load_font(FONT_BOLD, int(W * 0.092))
    fns = load_font(FONT_REG,  int(W * 0.041))

    text_center(draw, cx, text_top, 'AdvocateAI', fn, WHITE)
    text_center(draw, cx, text_top + int(W * 0.115), 'Your private document advocate', fns, (*PRIMARY_L, 210))

    return img


# ════════════════════════════════════════════════════════════════════════════════
# NOTIFICATION ICON  96 × 96  (monochrome white on transparent)
# ════════════════════════════════════════════════════════════════════════════════
def make_notif(S=96) -> Image.Image:
    img  = Image.new('RGBA', (S,S), (0,0,0,0))
    draw = ImageDraw.Draw(img)
    cx, cy = S//2, S//2
    sw, sh = S*0.76, S*0.82
    draw.polygon(shield_pts(cx, cy-S*0.02, sw, sh), fill=(255,255,255,255))
    # carve out centre for outline style
    draw.polygon(shield_pts(cx, cy-S*0.02, sw*0.70, sh*0.70), fill=(0,0,0,0))
    return img


# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    os.makedirs(ASSETS, exist_ok=True)

    print('Generating AdvocateAI logo assets…')

    icon = make_icon(1024)
    icon.convert('RGB').save(os.path.join(ASSETS, 'icon.png'))
    print('  ✓ icon.png (1024×1024)')

    adap = make_adaptive(1024)
    adap.save(os.path.join(ASSETS, 'adaptive-icon.png'))
    print('  ✓ adaptive-icon.png (1024×1024 RGBA)')

    splash = make_splash(1284, 2778)
    splash.convert('RGB').save(os.path.join(ASSETS, 'splash.png'))
    print('  ✓ splash.png (1284×2778)')

    notif = make_notif(96)
    notif.save(os.path.join(ASSETS, 'notification-icon.png'))
    print('  ✓ notification-icon.png (96×96)')

    print('\nDone. All assets saved to assets/')
