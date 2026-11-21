import argparse
from pathlib import Path
from PIL import Image, ImageDraw

parser = argparse.ArgumentParser()
parser.add_argument('directory')
parser.add_argument('pattern')
args = parser.parse_args()
directory = Path(args.directory)
files = sorted(directory.glob(args.pattern), key=lambda p: int(p.stem.split('-')[-1]))
width, height, cols = 250, 375, 4
canvas = Image.new('RGB', (width * cols, height * ((len(files) + cols - 1) // cols)), '#bbbbbb')
draw = ImageDraw.Draw(canvas)
for i, file in enumerate(files):
    page = Image.open(file).convert('RGB')
    page.thumbnail((width - 10, height - 25))
    x, y = (i % cols) * width, (i // cols) * height
    canvas.paste(page, (x + (width - page.width) // 2, y + 20))
    draw.text((x + 5, y + 3), file.name, fill='black')
canvas.save(directory / 'corrected-contact.png')
