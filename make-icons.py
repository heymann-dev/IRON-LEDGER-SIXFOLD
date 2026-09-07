from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def make_icon(size: int) -> None:
    image = Image.new("RGB", (size, size), "#040705")
    draw = ImageDraw.Draw(image)
    pad = round(size * 0.13)
    cut = round(size * 0.11)
    width = max(3, round(size * 0.024))
    frame = [
        (pad, pad),
        (size - pad - cut, pad),
        (size - pad, pad + cut),
        (size - pad, size - pad),
        (pad + cut, size - pad),
        (pad, size - pad - cut),
    ]
    draw.polygon(frame, fill="#0c120e", outline="#d6a344", width=width)
    font = ImageFont.truetype(FONT, round(size * 0.34))
    text = "IL"
    box = draw.textbbox((0, 0), text, font=font)
    x = (size - (box[2] - box[0])) / 2
    y = (size - (box[3] - box[1])) / 2 - box[1]
    draw.text((x, y), text, font=font, fill="#f0cb79")
    dot = round(size * 0.022)
    cx, cy = size - pad - round(size * 0.045), pad + round(size * 0.045)
    draw.ellipse((cx - dot, cy - dot, cx + dot, cy + dot), fill="#60c989")
    image.save(ROOT / "dist" / f"icon-{size}.png", optimize=True)


for icon_size in (192, 512):
    make_icon(icon_size)
