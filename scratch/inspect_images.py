import os
from PIL import Image

media_files = [
    r"C:\Users\vashi\.gemini\antigravity\brain\d0730fca-53ae-4a5a-aa6f-8efebf4de716\.user_uploaded\media_1790423637893.png",
    r"C:\Users\vashi\.gemini\antigravity\brain\d0730fca-53ae-4a5a-aa6f-8efebf4de716\.user_uploaded\media_1790423643032.jpg",
    r"C:\Users\vashi\.gemini\antigravity\brain\d0730fca-53ae-4a5a-aa6f-8efebf4de716\.user_uploaded\media_1790423648321.jpg",
    r"C:\Users\vashi\.gemini\antigravity\brain\d0730fca-53ae-4a5a-aa6f-8efebf4de716\.user_uploaded\media_1790423658819.png",
    r"C:\Users\vashi\.gemini\antigravity\brain\d0730fca-53ae-4a5a-aa6f-8efebf4de716\.user_uploaded\media_1790423666170.png",
]

for idx, f in enumerate(media_files):
    if os.path.exists(f):
        img = Image.open(f)
        print(f"File {idx+1}: {os.path.basename(f)} - Format: {img.format}, Size: {img.size}, Mode: {img.mode}")
    else:
        print(f"File {idx+1}: NOT FOUND {f}")
