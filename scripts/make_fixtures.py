"""Builds Y4M fake-camera feeds for the automated browser tests (Chromium --use-file-for-fake-video-capture).

usage: python3 -I scripts/make_fixtures.py <fixtures_dir>
  person-<name>.y4m : a real photo placed on a 16:9 canvas with ±1-2 px jitter (simulates a person holding still)
  empty.y4m         : an empty room (nobody in frame)
  football.y4m      : synthetic pitch, two goals, an orange ball shot into the right-hand goal (then back out, then a second shot)
"""
import sys, os, math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H, FPS = 640, 360, 15
out = sys.argv[1]

def write_y4m(path, frames):
    with open(path, 'wb') as f:
        f.write(f'YUV4MPEG2 W{W} H{H} F{FPS}:1 Ip A1:1 C420jpeg\n'.encode())
        for img in frames:
            a = np.asarray(img.convert('RGB'), dtype=np.float32)
            r, g, b = a[..., 0], a[..., 1], a[..., 2]
            y = 0.299 * r + 0.587 * g + 0.114 * b
            u = -0.168736 * r - 0.331264 * g + 0.5 * b + 128
            v = 0.5 * r - 0.418688 * g - 0.081312 * b + 128
            u = u.reshape(H // 2, 2, W // 2, 2).mean(axis=(1, 3))
            v = v.reshape(H // 2, 2, W // 2, 2).mean(axis=(1, 3))
            f.write(b'FRAME\n')
            for p in (y, u, v):
                f.write(np.clip(p, 0, 255).astype(np.uint8).tobytes())

def person(src, name, seconds=12):
    im = Image.open(src).convert('RGB')
    scale = min(W / im.width, H / im.height) * 0.95
    im = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
    bg = Image.new('RGB', (W, H), (205, 205, 200))
    rnd = random.Random(1)
    frames = []
    for i in range(seconds * FPS):
        fr = bg.copy()
        fr.paste(im, ((W - im.width) // 2 + rnd.randint(-1, 1), (H - im.height) // 2 + rnd.randint(-1, 1)))
        frames.append(fr)
    write_y4m(os.path.join(out, f'person-{name}.y4m'), frames)

def empty(seconds=6):
    bg = Image.new('RGB', (W, H), (190, 190, 185))
    d = ImageDraw.Draw(bg); d.rectangle([0, 260, W, H], fill=(120, 100, 80))
    write_y4m(os.path.join(out, 'empty.y4m'), [bg] * (seconds * FPS))

# Football scene geometry (pixels at 640x360). Exported for the test script.
PITCH = [(40, 60), (600, 60), (600, 320), (40, 320)]
GOAL_R = ((600, 150), (600, 230), (625, 190))   # left post, right post, inside point
GOAL_L = ((40, 150), (40, 230), (15, 190))

def football():
    rnd = np.random.default_rng(3)
    base = Image.new('RGB', (W, H), (40, 120, 55))
    px = np.asarray(base).astype(np.int16) + rnd.integers(-12, 12, (H, W, 1))
    base = Image.fromarray(np.clip(px, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(base)
    d.polygon(PITCH, outline=(235, 235, 235), width=2)
    for (p1, p2, _) in (GOAL_R, GOAL_L):
        d.line([p1, p2], fill=(250, 250, 250), width=3)
        dx = 25 if p1[0] > 320 else -25
        d.rectangle([min(p1[0], p1[0] + dx), p1[1], max(p1[0], p1[0] + dx), p2[1]], outline=(250, 250, 250), width=2)
    # a "player" in a dark shirt to add distractors
    path = []
    # 2 s idle at centre, shot into right goal, rests in net, comes back to centre (restart), second shot wide (miss), then a third shot in.
    def lin(a, b, n): return [(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n) for k in range(n)]
    path += [(320, 190)] * (2 * FPS)
    path += lin((320, 190), (640 - 22, 192), 18)          # shot (≈ 1.2 s)
    path += [(618, 192)] * (1 * FPS)                      # in the net
    path += lin((618, 192), (320, 190), 20)               # carried back
    path += [(320, 190)] * (3 * FPS)                      # kick-off wait (re-arm)
    path += lin((320, 190), (630, 290), 18)               # wide of the post (miss)
    path += lin((630, 290), (320, 190), 20)
    path += [(320, 190)] * (3 * FPS)
    path += lin((320, 190), (22, 175), 18)                # shot into LEFT goal
    path += [(22, 175)] * (2 * FPS)
    frames = []
    for i, (x, y) in enumerate(path):
        fr = base.copy(); g = ImageDraw.Draw(fr)
        g.rectangle([300 + 30 * math.sin(i / 9), 120, 320 + 30 * math.sin(i / 9), 200], fill=(30, 30, 40))
        g.ellipse([x - 7, y - 7, x + 7, y + 7], fill=(255, 120, 10))
        frames.append(fr.filter(ImageFilter.GaussianBlur(0.6)))
    write_y4m(os.path.join(out, 'football.y4m'), frames)
    print('football frames', len(frames), 'seconds', len(frames) / FPS)

os.makedirs(out, exist_ok=True)
person(os.path.join(out, 'pose.jpg'), 'warrior')
person(os.path.join(out, 'male_full_height_hands.jpg'), 'standing')
empty()
football()
# WebM copies for the recorded-video tests (Playwright's Chromium has no H.264).
import shutil, subprocess
if shutil.which('ffmpeg'):
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', os.path.join(out, 'football.y4m'), '-c:v', 'libvpx', '-b:v', '2M', '-an', os.path.join(out, 'football.webm')], check=True)
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', os.path.join(out, 'person-warrior.y4m'), '-t', '8', '-c:v', 'libvpx', '-b:v', '1M', '-an', os.path.join(out, 'warrior.webm')], check=True)
else:
    print('ffmpeg not found: skipping WebM files (recorded-video e2e scenarios need them)')
print('done')
