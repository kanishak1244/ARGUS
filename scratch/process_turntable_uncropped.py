import os
from PIL import Image
from rembg import remove, new_session

images_info = [
    {
        "file": r"C:\Users\vashi\.gemini\antigravity\brain\d0730fca-53ae-4a5a-aa6f-8efebf4de716\.user_uploaded\media_1790423658819.png",
        "name": "rover-turntable-1-front.png",
        "label": "FRONT VIEW"
    },
    {
        "file": r"C:\Users\vashi\.gemini\antigravity\brain\d0730fca-53ae-4a5a-aa6f-8efebf4de716\.user_uploaded\media_1790423666170.png",
        "name": "rover-turntable-2-frontright.png",
        "label": "FRONT-RIGHT 3/4"
    },
    {
        "file": r"C:\Users\vashi\.gemini\antigravity\brain\d0730fca-53ae-4a5a-aa6f-8efebf4de716\.user_uploaded\media_1790423648321.jpg",
        "name": "rover-turntable-3-right.png",
        "label": "RIGHT SIDE"
    },
    {
        "file": r"C:\Users\vashi\.gemini\antigravity\brain\d0730fca-53ae-4a5a-aa6f-8efebf4de716\.user_uploaded\media_1790423643032.jpg",
        "name": "rover-turntable-4-back.png",
        "label": "REAR VIEW"
    },
    {
        "file": r"C:\Users\vashi\.gemini\antigravity\brain\d0730fca-53ae-4a5a-aa6f-8efebf4de716\.user_uploaded\media_1790423637893.png",
        "name": "rover-turntable-5-left.png",
        "label": "LEFT SIDE"
    }
]

output_dir = r"c:\Users\vashi\OneDrive\Desktop\ARGUS\argus-_-autonomous-surveillance-&-hazard-rover\assets"

CANVAS_W = 1000
CANVAS_H = 750
TARGET_ROVER_H = 540  # Generous height within 750px canvas, leaving 105px top and bottom margin!
BASELINE_Y = 640

session = new_session("u2net")
print("Processing uncropped turntable frames...")

for item in images_info:
    src_path = item["file"]
    print(f"Processing {item['label']} ({os.path.basename(src_path)})...")
    
    with Image.open(src_path) as img:
        img_rgb = img.convert("RGB")
        nobg = remove(img_rgb, session=session)
        
        # Get bounding box of non-transparent content
        bbox = nobg.getbbox()
        if bbox:
            cropped = nobg.crop(bbox)
        else:
            cropped = nobg
            
        crop_w, crop_h = cropped.size
        
        # Scale based on target height, but ensure width also fits with margin
        scale_ratio = TARGET_ROVER_H / float(crop_h)
        new_w = int(crop_w * scale_ratio)
        new_h = TARGET_ROVER_H
        
        if new_w > (CANVAS_W - 80):
            scale_ratio = (CANVAS_W - 80) / float(crop_w)
            new_w = CANVAS_W - 80
            new_h = int(crop_h * scale_ratio)
        
        resized_rover = cropped.resize((new_w, new_h), Image.Resampling.LANCZOS)
        
        # Create canvas with transparent background
        canvas = Image.new("RGBA", (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
        
        # Place rover centered horizontally, bottom anchored at BASELINE_Y
        pos_x = (CANVAS_W - new_w) // 2
        pos_y = BASELINE_Y - new_h
        
        canvas.paste(resized_rover, (pos_x, pos_y), resized_rover)
        
        out_path = os.path.join(output_dir, item["name"])
        canvas.save(out_path, "PNG")
        print(f"Saved: {out_path} (Size: {new_w}x{new_h} at offset x={pos_x}, y={pos_y})")

print("Uncropped turntable frames processed successfully!")
