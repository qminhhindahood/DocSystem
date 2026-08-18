from PIL import Image, ImageDraw
import os
os.makedirs(r"eval/fixtures/media", exist_ok=True)
for name in ("seal_quyet_dinh", "seal_cong_van", "seal_thong_bao"):
    img = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([10, 10, 190, 190], outline=(200, 30, 30, 255), width=8)
    d.ellipse([40, 40, 160, 160], outline=(200, 30, 30, 255), width=4)
    d.text((70, 90), "SEAL", fill=(200, 30, 30, 255))
    img.save(rf"eval/fixtures/media/{name}.png")
print("seals written")
