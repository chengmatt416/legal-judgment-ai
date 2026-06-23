import os
import zlib
import struct

def write_png(width, height, pixel_func, filepath):
    # PNG Signature
    png = bytearray([137, 80, 78, 71, 13, 10, 26, 10])
    
    # Helper to write chunk
    def write_chunk(chunk_type, data):
        nonlocal png
        length = len(data)
        png += struct.pack('>I', length)
        png += chunk_type
        png += data
        crc = zlib.crc32(chunk_type + data)
        png += struct.pack('>I', crc)
        
    # IHDR chunk
    # width, height, bit depth (8), color type (6 = RGBA), compression (0), filter (0), interlace (0)
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    write_chunk(b'IHDR', ihdr)
    
    # IDAT chunk
    scanlines = bytearray()
    for y in range(height):
        scanlines.append(0) # Filter type 0
        for x in range(width):
            r, g, b, a = pixel_func(x, y, width, height)
            scanlines.extend([r, g, b, a])
            
    idat = zlib.compress(scanlines)
    write_chunk(b'IDAT', idat)
    
    # IEND chunk
    write_chunk(b'IEND', b'')
    
    # Create directory if not exists
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, 'wb') as f:
        f.write(png)

def draw_scale(x, y, w, h):
    # Normalized coordinates from 0 to 1
    nx = x / (w - 1) if w > 1 else 0.5
    ny = y / (h - 1) if h > 1 else 0.5
    
    # Distance from center
    cx, cy = 0.5, 0.5
    dx = nx - cx
    dy = ny - cy
    dist = (dx*dx + dy*dy)**0.5
    
    bg_color = (15, 23, 42, 255) # Slate 900
    gold = (201, 163, 92, 255)    # #C9A35C
    transparent = (0, 0, 0, 0)
    
    # 1. Circle container
    if dist > 0.48:
        return transparent
    elif dist > 0.44:
        return gold # outer gold ring
    
    # 2. Background
    # Small size 16x16 icon needs solid look, others look better with background
    if w <= 16:
        # For small icon, render scale directly on transparent or simple background
        if dist > 0.44:
            return transparent
    
    color = bg_color
    
    # 3. Draw scale of justice
    # Stand (vertical column): x between 0.48 and 0.52, y between 0.22 and 0.72
    if 0.47 <= nx <= 0.53 and 0.22 <= ny <= 0.72:
        return gold
        
    # Stand base: y between 0.70 and 0.76, x between 0.36 and 0.64
    if 0.70 <= ny <= 0.76 and 0.36 <= nx <= 0.64:
        return gold
        
    # Main beam (horizontal crossbar): y between 0.30 and 0.36, x between 0.18 and 0.82
    if 0.30 <= ny <= 0.36 and 0.18 <= nx <= 0.82:
        return gold
        
    # Left hanging plate (x center = 0.22, y = 0.54)
    # Plate: y at 0.54 to 0.58, x between 0.14 and 0.30
    if 0.54 <= ny <= 0.58 and 0.14 <= nx <= 0.30:
        return gold
    # Triangle suspension lines (left):
    if 0.36 <= ny <= 0.54:
        left_bound = 0.22 - (ny - 0.36) * (0.22 - 0.14) / (0.54 - 0.36)
        right_bound = 0.22 + (ny - 0.36) * (0.30 - 0.22) / (0.54 - 0.36)
        # Add thin boundary checks
        thickness = 0.035 if w <= 48 else 0.02
        if abs(nx - left_bound) < thickness or abs(nx - right_bound) < thickness:
            return gold
            
    # Right hanging plate (x center = 0.78, y = 0.54)
    # Plate: y at 0.54 to 0.58, x between 0.70 and 0.86
    if 0.54 <= ny <= 0.58 and 0.70 <= nx <= 0.86:
        return gold
    # Triangle suspension lines (right):
    if 0.36 <= ny <= 0.54:
        left_bound = 0.78 - (ny - 0.36) * (0.78 - 0.70) / (0.54 - 0.36)
        right_bound = 0.78 + (ny - 0.36) * (0.86 - 0.78) / (0.54 - 0.36)
        thickness = 0.035 if w <= 48 else 0.02
        if abs(nx - left_bound) < thickness or abs(nx - right_bound) < thickness:
            return gold

    # Small size 16x16 icon optimization (render transparent if not matching gold)
    if w <= 16:
        if color == bg_color:
            return transparent

    return color

def main():
    sizes = [16, 48, 128]
    print("Generating icons...")
    for size in sizes:
        filepath = f"icons/icon{size}.png"
        write_png(size, size, draw_scale, filepath)
        print(f"Generated {filepath}")
    print("Icons generated successfully!")

if __name__ == "__main__":
    main()
